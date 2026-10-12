-- Who recorded each transaction, and who last changed it.
--
-- In a shared budget, transactions belong to the owner (user_id) but may be
-- recorded and edited by any member. created_by is the signed-in user at
-- insert time and never changes; updated_by is the signed-in user of the
-- latest edit (null until the first edit). Both come from auth.uid(), never
-- from the request.

alter table app_data.transactions
  add column created_by uuid references app_data.profiles (id) on delete set null,
  add column updated_by uuid references app_data.profiles (id) on delete set null;

-- Before sharing existed, every transaction was recorded by its owner.
update app_data.transactions set created_by = user_id where created_by is null;

create index transactions_created_by_idx on app_data.transactions (user_id, created_by)
  where created_by is not null;

-- The service role (Telegram phase) has no auth.uid() and must pass these
-- columns itself.
create function app_data.transactions_set_audit() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.updated_by := null;
    return new;
  end if;
  -- authenticated has no UPDATE grant on these columns, so a change to them
  -- is the FK's "on delete set null" (or the service role): leave it alone.
  if new.created_by is distinct from old.created_by
     or new.updated_by is distinct from old.updated_by then
    return new;
  end if;
  new.updated_by := coalesce(auth.uid(), old.updated_by);
  return new;
end;
$$;

create trigger transactions_audit before insert or update on app_data.transactions
  for each row execute function app_data.transactions_set_audit();

-- Display names of everyone who can appear as a recorder or editor in a
-- budget: the owner, current members, and former members who recorded or
-- edited something there.
-- SECURITY DEFINER because owners cannot read their members' profiles; it
-- answers only for budgets the caller may open, and exposes names only.
create function app_data.budget_people(p_owner_id uuid) returns table (id uuid, name text)
language sql stable security definer set search_path = ''
as $$
  select p.id, coalesce(nullif(p.display_name, ''), u.email, '')
  from (
    select p_owner_id
    union
    select m.member_id from app_data.budget_members m
    where m.owner_id = p_owner_id and m.status = 'accepted'
    union
    select t.created_by from app_data.transactions t
    where t.user_id = p_owner_id and t.created_by is not null
    union
    select t.updated_by from app_data.transactions t
    where t.user_id = p_owner_id and t.updated_by is not null
  ) as ids (id)
  join app_data.profiles p on p.id = ids.id
  left join auth.users u on u.id = p.id
  where p_owner_id in (select app_data.accessible_budget_ids())
$$;

revoke execute on function
  app_data.transactions_set_audit(),
  app_data.budget_people(uuid)
from public;
grant execute on function app_data.budget_people(uuid) to authenticated, service_role;

create or replace function app_data.transaction_json(t app_data.transactions) returns jsonb
language sql stable set search_path = ''
as $$
  select jsonb_build_object(
    'id', t.id,
    'type', t.type,
    'source', t.source,
    'amount_rupiah', t.amount_rupiah::text,
    'account_id', t.account_id,
    'to_account_id', t.to_account_id,
    'category_id', t.category_id,
    'occurred_on', t.occurred_on,
    'note', t.note,
    'version', t.version,
    'created_by', t.created_by,
    'updated_by', t.updated_by,
    'created_at', t.created_at,
    'updated_at', t.updated_at
  )
$$;

-- ---------------------------------------------------------------------------
-- History and export also return the recorder and the last editor. The result type changes, so
-- the functions are dropped and recreated.
-- ---------------------------------------------------------------------------

drop function api.list_transactions(date, date, text, uuid, uuid, text, date, timestamptz, uuid, integer);
drop function api.export_transactions(date, date, text, uuid, uuid, text, date, timestamptz, uuid, integer);
drop function app_data.query_transactions(uuid, date, date, text, uuid, uuid, text, date, timestamptz, uuid, integer);

create function app_data.query_transactions(
  p_user_id uuid,
  p_from date,
  p_to date,
  p_type text,
  p_account_id uuid,
  p_category_id uuid,
  p_search text,
  p_cursor_occurred_on date,
  p_cursor_created_at timestamptz,
  p_cursor_id uuid,
  p_limit integer
) returns table (
  id uuid,
  type text,
  source text,
  amount_rupiah text,
  account_id uuid,
  account_name text,
  to_account_id uuid,
  to_account_name text,
  category_id uuid,
  category_name text,
  occurred_on date,
  note text,
  version integer,
  created_at timestamptz,
  updated_at timestamptz,
  created_by uuid,
  created_by_name text,
  updated_by uuid,
  updated_by_name text
)
language plpgsql stable set search_path = ''
as $$
declare
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_categories uuid[];
begin
  if p_type is not null and p_type not in ('income', 'expense', 'transfer') then
    raise exception 'TYPE_INVALID' using errcode = 'P0001';
  end if;
  if (p_cursor_occurred_on is null) <> (p_cursor_id is null)
     or (p_cursor_id is null) <> (p_cursor_created_at is null) then
    raise exception 'CURSOR_INVALID' using errcode = 'P0001';
  end if;
  if p_category_id is not null then
    v_categories := app_data.category_scope(p_user_id, p_category_id);
  end if;

  return query
  select
    t.id, t.type, t.source, t.amount_rupiah::text,
    t.account_id, a.name,
    t.to_account_id, ta.name,
    t.category_id,
    case when pc.id is null then c.name else pc.name || ' › ' || c.name end,
    t.occurred_on, t.note, t.version, t.created_at, t.updated_at,
    t.created_by, r.name,
    t.updated_by, e.name
  from app_data.transactions t
  join app_data.accounts a on a.id = t.account_id
  left join app_data.accounts ta on ta.id = t.to_account_id
  left join app_data.categories c on c.id = t.category_id
  left join app_data.categories pc on pc.id = c.parent_id
  left join app_data.budget_people(p_user_id) r on r.id = t.created_by
  left join app_data.budget_people(p_user_id) e on e.id = t.updated_by
  where t.user_id = p_user_id
    and (p_from is null or t.occurred_on >= p_from)
    and (p_to is null or t.occurred_on < p_to)
    and (p_type is null or t.type = p_type)
    and (p_account_id is null or t.account_id = p_account_id or t.to_account_id = p_account_id)
    and (v_categories is null or t.category_id = any (v_categories))
    and (v_search is null or strpos(lower(t.note), lower(v_search)) > 0)
    and (p_cursor_id is null
         or (t.occurred_on, t.created_at, t.id) < (p_cursor_occurred_on, p_cursor_created_at, p_cursor_id))
  order by t.occurred_on desc, t.created_at desc, t.id desc
  limit p_limit;
end;
$$;

create function api.list_transactions(
  p_from date default null,
  p_to date default null,
  p_type text default null,
  p_account_id uuid default null,
  p_category_id uuid default null,
  p_search text default null,
  p_cursor_occurred_on date default null,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_limit integer default 50
) returns table (
  id uuid,
  type text,
  source text,
  amount_rupiah text,
  account_id uuid,
  account_name text,
  to_account_id uuid,
  to_account_name text,
  category_id uuid,
  category_name text,
  occurred_on date,
  note text,
  version integer,
  created_at timestamptz,
  updated_at timestamptz,
  created_by uuid,
  created_by_name text,
  updated_by uuid,
  updated_by_name text
)
language sql stable security invoker set search_path = ''
as $$
  select * from app_data.query_transactions(
    app_data.budget_owner(), p_from, p_to, p_type, p_account_id, p_category_id, p_search,
    p_cursor_occurred_on, p_cursor_created_at, p_cursor_id,
    least(greatest(coalesce(p_limit, 50), 1), 50)
  )
$$;

create function api.export_transactions(
  p_from date default null,
  p_to date default null,
  p_type text default null,
  p_account_id uuid default null,
  p_category_id uuid default null,
  p_search text default null,
  p_cursor_occurred_on date default null,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_limit integer default 1000
) returns table (
  id uuid,
  type text,
  source text,
  amount_rupiah text,
  account_id uuid,
  account_name text,
  to_account_id uuid,
  to_account_name text,
  category_id uuid,
  category_name text,
  occurred_on date,
  note text,
  version integer,
  created_at timestamptz,
  updated_at timestamptz,
  created_by uuid,
  created_by_name text,
  updated_by uuid,
  updated_by_name text
)
language sql stable security invoker set search_path = ''
as $$
  select * from app_data.query_transactions(
    app_data.budget_owner(), p_from, p_to, p_type, p_account_id, p_category_id, p_search,
    p_cursor_occurred_on, p_cursor_created_at, p_cursor_id,
    least(greatest(coalesce(p_limit, 1000), 1), 1000)
  )
$$;

revoke execute on function
  app_data.query_transactions(uuid, date, date, text, uuid, uuid, text, date, timestamptz, uuid, integer),
  api.list_transactions(date, date, text, uuid, uuid, text, date, timestamptz, uuid, integer),
  api.export_transactions(date, date, text, uuid, uuid, text, date, timestamptz, uuid, integer)
from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke execute on all functions in schema api from anon';
  end if;
end;
$$;
grant execute on function
  app_data.query_transactions(uuid, date, date, text, uuid, uuid, text, date, timestamptz, uuid, integer)
to authenticated, service_role;
grant execute on function
  api.list_transactions(date, date, text, uuid, uuid, text, date, timestamptz, uuid, integer),
  api.export_transactions(date, date, text, uuid, uuid, text, date, timestamptz, uuid, integer)
to authenticated;

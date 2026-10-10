-- Sub-categories (one level) and per-day totals.
--
-- A category may have a parent of the same type; a parent cannot itself have a
-- parent, so the tree is at most two levels deep. Filtering by a parent
-- includes its children. Transactions may use either a parent or a child.

alter table app_data.categories
  add column parent_id uuid,
  add constraint categories_parent_not_self check (parent_id is null or parent_id <> id),
  add constraint categories_parent_fk
    foreign key (user_id, parent_id) references app_data.categories (user_id, id);

create index categories_parent_idx on app_data.categories (user_id, parent_id)
  where parent_id is not null;

grant update (parent_id) on app_data.categories to authenticated;

create or replace function app_data.categories_validate() returns trigger
language plpgsql set search_path = ''
as $$
declare
  v_parent record;
begin
  new.name := btrim(new.name);
  if char_length(new.name) not between 1 and 50 then
    raise exception 'NAME_INVALID' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' then
    if new.user_id <> old.user_id or new.id <> old.id
       or new.type <> old.type
       or new.seed_key is distinct from old.seed_key then
      raise exception 'IMMUTABLE_FIELD' using errcode = 'P0001';
    end if;
  end if;

  if new.parent_id is not null
     and (tg_op = 'INSERT' or new.parent_id is distinct from old.parent_id) then
    -- Serialize hierarchy changes per user so two concurrent edits cannot
    -- build a three-level chain (A under B while B goes under A).
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtext('app_data.categories:' || new.user_id::text)
    );
    if new.parent_id = new.id then
      raise exception 'CATEGORY_PARENT_INVALID' using errcode = 'P0001';
    end if;
    select c.type, c.parent_id, c.archived_at into v_parent
    from app_data.categories c
    where c.id = new.parent_id and c.user_id = new.user_id;
    if not found then
      raise exception 'CATEGORY_NOT_FOUND' using errcode = 'P0001';
    end if;
    if v_parent.parent_id is not null or v_parent.type <> new.type then
      raise exception 'CATEGORY_PARENT_INVALID' using errcode = 'P0001';
    end if;
    if v_parent.archived_at is not null then
      raise exception 'ARCHIVED_REFERENCE' using errcode = 'P0001';
    end if;
    if tg_op = 'UPDATE' and exists (
      select 1 from app_data.categories c
      where c.user_id = new.user_id and c.parent_id = new.id
    ) then
      raise exception 'CATEGORY_HAS_CHILDREN' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

-- The category itself plus its direct children (empty when it doesn't exist).
create function app_data.category_scope(p_user_id uuid, p_category_id uuid) returns uuid[]
language sql stable set search_path = ''
as $$
  select coalesce(array_agg(c.id), '{}')
  from app_data.categories c
  where c.user_id = p_user_id
    and (c.id = p_category_id or c.parent_id = p_category_id)
$$;
grant execute on function app_data.category_scope(uuid, uuid) to authenticated, service_role;

create or replace function app_data.category_json(c app_data.categories) returns jsonb
language sql stable set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id, 'name', c.name, 'type', c.type, 'parent_id', c.parent_id,
    'seed_key', c.seed_key, 'archived_at', c.archived_at
  )
$$;

-- ---------------------------------------------------------------------------
-- Category RPCs
-- ---------------------------------------------------------------------------

drop function api.list_categories();
create function api.list_categories() returns table (
  id uuid,
  name text,
  type text,
  parent_id uuid,
  seed_key text,
  archived_at timestamptz,
  created_at timestamptz
)
language sql stable security invoker set search_path = ''
as $$
  select c.id, c.name, c.type, c.parent_id, c.seed_key, c.archived_at, c.created_at
  from app_data.categories c
  where c.user_id = (select auth.uid())
  order by c.type, c.archived_at nulls first, c.created_at, c.name
$$;

drop function api.create_category(uuid, text, text);
create function api.create_category(
  p_id uuid,
  p_name text,
  p_type text,
  p_parent_id uuid default null
) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_uid uuid := app_data.require_uid();
  v_row app_data.categories;
begin
  if p_id is null then
    raise exception 'ID_REQUIRED' using errcode = 'P0001';
  end if;
  if p_type is null or p_type not in ('income', 'expense') then
    raise exception 'TYPE_INVALID' using errcode = 'P0001';
  end if;
  insert into app_data.categories (id, user_id, name, type, parent_id)
  values (p_id, v_uid, p_name, p_type, p_parent_id)
  on conflict (id) do nothing
  returning * into v_row;
  if found then
    return app_data.category_json(v_row);
  end if;
  select * into v_row from app_data.categories c where c.id = p_id and c.user_id = v_uid;
  if found
     and v_row.name = btrim(p_name)
     and v_row.type = p_type
     and v_row.parent_id is not distinct from p_parent_id then
    return app_data.category_json(v_row);
  end if;
  raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
end;
$$;

-- Rename and move in one statement; p_parent_id null makes it top-level.
create function api.update_category(p_id uuid, p_name text, p_parent_id uuid default null) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_uid uuid := app_data.require_uid();
  v_row app_data.categories;
begin
  update app_data.categories c
     set name = p_name, parent_id = p_parent_id
   where c.id = p_id and c.user_id = v_uid
  returning * into v_row;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  return app_data.category_json(v_row);
end;
$$;

-- ---------------------------------------------------------------------------
-- History: a parent category filter includes its children, and child names
-- are shown as "Parent › Child".
-- ---------------------------------------------------------------------------

create or replace function app_data.query_transactions(
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
  updated_at timestamptz
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
    t.occurred_on, t.note, t.version, t.created_at, t.updated_at
  from app_data.transactions t
  join app_data.accounts a on a.id = t.account_id
  left join app_data.accounts ta on ta.id = t.to_account_id
  left join app_data.categories c on c.id = t.category_id
  left join app_data.categories pc on pc.id = c.parent_id
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

-- ---------------------------------------------------------------------------
-- Per-day totals over the same filters as the history. Only days that have at
-- least one matching income/expense are returned; transfers are never counted.
-- ---------------------------------------------------------------------------

create function api.get_daily_totals(
  p_from date default null,
  p_to date default null,
  p_type text default null,
  p_account_id uuid default null,
  p_category_id uuid default null,
  p_search text default null
) returns table (
  occurred_on date,
  expense_rupiah text,
  income_rupiah text,
  expense_count bigint,
  income_count bigint
)
language plpgsql stable security invoker set search_path = ''
as $$
declare
  v_uid uuid := app_data.require_uid();
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_categories uuid[];
begin
  if p_type is not null and p_type not in ('income', 'expense', 'transfer') then
    raise exception 'TYPE_INVALID' using errcode = 'P0001';
  end if;
  if p_from is not null and p_to is not null and p_to <= p_from then
    raise exception 'PERIOD_INVALID' using errcode = 'P0001';
  end if;
  if p_category_id is not null then
    v_categories := app_data.category_scope(v_uid, p_category_id);
  end if;

  return query
  select
    t.occurred_on,
    coalesce(sum(t.amount_rupiah::numeric) filter (where t.type = 'expense'), 0)::text,
    coalesce(sum(t.amount_rupiah::numeric) filter (where t.type = 'income'), 0)::text,
    count(*) filter (where t.type = 'expense'),
    count(*) filter (where t.type = 'income')
  from app_data.transactions t
  where t.user_id = v_uid
    and t.type in ('income', 'expense')
    and (p_from is null or t.occurred_on >= p_from)
    and (p_to is null or t.occurred_on < p_to)
    and (p_type is null or t.type = p_type)
    and (p_account_id is null or t.account_id = p_account_id)
    and (v_categories is null or t.category_id = any (v_categories))
    and (v_search is null or strpos(lower(t.note), lower(v_search)) > 0)
  group by t.occurred_on
  order by t.occurred_on desc;
end;
$$;

-- ---------------------------------------------------------------------------
-- Dashboard: category totals roll children up into their top-level category,
-- with the per-child split under "children".
-- ---------------------------------------------------------------------------

create or replace function api.get_dashboard(p_from date, p_to date) returns jsonb
language plpgsql stable security invoker set search_path = ''
as $$
declare
  v_uid uuid := app_data.require_uid();
  v_result jsonb;
begin
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > 366 then
    raise exception 'PERIOD_INVALID' using errcode = 'P0001';
  end if;

  with period as (
    select t.type, t.amount_rupiah::numeric as amount, t.category_id, t.occurred_on
    from app_data.transactions t
    where t.user_id = v_uid
      and t.occurred_on >= p_from
      and t.occurred_on < p_to
      and t.type in ('income', 'expense')
  ),
  totals as (
    select
      coalesce(sum(amount) filter (where type = 'income'), 0) as income,
      coalesce(sum(amount) filter (where type = 'expense'), 0) as expense
    from period
  ),
  by_leaf as (
    select p.type, c.id, c.name, c.archived_at, coalesce(c.parent_id, c.id) as top_id,
           sum(p.amount) as total, count(*) as tx_count
    from period p
    join app_data.categories c on c.id = p.category_id
    group by p.type, c.id, c.name, c.archived_at, c.parent_id
  ),
  by_top as (
    select l.type, tc.id, tc.name, tc.archived_at, sum(l.total) as total, sum(l.tx_count)::bigint as tx_count
    from by_leaf l
    join app_data.categories tc on tc.id = l.top_id
    group by l.type, tc.id, tc.name, tc.archived_at
  ),
  days as (
    select d::date as day
    from generate_series(p_from::timestamp, (p_to - 1)::timestamp, interval '1 day') d
  ),
  daily as (
    select
      days.day,
      coalesce(sum(p.amount) filter (where p.type = 'expense'), 0) as expense,
      coalesce(sum(p.amount) filter (where p.type = 'income'), 0) as income
    from days
    left join period p on p.occurred_on = days.day
    group by days.day
  )
  select jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'income_rupiah', (select income::text from totals),
    'expense_rupiah', (select expense::text from totals),
    'net_rupiah', (select (income - expense)::text from totals),
    'expense_by_category', coalesce((
      select jsonb_agg(jsonb_build_object(
        'category_id', b.id, 'name', b.name, 'archived', b.archived_at is not null,
        'total_rupiah', b.total::text, 'count', b.tx_count,
        'children', coalesce((
          select jsonb_agg(jsonb_build_object(
            'category_id', l.id, 'name', l.name, 'archived', l.archived_at is not null,
            'total_rupiah', l.total::text, 'count', l.tx_count
          ) order by l.total desc, l.name)
          from by_leaf l where l.type = b.type and l.top_id = b.id and l.id <> b.id), '[]'::jsonb)
      ) order by b.total desc, b.name)
      from by_top b where b.type = 'expense'), '[]'::jsonb),
    'income_by_category', coalesce((
      select jsonb_agg(jsonb_build_object(
        'category_id', b.id, 'name', b.name, 'archived', b.archived_at is not null,
        'total_rupiah', b.total::text, 'count', b.tx_count,
        'children', coalesce((
          select jsonb_agg(jsonb_build_object(
            'category_id', l.id, 'name', l.name, 'archived', l.archived_at is not null,
            'total_rupiah', l.total::text, 'count', l.tx_count
          ) order by l.total desc, l.name)
          from by_leaf l where l.type = b.type and l.top_id = b.id and l.id <> b.id), '[]'::jsonb)
      ) order by b.total desc, b.name)
      from by_top b where b.type = 'income'), '[]'::jsonb),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', d.day, 'expense_rupiah', d.expense::text, 'income_rupiah', d.income::text
      ) order by d.day)
      from daily d), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants for the new and recreated RPCs.
-- ---------------------------------------------------------------------------

revoke execute on function
  api.list_categories(),
  api.create_category(uuid, text, text, uuid),
  api.update_category(uuid, text, uuid),
  api.get_daily_totals(date, date, text, uuid, uuid, text)
from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke execute on all functions in schema api from anon';
  end if;
end;
$$;
grant execute on function
  api.list_categories(),
  api.create_category(uuid, text, text, uuid),
  api.update_category(uuid, text, uuid),
  api.get_daily_totals(date, date, text, uuid, uuid, text)
to authenticated;

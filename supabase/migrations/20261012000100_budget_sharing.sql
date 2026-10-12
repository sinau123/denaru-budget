-- Shared budgets.
--
-- An owner invites another user by email. Once the invitee accepts, they may
-- read the owner's dashboard, history, wallets and categories, and create,
-- edit and delete the owner's transactions. Wallets and categories stay
-- writable by the owner only. Every user picks which budget the app shows
-- (profiles.active_budget_id); null means their own.
--
-- Transactions keep user_id = budget owner, so balances, reports, the
-- composite foreign keys and data_version all work unchanged.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table app_data.budget_members (
  id uuid primary key,
  owner_id uuid not null references app_data.profiles (id) on delete cascade,
  invitee_email text not null
    check (invitee_email = lower(btrim(invitee_email)) and char_length(invitee_email) between 3 and 254),
  -- Snapshots shown to the invitee, who cannot read the owner's profile yet.
  owner_name text not null default '' check (char_length(owner_name) <= 100),
  owner_email text not null default '',
  member_id uuid references app_data.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, invitee_email),
  constraint budget_members_not_self check (member_id is null or member_id <> owner_id),
  constraint budget_members_shape check (
    (status = 'pending' and member_id is null and accepted_at is null)
    or (status = 'accepted' and member_id is not null and accepted_at is not null)
  )
);

create unique index budget_members_owner_member_idx on app_data.budget_members (owner_id, member_id)
  where member_id is not null;
create index budget_members_member_idx on app_data.budget_members (member_id)
  where member_id is not null;
create index budget_members_invitee_idx on app_data.budget_members (invitee_email)
  where status = 'pending';

create trigger budget_members_updated_at before insert or update on app_data.budget_members
  for each row execute function app_data.set_updated_at();

alter table app_data.profiles
  add column active_budget_id uuid references app_data.profiles (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Email of the signed-in user, read from auth.users (Google-verified) rather
-- than from anything the browser sends.
create function app_data.current_email() returns text
language sql stable security definer set search_path = ''
as $$
  select lower(u.email) from auth.users u where u.id = auth.uid()
$$;

-- Budgets (owner ids) the signed-in user may open: their own plus accepted
-- shares. SECURITY DEFINER so RLS policies can call it without recursing into
-- budget_members' own policies; it only ever answers for auth.uid().
create function app_data.accessible_budget_ids() returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select auth.uid() where auth.uid() is not null
  union
  select m.owner_id from app_data.budget_members m
  where m.member_id = auth.uid() and m.status = 'accepted'
$$;

-- Owner of the budget the app is showing. Falls back to the user's own
-- budget when the chosen share no longer exists (revoked or left).
create function app_data.budget_owner() returns uuid
language plpgsql stable set search_path = ''
as $$
declare
  v_uid uuid := app_data.require_uid();
  v_active uuid;
begin
  select p.active_budget_id into v_active from app_data.profiles p where p.id = v_uid;
  if v_active is not null and v_active <> v_uid
     and v_active in (select app_data.accessible_budget_ids()) then
    return v_active;
  end if;
  return v_uid;
end;
$$;

-- Clears a member's budget choice when their membership disappears, so a
-- later re-invite never switches them over without asking. SECURITY DEFINER
-- because an owner revoking access cannot update the member's profile.
create function app_data.budget_members_after_delete() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if old.member_id is not null then
    update app_data.profiles
       set active_budget_id = null
     where id = old.member_id and active_budget_id = old.owner_id;
  end if;
  return null;
end;
$$;

create trigger budget_members_after_delete after delete on app_data.budget_members
  for each row execute function app_data.budget_members_after_delete();

revoke execute on function
  app_data.current_email(),
  app_data.accessible_budget_ids(),
  app_data.budget_owner(),
  app_data.budget_members_after_delete()
from public;
grant execute on function
  app_data.current_email(),
  app_data.accessible_budget_ids(),
  app_data.budget_owner()
to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

-- Members read the owner's profile (name, data_version for exports).
drop policy profiles_select on app_data.profiles;
create policy profiles_select on app_data.profiles for select to authenticated
  using (id in (select app_data.accessible_budget_ids()));

-- Wallets and categories: readable by members, writable by the owner only
-- (insert/update/delete policies are unchanged).
drop policy accounts_select on app_data.accounts;
create policy accounts_select on app_data.accounts for select to authenticated
  using (user_id in (select app_data.accessible_budget_ids()));

drop policy categories_select on app_data.categories;
create policy categories_select on app_data.categories for select to authenticated
  using (user_id in (select app_data.accessible_budget_ids()));

-- Transactions: full CRUD for owner and members.
drop policy transactions_select on app_data.transactions;
drop policy transactions_insert on app_data.transactions;
drop policy transactions_update on app_data.transactions;
drop policy transactions_delete on app_data.transactions;
create policy transactions_select on app_data.transactions for select to authenticated
  using (user_id in (select app_data.accessible_budget_ids()));
create policy transactions_insert on app_data.transactions for insert to authenticated
  with check (user_id in (select app_data.accessible_budget_ids()));
create policy transactions_update on app_data.transactions for update to authenticated
  using (user_id in (select app_data.accessible_budget_ids()))
  with check (user_id in (select app_data.accessible_budget_ids()));
create policy transactions_delete on app_data.transactions for delete to authenticated
  using (user_id in (select app_data.accessible_budget_ids()));

alter table app_data.budget_members enable row level security;

create policy budget_members_select on app_data.budget_members for select to authenticated
  using (
    owner_id = (select auth.uid())
    or member_id = (select auth.uid())
    or (status = 'pending' and invitee_email = (select app_data.current_email()))
  );
create policy budget_members_insert on app_data.budget_members for insert to authenticated
  with check (owner_id = (select auth.uid()) and status = 'pending' and member_id is null);
-- Only the invitee may accept, and only for themselves.
create policy budget_members_update on app_data.budget_members for update to authenticated
  using (status = 'pending' and invitee_email = (select app_data.current_email()))
  with check (member_id = (select auth.uid()) and status = 'accepted');
-- Owner revokes, member leaves, invitee declines.
create policy budget_members_delete on app_data.budget_members for delete to authenticated
  using (
    owner_id = (select auth.uid())
    or member_id = (select auth.uid())
    or (status = 'pending' and invitee_email = (select app_data.current_email()))
  );

revoke all on app_data.budget_members from public;
grant select, insert, delete on app_data.budget_members to authenticated;
grant update (member_id, status, accepted_at) on app_data.budget_members to authenticated;
grant update (active_budget_id) on app_data.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- Profile: describes the active budget too. data_version is the active
-- budget's, because exports read it to detect concurrent changes.
-- ---------------------------------------------------------------------------

create or replace function api.get_profile() returns jsonb
language plpgsql stable security invoker set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_owner uuid;
  v_result jsonb;
begin
  if v_uid is null or not exists (select 1 from app_data.profiles p where p.id = v_uid) then
    return null;
  end if;
  v_owner := app_data.budget_owner();

  select jsonb_build_object(
    'id', p.id,
    'display_name', p.display_name,
    'timezone', p.timezone,
    'currency', p.currency,
    'data_version', o.data_version::text,
    'has_accounts', exists (select 1 from app_data.accounts a where a.user_id = p.id),
    'today', app_data.today_jakarta(),
    'budget', jsonb_build_object(
      'owner_id', o.id,
      'owner_name', coalesce(
        nullif(o.display_name, ''),
        (select nullif(m.owner_email, '') from app_data.budget_members m
          where m.owner_id = o.id and m.member_id = v_uid),
        ''
      ),
      'is_own', o.id = p.id
    )
  ) into v_result
  from app_data.profiles p
  join app_data.profiles o on o.id = v_owner
  where p.id = v_uid;

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Sharing RPCs
-- ---------------------------------------------------------------------------

create function app_data.budget_member_json(m app_data.budget_members) returns jsonb
language sql stable set search_path = ''
as $$
  select jsonb_build_object(
    'id', m.id,
    'email', m.invitee_email,
    'status', m.status,
    'created_at', m.created_at,
    'accepted_at', m.accepted_at
  )
$$;
grant execute on function app_data.budget_member_json(app_data.budget_members) to authenticated, service_role;

-- "members": people I invited to my budget. "shared_with_me": invites to me
-- (pending) and budgets I joined (accepted).
create function api.get_budget_sharing() returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select jsonb_build_object(
    'members', coalesce((
      select jsonb_agg(app_data.budget_member_json(m) order by m.created_at, m.id)
      from app_data.budget_members m
      where m.owner_id = (select auth.uid())), '[]'::jsonb),
    'shared_with_me', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id,
        'owner_id', m.owner_id,
        'owner_name', coalesce(nullif(o.display_name, ''), nullif(m.owner_name, ''), m.owner_email),
        'owner_email', m.owner_email,
        'status', m.status,
        'created_at', m.created_at,
        'accepted_at', m.accepted_at
      ) order by m.status desc, m.created_at, m.id)
      from app_data.budget_members m
      -- The owner's profile is readable only after accepting.
      left join app_data.profiles o on o.id = m.owner_id
      where m.member_id = (select auth.uid())
         or (m.status = 'pending' and m.invitee_email = (select app_data.current_email()))), '[]'::jsonb)
  )
$$;

create function api.invite_budget_member(p_id uuid, p_email text) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_uid uuid := app_data.require_uid();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_me text := app_data.current_email();
  v_row app_data.budget_members;
begin
  if p_id is null then
    raise exception 'ID_REQUIRED' using errcode = 'P0001';
  end if;
  if char_length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'EMAIL_INVALID' using errcode = 'P0001';
  end if;
  if v_email = v_me then
    raise exception 'INVITE_SELF' using errcode = 'P0001';
  end if;

  -- Serialize per owner so concurrent invites cannot exceed the limit.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('app_data.budget_members:' || v_uid::text)
  );

  -- Replay of the same request returns the stored invite.
  select * into v_row from app_data.budget_members m where m.id = p_id and m.owner_id = v_uid;
  if found then
    if v_row.invitee_email = v_email then
      return app_data.budget_member_json(v_row);
    end if;
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
  end if;

  if exists (select 1 from app_data.budget_members m where m.owner_id = v_uid and m.invitee_email = v_email) then
    raise exception 'INVITE_EXISTS' using errcode = 'P0001';
  end if;
  -- Pilot scope: at most 4 people besides the owner (5 users per budget).
  if (select count(*) from app_data.budget_members m where m.owner_id = v_uid) >= 4 then
    raise exception 'MEMBER_LIMIT' using errcode = 'P0001';
  end if;

  insert into app_data.budget_members (id, owner_id, invitee_email, owner_name, owner_email)
  select p_id, v_uid, v_email, p.display_name, coalesce(v_me, '')
  from app_data.profiles p where p.id = v_uid
  returning * into v_row;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  return app_data.budget_member_json(v_row);
end;
$$;

-- Accept or decline an invite addressed to the signed-in user's email.
-- Accepting does not switch budgets; the user chooses that in Settings.
create function api.respond_budget_invite(p_id uuid, p_accept boolean) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_uid uuid := app_data.require_uid();
  v_email text := app_data.current_email();
begin
  if p_accept then
    update app_data.budget_members m
       set member_id = v_uid, status = 'accepted', accepted_at = now()
     where m.id = p_id and m.status = 'pending' and m.invitee_email = v_email;
    -- A repeated accept (lost response) finds the membership already there.
    if not found and not exists (
      select 1 from app_data.budget_members m where m.id = p_id and m.member_id = v_uid
    ) then
      raise exception 'NOT_FOUND' using errcode = 'P0001';
    end if;
  else
    delete from app_data.budget_members m
     where m.id = p_id and m.status = 'pending' and m.invitee_email = v_email;
    if not found then
      raise exception 'NOT_FOUND' using errcode = 'P0001';
    end if;
  end if;
  return api.get_budget_sharing();
end;
$$;

-- The owner removes a member or cancels an invite; a member leaves.
create function api.remove_budget_member(p_id uuid) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_uid uuid := app_data.require_uid();
begin
  delete from app_data.budget_members m
   where m.id = p_id and (m.owner_id = v_uid or m.member_id = v_uid);
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  return api.get_budget_sharing();
end;
$$;

-- Chooses the budget the app shows. Null (or the user's own id) means their own.
create function api.set_active_budget(p_owner_id uuid) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_uid uuid := app_data.require_uid();
begin
  if p_owner_id is not null and p_owner_id <> v_uid
     and p_owner_id not in (select app_data.accessible_budget_ids()) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  update app_data.profiles set active_budget_id = nullif(p_owner_id, v_uid) where id = v_uid;
  return api.get_profile();
end;
$$;

-- ---------------------------------------------------------------------------
-- Budget data RPCs now read and write the active budget instead of always the
-- caller's own. Wallet and category mutations are unchanged: they still only
-- touch rows where user_id = auth.uid(), so members cannot change them.
-- ---------------------------------------------------------------------------

create or replace function api.get_accounts() returns table (
  id uuid,
  name text,
  type text,
  opening_balance_rupiah text,
  opened_on date,
  archived_at timestamptz,
  balance_rupiah text,
  transaction_count bigint,
  earliest_occurred_on date,
  last_used_at timestamptz,
  created_at timestamptz
)
language sql stable security invoker set search_path = ''
as $$
  select
    a.id, a.name, a.type,
    a.opening_balance_rupiah::text,
    a.opened_on, a.archived_at,
    (a.opening_balance_rupiah + coalesce(m.delta, 0))::text,
    coalesce(m.tx_count, 0),
    m.earliest_on,
    m.last_used_at,
    a.created_at
  from app_data.accounts a
  left join lateral (
    select
      sum(case
            when t.type = 'income' then t.amount_rupiah::numeric
            when t.type = 'expense' then -t.amount_rupiah::numeric
            when t.type = 'transfer' and t.account_id = a.id then -t.amount_rupiah::numeric
            when t.type = 'transfer' and t.to_account_id = a.id then t.amount_rupiah::numeric
          end) as delta,
      count(*) as tx_count,
      min(t.occurred_on) as earliest_on,
      max(t.created_at) filter (where t.account_id = a.id) as last_used_at
    from app_data.transactions t
    where t.user_id = a.user_id
      and (t.account_id = a.id or t.to_account_id = a.id)
  ) m on true
  where a.user_id = (select app_data.budget_owner())
  order by a.archived_at nulls first, a.created_at, a.id
$$;

create or replace function api.list_categories() returns table (
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
  where c.user_id = (select app_data.budget_owner())
  order by c.type, c.archived_at nulls first, c.created_at, c.name
$$;

create or replace function api.create_transaction(
  p_id uuid,
  p_type text,
  p_amount_rupiah text,
  p_account_id uuid,
  p_occurred_on date,
  p_to_account_id uuid default null,
  p_category_id uuid default null,
  p_note text default ''
) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
begin
  return app_data.create_transaction_core(
    app_data.budget_owner(), p_id, p_type, p_amount_rupiah, p_account_id,
    p_to_account_id, p_category_id, p_occurred_on, p_note, 'web'
  );
end;
$$;

create or replace function api.get_transaction(p_id uuid) returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select app_data.transaction_json(t)
  from app_data.transactions t
  where t.id = p_id and t.user_id = (select app_data.budget_owner())
$$;

create or replace function api.update_transaction(
  p_id uuid,
  p_expected_version integer,
  p_amount_rupiah text,
  p_account_id uuid,
  p_occurred_on date,
  p_to_account_id uuid default null,
  p_category_id uuid default null,
  p_note text default ''
) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_owner uuid := app_data.budget_owner();
  v_row app_data.transactions;
begin
  -- Atomic compare-and-update: only succeeds on the expected version.
  update app_data.transactions t
     set amount_rupiah = app_data.parse_rupiah(p_amount_rupiah, false),
         account_id = p_account_id,
         to_account_id = p_to_account_id,
         category_id = p_category_id,
         occurred_on = p_occurred_on,
         note = btrim(coalesce(p_note, ''))
   where t.id = p_id
     and t.user_id = v_owner
     and t.version = p_expected_version
  returning * into v_row;

  if not found then
    if exists (select 1 from app_data.transactions t where t.id = p_id and t.user_id = v_owner) then
      raise exception 'VERSION_CONFLICT' using errcode = 'P0001';
    end if;
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  return app_data.transaction_json(v_row);
end;
$$;

create or replace function api.delete_transaction(p_id uuid, p_expected_version integer) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_owner uuid := app_data.budget_owner();
  v_row app_data.transactions;
begin
  delete from app_data.transactions t
   where t.id = p_id and t.user_id = v_owner and t.version = p_expected_version
  returning * into v_row;
  if not found then
    if exists (select 1 from app_data.transactions t where t.id = p_id and t.user_id = v_owner) then
      raise exception 'VERSION_CONFLICT' using errcode = 'P0001';
    end if;
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  return app_data.transaction_json(v_row);
end;
$$;

create or replace function api.list_transactions(
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
  updated_at timestamptz
)
language sql stable security invoker set search_path = ''
as $$
  select * from app_data.query_transactions(
    app_data.budget_owner(), p_from, p_to, p_type, p_account_id, p_category_id, p_search,
    p_cursor_occurred_on, p_cursor_created_at, p_cursor_id,
    least(greatest(coalesce(p_limit, 50), 1), 50)
  )
$$;

create or replace function api.export_transactions(
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
  updated_at timestamptz
)
language sql stable security invoker set search_path = ''
as $$
  select * from app_data.query_transactions(
    app_data.budget_owner(), p_from, p_to, p_type, p_account_id, p_category_id, p_search,
    p_cursor_occurred_on, p_cursor_created_at, p_cursor_id,
    least(greatest(coalesce(p_limit, 1000), 1), 1000)
  )
$$;

create or replace function api.get_daily_totals(
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
  v_owner uuid := app_data.budget_owner();
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
    v_categories := app_data.category_scope(v_owner, p_category_id);
  end if;

  return query
  select
    t.occurred_on,
    coalesce(sum(t.amount_rupiah::numeric) filter (where t.type = 'expense'), 0)::text,
    coalesce(sum(t.amount_rupiah::numeric) filter (where t.type = 'income'), 0)::text,
    count(*) filter (where t.type = 'expense'),
    count(*) filter (where t.type = 'income')
  from app_data.transactions t
  where t.user_id = v_owner
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

create or replace function api.get_dashboard(p_from date, p_to date) returns jsonb
language plpgsql stable security invoker set search_path = ''
as $$
declare
  v_owner uuid := app_data.budget_owner();
  v_result jsonb;
begin
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > 366 then
    raise exception 'PERIOD_INVALID' using errcode = 'P0001';
  end if;

  with period as (
    select t.type, t.amount_rupiah::numeric as amount, t.category_id, t.occurred_on
    from app_data.transactions t
    where t.user_id = v_owner
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
-- Grants for the new RPCs (replaced functions keep their existing grants).
-- ---------------------------------------------------------------------------

revoke execute on function
  api.get_budget_sharing(),
  api.invite_budget_member(uuid, text),
  api.respond_budget_invite(uuid, boolean),
  api.remove_budget_member(uuid),
  api.set_active_budget(uuid)
from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke execute on all functions in schema api from anon';
  end if;
end;
$$;
grant execute on function
  api.get_budget_sharing(),
  api.invite_budget_member(uuid, text),
  api.respond_budget_invite(uuid, boolean),
  api.remove_budget_member(uuid),
  api.set_active_budget(uuid)
to authenticated;

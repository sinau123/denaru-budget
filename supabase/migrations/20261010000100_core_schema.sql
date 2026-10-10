-- Core schema for the expense tracker MVP.
--
-- Business tables live in app_data, which is NOT exposed through the Data API.
-- The api schema (exposed) only contains RPC functions (see next migration).
-- All money is stored as bigint rupiah; all business dates are calendar dates.

create schema if not exists app_data;
create schema if not exists api;

revoke all on schema app_data from public;
revoke all on schema api from public;
grant usage on schema app_data to authenticated, service_role;
grant usage on schema api to authenticated, service_role;

-- Functions are executable by PUBLIC by default; never in these schemas.
alter default privileges in schema app_data revoke execute on functions from public;
alter default privileges in schema api revoke execute on functions from public;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Largest accepted rupiah amount (Rp999 triliun). Well inside bigint range.
create function app_data.max_rupiah() returns bigint
language sql immutable parallel safe set search_path = ''
as $$ select 999999999999999::bigint $$;

-- "Today" for business dates is always the calendar date in Asia/Jakarta.
create function app_data.today_jakarta() returns date
language sql stable parallel safe set search_path = ''
as $$ select (now() at time zone 'Asia/Jakarta')::date $$;

create function app_data.require_uid() returns uuid
language plpgsql stable set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;
  return v_uid;
end;
$$;

-- Parses a digit string (API boundary format) into bigint rupiah.
create function app_data.parse_rupiah(p_value text, p_allow_negative boolean default false)
returns bigint
language plpgsql immutable set search_path = ''
as $$
declare
  v numeric;
begin
  if p_value is null or p_value !~ '^-?[0-9]{1,19}$' then
    raise exception 'AMOUNT_INVALID' using errcode = 'P0001';
  end if;
  v := p_value::numeric;
  if abs(v) > app_data.max_rupiah() then
    raise exception 'AMOUNT_TOO_LARGE' using errcode = 'P0001';
  end if;
  if not p_allow_negative and v <= 0 then
    raise exception 'AMOUNT_INVALID' using errcode = 'P0001';
  end if;
  return v::bigint;
end;
$$;

create function app_data.set_updated_at() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table app_data.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 100),
  timezone text not null default 'Asia/Jakarta' check (timezone = 'Asia/Jakarta'),
  currency text not null default 'IDR' check (currency = 'IDR'),
  data_version bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table app_data.accounts (
  id uuid primary key,
  user_id uuid not null references app_data.profiles (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 50),
  type text not null check (type in ('cash', 'bank', 'ewallet')),
  opening_balance_rupiah bigint not null default 0
    check (abs(opening_balance_rupiah) <= 999999999999999),
  opened_on date not null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, id)
);

create table app_data.categories (
  id uuid primary key,
  user_id uuid not null references app_data.profiles (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 50),
  type text not null check (type in ('income', 'expense')),
  seed_key text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, id),
  unique (user_id, seed_key)
);

create table app_data.transactions (
  id uuid primary key,
  user_id uuid not null references app_data.profiles (id) on delete cascade,
  type text not null check (type in ('income', 'expense', 'transfer')),
  amount_rupiah bigint not null check (amount_rupiah > 0 and amount_rupiah <= 999999999999999),
  account_id uuid not null,
  to_account_id uuid,
  category_id uuid,
  occurred_on date not null,
  note text not null default '' check (char_length(note) <= 250),
  version integer not null default 1 check (version >= 1),
  source text not null default 'web' check (source in ('web', 'telegram')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Composite FKs make it impossible to reference another user's wallet/category.
  -- NO ACTION (default) blocks deleting a wallet that still has transactions.
  foreign key (user_id, account_id) references app_data.accounts (user_id, id),
  foreign key (user_id, to_account_id) references app_data.accounts (user_id, id),
  foreign key (user_id, category_id) references app_data.categories (user_id, id),
  constraint transactions_shape check (
    (type = 'transfer'
      and to_account_id is not null
      and to_account_id <> account_id
      and category_id is null)
    or
    (type in ('income', 'expense')
      and to_account_id is null
      and category_id is not null)
  )
);

create index transactions_user_order_idx
  on app_data.transactions (user_id, occurred_on desc, created_at desc, id desc);
create index transactions_account_idx on app_data.transactions (account_id);
create index transactions_to_account_idx on app_data.transactions (to_account_id)
  where to_account_id is not null;
create index transactions_category_idx on app_data.transactions (user_id, category_id)
  where category_id is not null;

-- ---------------------------------------------------------------------------
-- Validation triggers (the database decides what is valid, not the browser)
-- ---------------------------------------------------------------------------

create function app_data.accounts_validate() returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.name := btrim(new.name);
  if char_length(new.name) not between 1 and 50 then
    raise exception 'NAME_INVALID' using errcode = 'P0001';
  end if;
  if abs(new.opening_balance_rupiah) > app_data.max_rupiah() then
    raise exception 'AMOUNT_TOO_LARGE' using errcode = 'P0001';
  end if;
  if new.opened_on > app_data.today_jakarta() then
    raise exception 'DATE_IN_FUTURE' using errcode = 'P0001';
  end if;

  if tg_op = 'UPDATE' then
    if new.user_id <> old.user_id or new.id <> old.id then
      raise exception 'IMMUTABLE_FIELD' using errcode = 'P0001';
    end if;
    if new.opened_on > old.opened_on and exists (
      select 1 from app_data.transactions t
      where t.user_id = new.user_id
        and (t.account_id = new.id or t.to_account_id = new.id)
        and t.occurred_on < new.opened_on
    ) then
      raise exception 'OPENED_ON_AFTER_TRANSACTIONS' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

create function app_data.categories_validate() returns trigger
language plpgsql set search_path = ''
as $$
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
  return new;
end;
$$;

create function app_data.transactions_validate() returns trigger
language plpgsql set search_path = ''
as $$
declare
  v_account record;
  v_to record;
  v_category record;
begin
  if tg_op = 'UPDATE' then
    if new.user_id <> old.user_id or new.id <> old.id or new.source <> old.source then
      raise exception 'IMMUTABLE_FIELD' using errcode = 'P0001';
    end if;
    if new.type <> old.type then
      raise exception 'TYPE_IMMUTABLE' using errcode = 'P0001';
    end if;
    new.version := old.version + 1;
    new.created_at := old.created_at;
  else
    new.version := 1;
    new.created_at := now();
  end if;
  new.updated_at := now();
  new.note := btrim(coalesce(new.note, ''));

  if new.amount_rupiah is null or new.amount_rupiah <= 0 then
    raise exception 'AMOUNT_INVALID' using errcode = 'P0001';
  end if;
  if new.amount_rupiah > app_data.max_rupiah() then
    raise exception 'AMOUNT_TOO_LARGE' using errcode = 'P0001';
  end if;
  if char_length(new.note) > 250 then
    raise exception 'NOTE_TOO_LONG' using errcode = 'P0001';
  end if;
  if new.occurred_on is null then
    raise exception 'DATE_INVALID' using errcode = 'P0001';
  end if;
  if new.occurred_on > app_data.today_jakarta() then
    raise exception 'DATE_IN_FUTURE' using errcode = 'P0001';
  end if;

  select a.opened_on, a.archived_at into v_account
  from app_data.accounts a
  where a.id = new.account_id and a.user_id = new.user_id;
  if not found then
    raise exception 'ACCOUNT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if new.occurred_on < v_account.opened_on then
    raise exception 'DATE_BEFORE_OPENED' using errcode = 'P0001';
  end if;
  -- Archived references: keep existing ones on edit, never pick new ones.
  if v_account.archived_at is not null
     and (tg_op = 'INSERT' or new.account_id is distinct from old.account_id) then
    raise exception 'ARCHIVED_REFERENCE' using errcode = 'P0001';
  end if;

  if new.type = 'transfer' then
    if new.category_id is not null then
      raise exception 'TRANSFER_HAS_CATEGORY' using errcode = 'P0001';
    end if;
    if new.to_account_id is null then
      raise exception 'TRANSFER_TARGET_REQUIRED' using errcode = 'P0001';
    end if;
    if new.to_account_id = new.account_id then
      raise exception 'SAME_ACCOUNT' using errcode = 'P0001';
    end if;
    select a.opened_on, a.archived_at into v_to
    from app_data.accounts a
    where a.id = new.to_account_id and a.user_id = new.user_id;
    if not found then
      raise exception 'ACCOUNT_NOT_FOUND' using errcode = 'P0001';
    end if;
    if new.occurred_on < v_to.opened_on then
      raise exception 'DATE_BEFORE_OPENED' using errcode = 'P0001';
    end if;
    if v_to.archived_at is not null
       and (tg_op = 'INSERT' or new.to_account_id is distinct from old.to_account_id) then
      raise exception 'ARCHIVED_REFERENCE' using errcode = 'P0001';
    end if;
  else
    if new.to_account_id is not null then
      raise exception 'TARGET_NOT_ALLOWED' using errcode = 'P0001';
    end if;
    if new.category_id is null then
      raise exception 'CATEGORY_REQUIRED' using errcode = 'P0001';
    end if;
    select c.type, c.archived_at into v_category
    from app_data.categories c
    where c.id = new.category_id and c.user_id = new.user_id;
    if not found then
      raise exception 'CATEGORY_NOT_FOUND' using errcode = 'P0001';
    end if;
    if v_category.type <> new.type then
      raise exception 'CATEGORY_TYPE_MISMATCH' using errcode = 'P0001';
    end if;
    if v_category.archived_at is not null
       and (tg_op = 'INSERT' or new.category_id is distinct from old.category_id) then
      raise exception 'ARCHIVED_REFERENCE' using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

-- Bumps profiles.data_version on every business-data mutation. Used by the
-- export to detect changes between its first and last page. SECURITY DEFINER
-- so authenticated users don't need a grant to write data_version; it only
-- touches the profile that owns the row being changed (already authorized).
create function app_data.bump_data_version() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid;
begin
  if tg_op = 'DELETE' then
    v_user := old.user_id;
  else
    v_user := new.user_id;
  end if;
  update app_data.profiles
     set data_version = data_version + 1
   where id = v_user;
  return null;
end;
$$;

create trigger profiles_updated_at before update on app_data.profiles
  for each row execute function app_data.set_updated_at();

create trigger accounts_validate before insert or update on app_data.accounts
  for each row execute function app_data.accounts_validate();
create trigger accounts_updated_at before insert or update on app_data.accounts
  for each row execute function app_data.set_updated_at();
create trigger accounts_bump after insert or update or delete on app_data.accounts
  for each row execute function app_data.bump_data_version();

create trigger categories_validate before insert or update on app_data.categories
  for each row execute function app_data.categories_validate();
create trigger categories_updated_at before insert or update on app_data.categories
  for each row execute function app_data.set_updated_at();
create trigger categories_bump after insert or update or delete on app_data.categories
  for each row execute function app_data.bump_data_version();

create trigger transactions_validate before insert or update on app_data.transactions
  for each row execute function app_data.transactions_validate();
create trigger transactions_bump after insert or update or delete on app_data.transactions
  for each row execute function app_data.bump_data_version();

-- ---------------------------------------------------------------------------
-- Row Level Security and grants
-- ---------------------------------------------------------------------------

alter table app_data.profiles enable row level security;
alter table app_data.accounts enable row level security;
alter table app_data.categories enable row level security;
alter table app_data.transactions enable row level security;

create policy profiles_select on app_data.profiles for select to authenticated
  using (id = (select auth.uid()));
create policy profiles_insert on app_data.profiles for insert to authenticated
  with check (id = (select auth.uid()));
create policy profiles_update on app_data.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy accounts_select on app_data.accounts for select to authenticated
  using (user_id = (select auth.uid()));
create policy accounts_insert on app_data.accounts for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy accounts_update on app_data.accounts for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy accounts_delete on app_data.accounts for delete to authenticated
  using (user_id = (select auth.uid()));

create policy categories_select on app_data.categories for select to authenticated
  using (user_id = (select auth.uid()));
create policy categories_insert on app_data.categories for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy categories_update on app_data.categories for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy transactions_select on app_data.transactions for select to authenticated
  using (user_id = (select auth.uid()));
create policy transactions_insert on app_data.transactions for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy transactions_update on app_data.transactions for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy transactions_delete on app_data.transactions for delete to authenticated
  using (user_id = (select auth.uid()));

-- Minimum privileges needed by SECURITY INVOKER RPCs. app_data is not exposed
-- through the Data API, so these grants are only reachable via api.* functions.
revoke all on all tables in schema app_data from public;
grant select, insert, update (display_name) on app_data.profiles to authenticated;
grant select, insert, delete on app_data.accounts to authenticated;
grant update (name, type, opening_balance_rupiah, opened_on, archived_at)
  on app_data.accounts to authenticated;
grant select, insert on app_data.categories to authenticated;
grant update (name, archived_at) on app_data.categories to authenticated;
grant select, insert, delete on app_data.transactions to authenticated;
grant update (amount_rupiah, account_id, to_account_id, category_id, occurred_on, note)
  on app_data.transactions to authenticated;

revoke execute on all functions in schema app_data from public;
grant execute on function
  app_data.max_rupiah(),
  app_data.today_jakarta(),
  app_data.require_uid(),
  app_data.parse_rupiah(text, boolean)
to authenticated, service_role;

-- RPC contract exposed through the Data API (schema "api").
--
-- Every function is SECURITY INVOKER: RLS and grants on app_data apply, and the
-- caller identity always comes from auth.uid(). Money crosses the API boundary
-- as digit strings; bigint/numeric results are cast to text.

-- ---------------------------------------------------------------------------
-- Internal (not exposed) shared logic. The Telegram phase will reuse the same
-- core functions so validation and idempotency never diverge between sources.
-- ---------------------------------------------------------------------------

create function app_data.transaction_json(t app_data.transactions) returns jsonb
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
    'created_at', t.created_at,
    'updated_at', t.updated_at
  )
$$;

create function app_data.create_transaction_core(
  p_user_id uuid,
  p_id uuid,
  p_type text,
  p_amount_rupiah text,
  p_account_id uuid,
  p_to_account_id uuid,
  p_category_id uuid,
  p_occurred_on date,
  p_note text,
  p_source text
) returns jsonb
language plpgsql set search_path = ''
as $$
declare
  v_amount bigint := app_data.parse_rupiah(p_amount_rupiah, false);
  v_note text := btrim(coalesce(p_note, ''));
  v_row app_data.transactions;
begin
  if p_id is null then
    raise exception 'ID_REQUIRED' using errcode = 'P0001';
  end if;
  if p_type is null or p_type not in ('income', 'expense', 'transfer') then
    raise exception 'TYPE_INVALID' using errcode = 'P0001';
  end if;

  insert into app_data.transactions (
    id, user_id, type, amount_rupiah, account_id, to_account_id,
    category_id, occurred_on, note, source
  ) values (
    p_id, p_user_id, p_type, v_amount, p_account_id, p_to_account_id,
    p_category_id, p_occurred_on, v_note, p_source
  )
  on conflict (id) do nothing
  returning * into v_row;

  if found then
    return app_data.transaction_json(v_row) || jsonb_build_object('replayed', false);
  end if;

  -- Same ID seen before: return the stored result only if the payload matches.
  select * into v_row from app_data.transactions t
  where t.id = p_id and t.user_id = p_user_id;

  if found
     and v_row.type = p_type
     and v_row.amount_rupiah = v_amount
     and v_row.account_id = p_account_id
     and v_row.to_account_id is not distinct from p_to_account_id
     and v_row.category_id is not distinct from p_category_id
     and v_row.occurred_on = p_occurred_on
     and v_row.note = v_note
     and v_row.source = p_source then
    return app_data.transaction_json(v_row) || jsonb_build_object('replayed', true);
  end if;

  raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
end;
$$;

-- Shared list query for history and export. Ordered by
-- (occurred_on, created_at, id) descending with keyset pagination.
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
  updated_at timestamptz
)
language plpgsql stable set search_path = ''
as $$
declare
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
begin
  if p_type is not null and p_type not in ('income', 'expense', 'transfer') then
    raise exception 'TYPE_INVALID' using errcode = 'P0001';
  end if;
  if (p_cursor_occurred_on is null) <> (p_cursor_id is null)
     or (p_cursor_id is null) <> (p_cursor_created_at is null) then
    raise exception 'CURSOR_INVALID' using errcode = 'P0001';
  end if;

  return query
  select
    t.id, t.type, t.source, t.amount_rupiah::text,
    t.account_id, a.name,
    t.to_account_id, ta.name,
    t.category_id, c.name,
    t.occurred_on, t.note, t.version, t.created_at, t.updated_at
  from app_data.transactions t
  join app_data.accounts a on a.id = t.account_id
  left join app_data.accounts ta on ta.id = t.to_account_id
  left join app_data.categories c on c.id = t.category_id
  where t.user_id = p_user_id
    and (p_from is null or t.occurred_on >= p_from)
    and (p_to is null or t.occurred_on < p_to)
    and (p_type is null or t.type = p_type)
    and (p_account_id is null or t.account_id = p_account_id or t.to_account_id = p_account_id)
    and (p_category_id is null or t.category_id = p_category_id)
    and (v_search is null or strpos(lower(t.note), lower(v_search)) > 0)
    and (p_cursor_id is null
         or (t.occurred_on, t.created_at, t.id) < (p_cursor_occurred_on, p_cursor_created_at, p_cursor_id))
  order by t.occurred_on desc, t.created_at desc, t.id desc
  limit p_limit;
end;
$$;

grant execute on function
  app_data.transaction_json(app_data.transactions),
  app_data.create_transaction_core(uuid, uuid, text, text, uuid, uuid, uuid, date, text, text),
  app_data.query_transactions(uuid, date, date, text, uuid, uuid, text, date, timestamptz, uuid, integer)
to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Profile and onboarding
-- ---------------------------------------------------------------------------

create function api.get_profile() returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id,
    'display_name', p.display_name,
    'timezone', p.timezone,
    'currency', p.currency,
    'data_version', p.data_version::text,
    'has_accounts', exists (select 1 from app_data.accounts a where a.user_id = p.id),
    'today', app_data.today_jakarta()
  )
  from app_data.profiles p
  where p.id = (select auth.uid())
$$;

-- Idempotent: safe to call on every login and after an interrupted onboarding.
create function api.bootstrap_user(p_display_name text default null) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_uid uuid := app_data.require_uid();
  v_claims jsonb := coalesce(auth.jwt(), '{}'::jsonb);
begin
  insert into app_data.profiles (id, display_name)
  values (
    v_uid,
    left(coalesce(
      nullif(btrim(p_display_name), ''),
      nullif(v_claims -> 'user_metadata' ->> 'full_name', ''),
      nullif(v_claims ->> 'email', ''),
      ''
    ), 100)
  )
  on conflict (id) do nothing;

  insert into app_data.categories (id, user_id, name, type, seed_key)
  select gen_random_uuid(), v_uid, s.name, s.type, s.seed_key
  from (values
    ('expense_food', 'Makanan', 'expense'),
    ('expense_transport', 'Transportasi', 'expense'),
    ('expense_shopping', 'Belanja', 'expense'),
    ('expense_bills', 'Tagihan', 'expense'),
    ('expense_entertainment', 'Hiburan', 'expense'),
    ('expense_health', 'Kesehatan', 'expense'),
    ('expense_other', 'Lainnya', 'expense'),
    ('income_salary', 'Gaji', 'income'),
    ('income_other', 'Lainnya', 'income')
  ) as s (seed_key, name, type)
  on conflict (user_id, seed_key) do nothing;

  return api.get_profile();
end;
$$;

create function api.update_profile(p_display_name text) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_uid uuid := app_data.require_uid();
  v_name text := btrim(coalesce(p_display_name, ''));
begin
  if char_length(v_name) > 100 then
    raise exception 'NAME_INVALID' using errcode = 'P0001';
  end if;
  update app_data.profiles set display_name = v_name where id = v_uid;
  return api.get_profile();
end;
$$;

-- ---------------------------------------------------------------------------
-- Accounts (dompet)
-- ---------------------------------------------------------------------------

create function api.get_accounts() returns table (
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
  where a.user_id = (select auth.uid())
  order by a.archived_at nulls first, a.created_at, a.id
$$;

create function app_data.account_json(a app_data.accounts) returns jsonb
language sql stable set search_path = ''
as $$
  select jsonb_build_object(
    'id', a.id,
    'name', a.name,
    'type', a.type,
    'opening_balance_rupiah', a.opening_balance_rupiah::text,
    'opened_on', a.opened_on,
    'archived_at', a.archived_at
  )
$$;
grant execute on function app_data.account_json(app_data.accounts) to authenticated, service_role;

create function api.create_account(
  p_id uuid,
  p_name text,
  p_type text,
  p_opening_balance_rupiah text,
  p_opened_on date
) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_uid uuid := app_data.require_uid();
  v_opening bigint := app_data.parse_rupiah(coalesce(p_opening_balance_rupiah, '0'), true);
  v_row app_data.accounts;
begin
  if p_id is null then
    raise exception 'ID_REQUIRED' using errcode = 'P0001';
  end if;
  if p_type is null or p_type not in ('cash', 'bank', 'ewallet') then
    raise exception 'TYPE_INVALID' using errcode = 'P0001';
  end if;
  if p_opened_on is null then
    raise exception 'DATE_INVALID' using errcode = 'P0001';
  end if;

  insert into app_data.accounts (id, user_id, name, type, opening_balance_rupiah, opened_on)
  values (p_id, v_uid, p_name, p_type, v_opening, p_opened_on)
  on conflict (id) do nothing
  returning * into v_row;
  if found then
    return app_data.account_json(v_row);
  end if;

  select * into v_row from app_data.accounts a where a.id = p_id and a.user_id = v_uid;
  if found
     and v_row.name = btrim(p_name)
     and v_row.type = p_type
     and v_row.opening_balance_rupiah = v_opening
     and v_row.opened_on = p_opened_on then
    return app_data.account_json(v_row);
  end if;
  raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
end;
$$;

create function api.update_account(
  p_id uuid,
  p_name text,
  p_type text,
  p_opening_balance_rupiah text,
  p_opened_on date
) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_uid uuid := app_data.require_uid();
  v_row app_data.accounts;
begin
  if p_type is null or p_type not in ('cash', 'bank', 'ewallet') then
    raise exception 'TYPE_INVALID' using errcode = 'P0001';
  end if;
  update app_data.accounts a
     set name = p_name,
         type = p_type,
         opening_balance_rupiah = app_data.parse_rupiah(p_opening_balance_rupiah, true),
         opened_on = p_opened_on
   where a.id = p_id and a.user_id = v_uid
  returning * into v_row;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  return app_data.account_json(v_row);
end;
$$;

create function api.set_account_archived(p_id uuid, p_archived boolean) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_uid uuid := app_data.require_uid();
  v_row app_data.accounts;
begin
  update app_data.accounts a
     set archived_at = case when p_archived then coalesce(a.archived_at, now()) else null end
   where a.id = p_id and a.user_id = v_uid
  returning * into v_row;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  return app_data.account_json(v_row);
end;
$$;

-- Only wallets without any transaction can be deleted.
create function api.delete_account(p_id uuid) returns void
language plpgsql security invoker set search_path = ''
as $$
declare
  v_uid uuid := app_data.require_uid();
begin
  if exists (
    select 1 from app_data.transactions t
    where t.user_id = v_uid and (t.account_id = p_id or t.to_account_id = p_id)
  ) then
    raise exception 'ACCOUNT_HAS_TRANSACTIONS' using errcode = 'P0001';
  end if;
  delete from app_data.accounts a where a.id = p_id and a.user_id = v_uid;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
exception
  when foreign_key_violation then
    raise exception 'ACCOUNT_HAS_TRANSACTIONS' using errcode = 'P0001';
end;
$$;

-- ---------------------------------------------------------------------------
-- Categories
-- ---------------------------------------------------------------------------

create function api.list_categories() returns table (
  id uuid,
  name text,
  type text,
  seed_key text,
  archived_at timestamptz,
  created_at timestamptz
)
language sql stable security invoker set search_path = ''
as $$
  select c.id, c.name, c.type, c.seed_key, c.archived_at, c.created_at
  from app_data.categories c
  where c.user_id = (select auth.uid())
  order by c.type, c.archived_at nulls first, c.created_at, c.name
$$;

create function app_data.category_json(c app_data.categories) returns jsonb
language sql stable set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id, 'name', c.name, 'type', c.type,
    'seed_key', c.seed_key, 'archived_at', c.archived_at
  )
$$;
grant execute on function app_data.category_json(app_data.categories) to authenticated, service_role;

create function api.create_category(p_id uuid, p_name text, p_type text) returns jsonb
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
  insert into app_data.categories (id, user_id, name, type)
  values (p_id, v_uid, p_name, p_type)
  on conflict (id) do nothing
  returning * into v_row;
  if found then
    return app_data.category_json(v_row);
  end if;
  select * into v_row from app_data.categories c where c.id = p_id and c.user_id = v_uid;
  if found and v_row.name = btrim(p_name) and v_row.type = p_type then
    return app_data.category_json(v_row);
  end if;
  raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
end;
$$;

create function api.rename_category(p_id uuid, p_name text) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_uid uuid := app_data.require_uid();
  v_row app_data.categories;
begin
  update app_data.categories c set name = p_name
   where c.id = p_id and c.user_id = v_uid
  returning * into v_row;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  return app_data.category_json(v_row);
end;
$$;

create function api.set_category_archived(p_id uuid, p_archived boolean) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_uid uuid := app_data.require_uid();
  v_row app_data.categories;
begin
  update app_data.categories c
     set archived_at = case when p_archived then coalesce(c.archived_at, now()) else null end
   where c.id = p_id and c.user_id = v_uid
  returning * into v_row;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  return app_data.category_json(v_row);
end;
$$;

-- ---------------------------------------------------------------------------
-- Transactions
-- ---------------------------------------------------------------------------

create function api.create_transaction(
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
    app_data.require_uid(), p_id, p_type, p_amount_rupiah, p_account_id,
    p_to_account_id, p_category_id, p_occurred_on, p_note, 'web'
  );
end;
$$;

-- Used after a lost response: check by ID before retrying.
create function api.get_transaction(p_id uuid) returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select app_data.transaction_json(t)
  from app_data.transactions t
  where t.id = p_id and t.user_id = (select auth.uid())
$$;

create function api.update_transaction(
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
  v_uid uuid := app_data.require_uid();
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
     and t.user_id = v_uid
     and t.version = p_expected_version
  returning * into v_row;

  if not found then
    if exists (select 1 from app_data.transactions t where t.id = p_id and t.user_id = v_uid) then
      raise exception 'VERSION_CONFLICT' using errcode = 'P0001';
    end if;
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  return app_data.transaction_json(v_row);
end;
$$;

create function api.delete_transaction(p_id uuid, p_expected_version integer) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_uid uuid := app_data.require_uid();
  v_row app_data.transactions;
begin
  delete from app_data.transactions t
   where t.id = p_id and t.user_id = v_uid and t.version = p_expected_version
  returning * into v_row;
  if not found then
    if exists (select 1 from app_data.transactions t where t.id = p_id and t.user_id = v_uid) then
      raise exception 'VERSION_CONFLICT' using errcode = 'P0001';
    end if;
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  return app_data.transaction_json(v_row);
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
  updated_at timestamptz
)
language sql stable security invoker set search_path = ''
as $$
  select * from app_data.query_transactions(
    app_data.require_uid(), p_from, p_to, p_type, p_account_id, p_category_id, p_search,
    p_cursor_occurred_on, p_cursor_created_at, p_cursor_id,
    least(greatest(coalesce(p_limit, 50), 1), 50)
  )
$$;

-- Export pages are larger; the client reads data_version before and after all
-- pages and discards the file if it changed.
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
  updated_at timestamptz
)
language sql stable security invoker set search_path = ''
as $$
  select * from app_data.query_transactions(
    app_data.require_uid(), p_from, p_to, p_type, p_account_id, p_category_id, p_search,
    p_cursor_occurred_on, p_cursor_created_at, p_cursor_id,
    least(greatest(coalesce(p_limit, 1000), 1), 1000)
  )
$$;

-- ---------------------------------------------------------------------------
-- Dashboard: period [p_from, p_to). Transfers and opening balances excluded.
-- ---------------------------------------------------------------------------

create function api.get_dashboard(p_from date, p_to date) returns jsonb
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
  by_category as (
    select p.type, c.id, c.name, c.archived_at, sum(p.amount) as total, count(*) as tx_count
    from period p
    join app_data.categories c on c.id = p.category_id
    group by p.type, c.id, c.name, c.archived_at
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
        'total_rupiah', b.total::text, 'count', b.tx_count
      ) order by b.total desc, b.name)
      from by_category b where b.type = 'expense'), '[]'::jsonb),
    'income_by_category', coalesce((
      select jsonb_agg(jsonb_build_object(
        'category_id', b.id, 'name', b.name, 'archived', b.archived_at is not null,
        'total_rupiah', b.total::text, 'count', b.tx_count
      ) order by b.total desc, b.name)
      from by_category b where b.type = 'income'), '[]'::jsonb),
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
-- Grants: only signed-in users may call the API.
-- ---------------------------------------------------------------------------

revoke execute on all functions in schema api from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke execute on all functions in schema api from anon';
  end if;
end;
$$;
grant execute on all functions in schema api to authenticated;

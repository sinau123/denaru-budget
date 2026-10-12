-- Phase 2: record transactions through a private Telegram chat (PRD F11–F13).
--
-- The bot has no user JWT. The webhook (Next.js Route Handler) calls the
-- api.tg_* functions with the service role. Those functions are SECURITY
-- DEFINER, executable only by service_role, and resolve the app user from an
-- active link of the verified Telegram identity — never from chat text. They
-- then "act as" that user (request.jwt.claims for the current transaction) so
-- budget_owner(), the audit trigger and create_transaction_core behave
-- exactly as they do for the web. RLS is bypassed inside these functions, so
-- every ownership check is explicit.
--
-- The api.telegram_* functions are the web side (pairing, approval, default
-- wallet, disconnect). They are SECURITY DEFINER too because the integration
-- tables are not readable by authenticated; each answers only for auth.uid().
--
-- Telegram IDs are bigint in the database and digit strings at the API
-- boundary.

-- ---------------------------------------------------------------------------
-- Tables (no policies: reachable only through the functions below)
-- ---------------------------------------------------------------------------

create table app_data.telegram_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_data.profiles (id) on delete cascade,
  bot_id bigint not null,
  telegram_user_id bigint not null,
  chat_id bigint not null,
  username text not null default '',
  first_name text not null default '',
  default_account_id uuid references app_data.accounts (id) on delete set null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

-- One active Telegram identity per app user, and one app user per identity.
create unique index telegram_links_active_user_idx on app_data.telegram_links (user_id)
  where revoked_at is null;
create unique index telegram_links_active_identity_idx
  on app_data.telegram_links (bot_id, telegram_user_id)
  where revoked_at is null;

-- One-time pairing codes. Only the SHA-256 of the code is stored. The token is
-- deleted when it is confirmed, rejected, replaced, or long expired.
create table app_data.telegram_link_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_data.profiles (id) on delete cascade,
  code_hash bytea not null unique,
  bot_id bigint,
  candidate_telegram_user_id bigint,
  candidate_chat_id bigint,
  candidate_username text not null default '',
  candidate_first_name text not null default '',
  claimed_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index telegram_link_tokens_user_idx on app_data.telegram_link_tokens (user_id);

-- A draft is the transaction proposed from one chat message. The source
-- message key makes re-delivered messages reuse the same draft, and
-- transaction_id (fixed at creation) makes every commit of the draft resolve
-- to the same transaction. Committed drafts are kept (no FK to transactions)
-- so a transaction deleted on the web is never re-created by an old button.
create table app_data.telegram_drafts (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references app_data.telegram_links (id) on delete cascade,
  budget_owner_id uuid not null references app_data.profiles (id) on delete cascade,
  bot_id bigint not null,
  chat_id bigint not null,
  source_message_id bigint not null,
  type text not null check (type in ('income', 'expense')),
  amount_rupiah bigint check (amount_rupiah > 0 and amount_rupiah <= 999999999999999),
  -- Candidate amounts when the message is ambiguous ("3 burger 3000").
  amount_options jsonb,
  account_id uuid,
  category_id uuid,
  occurred_on date not null,
  note text not null default '' check (char_length(note) <= 250),
  status text not null default 'open'
    check (status in ('open', 'awaiting_amount', 'committed', 'cancelled')),
  version integer not null default 1 check (version >= 1),
  transaction_id uuid not null default gen_random_uuid(),
  expires_at timestamptz not null,
  committed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bot_id, chat_id, source_message_id)
);

create index telegram_drafts_link_idx on app_data.telegram_drafts (link_id, status);
create index telegram_drafts_expires_idx on app_data.telegram_drafts (expires_at);

-- Webhook deliveries. result holds the outcome of the update's database step
-- so a retried delivery replays it instead of applying it twice; replied_at
-- marks that the bot's answer was delivered. No chat text is stored.
create table app_data.telegram_events (
  bot_id bigint not null,
  update_id bigint not null,
  result jsonb,
  replied_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (bot_id, update_id)
);

create index telegram_events_created_idx on app_data.telegram_events (created_at);

alter table app_data.telegram_links enable row level security;
alter table app_data.telegram_link_tokens enable row level security;
alter table app_data.telegram_drafts enable row level security;
alter table app_data.telegram_events enable row level security;

revoke all on app_data.telegram_links, app_data.telegram_link_tokens,
  app_data.telegram_drafts, app_data.telegram_events from public;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Telegram ID from its API string form.
create function app_data.tg_id(p_value text) returns bigint
language plpgsql immutable set search_path = ''
as $$
begin
  if p_value is null or p_value !~ '^-?[0-9]{1,19}$' then
    raise exception 'TELEGRAM_ID_INVALID' using errcode = 'P0001';
  end if;
  return p_value::numeric::bigint;
exception
  when numeric_value_out_of_range then
    raise exception 'TELEGRAM_ID_INVALID' using errcode = 'P0001';
end;
$$;

-- Makes auth.uid() return p_user_id until the end of the current transaction.
-- Only called by the bot functions after resolving an active link.
create function app_data.tg_act_as(p_user_id uuid) returns void
language plpgsql set search_path = ''
as $$
begin
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object('sub', p_user_id, 'role', 'authenticated')::text,
    true
  );
  perform pg_catalog.set_config('request.jwt.claim.sub', p_user_id::text, true);
end;
$$;

-- Active link for a verified identity in its private chat, then acts as its user.
create function app_data.tg_require_link(p_bot_id text, p_telegram_user_id text, p_chat_id text)
returns app_data.telegram_links
language plpgsql set search_path = ''
as $$
declare
  v_link app_data.telegram_links;
begin
  select * into v_link from app_data.telegram_links l
  where l.bot_id = app_data.tg_id(p_bot_id)
    and l.telegram_user_id = app_data.tg_id(p_telegram_user_id)
    and l.chat_id = app_data.tg_id(p_chat_id)
    and l.revoked_at is null;
  if not found then
    raise exception 'TELEGRAM_NOT_LINKED' using errcode = 'P0001';
  end if;
  perform app_data.tg_act_as(v_link.user_id);
  return v_link;
end;
$$;

-- Stored result of an update that already went through its database step.
create function app_data.tg_replay(p_bot_id text, p_update_id text) returns jsonb
language sql stable set search_path = ''
as $$
  select e.result from app_data.telegram_events e
  where p_update_id is not null
    and e.bot_id = app_data.tg_id(p_bot_id)
    and e.update_id = app_data.tg_id(p_update_id)
$$;

create function app_data.tg_remember(p_bot_id text, p_update_id text, p_result jsonb) returns jsonb
language plpgsql set search_path = ''
as $$
begin
  if p_update_id is not null then
    insert into app_data.telegram_events (bot_id, update_id, result)
    values (app_data.tg_id(p_bot_id), app_data.tg_id(p_update_id), p_result)
    on conflict (bot_id, update_id) do update set result = excluded.result;
  end if;
  return p_result;
end;
$$;

-- Rejects wallet/category/date choices the draft could never be saved with.
-- The transactions trigger checks again at commit.
create function app_data.tg_check_draft_refs(
  p_owner_id uuid,
  p_type text,
  p_account_id uuid,
  p_category_id uuid,
  p_occurred_on date
) returns void
language plpgsql stable set search_path = ''
as $$
declare
  v_account record;
  v_category record;
begin
  if p_occurred_on is null then
    raise exception 'DATE_INVALID' using errcode = 'P0001';
  end if;
  if p_occurred_on > app_data.today_jakarta() then
    raise exception 'DATE_IN_FUTURE' using errcode = 'P0001';
  end if;
  if p_account_id is not null then
    select a.opened_on, a.archived_at into v_account
    from app_data.accounts a where a.id = p_account_id and a.user_id = p_owner_id;
    if not found then
      raise exception 'ACCOUNT_NOT_FOUND' using errcode = 'P0001';
    end if;
    if v_account.archived_at is not null then
      raise exception 'ARCHIVED_REFERENCE' using errcode = 'P0001';
    end if;
    if p_occurred_on < v_account.opened_on then
      raise exception 'DATE_BEFORE_OPENED' using errcode = 'P0001';
    end if;
  end if;
  if p_category_id is not null then
    select c.type, c.archived_at into v_category
    from app_data.categories c where c.id = p_category_id and c.user_id = p_owner_id;
    if not found then
      raise exception 'CATEGORY_NOT_FOUND' using errcode = 'P0001';
    end if;
    if v_category.type <> p_type then
      raise exception 'CATEGORY_TYPE_MISMATCH' using errcode = 'P0001';
    end if;
    if v_category.archived_at is not null then
      raise exception 'ARCHIVED_REFERENCE' using errcode = 'P0001';
    end if;
  end if;
end;
$$;

create function app_data.tg_draft_json(d app_data.telegram_drafts) returns jsonb
language sql stable set search_path = ''
as $$
  select jsonb_build_object(
    'id', d.id,
    'version', d.version,
    'status', d.status,
    'ready', d.status = 'open' and d.amount_rupiah is not null
      and d.account_id is not null and d.category_id is not null,
    'expired', d.status in ('open', 'awaiting_amount') and d.expires_at <= now(),
    'type', d.type,
    'amount_rupiah', d.amount_rupiah::text,
    'amount_options', d.amount_options,
    'account_id', d.account_id,
    'account_name', (select a.name from app_data.accounts a where a.id = d.account_id),
    'category_id', d.category_id,
    'category_name', (
      select case when pc.id is null then c.name else pc.name || ' › ' || c.name end
      from app_data.categories c
      left join app_data.categories pc on pc.id = c.parent_id
      where c.id = d.category_id),
    'occurred_on', d.occurred_on,
    'note', d.note,
    'transaction_id', d.transaction_id,
    'expires_at', d.expires_at,
    'committed_at', d.committed_at
  )
$$;

-- Cancels the open drafts of a link (new draft, disconnect).
create function app_data.tg_cancel_open_drafts(p_link_id uuid, p_except uuid default null) returns void
language sql set search_path = ''
as $$
  update app_data.telegram_drafts
     set status = 'cancelled', updated_at = now()
   where link_id = p_link_id
     and status in ('open', 'awaiting_amount')
     and (p_except is null or id <> p_except)
$$;

-- Draft of this link that a button or follow-up message refers to, locked.
create function app_data.tg_lock_draft(p_link app_data.telegram_links, p_draft_id uuid)
returns app_data.telegram_drafts
language plpgsql set search_path = ''
as $$
declare
  v_draft app_data.telegram_drafts;
begin
  select * into v_draft from app_data.telegram_drafts d
  where d.id = p_draft_id and d.link_id = p_link.id and d.chat_id = p_link.chat_id
  for update;
  if not found then
    raise exception 'DRAFT_NOT_FOUND' using errcode = 'P0001';
  end if;
  return v_draft;
end;
$$;

-- Common checks before changing or saving an open draft.
create function app_data.tg_require_open_draft(p_draft app_data.telegram_drafts, p_version integer)
returns void
language plpgsql stable set search_path = ''
as $$
begin
  if p_draft.status not in ('open', 'awaiting_amount') then
    raise exception 'DRAFT_CLOSED' using errcode = 'P0001';
  end if;
  if p_draft.expires_at <= now() then
    raise exception 'DRAFT_EXPIRED' using errcode = 'P0001';
  end if;
  if p_version is distinct from p_draft.version then
    raise exception 'VERSION_CONFLICT' using errcode = 'P0001';
  end if;
  -- The bot follows the active budget; a draft made for another one is stale.
  if p_draft.budget_owner_id <> app_data.budget_owner() then
    raise exception 'BUDGET_CHANGED' using errcode = 'P0001';
  end if;
end;
$$;

create function app_data.tg_link_json(l app_data.telegram_links) returns jsonb
language sql stable set search_path = ''
as $$
  select jsonb_build_object(
    'id', l.id,
    'telegram_user_id', l.telegram_user_id::text,
    'username', l.username,
    'first_name', l.first_name,
    'default_account_id', l.default_account_id,
    'created_at', l.created_at
  )
$$;

-- ---------------------------------------------------------------------------
-- Web RPCs (authenticated)
-- ---------------------------------------------------------------------------

create function api.telegram_get_status() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid uuid := app_data.require_uid();
begin
  return jsonb_build_object(
    'link', (
      select app_data.tg_link_json(l) from app_data.telegram_links l
      where l.user_id = v_uid and l.revoked_at is null),
    'pending', (
      select jsonb_build_object(
        'id', t.id,
        'expires_at', t.expires_at,
        'claimed', t.claimed_at is not null,
        'username', t.candidate_username,
        'first_name', t.candidate_first_name
      )
      from app_data.telegram_link_tokens t
      where t.user_id = v_uid and t.expires_at > now()
      order by t.created_at desc
      limit 1)
  );
end;
$$;

-- Starts pairing. The raw code is returned once and goes into the bot's deep
-- link; it is valid for five minutes and replaces any earlier code.
create function api.telegram_create_link_token() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := app_data.require_uid();
  v_code text := replace(gen_random_uuid()::text, '-', '');
  v_row app_data.telegram_link_tokens;
begin
  if not exists (select 1 from app_data.profiles p where p.id = v_uid) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  delete from app_data.telegram_link_tokens t where t.user_id = v_uid;
  insert into app_data.telegram_link_tokens (user_id, code_hash, expires_at)
  values (v_uid, sha256(convert_to(v_code, 'UTF8')), now() + interval '5 minutes')
  returning * into v_row;
  return jsonb_build_object('id', v_row.id, 'code', v_code, 'expires_at', v_row.expires_at);
end;
$$;

-- Approves the Telegram identity that opened the deep link.
create function api.telegram_confirm_link(p_token_id uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := app_data.require_uid();
  v_token app_data.telegram_link_tokens;
  v_old record;
begin
  select * into v_token from app_data.telegram_link_tokens t
  where t.id = p_token_id and t.user_id = v_uid
  for update;
  if not found then
    raise exception 'TOKEN_INVALID' using errcode = 'P0001';
  end if;
  if v_token.expires_at <= now() then
    raise exception 'TOKEN_EXPIRED' using errcode = 'P0001';
  end if;
  if v_token.claimed_at is null then
    raise exception 'TOKEN_NOT_CLAIMED' using errcode = 'P0001';
  end if;

  -- Replace the user's previous link and any link of this identity.
  for v_old in
    select l.id from app_data.telegram_links l
    where l.revoked_at is null
      and (l.user_id = v_uid
           or (l.bot_id = v_token.bot_id and l.telegram_user_id = v_token.candidate_telegram_user_id))
    for update
  loop
    perform app_data.tg_cancel_open_drafts(v_old.id);
    update app_data.telegram_links set revoked_at = now() where id = v_old.id;
  end loop;

  insert into app_data.telegram_links (user_id, bot_id, telegram_user_id, chat_id, username, first_name)
  values (v_uid, v_token.bot_id, v_token.candidate_telegram_user_id, v_token.candidate_chat_id,
          v_token.candidate_username, v_token.candidate_first_name);
  delete from app_data.telegram_link_tokens t where t.id = v_token.id;

  return api.telegram_get_status();
end;
$$;

create function api.telegram_reject_link(p_token_id uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := app_data.require_uid();
begin
  delete from app_data.telegram_link_tokens t where t.id = p_token_id and t.user_id = v_uid;
  return api.telegram_get_status();
end;
$$;

-- Wallet used when a chat message doesn't name one. It must be an active
-- wallet of the budget the user is showing; null clears it.
create function api.telegram_set_default_account(p_account_id uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := app_data.require_uid();
  v_link app_data.telegram_links;
  v_archived_at timestamptz;
begin
  select * into v_link from app_data.telegram_links l
  where l.user_id = v_uid and l.revoked_at is null
  for update;
  if not found then
    raise exception 'TELEGRAM_NOT_LINKED' using errcode = 'P0001';
  end if;
  if p_account_id is not null then
    select a.archived_at into v_archived_at from app_data.accounts a
    where a.id = p_account_id and a.user_id = app_data.budget_owner();
    if not found then
      raise exception 'ACCOUNT_NOT_FOUND' using errcode = 'P0001';
    end if;
    if v_archived_at is not null then
      raise exception 'ARCHIVED_REFERENCE' using errcode = 'P0001';
    end if;
  end if;
  update app_data.telegram_links set default_account_id = p_account_id where id = v_link.id;
  return api.telegram_get_status();
end;
$$;

create function api.telegram_unlink() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := app_data.require_uid();
  v_link app_data.telegram_links;
begin
  select * into v_link from app_data.telegram_links l
  where l.user_id = v_uid and l.revoked_at is null
  for update;
  if found then
    perform app_data.tg_cancel_open_drafts(v_link.id);
    update app_data.telegram_links set revoked_at = now() where id = v_link.id;
  end if;
  return api.telegram_get_status();
end;
$$;

-- ---------------------------------------------------------------------------
-- Bot RPCs (service_role only)
-- ---------------------------------------------------------------------------

-- Registers a webhook delivery. "replied" means the update was fully handled
-- before and the delivery can be acknowledged without doing anything.
-- Also prunes old integration data.
create function api.tg_receive_update(p_bot_id text, p_update_id text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_event app_data.telegram_events;
begin
  insert into app_data.telegram_events (bot_id, update_id)
  values (app_data.tg_id(p_bot_id), app_data.tg_id(p_update_id))
  on conflict (bot_id, update_id) do nothing;

  select * into v_event from app_data.telegram_events e
  where e.bot_id = app_data.tg_id(p_bot_id) and e.update_id = app_data.tg_id(p_update_id);

  -- Telegram stops re-delivering after 24 hours, and drafts expire after ten
  -- minutes; keep a margin for both.
  if random() < 0.05 then
    delete from app_data.telegram_events e where e.created_at < now() - interval '7 days';
    delete from app_data.telegram_link_tokens t where t.expires_at < now() - interval '1 day';
    delete from app_data.telegram_drafts d where d.expires_at < now() - interval '30 days';
  end if;

  return jsonb_build_object('replied', v_event.replied_at is not null);
end;
$$;

create function api.tg_mark_replied(p_bot_id text, p_update_id text) returns void
language sql security definer set search_path = ''
as $$
  update app_data.telegram_events
     set replied_at = coalesce(replied_at, now())
   where bot_id = app_data.tg_id(p_bot_id) and update_id = app_data.tg_id(p_update_id)
$$;

-- "/start <code>" from the deep link: records which Telegram identity wants
-- to connect. The web user still has to approve it.
create function api.tg_claim_link_token(
  p_bot_id text,
  p_code text,
  p_telegram_user_id text,
  p_chat_id text,
  p_username text,
  p_first_name text
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_token app_data.telegram_link_tokens;
  v_user bigint := app_data.tg_id(p_telegram_user_id);
  v_chat bigint := app_data.tg_id(p_chat_id);
begin
  if p_code is null or p_code !~ '^[0-9a-f]{32}$' then
    raise exception 'TOKEN_INVALID' using errcode = 'P0001';
  end if;
  select * into v_token from app_data.telegram_link_tokens t
  where t.code_hash = sha256(convert_to(p_code, 'UTF8'))
  for update;
  if not found then
    raise exception 'TOKEN_INVALID' using errcode = 'P0001';
  end if;
  if v_token.expires_at <= now() then
    raise exception 'TOKEN_EXPIRED' using errcode = 'P0001';
  end if;
  -- A code belongs to the first identity that uses it.
  if v_token.claimed_at is not null
     and (v_token.candidate_telegram_user_id <> v_user or v_token.bot_id <> app_data.tg_id(p_bot_id)) then
    raise exception 'TOKEN_INVALID' using errcode = 'P0001';
  end if;

  update app_data.telegram_link_tokens
     set bot_id = app_data.tg_id(p_bot_id),
         candidate_telegram_user_id = v_user,
         candidate_chat_id = v_chat,
         candidate_username = left(coalesce(p_username, ''), 64),
         candidate_first_name = left(coalesce(p_first_name, ''), 64),
         claimed_at = coalesce(claimed_at, now())
   where id = v_token.id;
  return jsonb_build_object('claimed', true, 'expires_at', v_token.expires_at);
end;
$$;

-- What the parser needs for a linked chat: the active budget's wallets and
-- categories, the default wallet, and the draft waiting for input, if any.
-- Returns {"linked": false} for unknown identities.
create function api.tg_get_context(p_bot_id text, p_telegram_user_id text, p_chat_id text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_link app_data.telegram_links;
  v_owner uuid;
begin
  begin
    v_link := app_data.tg_require_link(p_bot_id, p_telegram_user_id, p_chat_id);
  exception
    when others then
      if sqlerrm = 'TELEGRAM_NOT_LINKED' then
        return jsonb_build_object('linked', false);
      end if;
      raise;
  end;
  v_owner := app_data.budget_owner();

  return jsonb_build_object(
    'linked', true,
    'today', app_data.today_jakarta(),
    'budget', (
      select jsonb_build_object(
        'owner_id', o.id,
        'owner_name', coalesce(nullif(o.display_name, ''), ''),
        'is_own', o.id = v_link.user_id)
      from app_data.profiles o where o.id = v_owner),
    'default_account_id', (
      select a.id from app_data.accounts a
      where a.id = v_link.default_account_id and a.user_id = v_owner and a.archived_at is null),
    'accounts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'name', a.name, 'type', a.type, 'opened_on', a.opened_on
      ) order by a.created_at, a.id)
      from app_data.accounts a
      where a.user_id = v_owner and a.archived_at is null), '[]'::jsonb),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'type', c.type, 'seed_key', c.seed_key,
        'parent_id', c.parent_id, 'parent_name', pc.name
      ) order by c.type, c.created_at, c.id)
      from app_data.categories c
      left join app_data.categories pc on pc.id = c.parent_id
      where c.user_id = v_owner and c.archived_at is null), '[]'::jsonb),
    'active_draft', (
      select app_data.tg_draft_json(d) from app_data.telegram_drafts d
      where d.link_id = v_link.id and d.status in ('open', 'awaiting_amount')
        and d.expires_at > now()
      order by d.created_at desc
      limit 1)
  );
end;
$$;

-- Creates the draft for one chat message. p_draft:
-- {type, amount_rupiah|null, amount_options|null, account_id|null,
--  category_id|null, occurred_on, note}. Other open drafts are cancelled.
-- Without an amount or amount options the draft starts as awaiting_amount.
create function api.tg_create_draft(
  p_bot_id text,
  p_update_id text,
  p_telegram_user_id text,
  p_chat_id text,
  p_message_id text,
  p_draft jsonb
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_prev jsonb := app_data.tg_replay(p_bot_id, p_update_id);
  v_link app_data.telegram_links;
  v_owner uuid;
  v_type text := p_draft ->> 'type';
  v_amount bigint;
  v_options jsonb := p_draft -> 'amount_options';
  v_account uuid := nullif(p_draft ->> 'account_id', '')::uuid;
  v_category uuid := nullif(p_draft ->> 'category_id', '')::uuid;
  v_date date := (p_draft ->> 'occurred_on')::date;
  v_note text := btrim(coalesce(p_draft ->> 'note', ''));
  v_option jsonb;
  v_row app_data.telegram_drafts;
begin
  if v_prev is not null then
    return v_prev;
  end if;
  v_link := app_data.tg_require_link(p_bot_id, p_telegram_user_id, p_chat_id);
  v_owner := app_data.budget_owner();

  if v_type is null or v_type not in ('income', 'expense') then
    raise exception 'TYPE_INVALID' using errcode = 'P0001';
  end if;
  if nullif(p_draft ->> 'amount_rupiah', '') is not null then
    v_amount := app_data.parse_rupiah(p_draft ->> 'amount_rupiah', false);
  end if;
  if v_options is not null and jsonb_typeof(v_options) = 'null' then
    v_options := null;
  end if;
  if v_options is not null then
    if jsonb_typeof(v_options) <> 'array' or jsonb_array_length(v_options) not between 2 and 4 then
      raise exception 'AMOUNT_INVALID' using errcode = 'P0001';
    end if;
    for v_option in select * from jsonb_array_elements(v_options) loop
      perform app_data.parse_rupiah(v_option #>> '{}', false);
    end loop;
  end if;
  if char_length(v_note) > 250 then
    raise exception 'NOTE_TOO_LONG' using errcode = 'P0001';
  end if;
  perform app_data.tg_check_draft_refs(v_owner, v_type, v_account, v_category, v_date);

  -- Without any amount the bot asks the user to type one.
  insert into app_data.telegram_drafts (
    link_id, budget_owner_id, bot_id, chat_id, source_message_id, type, amount_rupiah,
    amount_options, account_id, category_id, occurred_on, note, status, expires_at
  ) values (
    v_link.id, v_owner, v_link.bot_id, v_link.chat_id, app_data.tg_id(p_message_id), v_type, v_amount,
    v_options, v_account, v_category, v_date, v_note,
    case when v_amount is null and v_options is null then 'awaiting_amount' else 'open' end,
    now() + interval '10 minutes'
  )
  on conflict (bot_id, chat_id, source_message_id) do nothing
  returning * into v_row;

  if not found then
    -- Same message seen before (e.g. an edited copy): show what it produced.
    select * into v_row from app_data.telegram_drafts d
    where d.bot_id = v_link.bot_id and d.chat_id = v_link.chat_id
      and d.source_message_id = app_data.tg_id(p_message_id) and d.link_id = v_link.id;
    if not found then
      raise exception 'DRAFT_NOT_FOUND' using errcode = 'P0001';
    end if;
  else
    perform app_data.tg_cancel_open_drafts(v_link.id, v_row.id);
  end if;

  return app_data.tg_remember(p_bot_id, p_update_id, app_data.tg_draft_json(v_row));
end;
$$;

-- Changes one or more fields of an open draft at the version the button or
-- message was made for. p_changes keys: amount_rupiah, account_id,
-- category_id, occurred_on, awaiting_amount (true asks for a typed amount).
create function api.tg_update_draft(
  p_bot_id text,
  p_update_id text,
  p_telegram_user_id text,
  p_chat_id text,
  p_draft_id uuid,
  p_version integer,
  p_changes jsonb
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_prev jsonb := app_data.tg_replay(p_bot_id, p_update_id);
  v_link app_data.telegram_links;
  v_draft app_data.telegram_drafts;
  v_changes jsonb := coalesce(p_changes, '{}'::jsonb);
begin
  if v_prev is not null then
    return v_prev;
  end if;
  v_link := app_data.tg_require_link(p_bot_id, p_telegram_user_id, p_chat_id);
  v_draft := app_data.tg_lock_draft(v_link, p_draft_id);
  perform app_data.tg_require_open_draft(v_draft, p_version);

  if v_changes ? 'amount_rupiah' then
    v_draft.amount_rupiah := app_data.parse_rupiah(v_changes ->> 'amount_rupiah', false);
    v_draft.amount_options := null;
    v_draft.status := 'open';
  end if;
  if v_changes ? 'account_id' then
    v_draft.account_id := (v_changes ->> 'account_id')::uuid;
  end if;
  if v_changes ? 'category_id' then
    v_draft.category_id := (v_changes ->> 'category_id')::uuid;
  end if;
  if v_changes ? 'occurred_on' then
    v_draft.occurred_on := (v_changes ->> 'occurred_on')::date;
  end if;
  if coalesce((v_changes ->> 'awaiting_amount')::boolean, false) then
    v_draft.status := 'awaiting_amount';
  elsif (v_changes ->> 'awaiting_amount')::boolean is false and v_draft.status = 'awaiting_amount' then
    v_draft.status := 'open';
  end if;
  perform app_data.tg_check_draft_refs(
    v_draft.budget_owner_id, v_draft.type, v_draft.account_id, v_draft.category_id, v_draft.occurred_on
  );

  update app_data.telegram_drafts
     set amount_rupiah = v_draft.amount_rupiah,
         amount_options = v_draft.amount_options,
         account_id = v_draft.account_id,
         category_id = v_draft.category_id,
         occurred_on = v_draft.occurred_on,
         status = v_draft.status,
         version = version + 1,
         expires_at = now() + interval '10 minutes',
         updated_at = now()
   where id = v_draft.id
  returning * into v_draft;

  return app_data.tg_remember(p_bot_id, p_update_id, app_data.tg_draft_json(v_draft));
end;
$$;

-- "Simpan": saves the draft as a transaction of the active budget, once.
-- A committed draft answers with its stored result (transaction may be null
-- when it was deleted on the web afterwards).
create function api.tg_commit_draft(
  p_bot_id text,
  p_update_id text,
  p_telegram_user_id text,
  p_chat_id text,
  p_draft_id uuid,
  p_version integer
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_prev jsonb := app_data.tg_replay(p_bot_id, p_update_id);
  v_link app_data.telegram_links;
  v_draft app_data.telegram_drafts;
  v_txn jsonb;
  v_replayed boolean := false;
begin
  if v_prev is not null then
    return v_prev;
  end if;
  v_link := app_data.tg_require_link(p_bot_id, p_telegram_user_id, p_chat_id);
  v_draft := app_data.tg_lock_draft(v_link, p_draft_id);

  if v_draft.status = 'committed' then
    v_replayed := true;
  else
    perform app_data.tg_require_open_draft(v_draft, p_version);
    if v_draft.status <> 'open' or v_draft.amount_rupiah is null
       or v_draft.account_id is null or v_draft.category_id is null then
      raise exception 'DRAFT_INCOMPLETE' using errcode = 'P0001';
    end if;

    perform app_data.create_transaction_core(
      v_draft.budget_owner_id, v_draft.transaction_id, v_draft.type, v_draft.amount_rupiah::text,
      v_draft.account_id, null, v_draft.category_id, v_draft.occurred_on, v_draft.note, 'telegram'
    );
    update app_data.telegram_drafts
       set status = 'committed', committed_at = now(), updated_at = now()
     where id = v_draft.id
    returning * into v_draft;
  end if;

  select app_data.transaction_json(t) into v_txn
  from app_data.transactions t
  where t.id = v_draft.transaction_id and t.user_id = v_draft.budget_owner_id;

  return app_data.tg_remember(p_bot_id, p_update_id, jsonb_build_object(
    'draft', app_data.tg_draft_json(v_draft),
    'transaction', v_txn,
    'replayed', v_replayed
  ));
end;
$$;

-- "Batal" or /cancel. A null draft ID cancels the chat's open draft.
create function api.tg_cancel_draft(
  p_bot_id text,
  p_update_id text,
  p_telegram_user_id text,
  p_chat_id text,
  p_draft_id uuid
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_prev jsonb := app_data.tg_replay(p_bot_id, p_update_id);
  v_link app_data.telegram_links;
  v_draft app_data.telegram_drafts;
begin
  if v_prev is not null then
    return v_prev;
  end if;
  v_link := app_data.tg_require_link(p_bot_id, p_telegram_user_id, p_chat_id);

  if p_draft_id is null then
    select * into v_draft from app_data.telegram_drafts d
    where d.link_id = v_link.id and d.status in ('open', 'awaiting_amount') and d.expires_at > now()
    order by d.created_at desc
    limit 1
    for update;
    if not found then
      return app_data.tg_remember(p_bot_id, p_update_id, jsonb_build_object('cancelled', false));
    end if;
  else
    v_draft := app_data.tg_lock_draft(v_link, p_draft_id);
    if v_draft.status not in ('open', 'awaiting_amount') then
      return app_data.tg_remember(p_bot_id, p_update_id, jsonb_build_object(
        'cancelled', false, 'draft', app_data.tg_draft_json(v_draft)));
    end if;
  end if;

  update app_data.telegram_drafts set status = 'cancelled', updated_at = now()
  where id = v_draft.id
  returning * into v_draft;
  return app_data.tg_remember(p_bot_id, p_update_id, jsonb_build_object(
    'cancelled', true, 'draft', app_data.tg_draft_json(v_draft)));
end;
$$;

-- /last: latest transactions of the active budget.
create function api.tg_recent_transactions(
  p_bot_id text,
  p_telegram_user_id text,
  p_chat_id text,
  p_limit integer default 5
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform app_data.tg_require_link(p_bot_id, p_telegram_user_id, p_chat_id);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', q.id,
      'type', q.type,
      'source', q.source,
      'amount_rupiah', q.amount_rupiah,
      'account_name', q.account_name,
      'to_account_name', q.to_account_name,
      'category_name', q.category_name,
      'occurred_on', q.occurred_on,
      'note', q.note
    ))
    from app_data.query_transactions(
      app_data.budget_owner(), null, null, null, null, null, null, null, null, null,
      least(greatest(coalesce(p_limit, 5), 1), 10)
    ) q), '[]'::jsonb);
end;
$$;

-- /disconnect from the chat (after the user confirms with a button).
create function api.tg_unlink(
  p_bot_id text,
  p_update_id text,
  p_telegram_user_id text,
  p_chat_id text
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_prev jsonb := app_data.tg_replay(p_bot_id, p_update_id);
  v_link app_data.telegram_links;
begin
  if v_prev is not null then
    return v_prev;
  end if;
  begin
    v_link := app_data.tg_require_link(p_bot_id, p_telegram_user_id, p_chat_id);
  exception
    when others then
      if sqlerrm = 'TELEGRAM_NOT_LINKED' then
        return app_data.tg_remember(p_bot_id, p_update_id, jsonb_build_object('unlinked', false));
      end if;
      raise;
  end;
  perform app_data.tg_cancel_open_drafts(v_link.id);
  update app_data.telegram_links set revoked_at = now() where id = v_link.id;
  return app_data.tg_remember(p_bot_id, p_update_id, jsonb_build_object('unlinked', true));
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke execute on function
  app_data.tg_id(text),
  app_data.tg_act_as(uuid),
  app_data.tg_require_link(text, text, text),
  app_data.tg_replay(text, text),
  app_data.tg_remember(text, text, jsonb),
  app_data.tg_check_draft_refs(uuid, text, uuid, uuid, date),
  app_data.tg_draft_json(app_data.telegram_drafts),
  app_data.tg_cancel_open_drafts(uuid, uuid),
  app_data.tg_lock_draft(app_data.telegram_links, uuid),
  app_data.tg_require_open_draft(app_data.telegram_drafts, integer),
  app_data.tg_link_json(app_data.telegram_links),
  api.telegram_get_status(),
  api.telegram_create_link_token(),
  api.telegram_confirm_link(uuid),
  api.telegram_reject_link(uuid),
  api.telegram_set_default_account(uuid),
  api.telegram_unlink(),
  api.tg_receive_update(text, text),
  api.tg_mark_replied(text, text),
  api.tg_claim_link_token(text, text, text, text, text, text),
  api.tg_get_context(text, text, text),
  api.tg_create_draft(text, text, text, text, text, jsonb),
  api.tg_update_draft(text, text, text, text, uuid, integer, jsonb),
  api.tg_commit_draft(text, text, text, text, uuid, integer),
  api.tg_cancel_draft(text, text, text, text, uuid),
  api.tg_recent_transactions(text, text, text, integer),
  api.tg_unlink(text, text, text, text)
from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke execute on all functions in schema api from anon';
  end if;
end;
$$;

grant execute on function
  api.telegram_get_status(),
  api.telegram_create_link_token(),
  api.telegram_confirm_link(uuid),
  api.telegram_reject_link(uuid),
  api.telegram_set_default_account(uuid),
  api.telegram_unlink()
to authenticated;

-- Explicit, in case the project grants new functions to authenticated by default.
revoke execute on function
  api.tg_receive_update(text, text),
  api.tg_mark_replied(text, text),
  api.tg_claim_link_token(text, text, text, text, text, text),
  api.tg_get_context(text, text, text),
  api.tg_create_draft(text, text, text, text, text, jsonb),
  api.tg_update_draft(text, text, text, text, uuid, integer, jsonb),
  api.tg_commit_draft(text, text, text, text, uuid, integer),
  api.tg_cancel_draft(text, text, text, text, uuid),
  api.tg_recent_transactions(text, text, text, integer),
  api.tg_unlink(text, text, text, text)
from authenticated;

grant execute on function
  api.tg_receive_update(text, text),
  api.tg_mark_replied(text, text),
  api.tg_claim_link_token(text, text, text, text, text, text),
  api.tg_get_context(text, text, text),
  api.tg_create_draft(text, text, text, text, text, jsonb),
  api.tg_update_draft(text, text, text, text, uuid, integer, jsonb),
  api.tg_commit_draft(text, text, text, text, uuid, integer),
  api.tg_cancel_draft(text, text, text, text, uuid),
  api.tg_recent_transactions(text, text, text, integer),
  api.tg_unlink(text, text, text, text)
to service_role;

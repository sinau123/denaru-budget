-- Telegram chooses its own budget.
--
-- Until now the bot recorded into the budget the user was showing on the web
-- (profiles.active_budget_id). A member who switched budgets on the web for a
-- quick look also switched the bot. The link now keeps its own choice
-- (telegram_links.budget_owner_id, null = the user's own budget), picked with
-- /budget in the chat or in Settings → Telegram. Like the web choice, it
-- falls back to the user's own budget once the share is gone, and is cleared
-- when the membership is removed so a later re-invite never switches it.
--
-- The default wallet belongs to one budget, so it is cleared when the budget
-- changes; the bot then asks for a new one.

alter table app_data.telegram_links
  add column budget_owner_id uuid references app_data.profiles (id) on delete set null;

-- Keep what existing links did: record into the budget shown on the web.
update app_data.telegram_links l
   set budget_owner_id = p.active_budget_id
  from app_data.profiles p
 where p.id = l.user_id and l.revoked_at is null and p.active_budget_id is not null;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Budget the chat records into: the link's choice while the user is still an
-- accepted member of it, otherwise their own.
create function app_data.tg_budget_owner(p_link app_data.telegram_links) returns uuid
language sql stable set search_path = ''
as $$
  select case
    when p_link.budget_owner_id is not null and exists (
      select 1 from app_data.budget_members m
      where m.owner_id = p_link.budget_owner_id
        and m.member_id = p_link.user_id
        and m.status = 'accepted')
    then p_link.budget_owner_id
    else p_link.user_id
  end
$$;

-- Budgets a user may record into from the chat: their own first, then
-- accepted shares.
create function app_data.tg_budgets_json(p_user_id uuid) returns jsonb
language sql stable set search_path = ''
as $$
  select jsonb_build_array(jsonb_build_object(
      'owner_id', p.id,
      'owner_name', p.display_name,
      'is_own', true))
    || coalesce((
      select jsonb_agg(jsonb_build_object(
        'owner_id', m.owner_id,
        'owner_name', coalesce(nullif(o.display_name, ''), nullif(m.owner_name, ''), m.owner_email),
        'is_own', false
      ) order by m.accepted_at, m.id)
      from app_data.budget_members m
      join app_data.profiles o on o.id = m.owner_id
      where m.member_id = p_user_id and m.status = 'accepted'), '[]'::jsonb)
  from app_data.profiles p
  where p.id = p_user_id
$$;

create function app_data.tg_budget_json(p_link app_data.telegram_links) returns jsonb
language sql stable set search_path = ''
as $$
  select b
  from jsonb_array_elements(app_data.tg_budgets_json(p_link.user_id)) b
  where (b ->> 'owner_id')::uuid = app_data.tg_budget_owner(p_link)
$$;

-- Switches the link to another budget (null = own). Changing budgets clears
-- the default wallet and cancels open drafts, which belong to the old budget.
create function app_data.tg_apply_budget(p_link app_data.telegram_links, p_owner_id uuid)
returns app_data.telegram_links
language plpgsql set search_path = ''
as $$
declare
  v_owner uuid := coalesce(p_owner_id, p_link.user_id);
  v_row app_data.telegram_links;
begin
  if v_owner <> p_link.user_id and not exists (
    select 1 from app_data.budget_members m
    where m.owner_id = v_owner and m.member_id = p_link.user_id and m.status = 'accepted'
  ) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_owner = app_data.tg_budget_owner(p_link) then
    -- Store the effective choice (drops a choice that had already lapsed).
    update app_data.telegram_links set budget_owner_id = nullif(v_owner, user_id)
    where id = p_link.id
    returning * into v_row;
    return v_row;
  end if;

  perform app_data.tg_cancel_open_drafts(p_link.id);
  update app_data.telegram_links
     set budget_owner_id = nullif(v_owner, user_id),
         default_account_id = null
   where id = p_link.id
  returning * into v_row;
  return v_row;
end;
$$;

-- Default wallet for the link's budget; null clears it.
create function app_data.tg_apply_default_account(p_link app_data.telegram_links, p_account_id uuid)
returns app_data.telegram_links
language plpgsql set search_path = ''
as $$
declare
  v_archived_at timestamptz;
  v_row app_data.telegram_links;
begin
  if p_account_id is not null then
    select a.archived_at into v_archived_at from app_data.accounts a
    where a.id = p_account_id and a.user_id = app_data.tg_budget_owner(p_link);
    if not found then
      raise exception 'ACCOUNT_NOT_FOUND' using errcode = 'P0001';
    end if;
    if v_archived_at is not null then
      raise exception 'ARCHIVED_REFERENCE' using errcode = 'P0001';
    end if;
  end if;
  update app_data.telegram_links set default_account_id = p_account_id where id = p_link.id
  returning * into v_row;
  return v_row;
end;
$$;

-- A draft is only valid for the budget the link records into.
create or replace function app_data.tg_require_open_draft(p_draft app_data.telegram_drafts, p_version integer)
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
  if p_draft.budget_owner_id is distinct from (
    select app_data.tg_budget_owner(l) from app_data.telegram_links l where l.id = p_draft.link_id
  ) then
    raise exception 'BUDGET_CHANGED' using errcode = 'P0001';
  end if;
end;
$$;

-- The web shows the chat's budget, the budgets it can switch to, and the
-- active wallets of the chat's budget for the default wallet.
create or replace function app_data.tg_link_json(l app_data.telegram_links) returns jsonb
language sql stable set search_path = ''
as $$
  select jsonb_build_object(
    'id', l.id,
    'telegram_user_id', l.telegram_user_id::text,
    'username', l.username,
    'first_name', l.first_name,
    'default_account_id', l.default_account_id,
    'budget', app_data.tg_budget_json(l),
    'budgets', app_data.tg_budgets_json(l.user_id),
    'accounts', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name) order by a.created_at, a.id)
      from app_data.accounts a
      where a.user_id = app_data.tg_budget_owner(l) and a.archived_at is null), '[]'::jsonb),
    'created_at', l.created_at
  )
$$;

-- Removing a membership also resets a chat that recorded into that budget.
create or replace function app_data.budget_members_after_delete() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_link record;
begin
  if old.member_id is not null then
    update app_data.profiles
       set active_budget_id = null
     where id = old.member_id and active_budget_id = old.owner_id;

    for v_link in
      select l.id from app_data.telegram_links l
      where l.user_id = old.member_id and l.budget_owner_id = old.owner_id
      for update
    loop
      perform app_data.tg_cancel_open_drafts(v_link.id);
      update app_data.telegram_links
         set budget_owner_id = null, default_account_id = null
       where id = v_link.id;
    end loop;
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Web RPCs (authenticated)
-- ---------------------------------------------------------------------------

create or replace function api.telegram_set_default_account(p_account_id uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := app_data.require_uid();
  v_link app_data.telegram_links;
begin
  select * into v_link from app_data.telegram_links l
  where l.user_id = v_uid and l.revoked_at is null
  for update;
  if not found then
    raise exception 'TELEGRAM_NOT_LINKED' using errcode = 'P0001';
  end if;
  perform app_data.tg_apply_default_account(v_link, p_account_id);
  return api.telegram_get_status();
end;
$$;

-- Budget the chat records into; null (or the user's own id) means their own.
create function api.telegram_set_budget(p_owner_id uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := app_data.require_uid();
  v_link app_data.telegram_links;
begin
  select * into v_link from app_data.telegram_links l
  where l.user_id = v_uid and l.revoked_at is null
  for update;
  if not found then
    raise exception 'TELEGRAM_NOT_LINKED' using errcode = 'P0001';
  end if;
  perform app_data.tg_apply_budget(v_link, p_owner_id);
  return api.telegram_get_status();
end;
$$;

-- ---------------------------------------------------------------------------
-- Bot RPCs (service_role only)
-- ---------------------------------------------------------------------------

create or replace function api.tg_get_context(p_bot_id text, p_telegram_user_id text, p_chat_id text)
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
  v_owner := app_data.tg_budget_owner(v_link);

  return jsonb_build_object(
    'linked', true,
    'today', app_data.today_jakarta(),
    'budget', app_data.tg_budget_json(v_link),
    'budgets', app_data.tg_budgets_json(v_link.user_id),
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

create or replace function api.tg_create_draft(
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
  v_owner := app_data.tg_budget_owner(v_link);

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

-- /last: latest transactions of the chat's budget.
create or replace function api.tg_recent_transactions(
  p_bot_id text,
  p_telegram_user_id text,
  p_chat_id text,
  p_limit integer default 5
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_link app_data.telegram_links;
begin
  v_link := app_data.tg_require_link(p_bot_id, p_telegram_user_id, p_chat_id);
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
      app_data.tg_budget_owner(v_link), null, null, null, null, null, null, null, null, null,
      least(greatest(coalesce(p_limit, 5), 1), 10)
    ) q), '[]'::jsonb);
end;
$$;

-- /budget → a budget button. Returns the budget the chat now records into.
create function api.tg_set_budget(
  p_bot_id text,
  p_update_id text,
  p_telegram_user_id text,
  p_chat_id text,
  p_owner_id uuid
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
  v_link := app_data.tg_require_link(p_bot_id, p_telegram_user_id, p_chat_id);
  select * into v_link from app_data.telegram_links l where l.id = v_link.id for update;
  v_link := app_data.tg_apply_budget(v_link, p_owner_id);
  return app_data.tg_remember(p_bot_id, p_update_id, jsonb_build_object('budget', app_data.tg_budget_json(v_link)));
end;
$$;

-- Default wallet button shown after switching budgets.
create function api.tg_set_default_account(
  p_bot_id text,
  p_update_id text,
  p_telegram_user_id text,
  p_chat_id text,
  p_account_id uuid
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
  v_link := app_data.tg_require_link(p_bot_id, p_telegram_user_id, p_chat_id);
  select * into v_link from app_data.telegram_links l where l.id = v_link.id for update;
  v_link := app_data.tg_apply_default_account(v_link, p_account_id);
  return app_data.tg_remember(p_bot_id, p_update_id, jsonb_build_object(
    'budget', app_data.tg_budget_json(v_link),
    'default_account_id', v_link.default_account_id,
    'account_name', (select a.name from app_data.accounts a where a.id = v_link.default_account_id)
  ));
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke execute on function
  app_data.tg_budget_owner(app_data.telegram_links),
  app_data.tg_budgets_json(uuid),
  app_data.tg_budget_json(app_data.telegram_links),
  app_data.tg_apply_budget(app_data.telegram_links, uuid),
  app_data.tg_apply_default_account(app_data.telegram_links, uuid),
  api.telegram_set_budget(uuid),
  api.tg_set_budget(text, text, text, text, uuid),
  api.tg_set_default_account(text, text, text, text, uuid)
from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke execute on all functions in schema api from anon';
  end if;
end;
$$;

grant execute on function api.telegram_set_budget(uuid) to authenticated;

revoke execute on function
  api.tg_set_budget(text, text, text, text, uuid),
  api.tg_set_default_account(text, text, text, text, uuid)
from authenticated;
grant execute on function
  api.tg_set_budget(text, text, text, text, uuid),
  api.tg_set_default_account(text, text, text, text, uuid)
to service_role;

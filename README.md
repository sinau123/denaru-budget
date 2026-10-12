# Denaru — Expense Tracker

A personal PWA for recording expenses, income, and transfers between wallets (MVP P0 from PRD v1.1).
Next.js 16 (App Router) + TypeScript + Tailwind, TanStack Query, React Hook Form + Zod, Recharts,
Supabase (Google Auth, PostgreSQL, RPC), deployed to Vercel Hobby.

## Architecture overview

- **Browser-only data.** Pages are rendered statically; data is loaded in the browser after login. No user
  data is rendered on the Next.js server or cached in the CDN/service worker.
- **`app_data` schema** holds the business tables (`profiles`, `accounts`, `categories`, `transactions`) and
  is **not exposed** to the Data API. The **`api` schema** contains only `SECURITY INVOKER` RPCs and is the
  only exposed schema.
- **RLS** is enabled on every table; identity always comes from `auth.uid()`. Minimal column grants.
- **Final validation happens in the database** (triggers + constraints): amount, date (Asia/Jakarta),
  ownership via composite FK `(user_id, id)`, category type, archived references, note length.
- **Money** = `bigint` rupiah, sent as a digit string; the browser uses `BigInt`.
- **Idempotency**: a transaction ID is generated once per form and reused on retry. Same ID + same payload
  → previous result; different payload → `IDEMPOTENCY_CONFLICT`. If a response is lost, the UI checks
  `get_transaction(id)` before resubmitting.
- **Edit conflicts**: `update_transaction`/`delete_transaction` use `expected_version` (compare-and-update).
- **CSV export**: all pages are read first; `data_version` is compared before/after; no file is produced
  if any page fails or the data changes. Spreadsheet formula injection protection.
- **Sub-categories**: `categories.parent_id`, one level deep, same type as the parent (enforced in the
  trigger). Filtering by a parent (history, export, daily totals) includes its children; the dashboard rolls
  children up into their parent. The UI shows a flat list (`Makanan`, `Makanan › Jajan`).
- **Daily expense**: `get_daily_totals` aggregates per day over the same filters as the history. It feeds the
  dashboard's daily section (category filter, today/average/peak) and the per-day totals in the history list.
- **Telegram (P1, PRD F11–F13)**: a private chat with the bot records income/expense into the budget the user
  is viewing on the web. See [Telegram bot](#telegram-bot).

```
supabase/migrations/   schema, RLS, triggers, RPC
src/lib/               money/date/csv utils, Supabase client, RPC wrapper, services
src/lib/telegram/      bot: message parser, replies/buttons, update handler, Bot API + DB clients
src/components/        UI, transaction form, screens
src/app/               routes: / (summary), /transaksi, /dompet, /pengaturan, /login, /onboarding
tests/db/              business rules & RLS run on PGlite (in-process Postgres)
tests/e2e/             Playwright smoke test with a fake backend
```

## Running locally

Prerequisites: Node 22, pnpm 9, Docker (for local Supabase).

```bash
pnpm install
cp .env.example .env.local          # fill in Google OAuth credentials for local login
pnpm db:start                       # supabase start; note the API URL + publishable/anon key
# set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env.local
pnpm db:reset                       # apply migrations
pnpm db:types                       # optional: generate types from the api schema
pnpm dev
```

Local Google OAuth: create an OAuth client (Web) in Google Cloud Console, add the redirect URI
`http://127.0.0.1:54321/auth/v1/callback`, then fill in `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID/SECRET`.

## Testing

```bash
pnpm test        # unit + component + database rules (PGlite, no Docker)
pnpm test:e2e    # production build + Playwright (mobile 360px & desktop) with a fake backend
pnpm typecheck && pnpm lint
```

`tests/db/business-rules.test.ts` covers the balance scenarios from PRD section 04, amount/date validation,
idempotency, version conflicts, archived references, user A/B/anon isolation, pagination, transfer filters, and
`data_version`. Tests still to be done manually before the pilot: real Google login, PWA installation on
Chrome Android & Safari iPhone, LCP/p95 measurement on a 10,000-transaction dataset, and a restore drill.

## Production deployment

1. **Supabase** (Free project, separate from development):
   - `supabase link --project-ref <ref>` then `supabase db push`.
   - Settings → API → *Exposed schemas*: set **only `api`** (remove `public`, `graphql_public`).
   - Authentication → Providers → Google: enable it and fill in the client ID/secret.
   - Authentication → URL Configuration: Site URL = Vercel domain, Redirect URLs =
     `https://<domain>/auth/callback`.
2. **Google Cloud**: consent screen (email & profile scopes), redirect URI
   `https://<ref>.supabase.co/auth/v1/callback`.
3. **Vercel Hobby**: import the repo, set `NEXT_PUBLIC_SUPABASE_URL` and
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (Production). Preview deployments must use the development
   Supabase project, **not** production. Never put the service role key in a `NEXT_PUBLIC_*` env var.

## Telegram bot

How it works:

- **Webhook**: `POST /api/integrations/telegram/webhook` (Route Handler). It checks
  `X-Telegram-Bot-Api-Secret-Token`, accepts private chats only, and calls the `api.tg_*` functions with the
  Supabase **secret key**. Those functions are `SECURITY DEFINER`, executable only by `service_role`; they find the
  active link for the verified Telegram user + chat and then act as that app user for the rest of the database
  transaction, so `budget_owner()`, the audit trigger and `create_transaction_core(..., 'telegram')` behave exactly
  as on the web. The user is never taken from chat text.
- **Pairing**: Settings → *Connect Telegram* creates a one-time code (5 minutes, stored as SHA-256) → the deep
  link `t.me/<bot>?start=<code>` → the bot records which Telegram identity pressed Start → the user approves that
  identity on the web → then picks the default wallet.
- **Recording**: a message such as `beli nasi 20rb pakai tunai` is parsed by rules (`parse-message.ts`; no AI)
  into a draft (10 minutes) with **Simpan / Ubah / Batal** buttons. Missing or ambiguous values (no amount,
  "3 burger 3000", unknown wallet/category) are asked for with buttons. Data is only written on *Simpan*.
- **No double transactions**: each webhook delivery is recorded per `(bot_id, update_id)` and every database step
  stores its result, so a re-delivered update replays it. A draft carries its transaction ID from creation, is
  locked on commit, and stays as proof after commit, so a second click, a retry, or a click after the transaction
  was deleted on the web never inserts again. Old draft versions cannot be saved.
- **Commands**: `/help`, `/last`, `/cancel`, `/disconnect` (replies are in Indonesian). Corrections to saved
  transactions are made on the web.

Setup:

1. Create a bot with @BotFather; put the token in `TELEGRAM_BOT_TOKEN` and the username in
   `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME`. Generate `TELEGRAM_WEBHOOK_SECRET` (`openssl rand -hex 32`).
2. Set `SUPABASE_SECRET_KEY` (Settings → API Keys, secret/service role) and `APP_URL` on the server only.
3. **Local**: `pnpm dev`, then `node --env-file=.env.local scripts/telegram-dev-poll.mjs` (long-polls Telegram and
   forwards updates to the local webhook; use a separate test bot).
4. **Production**: add the variables in Vercel (Production only; previews use the development Supabase project and
   a test bot), deploy, then `node --env-file=<file> scripts/telegram-set-webhook.mjs` to register the webhook and
   the command menu. Check that `last_error_message` is empty.

`tests/db/telegram.test.ts` covers pairing (expired/reused codes, approval by the owner only), access (no
`tg_*` for signed-in or anonymous users), drafts and commits (double click, re-delivered update, old version,
deleted transaction, expired draft, another chat's draft), shared budgets, and disconnect.

## Operations runbook

- **Weekly backups & before risky migrations** (the Free plan has no automatic backups):
  `BACKUP_GPG_RECIPIENT=<key> pnpm db:backup` → encrypted archive containing roles, schema, and data
  (including `auth.users` for identity mapping). Store it outside the project.
- **Restore** (rehearse on a separate project before the pilot): decrypt, then `psql` in order
  `roles.sql`, `schema.sql`, `data.sql` into the target database; verify transaction counts & balances.
- **Paused project** (after 7 days of inactivity): restore it from the Supabase dashboard. The UI shows a
  connection failure and never claims data was saved.
- **Quotas**: review Supabase & Vercel usage monthly; reassess if usage exceeds 70% of the database/egress quota.
  Don't enable paid add-ons automatically.
- **Telegram outage or paused project**: Telegram keeps undelivered updates for at most 24 hours. Afterwards,
  users should check `/last` or the web history before re-sending. Monitor function invocations and the size of
  `app_data.telegram_events` (old rows are pruned automatically).
- **App rollback**: promote the previous Vercel deployment. Migrations are forward-only; prepare a
  corrective migration if needed.

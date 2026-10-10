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
- **Telegram foundation (P1)**: the save logic lives in `app_data.create_transaction_core(...)` and the
  `transactions.source` column already exists, so a future bot RPC will use the same rules.

```
supabase/migrations/   schema, RLS, triggers, RPC
src/lib/               money/date/csv utils, Supabase client, RPC wrapper, services
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
- **App rollback**: promote the previous Vercel deployment. Migrations are forward-only; prepare a
  corrective migration if needed.

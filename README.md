# Denaru — Pencatat Pengeluaran

PWA pribadi untuk mencatat pengeluaran, pemasukan, dan transfer antar dompet (MVP P0 dari PRD v1.1).
Next.js 16 (App Router) + TypeScript + Tailwind, TanStack Query, React Hook Form + Zod, Recharts,
Supabase (Auth Google, PostgreSQL, RPC), deploy ke Vercel Hobby.

## Arsitektur singkat

- **Browser-only data.** Halaman dirender statis; data dimuat di browser setelah login. Tidak ada data
  pengguna yang dirender di server Next.js atau di-cache di CDN/service worker.
- **`app_data` schema** menyimpan tabel bisnis (`profiles`, `accounts`, `categories`, `transactions`) dan
  **tidak diekspos** ke Data API. **`api` schema** hanya berisi RPC `SECURITY INVOKER` dan merupakan
  satu-satunya schema yang diekspos.
- **RLS** aktif di semua tabel; identitas selalu dari `auth.uid()`. Grants kolom minimum.
- **Validasi final di database** (trigger + constraint): nominal, tanggal (Asia/Jakarta), kepemilikan
  lewat FK gabungan `(user_id, id)`, jenis kategori, referensi arsip, panjang catatan.
- **Uang** = `bigint` rupiah, dikirim sebagai string digit; browser memakai `BigInt`.
- **Idempotensi**: ID transaksi dibuat sekali per form dan dipakai ulang saat retry. ID sama + payload
  sama → hasil lama; payload beda → `IDEMPOTENCY_CONFLICT`. Setelah respons hilang, UI memeriksa
  `get_transaction(id)` dulu sebelum kirim ulang.
- **Konflik edit**: `update_transaction`/`delete_transaction` memakai `expected_version` (compare-and-update).
- **Ekspor CSV**: semua halaman dibaca dulu; `data_version` dibandingkan sebelum/sesudah; file tidak
  dibuat bila ada halaman gagal atau data berubah. Proteksi formula spreadsheet.
- **Fondasi Telegram (P1)**: logika simpan ada di `app_data.create_transaction_core(...)` dan kolom
  `transactions.source` sudah ada, sehingga RPC bot nanti memakai aturan yang sama.

```
supabase/migrations/   schema, RLS, triggers, RPC
src/lib/               money/date/csv utils, Supabase client, RPC wrapper, services
src/components/        UI, form transaksi, screens
src/app/               routes: / (ringkasan), /transaksi, /dompet, /pengaturan, /login, /onboarding
tests/db/              aturan bisnis & RLS dijalankan di PGlite (Postgres in-process)
tests/e2e/             Playwright smoke test dengan backend tiruan
```

## Menjalankan lokal

Prasyarat: Node 22, pnpm 9, Docker (untuk Supabase lokal).

```bash
pnpm install
cp .env.example .env.local          # isi kredensial Google OAuth untuk login lokal
pnpm db:start                       # supabase start; catat API URL + publishable/anon key
# isi NEXT_PUBLIC_SUPABASE_URL dan NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY di .env.local
pnpm db:reset                       # terapkan migration
pnpm db:types                       # opsional: hasilkan tipe dari schema api
pnpm dev
```

Google OAuth lokal: buat OAuth client (Web) di Google Cloud Console, tambahkan redirect URI
`http://127.0.0.1:54321/auth/v1/callback`, lalu isi `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID/SECRET`.

## Pengujian

```bash
pnpm test        # unit + komponen + aturan database (PGlite, tanpa Docker)
pnpm test:e2e    # build produksi + Playwright (mobile 360px & desktop) dengan backend tiruan
pnpm typecheck && pnpm lint
```

`tests/db/business-rules.test.ts` mencakup skenario saldo bagian 04 PRD, validasi nominal/tanggal,
idempotensi, konflik versi, referensi arsip, isolasi user A/B/anon, pagination, filter transfer, dan
`data_version`. Uji yang masih perlu dilakukan manual sebelum pilot: login Google nyata, instalasi PWA di
Chrome Android & Safari iPhone, pengukuran LCP/p95 pada dataset 10.000 transaksi, dan latihan restore.

## Deploy produksi

1. **Supabase** (proyek Free, terpisah dari development):
   - `supabase link --project-ref <ref>` lalu `supabase db push`.
   - Settings → API → *Exposed schemas*: isi **hanya `api`** (hapus `public`, `graphql_public`).
   - Authentication → Providers → Google: aktifkan, isi client ID/secret.
   - Authentication → URL Configuration: Site URL = domain Vercel, Redirect URLs =
     `https://<domain>/auth/callback`.
2. **Google Cloud**: consent screen (scope email & profile), redirect URI
   `https://<ref>.supabase.co/auth/v1/callback`.
3. **Vercel Hobby**: impor repo, set `NEXT_PUBLIC_SUPABASE_URL` dan
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (Production). Preview deployment harus memakai proyek
   Supabase development, **bukan** produksi. Jangan pernah menaruh service role key di env `NEXT_PUBLIC_*`.

## Runbook operasional

- **Backup mingguan & sebelum migration berisiko** (Free tidak punya backup otomatis):
  `BACKUP_GPG_RECIPIENT=<key> pnpm db:backup` → arsip terenkripsi berisi roles, schema, data
  (termasuk `auth.users` untuk pemetaan identitas). Simpan di luar proyek.
- **Restore** (latih di proyek terpisah sebelum pilot): dekripsi, lalu `psql` berurutan
  `roles.sql`, `schema.sql`, `data.sql` ke database target; verifikasi jumlah transaksi & saldo.
- **Proyek dijeda** (7 hari tanpa aktivitas): pulihkan dari dashboard Supabase. UI menampilkan gagal
  terhubung dan tidak pernah mengklaim data tersimpan.
- **Kuota**: tinjau usage Supabase & Vercel tiap bulan; evaluasi bila melewati 70% kuota database/egress.
  Jangan aktifkan add-on berbayar otomatis.
- **Rollback aplikasi**: promosikan deployment Vercel sebelumnya. Migration bersifat maju; siapkan
  migration koreksi bila perlu.

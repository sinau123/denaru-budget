"use client";

import { useState } from "react";

import { useCategories, useInvalidateUserData, useProfile } from "@/hooks/use-budget-data";
import { errorMessage } from "@/lib/api/api-errors";
import type { Category, CategoryType } from "@/lib/api/api-types";
import { createCategory, renameCategory, setCategoryArchived, updateProfile } from "@/lib/api/budget-service";

import { useAuth } from "../auth-provider";
import { ExportButton } from "../export-button";
import { Button } from "../ui/button";
import { inputClass } from "../ui/field";
import { Notice } from "../ui/notice";
import { Segmented } from "../ui/segmented";

export function SettingsScreen() {
  const auth = useAuth();
  const [signingOut, setSigningOut] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="figure text-3xl font-semibold sm:text-4xl">Pengaturan</h1>

      <ProfileSection />
      <CategoriesSection />

      <Section title="Ekspor data" description="Unduh seluruh transaksi (termasuk dompet arsip) sebagai CSV. Impor belum tersedia.">
        <div className="max-w-xs">
          <ExportButton filters={{}} label="Unduh semua transaksi" />
        </div>
      </Section>

      <Section title="Pasang di layar utama" description="Di Chrome Android: menu ⋮ → Tambahkan ke layar utama. Di Safari iPhone: tombol Bagikan → Tambah ke Layar Utama." />

      <Section title="Telegram" description="Mencatat transaksi lewat chat Telegram akan hadir pada fase berikutnya." />

      <Section title="Akun" description={auth.status === "signed-in" ? `Masuk sebagai ${auth.session.user.email ?? "pengguna Google"}.` : undefined}>
        <div>
          <Button
            variant="secondary"
            pending={signingOut}
            onClick={async () => {
              setSigningOut(true);
              await auth.signOut();
            }}
          >
            Keluar
          </Button>
        </div>
      </Section>
    </div>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children?: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-3xl border border-rule bg-paper-raised p-5">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        {description ? <p className="mt-0.5 text-sm text-ink-soft">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

function ProfileSection() {
  const profile = useProfile();
  const invalidate = useInvalidateUserData();
  const [name, setName] = useState<string | null>(null);
  const [state, setState] = useState<{ pending?: boolean; message?: string; error?: string }>({});
  const value = name ?? profile.data?.display_name ?? "";

  return (
    <Section title="Profil" description="Mata uang IDR dan zona waktu Asia/Jakarta.">
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={async (e) => {
          e.preventDefault();
          setState({ pending: true });
          try {
            await updateProfile(value);
            await invalidate();
            setState({ message: "Nama disimpan." });
            setName(null);
          } catch (error) {
            setState({ error: errorMessage(error) });
          }
        }}
      >
        <label className="flex-1">
          <span className="sr-only">Nama tampilan</span>
          <input value={value} maxLength={100} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder="Nama tampilan" />
        </label>
        <Button type="submit" variant="secondary" pending={state.pending} disabled={name === null}>
          Simpan
        </Button>
      </form>
      {state.message ? <p role="status" className="text-sm text-accent">{state.message}</p> : null}
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
    </Section>
  );
}

function CategoriesSection() {
  const categories = useCategories();
  const invalidate = useInvalidateUserData();
  const [type, setType] = useState<CategoryType>("expense");
  const [newName, setNewName] = useState("");
  const [newId, setNewId] = useState(() => crypto.randomUUID());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const list = (categories.data ?? []).filter((c) => c.type === type);

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await invalidate();
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    } finally {
      setBusy(null);
    }
  }

  return (
    <Section title="Kategori" description="Kategori arsip tetap tampil di riwayat, tetapi tidak bisa dipilih untuk transaksi baru.">
      <Segmented
        label="Jenis kategori"
        value={type}
        options={[
          { value: "expense", label: "Pengeluaran" },
          { value: "income", label: "Pemasukan" },
        ]}
        onChange={setType}
      />
      <form
        className="flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const name = newName.trim();
          if (!name) return setError("Nama kategori wajib diisi.");
          const ok = await run("new", () => createCategory(newId, name, type));
          if (ok) {
            setNewName("");
            setNewId(crypto.randomUUID());
          }
        }}
      >
        <label className="flex-1">
          <span className="sr-only">Nama kategori baru</span>
          <input value={newName} maxLength={50} onChange={(e) => setNewName(e.target.value)} placeholder="Kategori baru" className={inputClass} />
        </label>
        <Button type="submit" pending={busy === "new"}>
          Tambah
        </Button>
      </form>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {categories.isError ? <Notice tone="error">{errorMessage(categories.error)}</Notice> : null}
      <ul className="divide-y divide-rule rounded-2xl border border-rule">
        {list.map((c) => (
          <CategoryRow
            key={c.id}
            category={c}
            busy={busy === c.id}
            onRename={(name) => run(c.id, () => renameCategory(c.id, name))}
            onArchive={(archived) => run(c.id, () => setCategoryArchived(c.id, archived))}
          />
        ))}
      </ul>
    </Section>
  );
}

function CategoryRow({
  category,
  busy,
  onRename,
  onArchive,
}: {
  category: Category;
  busy: boolean;
  onRename: (name: string) => Promise<boolean>;
  onArchive: (archived: boolean) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(category.name);
  const archived = !!category.archived_at;

  if (editing) {
    return (
      <li className="flex gap-2 p-2">
        <label className="flex-1">
          <span className="sr-only">Nama kategori</span>
          <input autoFocus value={name} maxLength={50} onChange={(e) => setName(e.target.value)} className={inputClass} />
        </label>
        <Button
          size="md"
          pending={busy}
          onClick={async () => {
            if (await onRename(name.trim())) setEditing(false);
          }}
        >
          Simpan
        </Button>
        <Button size="md" variant="ghost" onClick={() => { setName(category.name); setEditing(false); }}>
          Batal
        </Button>
      </li>
    );
  }
  return (
    <li className="flex items-center gap-2 px-4 py-2">
      <span className={archived ? "flex-1 text-ink-faint line-through" : "flex-1 font-medium"}>{category.name}</span>
      {!archived ? (
        <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
          Ubah
        </Button>
      ) : null}
      <Button size="sm" variant="ghost" pending={busy} onClick={() => onArchive(!archived)}>
        {archived ? "Aktifkan" : "Arsipkan"}
      </Button>
    </li>
  );
}

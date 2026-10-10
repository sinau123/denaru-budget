"use client";

import { useState } from "react";

import { useCategories, useInvalidateUserData, useProfile } from "@/hooks/use-budget-data";
import { errorMessage } from "@/lib/api/api-errors";
import type { Category, CategoryType } from "@/lib/api/api-types";
import { createCategory, setCategoryArchived, updateCategory, updateProfile } from "@/lib/api/budget-service";
import { flattenCategories } from "@/lib/category-utils";

import { useAuth } from "../auth-provider";
import { ExportButton } from "../export-button";
import { useI18n } from "../i18n-provider";
import { LanguageSwitcher } from "../language-switcher";
import { Button } from "../ui/button";
import { cx } from "../ui/cx";
import { inputClass } from "../ui/field";
import { Notice } from "../ui/notice";
import { Segmented } from "../ui/segmented";

export function SettingsScreen() {
  const auth = useAuth();
  const { t } = useI18n();
  const s = t.settings;
  const [signingOut, setSigningOut] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="figure text-3xl font-semibold sm:text-4xl">{t.nav.settings}</h1>

      <ProfileSection />

      <Section title={s.languageTitle} description={s.languageDescription}>
        <div className="max-w-sm">
          <LanguageSwitcher />
        </div>
      </Section>

      <CategoriesSection />

      <Section title={s.exportTitle} description={s.exportDescription}>
        <div className="max-w-xs">
          <ExportButton filters={{}} label={s.exportAll} />
        </div>
      </Section>

      <Section title={s.installTitle} description={s.installDescription} />

      <Section title={s.telegramTitle} description={s.telegramDescription} />

      <Section
        title={s.accountTitle}
        description={auth.status === "signed-in" ? s.signedInAs(auth.session.user.email ?? s.googleUser) : undefined}
      >
        <div>
          <Button
            variant="secondary"
            pending={signingOut}
            onClick={async () => {
              setSigningOut(true);
              await auth.signOut();
            }}
          >
            {s.signOut}
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
  const { t } = useI18n();
  const [name, setName] = useState<string | null>(null);
  const [state, setState] = useState<{ pending?: boolean; message?: string; error?: string }>({});
  const value = name ?? profile.data?.display_name ?? "";

  return (
    <Section title={t.settings.profileTitle} description={t.settings.profileDescription}>
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={async (e) => {
          e.preventDefault();
          setState({ pending: true });
          try {
            await updateProfile(value);
            await invalidate();
            setState({ message: t.settings.nameSaved });
            setName(null);
          } catch (error) {
            setState({ error: errorMessage(error, t) });
          }
        }}
      >
        <label className="flex-1">
          <span className="sr-only">{t.settings.displayName}</span>
          <input value={value} maxLength={100} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder={t.settings.displayName} />
        </label>
        <Button type="submit" variant="secondary" pending={state.pending} disabled={name === null}>
          {t.common.save}
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
  const { t } = useI18n();
  const s = t.settings;
  const [type, setType] = useState<CategoryType>("expense");
  const [newName, setNewName] = useState("");
  const [newParent, setNewParent] = useState("");
  const [newId, setNewId] = useState(() => crypto.randomUUID());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const all = categories.data ?? [];
  const list = flattenCategories(all, (c) => c.type === type);
  // Only active top-level categories can take new children.
  const parentOptions = all.filter((c) => c.type === type && !c.parent_id && !c.archived_at);

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await invalidate();
      return true;
    } catch (e) {
      setError(errorMessage(e, t));
      return false;
    } finally {
      setBusy(null);
    }
  }

  return (
    <Section
      title={s.categoriesTitle}
      description={s.categoriesDescription}
    >
      <Segmented
        label={s.categoryType}
        value={type}
        options={[
          { value: "expense", label: t.transactionType.expense },
          { value: "income", label: t.transactionType.income },
        ]}
        onChange={(t) => {
          setType(t);
          setNewParent("");
        }}
      />
      <form
        className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[1fr_12rem_auto]"
        onSubmit={async (e) => {
          e.preventDefault();
          const name = newName.trim();
          if (!name) return setError(s.categoryNameRequired);
          const ok = await run("new", () => createCategory(newId, name, type, newParent || null));
          if (ok) {
            setNewName("");
            setNewId(crypto.randomUUID());
          }
        }}
      >
        <label className="col-span-2 sm:col-span-1">
          <span className="sr-only">{s.newCategoryName}</span>
          <input value={newName} maxLength={50} onChange={(e) => setNewName(e.target.value)} placeholder={s.newCategoryPlaceholder} className={inputClass} />
        </label>
        <label>
          <span className="sr-only">{s.newCategoryParent}</span>
          <ParentSelect value={newParent} options={parentOptions} onChange={setNewParent} />
        </label>
        <Button type="submit" pending={busy === "new"}>
          {t.common.add}
        </Button>
      </form>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {categories.isError ? <Notice tone="error">{errorMessage(categories.error, t)}</Notice> : null}
      <ul className="divide-y divide-rule rounded-2xl border border-rule">
        {list.map(({ category: c, depth }) => (
          <CategoryRow
            key={c.id}
            category={c}
            depth={depth}
            hasChildren={all.some((x) => x.parent_id === c.id)}
            parentOptions={all.filter(
              (p) => p.type === c.type && !p.parent_id && p.id !== c.id && (!p.archived_at || p.id === c.parent_id),
            )}
            busy={busy === c.id}
            onSave={(name, parentId) => run(c.id, () => updateCategory(c.id, name, parentId))}
            onArchive={(archived) => run(c.id, () => setCategoryArchived(c.id, archived))}
          />
        ))}
      </ul>
    </Section>
  );
}

function ParentSelect({
  value,
  options,
  onChange,
  disabled,
}: {
  value: string;
  options: Category[];
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className={inputClass}>
      <option value="">{t.settings.noParent}</option>
      {options.map((p) => (
        <option key={p.id} value={p.id}>
          {t.settings.under(p.name)}
          {p.archived_at ? t.common.archivedSuffix : ""}
        </option>
      ))}
    </select>
  );
}

function CategoryRow({
  category,
  depth,
  hasChildren,
  parentOptions,
  busy,
  onSave,
  onArchive,
}: {
  category: Category;
  depth: 0 | 1;
  hasChildren: boolean;
  parentOptions: Category[];
  busy: boolean;
  onSave: (name: string, parentId: string | null) => Promise<boolean>;
  onArchive: (archived: boolean) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(category.name);
  const [parentId, setParentId] = useState(category.parent_id ?? "");
  const archived = !!category.archived_at;

  if (editing) {
    return (
      <li className="grid grid-cols-2 gap-2 p-2 sm:grid-cols-[1fr_12rem_auto_auto]">
        <label className="col-span-2 sm:col-span-1">
          <span className="sr-only">{t.settings.categoryName}</span>
          <input autoFocus value={name} maxLength={50} onChange={(e) => setName(e.target.value)} className={inputClass} />
        </label>
        <label className="col-span-2 sm:col-span-1">
          <span className="sr-only">{t.settings.categoryParent}</span>
          <ParentSelect value={parentId} options={parentOptions} onChange={setParentId} disabled={hasChildren} />
        </label>
        <Button
          size="md"
          pending={busy}
          onClick={async () => {
            if (await onSave(name.trim(), parentId || null)) setEditing(false);
          }}
        >
          {t.common.save}
        </Button>
        <Button
          size="md"
          variant="ghost"
          onClick={() => {
            setName(category.name);
            setParentId(category.parent_id ?? "");
            setEditing(false);
          }}
        >
          {t.common.cancel}
        </Button>
        {hasChildren ? (
          <p className="col-span-2 text-xs text-ink-faint sm:col-span-4">{t.settings.hasChildrenHint}</p>
        ) : null}
      </li>
    );
  }
  return (
    <li className={cx("flex items-center gap-2 py-2 pr-4", depth === 1 ? "pl-9" : "pl-4")}>
      {depth === 1 ? (
        <span aria-hidden className="-ml-4 text-ink-faint">
          ↳
        </span>
      ) : null}
      <span className={archived ? "min-w-0 flex-1 truncate text-ink-faint line-through" : "min-w-0 flex-1 truncate font-medium"}>
        {depth === 1 ? <span className="sr-only">{t.settings.subcategory} </span> : null}
        {category.name}
      </span>
      {!archived ? (
        <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
          {t.common.edit}
        </Button>
      ) : null}
      <Button size="sm" variant="ghost" pending={busy} onClick={() => onArchive(!archived)}>
        {archived ? t.settings.unarchive : t.common.archive}
      </Button>
    </li>
  );
}

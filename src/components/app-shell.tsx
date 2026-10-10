"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { ConnectionBanner } from "./connection-banner";
import { useTransactionDialog } from "./transaction-dialog";
import { cx } from "./ui/cx";

const NAV = [
  { href: "/", label: "Ringkasan", icon: "M4 13h4v7H4zM10 4h4v16h-4zM16 9h4v11h-4z" },
  { href: "/transaksi", label: "Transaksi", icon: "M5 6h14M5 12h14M5 18h9" },
  { href: "/dompet", label: "Dompet", icon: "M3 7h15a3 3 0 013 3v8a2 2 0 01-2 2H5a2 2 0 01-2-2zM3 7l12-3v3M16 14h2" },
  { href: "/pengaturan", label: "Pengaturan", icon: "M12 15a3 3 0 100-6 3 3 0 000 6zM4 12h2M18 12h2M12 4v2M12 18v2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M6.3 17.7l1.4-1.4M16.3 7.7l1.4-1.4" },
] as const;

function NavIcon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { openTransaction } = useTransactionDialog();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <div className="ledger-bg min-h-dvh md:grid md:grid-cols-[15rem_1fr]">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh flex-col gap-6 border-r border-rule bg-paper-raised/70 px-4 py-6 md:flex">
        <Link href="/" className="figure px-2 text-3xl font-semibold tracking-tight">
          denaru<span className="text-accent">.</span>
        </Link>
        <button
          type="button"
          onClick={() => openTransaction()}
          className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-accent font-semibold text-accent-ink shadow-md transition hover:brightness-110"
        >
          <span aria-hidden className="text-xl leading-none">+</span> Tambah
        </button>
        <nav aria-label="Navigasi utama" className="flex flex-col gap-1">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(item.href) ? "page" : undefined}
              className={cx(
                "flex h-11 items-center gap-3 rounded-xl px-3 font-medium transition",
                isActive(item.href) ? "bg-accent-soft text-accent" : "text-ink-soft hover:bg-paper-sunken hover:text-ink",
              )}
            >
              <NavIcon d={item.icon} />
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-col">
        <ConnectionBanner />
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-32 pt-5 sm:px-6 md:pb-12 md:pt-8">{children}</main>
      </div>

      {/* Mobile bottom navigation with a centered add button */}
      <nav
        aria-label="Navigasi utama"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-rule bg-paper-raised/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        <ul className="grid grid-cols-5 items-end">
          {NAV.slice(0, 2).map((item) => (
            <MobileNavItem key={item.href} {...item} active={isActive(item.href)} />
          ))}
          <li className="flex justify-center">
            <button
              type="button"
              onClick={() => openTransaction()}
              aria-label="Tambah transaksi"
              className="-mt-6 grid size-15 place-items-center rounded-full bg-accent text-accent-ink shadow-lg ring-4 ring-paper transition active:scale-95"
            >
              <svg viewBox="0 0 24 24" className="size-7" aria-hidden fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          </li>
          {NAV.slice(2).map((item) => (
            <MobileNavItem key={item.href} {...item} active={isActive(item.href)} />
          ))}
        </ul>
      </nav>
    </div>
  );
}

function MobileNavItem({ href, label, icon, active }: { href: string; label: string; icon: string; active: boolean }) {
  return (
    <li>
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        className={cx(
          "flex h-16 flex-col items-center justify-center gap-1 text-[0.7rem] font-semibold",
          active ? "text-accent" : "text-ink-faint",
        )}
      >
        <NavIcon d={icon} />
        {label}
      </Link>
    </li>
  );
}

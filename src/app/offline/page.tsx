import type { Metadata } from "next";

export const metadata: Metadata = { title: "Offline" };

/** Static page cached by the service worker and shown when navigation fails offline. */
export default function OfflinePage() {
  return (
    <main className="grid min-h-dvh place-items-center px-6 text-center">
      <div className="max-w-sm">
        <p className="figure text-4xl font-semibold">
          denaru<span className="text-accent">.</span>
        </p>
        <h1 className="mt-6 text-xl font-semibold">Anda sedang offline</h1>
        <p className="mt-2 text-ink-soft">
          Mencatat dan melihat transaksi memerlukan koneksi internet. Tidak ada data yang disimpan selama offline.
        </p>
        {/* A full page load is intended here so the network is retried. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/" className="mt-6 inline-flex h-11 items-center rounded-xl bg-accent px-5 font-semibold text-accent-ink">
          Coba lagi
        </a>
      </div>
    </main>
  );
}

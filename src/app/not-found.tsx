import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-6 text-center">
      <div>
        <h1 className="figure text-3xl font-semibold">Halaman tidak ditemukan</h1>
        <Link href="/" className="mt-4 inline-block font-semibold text-accent hover:underline">
          Kembali ke ringkasan
        </Link>
      </div>
    </main>
  );
}

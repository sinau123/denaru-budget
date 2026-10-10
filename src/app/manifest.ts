import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Denaru — Pencatat Pengeluaran",
    short_name: "Denaru",
    description: "Catat pengeluaran, pemasukan, dan transfer antar dompet.",
    lang: "id",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f5f1e8",
    theme_color: "#1d5c45",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

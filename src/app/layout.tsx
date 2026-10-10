import type { Metadata, Viewport } from "next";
import { Fraunces, Plus_Jakarta_Sans } from "next/font/google";

import { Providers } from "@/components/providers";
import { ServiceWorkerRegister } from "@/components/service-worker-register";

import "./globals.css";

const body = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-body", display: "swap" });
const display = Fraunces({ subsets: ["latin"], variable: "--font-display", display: "swap", axes: ["opsz"] });

export const metadata: Metadata = {
  title: { default: "Denaru", template: "%s · Denaru" },
  description: "Catat pengeluaran, pemasukan, dan transfer antar dompet.",
  applicationName: "Denaru",
  appleWebApp: { capable: true, title: "Denaru", statusBarStyle: "default" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f1e8" },
    { media: "(prefers-color-scheme: dark)", color: "#15140f" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id" className={`${body.variable} ${display.variable}`}>
      <body className="min-h-dvh antialiased">
        <Providers>{children}</Providers>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}

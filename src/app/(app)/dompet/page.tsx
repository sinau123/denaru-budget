import type { Metadata } from "next";

import { WalletsScreen } from "@/components/screens/wallets-screen";

export const metadata: Metadata = { title: "Dompet" };

export default function WalletsPage() {
  return <WalletsScreen />;
}

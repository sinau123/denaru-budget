import type { Metadata } from "next";

import { SettingsScreen } from "@/components/screens/settings-screen";

export const metadata: Metadata = { title: "Pengaturan" };
export const instant = false;

export default function SettingsPage() {
  return <SettingsScreen />;
}

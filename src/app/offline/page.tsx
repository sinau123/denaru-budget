import type { Metadata } from "next";

import { OfflineScreen } from "@/components/screens/offline-screen";

export const metadata: Metadata = { title: "Offline" };

/** Static page cached by the service worker and shown when navigation fails offline. */
export default function OfflinePage() {
  return <OfflineScreen />;
}

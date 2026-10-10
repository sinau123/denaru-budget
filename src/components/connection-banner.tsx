"use client";

import { useSyncExternalStore } from "react";

function subscribe(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

export function useOnline() {
  return useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
}

export function ConnectionBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div role="status" className="bg-warn-soft px-4 py-2 text-center text-sm font-medium text-warn">
      Anda sedang offline. Data dapat dilihat dari layar terakhir, tetapi penyimpanan memerlukan koneksi.
    </div>
  );
}

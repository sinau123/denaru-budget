import type { Metadata } from "next";
import { Suspense } from "react";

import { TransactionsScreen } from "@/components/screens/transactions-screen";

export const metadata: Metadata = { title: "Transaksi" };

export default function TransactionsPage() {
  return (
    <Suspense>
      <TransactionsScreen />
    </Suspense>
  );
}

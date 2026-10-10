import { AppShell } from "@/components/app-shell";
import { RequireOnboarded, RequireSession } from "@/components/session-gate";
import { TransactionDialogProvider } from "@/components/transaction-dialog";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireSession>
      <RequireOnboarded>
        <TransactionDialogProvider>
          <AppShell>{children}</AppShell>
        </TransactionDialogProvider>
      </RequireOnboarded>
    </RequireSession>
  );
}

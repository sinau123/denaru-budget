import { AppShell } from "@/components/app-shell";
import { RequireOnboarded, RequireSession } from "@/components/session-gate";
import { TransactionDialogProvider } from "@/components/transaction-dialog";

// Auth is resolved client-side, so the gates render a splash on the server and child
// segments never render there. Opt out of instant-navigation validation for this subtree.
export const instant = false;

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

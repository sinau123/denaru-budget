import { cx } from "./cx";

type Tone = "info" | "warn" | "error" | "success";

const tones: Record<Tone, string> = {
  info: "bg-paper-sunken text-ink border-rule",
  warn: "bg-warn-soft text-warn border-warn/30",
  error: "bg-outflow-soft text-outflow border-outflow/30",
  success: "bg-accent-soft text-accent border-accent/30",
};

export function Notice({
  tone = "info",
  title,
  children,
  action,
  className,
}: {
  tone?: Tone;
  title?: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      role={tone === "error" || tone === "warn" ? "alert" : "status"}
      className={cx("flex flex-col gap-2 rounded-2xl border px-4 py-3 text-sm", tones[tone], className)}
    >
      {title ? <p className="font-semibold">{title}</p> : null}
      {children ? <div className="leading-relaxed">{children}</div> : null}
      {action ? <div className="flex flex-wrap gap-2">{action}</div> : null}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-3xl border border-dashed border-rule px-6 py-10 text-center">
      <p className="figure text-xl font-semibold">{title}</p>
      {children ? <div className="max-w-sm text-sm text-ink-soft">{children}</div> : null}
      {action}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cx("animate-pulse rounded-xl bg-paper-sunken", className)} />;
}

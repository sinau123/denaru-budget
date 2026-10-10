import { useId } from "react";

import { cx } from "./cx";

export const inputClass =
  "h-11 w-full rounded-xl border border-rule bg-paper-raised px-3 text-[0.95rem] text-ink placeholder:text-ink-faint " +
  "transition focus:border-accent focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-1 " +
  "aria-[invalid=true]:border-outflow disabled:opacity-60";

type FieldProps = {
  label: string;
  error?: string;
  hint?: React.ReactNode;
  className?: string;
  children: (props: { id: string; "aria-invalid": boolean; "aria-describedby"?: string }) => React.ReactNode;
};

/** Label + control + message, wired for screen readers. */
export function Field({ label, error, hint, className, children }: FieldProps) {
  const id = useId();
  const messageId = `${id}-msg`;
  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-semibold text-ink-soft">
        {label}
      </label>
      {children({ id, "aria-invalid": !!error, "aria-describedby": error || hint ? messageId : undefined })}
      {error ? (
        <p id={messageId} role="alert" className="text-sm font-medium text-outflow">
          {error}
        </p>
      ) : hint ? (
        <p id={messageId} className="text-xs text-ink-faint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

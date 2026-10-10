import { cx } from "./cx";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "md" | "sm" | "lg";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-ink hover:brightness-110 shadow-[0_1px_0_rgb(0_0_0/0.15)]",
  secondary: "bg-paper-raised text-ink border border-rule hover:bg-paper-sunken",
  ghost: "text-ink-soft hover:bg-paper-sunken hover:text-ink",
  danger: "bg-outflow text-paper hover:brightness-110",
};

const sizes: Record<Size, string> = {
  sm: "h-9 px-3 text-sm",
  md: "h-11 px-4 text-[0.95rem]",
  lg: "h-12 px-5 text-base",
};

export type ButtonProps = React.ComponentProps<"button"> & {
  variant?: Variant;
  size?: Size;
  pending?: boolean;
};

export function Button({ variant = "primary", size = "md", pending, disabled, className, children, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      className={cx(
        "inline-flex select-none items-center justify-center gap-2 rounded-xl font-semibold transition",
        "disabled:cursor-not-allowed disabled:opacity-55",
        variants[variant],
        sizes[size],
        className,
      )}
    >
      {pending ? <Spinner /> : null}
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cx("inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent", className)}
    />
  );
}

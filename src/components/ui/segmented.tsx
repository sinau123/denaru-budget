import { cx } from "./cx";

type Option<T extends string> = { value: T; label: string };

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  disabled,
}: {
  value: T;
  options: readonly Option<T>[];
  onChange: (value: T) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="grid auto-cols-fr grid-flow-col gap-1 rounded-2xl bg-paper-sunken p-1">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled && !active}
            onClick={() => onChange(o.value)}
            className={cx(
              "h-10 rounded-xl text-sm font-semibold transition",
              active ? "bg-paper-raised text-ink shadow-sm" : "text-ink-soft hover:text-ink",
              disabled && !active && "cursor-not-allowed opacity-40",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

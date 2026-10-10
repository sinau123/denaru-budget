"use client";

import { formatRupiahInput, normalizeRupiahInput } from "@/lib/money-utils";

import { cx } from "./cx";
import { inputClass } from "./field";

type MoneyInputProps = Omit<React.ComponentProps<"input">, "value" | "onChange" | "type"> & {
  value: string;
  onValueChange: (digits: string) => void;
  allowNegative?: boolean;
  large?: boolean;
};

/** Rupiah input: stores a digit string, shows thousands separators. */
export function MoneyInput({ value, onValueChange, allowNegative, large, className, ...rest }: MoneyInputProps) {
  return (
    <div className="relative">
      <span
        aria-hidden
        className={cx(
          "pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-semibold text-ink-faint",
          large ? "text-lg" : "text-sm",
        )}
      >
        Rp
      </span>
      <input
        {...rest}
        type="text"
        inputMode={allowNegative ? "text" : "numeric"}
        autoComplete="off"
        value={formatRupiahInput(value)}
        onChange={(e) => {
          const next = normalizeRupiahInput(e.target.value);
          onValueChange(allowNegative ? next : next.replace(/^-/, ""));
        }}
        className={cx(inputClass, large ? "figure h-14 pl-11 text-2xl" : "pl-10", className)}
      />
    </div>
  );
}

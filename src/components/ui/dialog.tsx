"use client";

import { useEffect, useRef } from "react";

import { useI18n } from "../i18n-provider";
import { cx } from "./cx";

type DialogProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
};

/**
 * Native <dialog> (focus trap, Esc, inert background). Bottom sheet on phones,
 * centered card on wider screens.
 */
export function Dialog({ open, onClose, title, description, children, className }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const { t } = useI18n();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      aria-labelledby="dialog-title"
      className={cx(
        "m-0 mt-auto max-h-[92dvh] w-full max-w-none overflow-y-auto rounded-t-3xl border border-rule bg-paper p-0 text-ink shadow-2xl",
        "sm:m-auto sm:max-w-lg sm:rounded-3xl",
        className,
      )}
    >
      {open ? (
        <div className="px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-5 sm:px-6">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <h2 id="dialog-title" className="figure text-2xl font-semibold">
                {title}
              </h2>
              {description ? <div className="mt-1 text-sm text-ink-soft">{description}</div> : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label={t.common.close}
              className="-mr-2 -mt-1 grid size-10 place-items-center rounded-full text-ink-soft hover:bg-paper-sunken"
            >
              <svg viewBox="0 0 24 24" className="size-5" aria-hidden fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          {children}
        </div>
      ) : null}
    </dialog>
  );
}

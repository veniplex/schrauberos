"use client";

import clsx from "clsx";
import type { ReactNode } from "react";

export type SegmentOption<T extends string> = { value: T; label: ReactNode; /** Zugänglicher Name, wenn `label` nur ein Symbol ist */ title?: string };

/** Umschalter mit wenigen, gleichrangigen Werten (Sprache, Darstellung). */
export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
  busy,
}: {
  label: string;
  value: T;
  options: Array<SegmentOption<T>>;
  onChange: (value: T) => void;
  busy?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={label} aria-busy={busy} className="flex gap-0.5 rounded-md bg-surface-2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          aria-label={o.title}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={clsx(
            "grid min-h-(--tap-sm) min-w-(--tap-sm) cursor-pointer place-items-center rounded-sm px-2 text-xs font-medium transition-colors",
            value === o.value ? "bg-surface text-ink shadow-sm" : "text-ink-muted hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

"use client";

import clsx from "clsx";
import Link from "next/link";
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

export type SegmentLink = { href: string; label: ReactNode; active: boolean };

/**
 * Wie `SegmentedControl`, aber jede Option ist ein Link (Auswahl über die Adresse: Filter einer Liste, Ansicht). Die aktive trägt `aria-current="true"`.
 * Für „entweder – oder“ mit wenigen Werten; mehrere unabhängige Filter bleiben Chips (`ChipLink`).
 */
export function SegmentedLinks({ label, options, className }: { label: string; options: SegmentLink[]; className?: string }) {
  return (
    <nav aria-label={label} className={clsx("inline-flex max-w-full gap-0.5 overflow-x-auto rounded-md bg-surface-2 p-0.5", className)}>
      {options.map((o, i) => (
        <Link
          key={i}
          href={o.href}
          aria-current={o.active ? "true" : undefined}
          className={clsx(
            "relative grid min-h-(--tap-sm) min-w-(--tap-sm) place-items-center whitespace-nowrap rounded-sm px-3 text-sm font-medium transition-colors",
            o.active ? "bg-surface text-ink shadow-sm" : "text-ink-muted hover:text-ink",
          )}
        >
          {o.label}
        </Link>
      ))}
    </nav>
  );
}

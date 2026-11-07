import clsx from "clsx";
import Link from "next/link";
import type { ReactNode } from "react";
import { LinkPending } from "./link-pending";

export type TabItem = { href: string; label: ReactNode; active: boolean };

/**
 * Reiter einer Seite (Navigation zwischen verwandten Seiten oder Ansichten, z. B. Eingang/Ausgang, Fahrzeuge/Führerscheine): jeder Reiter ist ein Link,
 * der aktive trägt `aria-current="page"`. Auf schmalen Bildschirmen scrollt die Leiste waagerecht. `label` benennt die Navigation für Hilfstechnik.
 * Kein ARIA-`tablist`: Die Reiter wechseln die Seite, nicht den Inhalt einer Seite. Die Trennlinie ist ein innerer Schatten der Leiste (kein Rahmen mit negativem Rand): Der 2 px starke
 * Strich des aktiven Reiters liegt so innerhalb des scrollenden Bereichs und wird nicht abgeschnitten.
 */
export function TabNav({ label, items, className }: { label: string; items: TabItem[]; className?: string }) {
  return (
    <nav className={clsx("mb-5 flex gap-1 overflow-x-auto overflow-y-hidden shadow-[inset_0_-1px_0_var(--line)]", className)} aria-label={label}>
      {items.map((item, i) => (
        <Link
          key={i}
          href={item.href}
          aria-current={item.active ? "page" : undefined}
          className={clsx(
            "relative inline-flex min-h-(--tap) items-center whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium",
            item.active ? "border-accent text-accent-text" : "border-transparent text-ink-muted hover:text-ink",
          )}
        >
          {item.label}
          <LinkPending className="absolute right-0.5 top-1/2 size-3 -translate-y-1/2" />
        </Link>
      ))}
    </nav>
  );
}

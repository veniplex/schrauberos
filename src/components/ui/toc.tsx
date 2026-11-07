import clsx from "clsx";
import { Disclosure } from "./disclosure";

export type TocItem = { id: string; text: string; level: 2 | 3 };

function List({ items, className }: { items: TocItem[]; className?: string }) {
  return (
    <ul className={clsx("flex flex-col text-sm", className)}>
      {items.map((h, i) => (
        <li key={`${h.id}-${i}`}>
          <a href={`#${h.id}`} className={clsx("flex min-h-(--tap-row) items-center py-0.5 text-ink-muted hover:text-ink", h.level === 3 ? "pl-6" : "pl-3")}>
            {h.text}
          </a>
        </li>
      ))}
    </ul>
  );
}

/**
 * „Auf dieser Seite“ – das Inhaltsverzeichnis einer langen Seite (Hilfe und Dokumentation, ein Muster):
 * - `aside` (ab `xl`): feste Spalte neben dem Text, folgt beim Scrollen;
 * - `inline` (unter `xl`): einklappbar am Anfang des Textes, damit es dort nicht den Platz frisst.
 * Beide stehen im selben Bereich der Seite; jeweils nur eines ist sichtbar.
 */
export function PageToc({ title, items, placement }: { title: string; items: TocItem[]; placement: "aside" | "inline" }) {
  if (placement === "inline") {
    return (
      <Disclosure title={title} className="mb-4 xl:hidden">
        <nav aria-label={title}>
          <List items={items} className="mt-1" />
        </nav>
      </Disclosure>
    );
  }
  return (
    <nav aria-label={title} className="hidden xl:block">
      <div className="sticky top-20">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">{title}</p>
        <List items={items} className="gap-0.5 border-l border-line" />
      </div>
    </nav>
  );
}

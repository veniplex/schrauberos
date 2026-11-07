"use client";

import clsx from "clsx";
import { ChevronRight } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

/**
 * Auf- und zuklappbarer Bereich. Ohne `open` verwaltet er seinen Zustand selbst (`defaultOpen`); mit `open` + `onOpenChange` steuert
 * ihn der Aufrufer (z. B. das Navigationsmenü, das die Gruppe der aktuellen Seite öffnet). Der Inhalt bleibt auch zugeklappt im Dokument (`hidden`) – Formularfelder darin werden also
 * weiter gesendet (Rollenmaske).
 * Aussehen: `panel` = umrandeter Kasten, `section` = Zwischenüberschrift (Navigation), `card` = Karte mit Kopfzeile (Module & Funktionen, Dashboard „Weitere Bausteine“).
 * `locked`: nicht einklappbar (immer offen) – die Überschrift steht dann ohne Knopf und Pfeil (Navigation: die Gruppe der aktuellen Seite).
 * `description`: zweite Zeile unter dem Titel (im Knopf); `actions`: Bedienelemente rechts neben dem Knopf (z. B. ein Schalter oder „Alle wählen“ – sie liegen außerhalb des Knopfes);
 * `headingLevel`: der Knopf steht in einer Überschrift dieser Ebene (Gliederung der Seite).
 */
export function Disclosure({
  title,
  children,
  defaultOpen = false,
  open,
  onOpenChange,
  variant = "panel",
  locked = false,
  className,
  description,
  actions,
  headingLevel,
}: {
  title: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  variant?: "panel" | "section" | "card";
  locked?: boolean;
  className?: string;
  description?: ReactNode;
  actions?: ReactNode;
  headingLevel?: 2 | 3;
}) {
  const [inner, setInner] = useState(defaultOpen);
  const isOpen = locked || (open ?? inner);
  const id = useId();
  const toggle = () => {
    setInner(!isOpen);
    onOpenChange?.(!isOpen);
  };
  const Heading = headingLevel === 3 ? "h3" : "h2";
  const card = variant === "card";

  const button = (
    <button
      type="button"
      aria-expanded={isOpen}
      aria-controls={id}
      onClick={toggle}
      className={clsx(
        "flex min-h-(--tap-row) w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-md text-left transition-colors",
        variant === "panel" && "px-1 py-1 text-xs font-medium text-ink-muted hover:text-ink",
        variant === "section" && "px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted hover:bg-surface-hover hover:text-ink",
        card && "px-1 py-1 text-ink hover:text-ink-muted",
      )}
    >
      <ChevronRight className={clsx("size-3.5 shrink-0 transition-transform", isOpen && "rotate-90")} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className={clsx("block", card ? "text-base font-semibold" : "truncate")}>{title}</span>
        {description ? <span className="mt-0.5 block text-sm font-normal normal-case tracking-normal text-ink-muted">{description}</span> : null}
      </span>
    </button>
  );
  const toggleControl = headingLevel ? <Heading className="min-w-0 flex-1">{button}</Heading> : <div className="min-w-0 flex-1">{button}</div>;

  return (
    <div className={clsx(variant === "panel" && "rounded-md border border-line bg-surface p-2", card && "card min-w-0", className)}>
      {locked ? (
        <p className="flex min-h-(--tap-row) items-center gap-1.5 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">
          <span className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">{title}</span>
        </p>
      ) : actions || card ? (
        <div className={clsx("flex flex-wrap items-start justify-between gap-x-3 gap-y-1", card && "px-4 py-3", card && isOpen && "border-b border-line")}>
          {toggleControl}
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
      ) : (
        toggleControl
      )}
      <div id={id} hidden={!isOpen}>
        {children}
      </div>
    </div>
  );
}

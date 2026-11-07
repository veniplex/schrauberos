"use client";

import clsx from "clsx";
import { ChevronRight } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

/**
 * Auf- und zuklappbarer Bereich. Ohne `open` verwaltet er seinen Zustand selbst (`defaultOpen`); mit `open` + `onOpenChange` steuert
 * ihn der Aufrufer (z. B. das Navigationsmenü, das die Gruppe der aktuellen Seite öffnet).
 * Aussehen: `panel` = umrandeter Kasten, `section` = Zwischenüberschrift (Navigation).
 * `locked`: nicht einklappbar (immer offen) – die Überschrift steht dann ohne Knopf und Pfeil (Navigation: die Gruppe der aktuellen Seite).
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
}: {
  title: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  variant?: "panel" | "section";
  locked?: boolean;
  className?: string;
}) {
  const [inner, setInner] = useState(defaultOpen);
  const isOpen = locked || (open ?? inner);
  const id = useId();
  const toggle = () => {
    setInner(!isOpen);
    onOpenChange?.(!isOpen);
  };

  return (
    <div className={clsx(variant === "panel" && "rounded-md border border-line bg-surface p-2", className)}>
      {locked ? (
        <p className="flex min-h-(--tap-row) items-center gap-1.5 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">
          <span className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">{title}</span>
        </p>
      ) : (
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls={id}
        onClick={toggle}
        className={clsx(
          "flex min-h-(--tap-row) w-full cursor-pointer items-center gap-1.5 rounded-md text-left transition-colors",
          variant === "panel" ? "px-1 py-1 text-xs font-medium text-ink-muted hover:text-ink" : "px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted hover:bg-surface-hover hover:text-ink",
        )}
      >
        <ChevronRight className={clsx("size-3.5 shrink-0 transition-transform", isOpen && "rotate-90")} aria-hidden />
        <span className="truncate">{title}</span>
      </button>
      )}
      <div id={id} hidden={!isOpen}>
        {children}
      </div>
    </div>
  );
}

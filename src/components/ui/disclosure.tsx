"use client";

import clsx from "clsx";
import { ChevronRight } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

/**
 * Auf- und zuklappbarer Bereich. Ohne `open` verwaltet er seinen Zustand selbst (`defaultOpen`); mit `open` + `onOpenChange` steuert
 * ihn der Aufrufer (z. B. das Navigationsmenü, das die Gruppe der aktuellen Seite öffnet).
 * Aussehen: `panel` = umrandeter Kasten, `section` = Zwischenüberschrift (Navigation).
 */
export function Disclosure({
  title,
  children,
  defaultOpen = false,
  open,
  onOpenChange,
  variant = "panel",
  className,
}: {
  title: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  variant?: "panel" | "section";
  className?: string;
}) {
  const [inner, setInner] = useState(defaultOpen);
  const isOpen = open ?? inner;
  const id = useId();
  const toggle = () => {
    setInner(!isOpen);
    onOpenChange?.(!isOpen);
  };

  return (
    <div className={clsx(variant === "panel" && "rounded-md border border-line bg-surface p-2", className)}>
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls={id}
        onClick={toggle}
        className={clsx(
          "flex w-full cursor-pointer items-center gap-1.5 rounded-md text-left transition-colors",
          variant === "panel" ? "px-1 py-1 text-xs font-medium text-ink-muted hover:text-ink" : "px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted hover:bg-surface-hover hover:text-ink",
        )}
      >
        <ChevronRight className={clsx("size-3.5 shrink-0 transition-transform", isOpen && "rotate-90")} aria-hidden />
        <span className="truncate">{title}</span>
      </button>
      <div id={id} hidden={!isOpen}>
        {children}
      </div>
    </div>
  );
}

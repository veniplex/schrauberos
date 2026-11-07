"use client";

import clsx from "clsx";
import { ChevronDown } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { useI18n } from "@/i18n/client";
import { Button } from "./buttons";

/**
 * Zusatzfilter einer `FilterBar`: ab `sm` immer sichtbar (die Felder liegen im Raster der Leiste), darunter hinter dem Knopf „Weitere Filter“ eingeklappt.
 * Das Suchfeld gehört **nicht** hierher und bleibt immer sichtbar. Die Felder bleiben auch eingeklappt im Formular (versteckte Felder werden trotzdem gesendet).
 * `defaultOpen`: aufgeklappt starten (ein Zusatzfilter ist gerade aktiv).
 */
export function FilterExtras({ children, defaultOpen = false }: { children: ReactNode; defaultOpen?: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <>
      <Button variant="ghost" className="justify-between sm:hidden" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        {t("common.moreFilters")}
        <ChevronDown className={clsx("size-4 transition-transform", open && "rotate-180")} aria-hidden />
      </Button>
      <div id={id} className={clsx("grid gap-3 sm:contents", !open && "max-sm:hidden")}>
        {children}
      </div>
    </>
  );
}

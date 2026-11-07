"use client";

import clsx from "clsx";
import { Printer } from "lucide-react";
import type { ReactNode } from "react";
import { useI18n } from "@/i18n/client";
import { Button } from "./buttons";

/**
 * Druckansicht auf A4 (Auftragskarte, Terminzettel, Berichte, Listen): Der Rahmen setzt die benannte Seite `a4` (A4 hochkant, 15 mm Rand, `globals.css`), und alles mit `no-print`
 * (Werkzeugleiste, Knöpfe, Navigation) verschwindet im Ausdruck. Im Ausdruck ist das Design immer hell. `PrintPageBreak` beginnt eine neue Seite, `PrintKeep` hält einen Block zusammen
 * (Tabellenzeile, Unterschriftsfeld) – nichts wird mitten durch eine Zeile geschnitten.
 *
 * Drucken geht über den Dialog des Geräts (`window.print()`); „Als PDF sichern“ ist dort dieselbe Funktion. Fertige Dokumente (Rechnung, Angebot) liefert `server/pdf` – diese Ansicht
 * ist für Seiten, die ohnehin am Bildschirm stehen. Etiketten und andere Papiergrößen brauchen eine eigene benannte Seite (`@page`), nicht diesen Rahmen.
 */
export function PrintButton({ className }: { className?: string }) {
  const { t } = useI18n();
  return (
    <Button className={clsx("no-print", className)} onClick={() => window.print()}>
      <Printer className="size-4" aria-hidden /> {t("ui.print.print")}
    </Button>
  );
}

export function PrintLayout({ children, toolbar, className }: { children: ReactNode; /** zusätzliche Knöpfe neben „Drucken“ (erscheinen nie im Ausdruck) */ toolbar?: ReactNode; className?: string }) {
  return (
    <div className={clsx("print-a4", className)}>
      <div className="no-print mb-4 flex flex-wrap items-center justify-end gap-2">
        {toolbar}
        <PrintButton />
      </div>
      <div className="print:text-[11pt]">{children}</div>
    </div>
  );
}

/** Beginnt im Ausdruck eine neue Seite (am Bildschirm unsichtbar). */
export function PrintPageBreak() {
  return <div aria-hidden className="print-break" />;
}

/** Hält den Inhalt im Ausdruck auf einer Seite beisammen. */
export function PrintKeep({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx("print-keep", className)}>{children}</div>;
}

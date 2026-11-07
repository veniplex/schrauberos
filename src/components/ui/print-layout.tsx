"use client";

import clsx from "clsx";
import { Printer } from "lucide-react";
import type { ReactNode } from "react";
import { useI18n } from "@/i18n/client";
import { Button } from "./buttons";

/**
 * Druckansicht auf A4 (Auftragskarte, Terminzettel, Berichte, Listen): Der Rahmen setzt die benannte Seite `a4` (A4 hochkant, 15 mm Rand, `globals.css`; mit `size` auch A5 und A6 mit 10 bzw. 8 mm Rand), und alles mit `no-print`
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

/** Schriftgröße im Ausdruck je Papier (Tailwind erkennt nur vollständige Klassennamen). */
const TEXT = { a4: "print:text-[11pt]", a5: "print:text-[10pt]", a6: "print:text-[9pt]" } as const;

export function PrintLayout({ children, toolbar, size = "a4", className }: { children: ReactNode; /** zusätzliche Knöpfe neben „Drucken“ (erscheinen nie im Ausdruck) */ toolbar?: ReactNode; /** Papier: A4 (Standard), A5 oder A6 hochkant – je eine benannte Seite (`globals.css`) */ size?: "a4" | "a5" | "a6"; className?: string }) {
  return (
    <div className={clsx(`print-${size}`, className)} data-print-size={size}>
      <div className="no-print mb-4 flex flex-wrap items-center justify-end gap-2">
        {toolbar}
        <PrintButton />
      </div>
      <div className={TEXT[size]}>{children}</div>
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

"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { moveSlot } from "./calendar-layout";

/**
 * Tastaturbedienung des Zeitrasters (Wochen- und Tagesansicht): Die Zeitfenster („Neuer Termin um 14:30“) sind Links mit `data-slot`, `data-col`, `data-row`.
 * Für sie gilt das Rastermuster mit **einem Tab-Stopp**: Tab erreicht genau ein Zeitfenster (`tabIndex=0`, vom Server gesetzt – das jetzige oder das erste),
 * **Pfeiltasten** bewegen sich im Raster (auf/ab = Zeit, links/rechts = Tag bzw. Arbeitsplatz), **Bild auf/ab** springen vier Fenster, **Pos1/Ende** an den Rand der Spalte;
 * Eingabe öffnet den Dialog wie jeder Link. Der Tab-Stopp wandert mit (Roving-Tabindex); ohne ihn müsste man sich durch Hunderte Zeitfenster tabben.
 * Die Termine selbst bleiben gewöhnliche Links in Tab-Reihenfolge (nach Zeit sortiert, Tag für Tag).
 *
 * Das Raster bleibt Server-Markup (`children`); diese Hülle fängt nur die Tasten ab. Die Größe (`data-cols`, `data-rows`) steht am Element.
 */
export function SlotGrid({ children, className, cols, rows }: { children: ReactNode; className?: string; cols: number; rows: number }) {
  const root = useRef<HTMLDivElement>(null);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (event.altKey || event.ctrlKey || event.metaKey || !target.matches?.("a[data-slot]")) return;
    const from = { col: Number(target.dataset.col), row: Number(target.dataset.row) };
    const to = moveSlot(from, event.key, { cols, rows });
    // Pfeiltasten gehören dem Raster (sonst scrollt die Seite), auch am Rand
    if (/^(Arrow|Page|Home|End)/.test(event.key)) event.preventDefault();
    if (!to) return;
    const next = root.current?.querySelector<HTMLElement>(`a[data-slot][data-col="${to.col}"][data-row="${to.row}"]`);
    if (!next) return;
    // Roving-Tabindex: der Tab-Stopp zieht mit
    for (const slot of root.current?.querySelectorAll<HTMLElement>("a[data-slot][tabindex='0']") ?? []) slot.tabIndex = -1;
    next.tabIndex = 0;
    next.focus();
  }

  return (
    // Die Tasten kommen von den Zeitfenster-Links (`onKeyDown` fängt sie nur ab); die Hülle selbst ist kein Bedienelement
    <div ref={root} className={className} onKeyDown={onKeyDown}>
      {children}
    </div>
  );
}

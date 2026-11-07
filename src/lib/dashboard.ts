// Reine Logik der Übersicht – ohne Datenbank, ohne React (getestet).

/**
 * Auswahl der Dashboard-Bausteine (P2b-4) – rein, getestet. Die Übersicht zeigt je Person die `DASHBOARD_VISIBLE` (4) wichtigsten Bausteine offen und den Rest zugeklappt
 * („Weitere Bausteine“). „Wichtig“ heißt `priority` (kleiner = wichtiger, von den Funktionen gemeldet); bei Gleichstand entscheidet die Reihenfolge `order`, dann die ID. Die offenen
 * stehen in der Anzeigereihenfolge (`order`), die zugeklappten nach Wichtigkeit. Was überhaupt in Frage kommt, haben Funktion, Recht und `uses` schon entschieden (`widgetsFor`).
 */
export const DASHBOARD_VISIBLE = 4;

/** Schlüssel der Einstellung (AppSetting): Die Einrichtungs-Checkliste ist ausgeblendet – für die ganze Werkstatt, nicht je Person. */
export const SETUP_CHECKLIST_HIDDEN = "dashboard.setupChecklistHidden";

type Pickable = { id: string; priority: number; order: number };

export function pickWidgets<T extends Pickable>(widgets: readonly T[], visible: number = DASHBOARD_VISIBLE): { shown: T[]; more: T[] } {
  const byImportance = [...widgets].sort((a, b) => a.priority - b.priority || a.order - b.order || a.id.localeCompare(b.id));
  const shownIds = new Set(byImportance.slice(0, Math.max(0, visible)).map((w) => w.id));
  return {
    shown: widgets.filter((w) => shownIds.has(w.id)).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)),
    more: byImportance.filter((w) => !shownIds.has(w.id)),
  };
}

/** Stand der Einrichtungs-Checkliste: wie viele Punkte sind erledigt, welche fehlen noch (Pflicht vor Empfehlung, sonst in Reihenfolge der Eingabe). */
export function checklistProgress<T extends { done: boolean; recommended: boolean }>(items: readonly T[]): { done: number; total: number; open: T[]; complete: boolean } {
  const open = items.filter((i) => !i.done);
  return { done: items.length - open.length, total: items.length, open: [...open.filter((i) => !i.recommended), ...open.filter((i) => i.recommended)], complete: items.length > 0 && open.length === 0 };
}

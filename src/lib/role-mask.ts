import { searchKey, searchTerms } from "./search-key";

/**
 * Auswahl in der Rollenmaske – reine Funktionen (vom Formular genutzt, getestet).
 *
 * Regeln: „Bearbeiten“ (jede Aktion außer „Ansehen“) setzt „Ansehen“ der Gruppe mit (Rechte ohne Ansehen-Recht sind sinnlos); wer
 * „Ansehen“ abwählt, verliert die übrigen Rechte der Gruppe. Gesperrte Rechte (`locked`: vom Aufrufer nicht vergebbar/entziehbar)
 * bleiben immer unverändert.
 */
export function togglePermission(selected: ReadonlySet<string>, key: string, on: boolean, groupKeys: readonly string[], locked: ReadonlySet<string>): Set<string> {
  const next = new Set(selected);
  if (locked.has(key)) return next; // gesperrte Rechte lassen sich nicht umschalten (die Oberfläche deaktiviert sie ohnehin)
  const [group, verb] = key.split(".");
  const view = `${group}.view`;
  if (on) {
    next.add(key);
    if (verb !== "view" && groupKeys.includes(view) && !locked.has(view)) next.add(view);
  } else {
    next.delete(key);
    if (verb === "view") for (const k of groupKeys) if (!locked.has(k)) next.delete(k);
  }
  return next;
}

/** Ganze Gruppe an-/abwählen (gesperrte Rechte bleiben unverändert). */
export function toggleGroupPermissions(selected: ReadonlySet<string>, keys: readonly string[], on: boolean, locked: ReadonlySet<string>): Set<string> {
  const next = new Set(selected);
  for (const k of keys) {
    if (locked.has(k)) continue;
    if (on) next.add(k);
    else next.delete(k);
  }
  return next;
}

/* ───────────── Aufbau der Maske, Suche und Vorschau (P2b-3) – rein, vom Formular genutzt ───────────── */

export type MaskKey = { key: string; label: string; /** Kurzbeschreibung (eine Zeile) */ hint: string; /** Kennzeichnung, z. B. „Export“ oder „Nur Administratoren“ (Text), sonst leer */ mark?: string };
export type MaskGroup = { group: string; label: string; keys: MaskKey[]; inactive: boolean };
export type MaskSection = { moduleId: string; moduleName: string; groups: MaskGroup[] };

/**
 * Suche in der Rollenmaske: Jedes Wort des Suchtextes muss in Gruppenname, Rechtname, Kurzbeschreibung, Kennzeichnung oder Schlüssel vorkommen (Groß-/Kleinschreibung, Umlaute und
 * Trenner egal, wie in den Listen). Trifft der Gruppenname, bleibt die ganze Gruppe; sonst nur die passenden Rechte. Leerer Suchtext = alles. Das Ergebnis behält die Reihenfolge.
 */
export function filterMask(sections: readonly MaskSection[], query: string): MaskSection[] {
  const words = searchTerms(query);
  if (words.length === 0) return sections.map((s) => ({ ...s }));
  const matches = (text: string) => words.every((w) => text.includes(w));
  return sections
    .map((section) => ({
      ...section,
      groups: section.groups.flatMap((group) => {
        const groupText = searchKey(group.label, section.moduleName);
        if (matches(groupText)) return [group];
        const keys = group.keys.filter((k) => matches(searchKey(k.label, k.hint, k.mark, k.key, group.label)));
        return keys.length > 0 ? [{ ...group, keys }] : [];
      }),
    }))
    .filter((section) => section.groups.length > 0);
}

/** Ein Eintrag der Vorschau (Navigation, Dashboard-Baustein, Schnellaktion): `permission` ist das Recht, das ihn freischaltet, `feature` die Funktion, die dafür an sein muss. */
export type PreviewEntry = { id: string; feature: string; permission: string; label: string; moduleName: string };
export type PreviewData = { nav: PreviewEntry[]; widgets: PreviewEntry[]; actions: PreviewEntry[]; inactiveFeatures: readonly string[] };
export type RolePreview = { nav: PreviewEntry[]; widgets: PreviewEntry[]; actions: PreviewEntry[]; /** Einträge, die erst erscheinen, wenn ihre ausgeschaltete Funktion eingeschaltet wird */ waiting: number };

/**
 * „Was sieht diese Rolle?“ – aus dem Katalog berechnet, ohne Seiten zu rendern: Ein Eintrag erscheint, wenn die Rolle sein Recht hat und seine Funktion eingeschaltet ist
 * (dieselbe Regel wie `navFor`/`widgetsFor`/`quickActionsFor` für die Sitzung: ausgeschaltete Funktionen haben keine Rechte). Einträge ausgeschalteter Funktionen zählen als `waiting`.
 */
export function rolePreview(selected: ReadonlySet<string>, data: PreviewData): RolePreview {
  const inactive = new Set(data.inactiveFeatures);
  let waiting = 0;
  const pick = (entries: PreviewEntry[]) =>
    entries.filter((e) => {
      if (!selected.has(e.permission)) return false;
      if (inactive.has(e.feature)) {
        waiting++;
        return false;
      }
      return true;
    });
  return { nav: pick(data.nav), widgets: pick(data.widgets), actions: pick(data.actions), waiting };
}

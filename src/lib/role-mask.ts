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

// Reine Logik zur Aktivierung von Modulen und Funktionen – ohne DB, ohne React (getestet).

export type ModuleLike = { id: string; required?: boolean; defaultEnabled?: boolean };
export type FeatureLike = { id: string; module: string; required?: boolean; requires?: readonly string[]; defaultEnabled?: boolean };

/**
 * Gespeicherte Schalter: Schlüssel = Modul-ID ("office") oder Funktions-ID ("office.fleet"). Gespeichert werden nur Abweichungen vom
 * Standard des Eintrags (`defaultEnabled`): Fehlt ein Schalter, gilt der Standard – bei Bestandsfunktionen "an", bei neuen Funktionen
 * mit `defaultEnabled: false` "aus" (sie werden über Presets bei der Einrichtung bzw. die Module-Seite eingeschaltet).
 */
export type Overrides = Readonly<Record<string, boolean>>;

export const featureKey = (f: { module: string; id: string }) => `${f.module}.${f.id}`;

/** Standardzustand eines Moduls oder einer Funktion ohne gespeicherten Schalter (Vorgabe: an). */
export const defaultOn = (x: { defaultEnabled?: boolean }): boolean => x.defaultEnabled !== false;

/** Ist das Modul eingeschaltet (Pflichtmodule immer)? */
export const moduleOn = (m: ModuleLike, o: Overrides): boolean => !!m.required || (o[m.id] ?? defaultOn(m));

/** Ist die Funktion selbst eingeschaltet (ohne Modul und Abhängigkeiten zu prüfen; Pflichtfunktionen immer)? */
export const featureSwitchOn = (f: FeatureLike, o: Overrides): boolean => !!f.required || (o[featureKey(f)] ?? defaultOn(f));

/**
 * Welche Funktionen sind wirklich nutzbar?
 * Eine Funktion ist aktiv, wenn ihr Modul und sie selbst nicht ausgeschaltet sind (Pflicht-Einträge sind immer an)
 * UND alle ihre harten Abhängigkeiten (`requires`) aktiv sind.
 */
export function effectiveFeatureIds(modules: readonly ModuleLike[], features: readonly FeatureLike[], overrides: Overrides): Set<string> {
  const mods = new Map(modules.map((m) => [m.id, moduleOn(m, overrides)]));
  const on = new Set<string>();
  for (const f of features) {
    if (f.required || (mods.get(f.module) !== false && featureSwitchOn(f, overrides))) on.add(featureKey(f));
  }
  // Abhängigkeiten auflösen, bis sich nichts mehr ändert
  for (let changed = true; changed; ) {
    changed = false;
    for (const f of features) {
      const id = featureKey(f);
      if (on.has(id) && !(f.requires ?? []).every((r) => on.has(r))) {
        on.delete(id);
        changed = true;
      }
    }
  }
  return on;
}

export type FeatureStatus =
  | { state: "on" }
  /** einzeln ausgeschaltet */
  | { state: "off" }
  /** das ganze Modul ist ausgeschaltet */
  | { state: "module-off" }
  /** an, aber eine benötigte Funktion ist nicht aktiv */
  | { state: "blocked"; missing: string[] };

export function featureStatus(
  f: FeatureLike,
  modules: readonly ModuleLike[],
  features: readonly FeatureLike[],
  overrides: Overrides,
): FeatureStatus {
  const mod = modules.find((m) => m.id === f.module);
  if (!f.required) {
    if (mod && !moduleOn(mod, overrides)) return { state: "module-off" };
    if (!featureSwitchOn(f, overrides)) return { state: "off" };
  }
  const active = effectiveFeatureIds(modules, features, overrides);
  if (active.has(featureKey(f))) return { state: "on" };
  return { state: "blocked", missing: (f.requires ?? []).filter((r) => !active.has(r)) };
}

/** Alle Funktionen, die (direkt oder indirekt) von `id` abhängen – sie fallen aus, wenn `id` ausgeschaltet wird. */
export function dependentsOf(id: string, features: readonly FeatureLike[]): string[] {
  const result = new Set<string>();
  const queue = [id];
  while (queue.length) {
    const current = queue.shift()!;
    for (const f of features) {
      const fid = featureKey(f);
      if (!result.has(fid) && (f.requires ?? []).includes(current)) {
        result.add(fid);
        queue.push(fid);
      }
    }
  }
  return [...result];
}

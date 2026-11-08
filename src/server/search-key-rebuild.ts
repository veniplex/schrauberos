import "server-only";
import { SEARCH_KEY_VERSION } from "@/lib/search-key";
import type { FeatureId } from "@/modules/catalog";
import { getSetting, setSetting } from "@/server/settings";
import type { JobDef } from "@/server/jobs/types";

/**
 * Nachziehen der normalisierten Suchspalten (Kunden `nameKey/cityKey/phoneKey`, Fahrzeuge `plateNorm/searchKey`, Rechnungen `partyKey`, Artikel `searchKey`).
 *
 * Diese Spalten werden von den Operationen beim Schreiben gepflegt (`lib/search-key.ts`, `lib/plate.ts`). Ändert sich der Algorithmus (Faltung, Telefon-/Kennzeichen-Normalisierung),
 * sind die Bestandszeilen veraltet. Deshalb gibt es eine **Versionsnummer des Algorithmus** (`SEARCH_KEY_VERSION`, im Code) und je Tabelle eine **gespeicherte Version** (Einstellung
 * `search.keyVersion.<tabelle>`): Ist die Version im Code höher, rechnet ein Job die Spalten dieser Tabelle blockweise neu (Cursor in `search.keyCursor.<tabelle>`, wiederholbar – ein
 * Neustart mitten im Lauf macht beim Cursor weiter) und hebt danach die gespeicherte Version an. **Fehlt die Einstellung, gilt Version 1** (der Algorithmus von Version 0.2.0): eine frische
 * Installation hat damit nichts zu tun, und nur eine künftige Erhöhung löst einen Lauf aus.
 *
 * Die Tabellen gehören den Funktionen: jede meldet ihren Schritt (`rebuild`) in ihrer `jobs.ts` über `searchKeyJob` an – die Plattform kennt keine Fachtabelle. Der Schritt schreibt eine Zeile
 * **ohne `updatedAt` zu ändern** und nur, wenn sie sich seit dem Lesen nicht geändert hat (ein offenes Bearbeiten-Formular soll keinen Konflikt zeigen, ein gleichzeitiger Schreiber hat ohnehin
 * schon mit dem neuen Algorithmus geschrieben).
 */

export const searchKeyVersionSetting = (id: string) => `search.keyVersion.${id}`;
export const searchKeyCursorSetting = (id: string) => `search.keyCursor.${id}`;

/** Version, die mit dem Algorithmus von 0.2.0 geschrieben wurde: gilt, solange nichts gespeichert ist. */
export const BASELINE_KEY_VERSION = 1;

/** Ein Schritt: ab `cursor` (exklusiv, Reihenfolge nach `id`) höchstens `limit` Zeilen prüfen und veraltete Schlüssel neu schreiben. `next` = letzte geprüfte `id`, `null` = Ende der Tabelle. */
export type KeyRebuildStep = (cursor: string | null, limit: number) => Promise<{ next: string | null; scanned: number; changed: number }>;

export async function storedKeyVersion(id: string): Promise<number> {
  const raw = await getSetting(searchKeyVersionSetting(id));
  const n = raw === null ? NaN : Number(raw);
  return Number.isInteger(n) && n >= BASELINE_KEY_VERSION ? n : BASELINE_KEY_VERSION;
}

/** Sind die Schlüssel dieser Tabelle älter als der Algorithmus im Code? (Eine einzige gezielte Abfrage – billig genug für die Vorabprüfung des Jobs.) */
export async function searchKeysStale(id: string, version = SEARCH_KEY_VERSION): Promise<boolean> {
  return (await storedKeyVersion(id)) < version;
}

export type KeyRebuildResult = { done: boolean; scanned: number; changed: number };

export const KEY_REBUILD_BATCH = 500;
/** Zeitbudget eines Laufs; danach macht der nächste Lauf beim Cursor weiter. */
export const KEY_REBUILD_BUDGET_MS = 60_000;

export async function rebuildSearchKeys(options: { id: string; step: KeyRebuildStep; version?: number; batch?: number; budgetMs?: number; signal?: AbortSignal; now?: () => number }): Promise<KeyRebuildResult> {
  const version = options.version ?? SEARCH_KEY_VERSION;
  const now = options.now ?? Date.now;
  const deadline = now() + (options.budgetMs ?? KEY_REBUILD_BUDGET_MS);
  if (!(await searchKeysStale(options.id, version))) return { done: true, scanned: 0, changed: 0 };

  let cursor = (await getSetting(searchKeyCursorSetting(options.id))) || null;
  let scanned = 0;
  let changed = 0;
  while (now() < deadline && !options.signal?.aborted) {
    const result = await options.step(cursor, options.batch ?? KEY_REBUILD_BATCH);
    scanned += result.scanned;
    changed += result.changed;
    if (result.next === null) {
      // Ende der Tabelle: Version anheben, Cursor verwerfen (in dieser Reihenfolge – bricht ein Lauf dazwischen ab, beginnt der nächste von vorn, was nur Zeit kostet)
      await setSetting(searchKeyVersionSetting(options.id), String(version));
      await setSetting(searchKeyCursorSetting(options.id), null);
      return { done: true, scanned, changed };
    }
    cursor = result.next;
    await setSetting(searchKeyCursorSetting(options.id), cursor);
    // zwischen den Blöcken andere Zugriffe drankommen lassen
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  return { done: false, scanned, changed };
}

/** Der Job einer Funktion: läuft nur, solange die Funktion aktiv ist, und nur, wenn die gespeicherte Version veraltet ist (`shouldRun`: eine Abfrage, kein Lauf-Eintrag sonst). */
export function searchKeyJob(def: { id: string; feature: FeatureId; table: string; step: KeyRebuildStep }): JobDef {
  return {
    id: def.id,
    feature: def.feature,
    schedule: { every: 5 * 60_000 },
    timeoutMs: 5 * 60_000,
    shouldRun: () => searchKeysStale(def.table),
    run: async ({ signal }) => {
      const r = await rebuildSearchKeys({ id: def.table, step: def.step, signal });
      return r.done ? `${r.changed} von ${r.scanned} aktualisiert` : `${r.changed} von ${r.scanned} aktualisiert, weiter beim nächsten Lauf`;
    },
  };
}

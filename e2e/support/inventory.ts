import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { ALL_PAGES, PLATFORM_PAGES } from "../../src/modules/pages";
import type { PageKind, PageParam } from "../../src/modules/types";
import { DB_FILE } from "./env";

/** Eine zu prüfende Seite mit aufgelöster Adresse (Seed-Verweise durch echte IDs ersetzt). */
export type InventoryEntry = {
  /** Eindeutiger Schlüssel (Muster + Suchparameter), auch Schlüssel der Baseline-Listen */
  key: string;
  url: string;
  kind: PageKind;
  /** Recht, das die Seite verlangt; null = jeder Angemeldete */
  permission: string | null;
  /** Ohne Anmeldung erreichbar (Anmeldeseiten) */
  public: boolean;
  feature: string | null;
  /** Schlüsselseite mit Baseline-Screenshots */
  screenshot: boolean;
  /** Ohne dieses Recht ist ein fremder Datensatz „nicht gefunden“ (siehe `PageDef.notFoundWithout`) */
  notFoundWithout: string | null;
  /** Zusätzlich verlangt: mindestens eines dieser Rechte (siehe `PageDef.alsoAnyOf`) */
  alsoAnyOf: readonly string[];
};

/** Platzhalter, wenn es noch keine Datenbank gibt (`playwright test --list` ohne laufende App): nur die Namen der Tests werden gebraucht. */
const PLACEHOLDER_ID = "0";

function lookup(db: Database.Database | null, param: PageParam): string | null {
  if ("value" in param) return param.value;
  if (!db) return PLACEHOLDER_ID;
  const column = param.column ?? "id";
  const row = db.prepare(`SELECT "${column}" AS v FROM "${param.table}"${param.where ? ` WHERE ${param.where}` : ""} ORDER BY "${column}" LIMIT 1`).get() as { v: string } | undefined;
  return row?.v ?? null;
}

/**
 * Die Routen-Inventur: alle Seiten aller Funktionen (Seitenlisten `pages.ts`, eingesammelt in src/modules/pages.ts) plus die Plattform,
 * mit IDs aus dem Demo-Seed. Fehlt eine Seed-Zeile, bricht die Inventur ab – die Seed-Daten müssen jede Seite abdecken.
 */
export function loadInventory(): InventoryEntry[] {
  // Ohne Datenbank (nur Auflisten, `--list`) gelten Platzhalter-IDs; in einem echten Lauf stehen App und Demo-Daten vor dem Laden der Tests bereit
  const db = existsSync(DB_FILE) ? new Database(DB_FILE, { readonly: true }) : null;
  try {
    const entries: InventoryEntry[] = [];
    const add = (
      page: { path: string; kind: PageKind; params?: Record<string, PageParam>; query?: string; key?: boolean; notFoundWithout?: string; alsoAnyOf?: readonly string[] },
      extra: Pick<InventoryEntry, "permission" | "public" | "feature">,
    ) => {
      let url = page.path;
      // Schlüssel: Muster mit eingesetzten festen Werten ("/docs/it/[slug]"), IDs bleiben Platzhalter
      let key = page.path;
      for (const [name, param] of Object.entries(page.params ?? {})) {
        const value = lookup(db, param);
        if (value === null) throw new Error(`Kein Seed-Eintrag für ${page.path} (${name}: ${JSON.stringify(param)}) – Demo-Seed ergänzen.`);
        url = url.replace(`[${name}]`, encodeURIComponent(value));
        if ("value" in param) key = key.replace(`[${name}]`, value);
      }
      entries.push({ key: `${key}${page.query ?? ""}`, url: `${url}${page.query ?? ""}`, kind: page.kind, screenshot: page.key ?? false, notFoundWithout: page.notFoundWithout ?? null, alsoAnyOf: page.alsoAnyOf ?? [], ...extra });
    };
    for (const page of ALL_PAGES) add(page, { permission: page.permission, public: false, feature: page.feature });
    for (const page of PLATFORM_PAGES) add(page, { permission: null, public: page.public ?? false, feature: null });
    return entries;
  } finally {
    db?.close();
  }
}

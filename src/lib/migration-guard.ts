/**
 * Migrations-Wächter: prüft die SQL-Dateien in `prisma/migrations` auf Änderungen, die ein Web-Update mit Rückfall auf die Vorversion
 * oder bestehende Daten gefährden. Reine Logik ohne Abhängigkeiten; der Test `migration-guard.test.ts` wendet sie auf alle echten
 * Migrationen an.
 *
 * Geprüft wird jede Migration NACH der Baseline (die Baseline selbst legt alle Tabellen an und ist nur über ihren Marker kenntlich):
 *  - kein `DROP` und kein `RENAME` (Rückfall-Version kennt die Spalte/Tabelle noch; erst hinzufügen, viel später entfernen),
 *  - keine neue Spalte `NOT NULL` ohne `DEFAULT` (die Vorversion schreibt sie nicht),
 *  - kein neuer `UNIQUE`-Index auf einer Bestandstabelle (die Vorversion könnte Duplikate erzeugen); Ausnahme: eine in derselben
 *    Migration neu angelegte, nullable Spalte (mit Marker),
 *  - kein `DELETE`/`UPDATE`/`REPLACE` (Daten werden nicht still verändert).
 *
 * Eine begründete Ausnahme steht als Kommentarzeile in der Migration: `-- guard:allow <regel>: <Begründung>` mit den Regeln
 * `drop`, `rename`, `not-null`, `unique`, `data-change`. Die Begründung ist Pflicht und fällt im Review auf.
 */

/** Name der Baseline-Migration: immer die erste und – ab der Veröffentlichung – eingefroren. */
export const BASELINE_NAME = "00000000000000_baseline";
/** Marker in der ersten Zeile der Baseline (geschrieben von `npm run db:baseline`); der Wächter erkennt daran die „scharfe“ Baseline. */
export const BASELINE_MARKER = "-- schrauberos:baseline";

export const GUARD_RULES = ["drop", "rename", "not-null", "unique", "data-change"] as const;
export type GuardRule = (typeof GUARD_RULES)[number];
export type GuardViolation = { rule: GuardRule; statement: string; message: string };

const MIN_REASON = 10;

/** Ausnahmen (`-- guard:allow <regel>: <Begründung>`) einer Migration. */
export function allowedRules(sql: string): Set<GuardRule> {
  const allowed = new Set<GuardRule>();
  for (const line of sql.split(/\r?\n/)) {
    const m = /^\s*--\s*guard:allow\s+([a-z-]+)\s*:\s*(.+?)\s*$/.exec(line);
    if (m && (GUARD_RULES as readonly string[]).includes(m[1]) && m[2].length >= MIN_REASON) allowed.add(m[1] as GuardRule);
  }
  return allowed;
}

/** SQL ohne Kommentare, in einzelne Anweisungen zerlegt (Semikolons und `--` in Zeichenketten bleiben erhalten). */
export function statementsOf(sql: string): string[] {
  const noComments = sql
    .split(/\r?\n/)
    .map((line) => {
      let quoted = false;
      for (let i = 0; i < line.length; i++) {
        if (line[i] === "'") quoted = !quoted;
        else if (!quoted && line[i] === "-" && line[i + 1] === "-") return line.slice(0, i);
      }
      return line;
    })
    .join("\n");
  const out: string[] = [];
  let current = "";
  let quoted = false;
  for (const ch of noComments) {
    if (ch === "'") quoted = !quoted;
    if (ch === ";" && !quoted) {
      if (current.trim()) out.push(current.trim());
      current = "";
    } else current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

/** Ein SQL-Bezeichner in Anführungszeichen, Backticks oder ohne (drei Erfassungsgruppen). */
const IDENT = "(?:\"([^\"]+)\"|`([^`]+)`|(\\w+))";
const pick = (m: RegExpExecArray, from = 1) => m[from] ?? m[from + 1] ?? m[from + 2];
const re = (source: string) => new RegExp(source.replaceAll("{ID}", IDENT), "i");

const CREATE_TABLE = re("^CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?{ID}");
const ADD_COLUMN = re("^ALTER\\s+TABLE\\s+{ID}\\s+ADD\\s+COLUMN\\s+{ID}\\s*([\\s\\S]*)$");
const UNIQUE_INDEX = re("^CREATE\\s+UNIQUE\\s+INDEX\\s+{ID}\\s+ON\\s+{ID}\\s*\\(([^)]*)\\)");

/** Tabellen, die diese Migration neu anlegt. */
export function tablesCreatedBy(sql: string): string[] {
  const names: string[] = [];
  for (const s of statementsOf(sql)) {
    const m = CREATE_TABLE.exec(s);
    if (m) names.push(pick(m));
  }
  return names;
}

/** Prüft eine Migration; `existingTables` sind die Tabellen, die frühere Migrationen angelegt haben. */
export function checkMigration(sql: string, existingTables: ReadonlySet<string>): GuardViolation[] {
  const allowed = allowedRules(sql);
  const found: GuardViolation[] = [];
  const shorten = (statement: string) => statement.replace(/\s+/g, " ").slice(0, 160);
  const add = (rule: GuardRule, statement: string, message: string) => {
    if (!allowed.has(rule)) found.push({ rule, statement: shorten(statement), message });
  };
  const statements = statementsOf(sql);

  // Neue, nullable Spalten dieser Migration je Tabelle (für die Ausnahme beim Unique-Index)
  const newNullable = new Map<string, Set<string>>();
  for (const s of statements) {
    const m = ADD_COLUMN.exec(s);
    if (!m) continue;
    const table = pick(m);
    const column = pick(m, 4);
    const rest = m[7] ?? "";
    if (/\bNOT\s+NULL\b/i.test(rest)) {
      if (!/\bDEFAULT\b/i.test(rest)) add("not-null", s, `Neue Spalte ${table}.${column} ist NOT NULL ohne DEFAULT – die Vorversion des Codes könnte sie nicht schreiben.`);
    } else {
      if (!newNullable.has(table)) newNullable.set(table, new Set());
      newNullable.get(table)!.add(column);
    }
  }

  for (const s of statements) {
    if (/^DROP\s+/i.test(s)) add("drop", s, "DROP ist nicht erlaubt: Spalten und Tabellen erst viel später entfernen (Rückfall auf die Vorversion).");
    if (/^ALTER\s+TABLE\b[\s\S]*\bDROP\s+COLUMN\b/i.test(s)) add("drop", s, "DROP COLUMN ist nicht erlaubt (Rückfall auf die Vorversion).");
    if (/\bRENAME\b/i.test(s)) add("rename", s, "RENAME ist nicht erlaubt: die Vorversion des Codes kennt nur den alten Namen.");
    if (/^(DELETE\s+FROM|UPDATE\s|REPLACE\s+INTO|INSERT\s+OR\s+REPLACE)/i.test(s)) add("data-change", s, "DELETE/UPDATE/REPLACE verändert Bestandsdaten und braucht eine begründete Ausnahme.");

    const u = UNIQUE_INDEX.exec(s);
    if (u) {
      const table = pick(u, 4);
      if (existingTables.has(table)) {
        const columns = u[7].split(",").map((c) => c.trim().replace(/^["`]|["`]$/g, "").replace(/\s+(ASC|DESC)$/i, ""));
        const allNew = columns.every((c) => newNullable.get(table)?.has(c));
        // Auf einer Bestandsspalte hilft auch kein Marker; auf einer neuen nullable Spalte nur mit Marker samt Begründung
        if (!allNew) found.push({ rule: "unique", statement: shorten(s), message: `Neuer UNIQUE-Index auf der Bestandstabelle ${table}: nur auf einer in derselben Migration neu angelegten nullable Spalte erlaubt.` });
        else add("unique", s, `UNIQUE-Index auf der neuen Spalte von ${table} braucht den Marker „-- guard:allow unique: <Begründung>“.`);
      }
    }
  }
  return found;
}

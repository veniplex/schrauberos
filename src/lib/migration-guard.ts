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
 *  - kein `DELETE`/`UPDATE`/`REPLACE` (auch nicht als `WITH … UPDATE` oder `INSERT … ON CONFLICT … DO UPDATE`; Daten werden nicht still verändert),
 *  - kein `CREATE TRIGGER` (läuft bei jedem Schreibzugriff, auch dem der Vorversion) und kein `PRAGMA`/`ATTACH`/`DETACH`/`VACUUM`.
 *
 * Geprüft wird auf dem SQL ohne Kommentare (Zeilen- und Blockkommentare) und ohne den Inhalt von Zeichenketten und Bezeichnern. SQL unterscheidet
 * Groß-/Kleinschreibung nicht (auch nicht bei Tabellennamen), kennt Schema-Präfixe (`main."T"`), und `ADD`/`DROP` gibt es mit und ohne `COLUMN`.
 *
 * Eine begründete Ausnahme steht als Kommentarzeile in der Migration: `-- guard:allow <regel>: <Begründung>` mit den Regeln
 * `drop`, `rename`, `not-null`, `unique`, `data-change`, `trigger`, `pragma`. Die Begründung ist Pflicht und fällt im Review auf.
 * Veröffentlichte Migrationen schützt zusätzlich `migration-freeze.ts` (Prüfsummen).
 */

/** Name der Baseline-Migration: immer die erste und – ab der Veröffentlichung – eingefroren. */
export const BASELINE_NAME = "00000000000000_baseline";
/** Marker in der ersten Zeile der Baseline (geschrieben von `npm run db:baseline`); der Wächter erkennt daran die „scharfe“ Baseline. */
export const BASELINE_MARKER = "-- schrauberos:baseline";

export const GUARD_RULES = ["drop", "rename", "not-null", "unique", "data-change", "trigger", "pragma"] as const;
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

/** Ende eines Zeichenketten-/Bezeichner-Literals, das bei `from` (dem Anführungszeichen) beginnt; verdoppelte Anführungszeichen gehören dazu. */
function literalEnd(text: string, from: number): number {
  const close = text[from] === "[" ? "]" : text[from];
  let j = from + 1;
  while (j < text.length) {
    if (text[j] === close) {
      if (close !== "]" && text[j + 1] === close) j += 2;
      else break;
    } else j++;
  }
  return j;
}

const isQuote = (ch: string) => ch === "'" || ch === '"' || ch === "`" || ch === "[";

/**
 * SQL ohne Kommentare: Zeilenkommentare bis zum Zeilenende und Blockkommentare (auch über mehrere Zeilen, ersetzt durch ein Leerzeichen).
 * Zeichenketten und Bezeichner (in einfachen/doppelten Anführungszeichen, Backticks oder eckigen Klammern) bleiben unangetastet, auch wenn darin Kommentarzeichen stehen.
 */
export function stripComments(sql: string): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (isQuote(ch)) {
      const end = literalEnd(sql, i);
      out += sql.slice(i, end + 1);
      i = end + 1;
    } else if (ch === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
    } else if (ch === "/" && sql[i + 1] === "*") {
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? sql.length : end + 2;
      out += " ";
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

/** Zeichenketten und Bezeichner durch leere ersetzt: Schlüsselwörter darin (`'RENAME'`, `"drop"`) zählen nicht. */
export const skeleton = (statement: string) => statement.replace(/'(?:[^']|'')*'|"(?:[^"]|"")*"|`(?:[^`]|``)*`|\[[^\]]*\]/g, (m) => (m[0] === "[" ? "[]" : m[0] + m[0]));

/** SQL ohne Kommentare, in einzelne Anweisungen zerlegt (Semikolons in Zeichenketten bleiben erhalten; ein `CREATE TRIGGER … BEGIN … END` ist eine Anweisung). */
export function statementsOf(sql: string): string[] {
  const text = stripComments(sql);
  const chunks: string[] = [];
  let current = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (isQuote(ch)) {
      const end = literalEnd(text, i);
      current += text.slice(i, end + 1);
      i = end + 1;
    } else if (ch === ";") {
      chunks.push(current.trim());
      current = "";
      i++;
    } else {
      current += ch;
      i++;
    }
  }
  chunks.push(current.trim());

  // Ein Trigger enthält Semikolons in seinem Rumpf: bis zum abschließenden „END“ zusammenfassen
  const out: string[] = [];
  for (let k = 0; k < chunks.length; k++) {
    let statement = chunks[k];
    if (/^CREATE\s+(?:TEMP(?:ORARY)?\s+)?TRIGGER\b/i.test(statement)) {
      while (k + 1 < chunks.length && !/^END$/i.test(chunks[k + 1])) statement += `; ${chunks[++k]}`;
      if (k + 1 < chunks.length) statement += `; ${chunks[++k]}`;
    }
    if (statement) out.push(statement);
  }
  return out;
}

/** Ein SQL-Bezeichner in Anführungszeichen, Backticks, eckigen Klammern oder ohne (vier Erfassungsgruppen). */
const IDENT = '(?:"([^"]+)"|`([^`]+)`|\\[([^\\]]+)\\]|(\\w+))';
const pick = (m: RegExpExecArray, from = 1) => m[from] ?? m[from + 1] ?? m[from + 2] ?? m[from + 3];
const re = (source: string) => new RegExp(source.replaceAll("{ID}", IDENT), "i");

/** Schema-Präfix (`main.`, `"main".`, `temp.`) entfernt – SQLite-Migrationen laufen immer in `main`. */
const withoutSchema = (statement: string) => statement.replace(/(?:"(?:main|temp)"|`(?:main|temp)`|\[(?:main|temp)\]|\b(?:main|temp))\s*\.\s*(?=["`[\w])/gi, "");

const CREATE_TABLE = re("^CREATE\\s+(?:TEMP(?:ORARY)?\\s+)?TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?{ID}");
const ADD_COLUMN = re("^ALTER\\s+TABLE\\s+{ID}\\s+ADD\\s+(?:COLUMN\\s+)?{ID}\\s*([\\s\\S]*)$");
const UNIQUE_INDEX = re("^CREATE\\s+UNIQUE\\s+INDEX\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?{ID}\\s+ON\\s+{ID}\\s*\\(");

/** Text hinter einer öffnenden Klammer (bei `from`) bis zu ihrer schließenden; verschachtelte Klammern werden gezählt. */
function parenthesized(text: string, from: number): string {
  let depth = 1;
  for (let i = from; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")" && --depth === 0) return text.slice(from, i);
  }
  return text.slice(from);
}

/** Tabellen, die diese Migration neu anlegt. */
export function tablesCreatedBy(sql: string): string[] {
  const names: string[] = [];
  for (const s of statementsOf(sql)) {
    const m = CREATE_TABLE.exec(withoutSchema(s));
    if (m) names.push(pick(m));
  }
  return names;
}

const lower = (name: string) => name.toLowerCase();

/** Prüft eine Migration; `existingTables` sind die Tabellen, die frühere Migrationen angelegt haben (Groß-/Kleinschreibung egal). */
export function checkMigration(sql: string, existingTables: ReadonlySet<string>): GuardViolation[] {
  const allowed = allowedRules(sql);
  const existing = new Set([...existingTables].map(lower));
  const found: GuardViolation[] = [];
  const shorten = (statement: string) => statement.replace(/\s+/g, " ").slice(0, 160);
  const add = (rule: GuardRule, statement: string, message: string) => {
    if (!allowed.has(rule)) found.push({ rule, statement: shorten(statement), message });
  };
  const statements = statementsOf(sql).map(withoutSchema);

  // Neue, nullable Spalten dieser Migration je Tabelle (für die Ausnahme beim Unique-Index)
  const newNullable = new Map<string, Set<string>>();
  for (const s of statements) {
    const m = ADD_COLUMN.exec(s);
    if (!m) continue;
    const table = lower(pick(m));
    const column = lower(pick(m, 5));
    const rest = skeleton(m[9] ?? "");
    if (/\bNOT\s+NULL\b/i.test(rest)) {
      if (!/\bDEFAULT\b/i.test(rest) || /\bDEFAULT\s+NULL\b/i.test(rest)) add("not-null", s, `Neue Spalte ${pick(m)}.${pick(m, 5)} ist NOT NULL ohne DEFAULT – die Vorversion des Codes könnte sie nicht schreiben.`);
    } else {
      if (!newNullable.has(table)) newNullable.set(table, new Set());
      newNullable.get(table)!.add(column);
    }
  }

  for (const s of statements) {
    const bare = skeleton(s);
    if (/^CREATE\s+(?:TEMP(?:ORARY)?\s+)?TRIGGER\b/i.test(bare)) {
      add("trigger", s, "CREATE TRIGGER ist nicht erlaubt: Ein Trigger läuft bei jedem Schreibzugriff, auch dem der Vorversion des Codes.");
      continue; // der Rumpf gehört zum Trigger
    }
    if (/^(?:PRAGMA|ATTACH|DETACH|VACUUM)\b/i.test(bare)) add("pragma", s, "PRAGMA/ATTACH/DETACH/VACUUM verändern Datenbank-Einstellungen oder Dateien und brauchen eine begründete Ausnahme.");
    if (/^DROP\b/i.test(bare)) add("drop", s, "DROP ist nicht erlaubt: Spalten und Tabellen erst viel später entfernen (Rückfall auf die Vorversion).");
    if (/^ALTER\s+TABLE\b[\s\S]*\bDROP\b/i.test(bare)) add("drop", s, "DROP COLUMN ist nicht erlaubt (Rückfall auf die Vorversion).");
    if (/\bRENAME\b/i.test(bare)) add("rename", s, "RENAME ist nicht erlaubt: die Vorversion des Codes kennt nur den alten Namen.");
    if (
      /^(?:DELETE\s+FROM|UPDATE\b|REPLACE\s+INTO|INSERT\s+OR\s+REPLACE)/i.test(bare) ||
      /^INSERT\b[\s\S]*\bON\s+CONFLICT\b[\s\S]*\bDO\s+UPDATE\b/i.test(bare) ||
      (/^WITH\b/i.test(bare) && /\b(?:DELETE|UPDATE|REPLACE)\b/i.test(bare))
    ) {
      add("data-change", s, "DELETE/UPDATE/REPLACE verändert Bestandsdaten und braucht eine begründete Ausnahme.");
    }

    const u = UNIQUE_INDEX.exec(s);
    if (u) {
      const table = lower(pick(u, 5));
      if (existing.has(table)) {
        const inner = parenthesized(s, u[0].length);
        const columns = inner.split(",").map((c) => lower(c.trim().replace(/\s+(ASC|DESC)$/i, "").replace(/^["`[]|["`\]]$/g, "")));
        const allNew = !inner.includes("(") && columns.every((c) => newNullable.get(table)?.has(c));
        // Auf einer Bestandsspalte hilft auch kein Marker; auf einer neuen nullable Spalte nur mit Marker samt Begründung
        if (!allNew) found.push({ rule: "unique", statement: shorten(s), message: `Neuer UNIQUE-Index auf der Bestandstabelle ${pick(u, 5)}: nur auf einer in derselben Migration neu angelegten nullable Spalte erlaubt.` });
        else add("unique", s, `UNIQUE-Index auf der neuen Spalte von ${pick(u, 5)} braucht den Marker „-- guard:allow unique: <Begründung>“.`);
      }
    }
  }
  return found;
}

import { z } from "zod";
import { centsToInput, MAX_MONEY_CENTS, parseMoneyToCents } from "./money";

/**
 * Positionen für Angebote, Aufträge und Rechnungen: **die** Rechenregel der Anwendung (reine Funktionen, ganze Cent, keine Gleitkomma-Rundung). Der Positionen-Editor
 * (`components/ui/line-item-editor.tsx`) rechnet damit im Browser, die Operationen rechnen **dieselben** Funktionen auf dem Server nach – Summen aus dem Browser werden nie geglaubt.
 *
 * **Regeln** (Entscheidung F0/F3):
 *  - Alle Preise sind **Netto**-Einzelpreise in ganzen Cent; die Menge hat bis zu drei Nachkommastellen (`quantityMilli`, 1,5 Std. = 1500), Rabatt und Steuersatz bis zu zwei (Basispunkte, 19 % = 1900).
 *  - Position: `Basis = Menge × Einzelpreis` (kaufmännisch gerundet, „halbe Cent weg von null“), `Rabatt = Basis × Rabattsatz` (ebenso gerundet), `Netto = Basis − Rabatt`.
 *  - **Steuer je Satz auf der Summe gerundet:** Die Nettobeträge gleicher Steuersätze werden addiert, erst dann wird die Steuer des Satzes berechnet und gerundet (nicht je Position).
 *    So stimmen Summenblock, Rechnung und XRechnung überein (EN 16931 verlangt Steuerbasis und -betrag je Kategorie und Satz).
 *  - **Steuerfrei** (`exempt`, Kleinunternehmer nach § 19 UStG): keine Steuer, eine Gruppe mit Satz 0 und Steuerbetrag 0; Brutto = Netto.
 *  - Negative Mengen und Preise sind erlaubt (Gutschriftspositionen); Grenzen: Menge ± 1.000.000, Preis ± 10.000.000,00 €, Rabatt 0 … 100 %, Steuersatz 0 … 100 %.
 *  - **Überlaufschutz:** Jeder Betrag (Position vor Rabatt, Summen, Steuer, Brutto) bleibt unter `MAX_MONEY_CENTS` (21.474.836,47 €, die Grenze einer `Int`-Spalte). Eine Position, die darüber liegt, ist ungültig
 *    (Editor: Fehler an der Zeile, Server: `validation.tooLarge` an der Position), ebenso eine zu große Summe (`Totals.exceedsLimit`). Unterhalb der Grenze ist jede Rechnung exakt (höchstens 200 Positionen);
 *    oberhalb sind die Summen nicht mehr verlässlich – die Aufrufer prüfen `exceedsLimit`, bevor sie Summen anzeigen oder speichern.
 */

export const QUANTITY_DECIMALS = 3;
export const PERCENT_DECIMALS = 2;
export const MAX_QUANTITY_MILLI = 1_000_000 * 1000;
export const MAX_UNIT_CENTS = 10_000_000 * 100;
export const MAX_LINES = 200;

/** Eine auswertbare Position (alle Werte ganzzahlig). */
export type ParsedLine = {
  /** Menge in Tausendsteln (1,5 → 1500) */
  quantityMilli: number;
  /** Netto-Einzelpreis in Cent */
  unitCents: number;
  /** Steuersatz in Basispunkten (19 % → 1900) */
  taxBp: number;
  /** Rabatt in Basispunkten (10 % → 1000), 0 … 10000 */
  discountBp: number;
};

export type LineResult = { baseCents: number; discountCents: number; netCents: number };
export type TaxGroup = { taxBp: number; netCents: number; taxCents: number };
export type Totals = {
  lines: LineResult[];
  /** Summe der Positionen vor Rabatt */
  baseCents: number;
  discountCents: number;
  netCents: number;
  /** je Steuersatz, absteigend nach Satz */
  taxGroups: TaxGroup[];
  taxCents: number;
  grossCents: number;
  /** Ein Betrag liegt über `MAX_MONEY_CENTS` (Positionen, Summen, Steuer oder Brutto): die Werte sind dann nicht verlässlich und dürfen nicht gespeichert werden */
  exceedsLimit: boolean;
};

/** `a × b ÷ d`, exakt (BigInt) und kaufmännisch gerundet (halbe Einheit weg von null). */
export function mulDiv(a: number, b: number, d: number): number {
  const zero = BigInt(0);
  const numerator = BigInt(a) * BigInt(b);
  const denominator = BigInt(d);
  const negative = numerator < zero !== denominator < zero;
  const n = numerator < zero ? -numerator : numerator;
  const dd = denominator < zero ? -denominator : denominator;
  const quotient = n / dd;
  const rounded = (n % dd) * BigInt(2) >= dd ? quotient + BigInt(1) : quotient;
  return Number(negative ? -rounded : rounded);
}

export function lineResult(line: ParsedLine): LineResult {
  const baseCents = mulDiv(line.quantityMilli, line.unitCents, 1000);
  const discountCents = mulDiv(baseCents, line.discountBp, 10_000);
  return { baseCents, discountCents, netCents: baseCents - discountCents };
}

/** Liegt eine Position vor Rabatt über der Betragsgrenze? (Menge × Preis kann bis 10^15 Cent erreichen.) */
export const lineExceedsLimit = (line: ParsedLine): boolean => Math.abs(lineResult(line).baseCents) > MAX_MONEY_CENTS;

/** Summen eines Beleges. `exempt`: steuerfrei (Kleinunternehmer) – alle Sätze zählen als 0. Setzt `exceedsLimit`, wenn ein Betrag die Grenze übersteigt. */
export function computeTotals(lines: readonly ParsedLine[], options: { exempt?: boolean } = {}): Totals {
  const results = lines.map(lineResult);
  const groups = new Map<number, number>();
  lines.forEach((line, index) => {
    const rate = options.exempt ? 0 : line.taxBp;
    groups.set(rate, (groups.get(rate) ?? 0) + results[index].netCents);
  });
  const taxGroups = [...groups.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([taxBp, netCents]) => ({ taxBp, netCents, taxCents: mulDiv(netCents, taxBp, 10_000) }));
  const sum = (pick: (r: LineResult) => number) => results.reduce((total, r) => total + pick(r), 0);
  const netCents = sum((r) => r.netCents);
  const taxCents = taxGroups.reduce((total, g) => total + g.taxCents, 0);
  const baseCents = sum((r) => r.baseCents);
  const discountCents = sum((r) => r.discountCents);
  const grossCents = netCents + taxCents;
  // Positionen zuerst: Liegt keine darüber, sind alle Summen exakt (höchstens 200 × 2,1 Mrd. Cent, weit unter 2^53)
  const exceedsLimit = results.some((r) => Math.abs(r.baseCents) > MAX_MONEY_CENTS) || [baseCents, discountCents, netCents, taxCents, grossCents, ...taxGroups.flatMap((g) => [g.netCents, g.taxCents])].some((value) => !Number.isSafeInteger(value) || Math.abs(value) > MAX_MONEY_CENTS);
  return { lines: results, baseCents, discountCents, netCents, taxGroups, taxCents, grossCents, exceedsLimit };
}

/* ------------------------------------------------------------------ Eingabetexte */

/**
 * Dezimalzahl als Text („1,5“, „1.5“, „1.234,5“, „-2“) → ganze Zahl mit `decimals` Nachkommastellen (1,5 mit 3 Stellen → 1500). `null` bei Ungültigem **und** bei mehr Nachkommastellen,
 * als erlaubt sind (nichts wird stillschweigend abgeschnitten). Ein einzelner Punkt oder ein einzelnes Komma ist immer das Dezimalzeichen (bei Mengen und Sätzen gibt es keine Tausendertrenner);
 * kommen beide vor, ist das letzte das Dezimalzeichen.
 */
export function parseScaled(input: string, decimals: number): number | null {
  let text = input.replace(/[\s ]/g, "");
  if (!text) return null;
  const negative = text.startsWith("-");
  if (negative || text.startsWith("+")) text = text.slice(1);
  if (text.includes(",") && text.includes(".")) text = text.lastIndexOf(",") > text.lastIndexOf(".") ? text.replace(/\./g, "").replace(",", ".") : text.replace(/,/g, "");
  else text = text.replace(",", ".");
  const match = /^(\d+)(?:\.(\d*))?$/.exec(text);
  if (!match) return null;
  const fraction = match[2] ?? "";
  if (fraction.length > decimals) return null;
  const scaled = Number(match[1] + fraction.padEnd(decimals, "0"));
  if (!Number.isSafeInteger(scaled)) return null;
  return negative ? -scaled : scaled;
}

/** Ganze Zahl mit `decimals` Nachkommastellen → Text für ein Eingabefeld, ohne überflüssige Nullen („1,5“, „19“). */
export function scaledToInput(value: number, decimals: number, locale: "de" | "en" = "de"): string {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  const factor = 10 ** decimals;
  const whole = Math.trunc(abs / factor);
  const fraction = String(abs % factor).padStart(decimals, "0").replace(/0+$/, "");
  return `${sign}${whole}${fraction ? (locale === "de" ? "," : ".") + fraction : ""}`;
}

export const parseQuantity = (text: string): number | null => {
  const milli = parseScaled(text, QUANTITY_DECIMALS);
  return milli === null || Math.abs(milli) > MAX_QUANTITY_MILLI ? null : milli;
};
/** Prozentwert („19“, „5,5“) → Basispunkte, 0 … 100 % */
export const parsePercentBp = (text: string): number | null => {
  const bp = parseScaled(text, PERCENT_DECIMALS);
  return bp === null || bp < 0 || bp > 10_000 ? null : bp;
};
export const parseUnitCents = (text: string): number | null => {
  const cents = parseMoneyToCents(text);
  return cents === null || Math.abs(cents) > MAX_UNIT_CENTS ? null : cents;
};

/* ------------------------------------------------------------------ Zustand des Editors */

/**
 * Eine Zeile des Editors, alle Werte als Eingabetext (so lässt sich halb Getipptes darstellen). `kind` (Art der Position, z. B. Arbeit/Teil) und `refType`/`refId` (Verweis, den eine andere
 * Funktion beim Einfügen setzt, z. B. ein Artikel) sind optionale Zusätze: leer, wenn der Aufrufer sie nicht nutzt, und dann auch nicht im Absendefeld.
 */
export type EditorRow = { key: string; description: string; quantity: string; unit: string; unitPrice: string; taxRate: string; discount: string; kind: string; refType: string; refId: string };
export type EditorField = Exclude<keyof EditorRow, "key">;
export type EditorState = { rows: EditorRow[]; nextKey: number };
/** Eine Zeile ohne Schlüssel – so wird der Zustand für Entwürfe gesichert. */
export type EditorRowDraft = Omit<EditorRow, "key">;

export type EditorAction =
  | { type: "add"; row?: Partial<EditorRowDraft> }
  | { type: "remove"; key: string }
  | { type: "set"; key: string; field: EditorField; value: string }
  | { type: "move"; key: string; delta: -1 | 1 }
  | { type: "replace"; rows: readonly Partial<EditorRowDraft>[] };

/**
 * Ereignis, mit dem eine andere Funktion eine Position in den Editor einfügt (z. B. „Artikel einfügen“ im Auftrag): `window.dispatchEvent(new CustomEvent(LINE_ITEM_ADD_EVENT, { detail }))`.
 * `name` ist das Absendefeld des Editors (Standard „items“), `row` die vorbelegten Werte als Eingabetext. Der Editor kennt den Absender nicht.
 */
export const LINE_ITEM_ADD_EVENT = "so-line-item-add";
export type LineItemAddDetail = { name?: string; row: Partial<EditorRowDraft> };

export const EDITOR_FIELDS: readonly EditorField[] = ["description", "quantity", "unit", "unitPrice", "taxRate", "discount", "kind", "refType", "refId"];

export function blankRow(key: string, defaults: Partial<EditorRowDraft> = {}): EditorRow {
  return { key, description: "", quantity: "1", unit: "", unitPrice: "", taxRate: "19", discount: "", kind: "", refType: "", refId: "", ...defaults };
}

export function createEditorState(rows: readonly Partial<EditorRowDraft>[], defaults: Partial<EditorRowDraft> = {}): EditorState {
  return { rows: rows.map((row, i) => blankRow(`r${i}`, { ...defaults, ...row })), nextKey: rows.length };
}

/**
 * Zustandsübergang. **Jede Änderung rechnet aus dem aktuellen Zustand** (`useReducer`): Die Wiederherstellung eines Entwurfs schreibt mehrere Felder nacheinander, und ein Rückruf mit einer
 * Kopie des Zustands aus dem letzten Rendern würde die anderen überschreiben (siehe `invoices/amounts.ts`).
 */
export function editorReducer(state: EditorState, action: EditorAction, defaults: Partial<EditorRowDraft> = {}): EditorState {
  switch (action.type) {
    case "add": {
      if (state.rows.length >= MAX_LINES) return state;
      // eine neue Zeile übernimmt den Steuersatz der letzten (meist dasselbe)
      const last = state.rows.at(-1);
      const row = blankRow(`r${state.nextKey}`, { ...defaults, ...(last ? { taxRate: last.taxRate } : {}), ...action.row });
      return { rows: [...state.rows, row], nextKey: state.nextKey + 1 };
    }
    case "remove":
      return { ...state, rows: state.rows.filter((row) => row.key !== action.key) };
    case "set":
      return { ...state, rows: state.rows.map((row) => (row.key === action.key ? { ...row, [action.field]: action.value } : row)) };
    case "move": {
      const index = state.rows.findIndex((row) => row.key === action.key);
      const target = index + action.delta;
      if (index < 0 || target < 0 || target >= state.rows.length) return state;
      const rows = [...state.rows];
      [rows[index], rows[target]] = [rows[target], rows[index]];
      return { ...state, rows };
    }
    case "replace": {
      const rows = action.rows.slice(0, MAX_LINES).map((row, i) => blankRow(`r${state.nextKey + i}`, { ...defaults, ...cleanDraftRow(row) }));
      return { rows, nextKey: state.nextKey + rows.length };
    }
  }
}

/** Nur bekannte Felder, nur Text (ein Entwurf aus dem `sessionStorage` ist Fremdeingabe). */
function cleanDraftRow(row: Partial<EditorRowDraft>): Partial<EditorRowDraft> {
  const out: Partial<EditorRowDraft> = {};
  for (const field of EDITOR_FIELDS) if (typeof row[field] === "string") out[field] = row[field].slice(0, 500);
  return out;
}

/** Zustand → Text für das Zustandsfeld des Entwurfs (feste Feldreihenfolge, ohne Schlüssel). */
export function serializeDraft(rows: readonly EditorRow[]): string {
  return JSON.stringify(rows.map((row) => EDITOR_FIELDS.map((field) => row[field])));
}

/** Text des Zustandsfeldes → Zeilen (leer bei Unlesbarem). */
export function parseDraft(text: string): EditorRowDraft[] {
  try {
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((row): row is unknown[] => Array.isArray(row))
      .slice(0, MAX_LINES)
      .map((row) => Object.fromEntries(EDITOR_FIELDS.map((field, i) => [field, typeof row[i] === "string" ? (row[i] as string).slice(0, 500) : ""])) as EditorRowDraft);
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ Auswertung */

export type RowIssue = Partial<Record<"quantity" | "unitPrice" | "taxRate" | "discount", "invalid" | "tooLarge">>;
export type RowEvaluation = { parsed: ParsedLine | null; issues: RowIssue };

/** Prüft eine Zeile des Editors: alle Felder lesbar? Leerer Rabatt ist 0 %; Menge und Preis sind Pflicht. */
export function evaluateRow(row: Pick<EditorRow, "quantity" | "unitPrice" | "taxRate" | "discount">): RowEvaluation {
  const quantityMilli = parseQuantity(row.quantity);
  const unitCents = parseUnitCents(row.unitPrice);
  const taxBp = parsePercentBp(row.taxRate);
  const discountBp = row.discount.trim() === "" ? 0 : parsePercentBp(row.discount);
  const issues: RowIssue = {};
  if (quantityMilli === null) issues.quantity = "invalid";
  if (unitCents === null) issues.unitPrice = "invalid";
  if (taxBp === null) issues.taxRate = "invalid";
  if (discountBp === null) issues.discount = "invalid";
  if (quantityMilli === null || unitCents === null || taxBp === null || discountBp === null) return { parsed: null, issues };
  const parsed = { quantityMilli, unitCents, taxBp, discountBp };
  // Menge × Preis über der Betragsgrenze: Fehler an Menge und Preis (der Betrag ist zu groß, nicht eines der Felder für sich)
  if (lineExceedsLimit(parsed)) return { parsed: null, issues: { quantity: "tooLarge", unitPrice: "tooLarge" } };
  return { parsed, issues };
}

export type EditorEvaluation = { rows: RowEvaluation[]; totals: Totals; valid: boolean; /** die Summen (nicht eine einzelne Zeile) übersteigen die Betragsgrenze */ tooLarge: boolean };

/** Alle Zeilen auswerten; die Summen zählen nur gültige Zeilen (`valid` sagt, ob alle gültig sind). */
export function evaluateRows(rows: readonly EditorRow[], options: { exempt?: boolean } = {}): EditorEvaluation {
  const evaluated = rows.map(evaluateRow);
  const parsed = evaluated.flatMap((e) => (e.parsed ? [e.parsed] : []));
  const totals = computeTotals(parsed, options);
  return { rows: evaluated, totals, valid: evaluated.every((e) => e.parsed !== null) && !totals.exceedsLimit, tooLarge: totals.exceedsLimit };
}

/** Wert des Absendefeldes: die Positionen als Zahlen (ungültige Felder als `null` – der Server lehnt sie ab und meldet den Fehler an die Zeile). */
export function serializeSubmit(rows: readonly EditorRow[]): string {
  return JSON.stringify(
    rows.map((row) => {
      const quantityMilli = parseQuantity(row.quantity);
      const unitCents = parseUnitCents(row.unitPrice);
      const taxBp = parsePercentBp(row.taxRate);
      const discountBp = row.discount.trim() === "" ? 0 : parsePercentBp(row.discount);
      return {
        description: row.description.trim(),
        unit: row.unit.trim(),
        quantityMilli,
        unitCents,
        taxBp,
        discountBp,
        ...(row.kind ? { kind: row.kind } : {}),
        ...(row.refType && row.refId ? { refType: row.refType, refId: row.refId } : {}),
      };
    }),
  );
}

/** Positionen aus gespeicherten Zahlen zurück in Eingabetexte (Bearbeiten-Formular). */
export function rowsFromItems(
  items: ReadonlyArray<{ description: string; unit?: string; quantityMilli: number; unitCents: number; taxBp: number; discountBp?: number; kind?: string; refType?: string | null; refId?: string | null }>,
  locale: "de" | "en" = "de",
): EditorRowDraft[] {
  return items.map((item) => ({
    description: item.description,
    unit: item.unit ?? "",
    quantity: scaledToInput(item.quantityMilli, QUANTITY_DECIMALS, locale),
    unitPrice: locale === "de" ? centsToInput(item.unitCents) : centsToInput(item.unitCents).replace(",", "."),
    taxRate: scaledToInput(item.taxBp, PERCENT_DECIMALS, locale),
    discount: item.discountBp ? scaledToInput(item.discountBp, PERCENT_DECIMALS, locale) : "",
    kind: item.kind ?? "",
    refType: item.refType ?? "",
    refId: item.refId ?? "",
  }));
}

/**
 * Eingabeschema für die Positionen im Absendefeld (`serializeSubmit`) – Formular-Aktion **und** API verwenden es, danach rechnet `computeTotals`. Fehler tragen Meldungsschlüssel
 * (`validation.*`); das Feld der Zeile steht im Pfad (`items.2.unitCents` → Fehler an Position 3).
 */
export const lineItemsInput = (options: { max?: number } = {}) =>
  z
    .string()
    .max(200_000)
    .transform((text, ctx) => {
      try {
        return JSON.parse(text) as unknown;
      } catch {
        ctx.addIssue({ code: "custom", message: "validation.invalid" });
        return z.NEVER;
      }
    })
    .pipe(lineItemsSchema(options));

export const lineItemsSchema = (options: { max?: number } = {}) =>
  z
    .array(
      z.object({
        description: z.string().trim().min(1, { error: "validation.required" }).max(300),
        unit: z.string().trim().max(20).default(""),
        quantityMilli: z.number({ error: "validation.number" }).int().min(-MAX_QUANTITY_MILLI).max(MAX_QUANTITY_MILLI),
        unitCents: z.number({ error: "validation.invalid" }).int().min(-MAX_UNIT_CENTS).max(MAX_UNIT_CENTS),
        taxBp: z.number({ error: "validation.number" }).int().min(0).max(10_000),
        discountBp: z.number({ error: "validation.number" }).int().min(0).max(10_000).default(0),
        /** Zusätze, die nur der Aufrufer deutet (Art der Position, Verweis auf einen Artikel) */
        kind: z.string().max(20).optional(),
        refType: z.string().max(20).optional(),
        refId: z.string().max(64).optional(),
      }),
    )
    .max(options.max ?? MAX_LINES)
    .superRefine((items, ctx) => {
      // Betragsgrenze (Int-Spalten, exakte Summen): erst jede Position, dann die Summen – nie ein stiller Überlauf
      let lineIssue = false;
      items.forEach((item, index) => {
        if (!lineExceedsLimit(item)) return;
        lineIssue = true;
        ctx.addIssue({ code: "custom", path: [index, "unitCents"], message: "validation.tooLarge" });
      });
      // schlimmster Fall (Steuer nicht ausgenommen): Brutto ist am größten
      if (!lineIssue && computeTotals(items).exceedsLimit) ctx.addIssue({ code: "custom", message: "validation.tooLarge" });
    });

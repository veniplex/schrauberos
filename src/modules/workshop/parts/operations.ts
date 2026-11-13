import { z } from "zod";
import { claimRow } from "@/lib/concurrency";
import { todayInput } from "@/lib/dates";
import { parsePercentBp, parseQuantity } from "@/lib/line-items";
import { parseMoneyToCents } from "@/lib/money";
import { searchKey } from "@/lib/search-key";
import { defineOperation, fail, failField, type RunContext } from "@/server/operations";
import { normalizeArticleNumber } from "./domain";
import { bookMovement } from "./stock";

/**
 * Operationen von Teile & Lager. Der Bestand ändert sich **nur** über Bewegungen (`StockMovement`, unveränderlich): Wareneingang, Inventur-Korrektur, Auftragsabgang und Rückbuchung
 * (die beiden letzten kommen aus den Hooks auf `orders.close`/`orders.reopen`, `hooks.ts`). Jede Buchung ändert den Bestand mit einem atomaren Zuwachs und hält den Stand danach fest.
 * Ein negativer Bestand ist erlaubt (die Ware war da, die Buchung hinkt) und wird sichtbar gemacht, nie verhindert.
 */

/** Geldbetrag als Text: leer = löschen (`null`), sonst Cent ≥ 0. */
const optionalMoney = z
  .string()
  .max(20)
  .transform((value, ctx) => {
    if (value.trim() === "") return null;
    const cents = parseMoneyToCents(value);
    if (cents === null || cents < 0) {
      ctx.addIssue({ code: "custom", message: "validation.invalid" });
      return z.NEVER;
    }
    return cents;
  });

/** Menge als Text (bis drei Nachkommastellen) → Tausendstel, mit unterer Grenze. */
const quantity = (min: number) =>
  z
    .string()
    .max(14)
    .transform((value, ctx) => {
      const milli = parseQuantity(value);
      if (milli === null || milli < min) {
        ctx.addIssue({ code: "custom", message: "validation.invalid" });
        return z.NEVER;
      }
      return milli;
    });

const taxRate = z
  .string()
  .max(8)
  .transform((value, ctx) => {
    const bp = parsePercentBp(value);
    if (bp === null) {
      ctx.addIssue({ code: "custom", message: "validation.invalid" });
      return z.NEVER;
    }
    return bp;
  });

export const articleInput = z.object({
  id: z.string().optional(),
  version: z.string().optional(),
  number: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(120),
  unit: z.string().trim().min(1).max(10).default("Stk"),
  supplier: z.string().trim().max(120).optional(),
  taxRate: taxRate.default(1900),
  minStock: quantity(0).optional(),
  notes: z.string().max(2000).optional(),
  /** Preise (nur mit `parts.prices`): fehlt das Feld, bleibt der Wert; leer löscht ihn */
  purchase: optionalMoney.optional(),
  sale: optionalMoney.optional(),
});
export type ArticleInput = z.output<typeof articleInput>;

export const saveArticleOperation = defineOperation({
  name: "parts.save",
  permission: "parts.edit",
  input: articleInput,
  audit: (input) => (input.id ? "part.update" : "part.create"),
  run: async ({ input: d, principal, tx, audit }) => {
    const wantsPrices = d.purchase !== undefined || d.sale !== undefined;
    // Preise ändert nur, wer sie sehen darf (sonst bliebe ein Preis ungesehen überschreibbar)
    if (wantsPrices && !principal.can("parts.prices")) fail("forbidden");
    const number = normalizeArticleNumber(d.number);
    if (await tx.article.findFirst({ where: { number, ...(d.id ? { id: { not: d.id } } : {}) }, select: { id: true } })) failField("number", "parts.errors.numberTaken");
    const data = {
      number,
      name: d.name,
      searchKey: searchKey(number, d.name, d.supplier),
      unit: d.unit,
      supplier: d.supplier ?? null,
      taxBp: d.taxRate,
      ...(d.minStock !== undefined ? { minStockMilli: d.minStock } : { minStockMilli: 0 }),
      notes: d.notes ?? null,
      ...(d.purchase !== undefined ? { purchaseCents: d.purchase } : {}),
      ...(d.sale !== undefined ? { saleCents: d.sale } : {}),
    };
    let id: string;
    if (d.id) {
      const current = await tx.article.findUnique({ where: { id: d.id }, select: { id: true } });
      if (!current) fail("notFound");
      if (!(await claimRow(tx.article, d.id, d.version))) fail("conflict");
      await tx.article.update({ where: { id: d.id }, data });
      id = d.id;
    } else {
      id = (await tx.article.create({ data, select: { id: true } })).id;
    }
    // Der Audit-Eintrag nennt die Felder, nie die Preise
    audit({ target: `${number} · ${d.name}`, entityId: id });
    return { id };
  },
});

export const setArchivedOperation = defineOperation({
  name: "parts.setArchived",
  permission: "parts.edit",
  input: z.object({ id: z.string().min(1), version: z.string().min(1), archived: z.enum(["0", "1"]).transform((v) => v === "1") }),
  audit: (input) => (input.archived ? "part.archive" : "part.unarchive"),
  run: async ({ input: d, tx, audit }) => {
    const article = await tx.article.findUnique({ where: { id: d.id }, select: { number: true, archivedAt: true } });
    if (!article) fail("notFound");
    if (!!article.archivedAt === d.archived) fail("conflict");
    if (!(await claimRow(tx.article, d.id, d.version))) fail("conflict");
    await tx.article.update({ where: { id: d.id }, data: { archivedAt: d.archived ? new Date() : null } });
    audit({ target: article.number, entityId: d.id });
    return { id: d.id };
  },
});

/* ───────────── Buchungen ───────────── */

const who = (principal: { user: { name: string } }) => principal.user.name.slice(0, 80);

export const receiptInput = z.object({
  /** Artikel */
  articleId: z.string().min(1),
  quantity: quantity(1),
  /** Lieferschein oder Nummer der Eingangsrechnung (von Hand eingetragen; verknüpft den Wareneingang mit dem Beleg) */
  reference: z.string().trim().max(80).optional(),
  note: z.string().trim().max(500).optional(),
});

export const receiptOperation = defineOperation({
  name: "parts.receipt",
  permission: "parts.stock",
  input: receiptInput,
  audit: "part.receipt",
  run: async ({ input: d, principal, tx, audit }) => {
    const article = await tx.article.findUnique({ where: { id: d.articleId }, select: { number: true, archivedAt: true } });
    if (!article) failField("articleId", "validation.invalid");
    if (article.archivedAt) failField("articleId", "parts.errors.archived");
    const movement = await bookMovement(tx, { articleId: d.articleId, kind: "receipt", delta: d.quantity, byName: who(principal), reference: d.reference, note: d.note });
    audit({ target: `${article.number}: +${d.quantity / 1000}${d.reference ? ` (${d.reference})` : ""}`, entityId: d.articleId });
    return { id: movement!.id, articleId: d.articleId };
  },
});

export const countInput = z.object({
  /** gezählter Bestand je Artikel (Kennung → Menge als Text); leer gelassene Artikel bleiben unverändert */
  counts: z.record(z.string().min(1), z.string().max(14)),
  note: z.string().trim().max(200).optional(),
});

/**
 * Inventur: Der gezählte Bestand ersetzt den Sollbestand; die **Differenz** wird als Korrektur gebucht (Bewegung `correction` mit Bezeichnung „Inventur <Tag>“). Gebucht wird gegen
 * den Stand **in der Transaktion** (nicht gegen den, der beim Öffnen der Seite galt). Artikel ohne Eingabe und ohne Abweichung erzeugen nichts.
 */
export const countOperation = defineOperation({
  name: "parts.count",
  permission: "parts.stock",
  input: countInput,
  audit: "part.count",
  run: async ({ input: d, principal, tx, audit }: RunContext<z.output<typeof countInput>, undefined>) => {
    const entries = Object.entries(d.counts).filter(([, value]) => value.trim() !== "");
    const reference = `Inventur ${todayInput()}`;
    let corrected = 0;
    for (const [articleId, text] of entries) {
      const counted = parseQuantity(text);
      if (counted === null || counted < 0) failField(`counts.${articleId}`, "validation.invalid");
      const article = await tx.article.findUnique({ where: { id: articleId }, select: { stockMilli: true } });
      if (!article) failField(`counts.${articleId}`, "validation.invalid");
      const delta = counted - article.stockMilli;
      if (delta === 0) continue;
      await bookMovement(tx, { articleId, kind: "correction", delta, byName: who(principal), reference, note: d.note });
      corrected += 1;
    }
    audit({ target: `${reference}: ${corrected}/${entries.length}`, entityId: null });
    return { corrected, counted: entries.length };
  },
});

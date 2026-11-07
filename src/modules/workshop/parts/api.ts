import { z } from "zod";
import type { Article, StockMovement } from "@/generated/prisma/client";
import { versionOf } from "@/lib/concurrency";
import { scaledToInput } from "@/lib/line-items";
import { centsText, iso, isoOrNull, nullableString, oneOf, text } from "@/server/api/format";
import { defineResource, type Delegate } from "@/server/api/resource";
import { db } from "@/server/db";
import { restrictedOrderIds } from "@/modules/workshop/orders/public";
import { MOVEMENT_KINDS } from "./constants";
import { receiptOperation, saveArticleOperation, setArchivedOperation } from "./operations";

/**
 * API-Ressourcen von Teile & Lager: `/articles` (ohne Preise), `/article-prices` (Einkaufs- und Verkaufspreis, nur lesend, Recht `parts.prices`), `/stock-movements` (lesen; **anlegen =
 * Wareneingang**, Recht `parts.stock`). Bewegungen sind unveränderlich: kein Ändern, kein Löschen; Abgänge und Rückbuchungen entstehen nur mit den Aufträgen, die Inventur nur in der
 * Oberfläche. Preise setzt man im Körper von `POST /articles` und `PATCH /articles/{id}` (`purchaseCents`, `saleCents`, `null` löscht) – nur mit `parts.prices` (sonst 403).
 */
type Json = Record<string, unknown>;

const articleItem = z.object({
  id: z.string(),
  version: z.string(),
  number: z.string(),
  name: z.string(),
  unit: z.string(),
  supplier: nullableString,
  /** Steuersatz in Basispunkten (19 % = 1900) */
  taxBp: z.number().int(),
  /** Bestand und Mindestbestand in Tausendsteln der Einheit; der Bestand kann negativ sein */
  stockMilli: z.number().int(),
  minStockMilli: z.number().int(),
  notes: nullableString,
  archivedAt: nullableString,
  createdAt: z.string(),
  updatedAt: z.string(),
});

const body = z.strictObject({
  number: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(120),
  unit: z.string().trim().min(1).max(10).optional(),
  supplier: text(120),
  taxBp: z.number().int().min(0).max(10_000).optional(),
  minStockMilli: z.number().int().min(0).max(1_000_000_000).optional(),
  notes: text(2000),
  /** nur mit `parts.prices`; `null` löscht den Preis */
  purchaseCents: z.number().int().min(0).nullable().optional(),
  saleCents: z.number().int().min(0).nullable().optional(),
});

/** Milli → Text, den die Operation liest („1.5“). */
const milliText = (milli: number): string => String(milli / 1000);

/** Körper (oder der Stand der Zeile, gelegt unter den Teil-Körper) → rohe Eingabe der Operation; Preise nur, wenn der Aufrufer sie ausdrücklich nennt. */
function toInput(b: Record<string, unknown>, explicit: Record<string, unknown>): Json {
  const price = (key: "purchaseCents" | "saleCents") => (key in explicit ? (explicit[key] === null ? "" : centsText(explicit[key] as number)) : undefined);
  return {
    number: b.number,
    name: b.name,
    unit: b.unit,
    supplier: b.supplier,
    taxRate: typeof b.taxBp === "number" ? scaledToInput(b.taxBp, 2, "en") : undefined,
    minStock: typeof b.minStockMilli === "number" ? milliText(b.minStockMilli) : undefined,
    notes: b.notes,
    purchase: price("purchaseCents"),
    sale: price("saleCents"),
  };
}

export const articleEndpoints = defineResource({
  feature: "workshop.parts",
  tag: "Parts",
  name: "articles",
  singular: "article",
  path: "/articles",
  read: "parts.view",
  model: db.article as unknown as Delegate<Article>,
  // Preise werden nicht gelesen: `/article-prices` ist die Ressource dafür (Recht parts.prices)
  select: { id: true, number: true, name: true, unit: true, supplier: true, taxBp: true, stockMilli: true, minStockMilli: true, notes: true, archivedAt: true, createdAt: true, updatedAt: true },
  item: articleItem,
  version: versionOf,
  // Buchungen ändern den Bestand, nicht die Version (Stammdaten): der Bestand gehört in den ETag, sonst bestätigte ein bedingtes Lesen einen veralteten Bestand
  etagExtra: (a) => a.stockMilli.toString(36),
  toItem: (a): z.input<typeof articleItem> => ({
    id: a.id,
    version: versionOf(a),
    number: a.number,
    name: a.name,
    unit: a.unit,
    supplier: a.supplier,
    taxBp: a.taxBp,
    stockMilli: a.stockMilli,
    minStockMilli: a.minStockMilli,
    notes: a.notes,
    archivedAt: isoOrNull(a.archivedAt),
    createdAt: iso(a.createdAt),
    updatedAt: iso(a.updatedAt),
  }),
  list: {
    filters: z.strictObject({ number: z.string().max(40).optional(), archived: z.enum(["true", "false"]).optional(), belowMinimum: z.enum(["true"]).optional() }),
    where: ({ number, archived, belowMinimum }) => ({
      ...(number ? { number: number.trim().toUpperCase() } : {}),
      ...(archived === "true" ? { archivedAt: { not: null } } : archived === "false" ? { archivedAt: null } : {}),
      // „unter Mindestbestand“ vergleicht zwei Spalten; die API filtert nur den eindeutigen Fall des negativen Bestands
      ...(belowMinimum ? { stockMilli: { lt: 0 } } : {}),
    }),
    sorts: { number: (dir) => ({ number: dir }), name: (dir) => ({ name: dir }), stockMilli: (dir) => ({ stockMilli: dir }), updatedAt: (dir) => ({ updatedAt: dir }) },
    defaultSort: [{ key: "number", dir: "asc" }],
  },
  create: { permission: "parts.edit", operation: saveArticleOperation, body, toInput: (b, { call }) => toInput(b, call.body as Json) },
  update: {
    permission: "parts.edit",
    operation: saveArticleOperation,
    current: (a) => ({ number: a.number, name: a.name, unit: a.unit, supplier: a.supplier, taxBp: a.taxBp, minStockMilli: a.minStockMilli, notes: a.notes }),
    toInput: (merged, { id, version, call }) => ({ ...toInput(merged, call.body as Json), id, version }),
  },
  actions: [
    { name: "archive", summary: "Archive an article (it disappears from selections; positions and movements stay)", permission: "parts.edit", operation: setArchivedOperation, ifMatch: true, toInput: (id, _b, { version }) => ({ id, version, archived: "1" }) },
    { name: "unarchive", summary: "Reactivate an archived article", permission: "parts.edit", operation: setArchivedOperation, ifMatch: true, toInput: (id, _b, { version }) => ({ id, version, archived: "0" }) },
  ],
});

const priceItem = z.object({ id: z.string(), number: z.string(), purchaseCents: z.number().int().nullable(), saleCents: z.number().int().nullable() });

export const priceEndpoints = defineResource({
  feature: "workshop.parts",
  tag: "Parts",
  name: "article-prices",
  singular: "article price",
  path: "/article-prices",
  read: "parts.prices",
  model: db.article as unknown as Delegate<Article>,
  select: { id: true, number: true, purchaseCents: true, saleCents: true },
  item: priceItem,
  toItem: (a): z.input<typeof priceItem> => ({ id: a.id, number: a.number, purchaseCents: a.purchaseCents, saleCents: a.saleCents }),
  list: {
    filters: z.strictObject({}),
    sorts: { number: (dir) => ({ number: dir }) },
    defaultSort: [{ key: "number", dir: "asc" }],
  },
});

const movementItem = z.object({
  id: z.string(),
  articleId: z.string(),
  kind: z.enum(MOVEMENT_KINDS),
  quantityMilli: z.number().int(),
  stockAfterMilli: z.number().int(),
  orderId: nullableString,
  orderNumber: nullableString,
  reference: nullableString,
  note: nullableString,
  byName: z.string(),
  createdAt: z.string(),
});

export const movementEndpoints = defineResource({
  feature: "workshop.parts",
  tag: "Parts",
  name: "stock-movements",
  singular: "stock movement",
  path: "/stock-movements",
  read: "parts.view",
  model: db.stockMovement as unknown as Delegate<StockMovement>,
  // Buchungen zu Aufträgen eingeschränkter Kunden (Art. 18; Kunde oder Fahrzeughalter) gibt es für die API nicht – Auftragsnummer und Notiz könnten sonst Kundenbezug verraten. Die Buchung kennt den Auftrag nur über
  // die Kennung (kein Fremdschlüssel), deshalb zählt die Liste der eingeschränkten Aufträge; ist sie zu lang, sind alle Buchungen mit Auftrag unsichtbar (nie das Gegenteil).
  scope: async () => {
    const ids = await restrictedOrderIds();
    return ids === null ? { orderId: null } : ids.length === 0 ? {} : { OR: [{ orderId: null }, { orderId: { notIn: ids } }] };
  },
  item: movementItem,
  toItem: (m): z.input<typeof movementItem> => ({
    id: m.id,
    articleId: m.articleId,
    kind: oneOf(MOVEMENT_KINDS, m.kind, "correction"),
    quantityMilli: m.quantityMilli,
    stockAfterMilli: m.stockAfterMilli,
    orderId: m.orderId,
    orderNumber: m.orderNumber,
    reference: m.reference,
    note: m.note,
    byName: m.byName,
    createdAt: iso(m.createdAt),
  }),
  list: {
    filters: z.strictObject({ articleId: z.string().max(64).optional(), kind: z.enum(MOVEMENT_KINDS).optional(), orderId: z.string().max(64).optional() }),
    where: ({ articleId, kind, orderId }) => ({ ...(articleId ? { articleId } : {}), ...(kind ? { kind } : {}), ...(orderId ? { orderId } : {}) }),
    sorts: { createdAt: (dir) => ({ createdAt: dir }) },
    defaultSort: [{ key: "createdAt", dir: "desc" }],
  },
  create: {
    permission: "parts.stock",
    operation: receiptOperation,
    body: z.strictObject({
      articleId: z.string().min(1).max(64),
      /** Menge in Tausendsteln der Einheit (1,5 = 1500), mindestens 1 */
      quantityMilli: z.number().int().min(1).max(1_000_000_000),
      /** Lieferschein oder Nummer der Eingangsrechnung */
      reference: text(80),
      note: text(500),
    }),
    toInput: (b) => ({ articleId: b.articleId, quantity: milliText(b.quantityMilli as number), reference: b.reference, note: b.note }),
    rename: { quantity: "quantityMilli" },
  },
});

export const endpoints = [...articleEndpoints, ...priceEndpoints, ...movementEndpoints];

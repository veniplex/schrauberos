import { z } from "zod";
import { etagOf, ifNoneMatchHit, isParamError, parseIfMatch, parsePaging, parseSort } from "@/lib/api/query";
import { iso, isoOrNull, nullableString, optionalRef, requiredRef, text } from "@/server/api/format";
import { ID_SHAPE } from "@/server/api/resource";
import type { ApiEndpoint } from "@/server/api/types";
import { apiProblem, runApiOperation } from "@/server/operations";
import { CHECKLIST_STATUSES, ITEM_TYPES, SIGNATURE_MODES } from "./constants";
import { parseOptions } from "./domain";
import { completeChecklistOperation, setItemOperation, startChecklistOperation } from "./operations";
import { getChecklist, listChecklists, listTemplates, type ChecklistDetail, type ChecklistRow } from "./queries";
import { db } from "@/server/db";

/**
 * API-Ressourcen der Checklisten:
 *  - `GET /checklist-templates`: die aktiven Vorlagen mit den Punkten der aktuellen Version (zum Beginnen einer Checkliste); gepflegt werden Vorlagen nur in der Oberfläche,
 *  - `GET /checklists`, `GET /checklists/{id}` (mit Punkten, je Punkt `version`): nur Checklisten, die das Token nach den Rechten für Fahrzeug bzw. Auftrag sehen darf – Checklisten von Kunden mit eingeschränkter
 *    Verarbeitung (Art. 18) gibt es nicht (404),
 *  - `POST /checklists` (beginnen am Fahrzeug oder Auftrag), `PATCH /checklist-items/{id}` (einen Punkt speichern; **`If-Match` mit der `version` des Punkts**, 412 bei veraltetem Stand),
 *    `POST /checklists/{id}/complete` (abschließen; `If-Match` der Checkliste; die Kundenunterschrift gibt es über die API nur als **getippten Namen** mit Bestätigung, gezeichnet nur in der Oberfläche).
 */

const itemShape = z.object({
  id: z.string(),
  version: z.string(),
  position: z.number().int(),
  label: z.string(),
  type: z.enum(ITEM_TYPES),
  unit: nullableString,
  minValue: z.number().nullable(),
  maxValue: z.number().nullable(),
  targetValue: z.number().nullable(),
  options: z.array(z.string()),
  required: z.boolean(),
  hint: nullableString,
  done: z.boolean(),
  numberValue: z.number().nullable(),
  textValue: nullableString,
  outOfRange: z.boolean(),
});

const summaryShape = z.object({
  id: z.string(),
  version: z.string(),
  templateId: z.string(),
  templateName: z.string(),
  templateVersion: z.number().int(),
  standardKey: nullableString,
  status: z.enum(CHECKLIST_STATUSES),
  vehicleId: z.string(),
  orderId: nullableString,
  createdAt: z.string(),
  completedAt: nullableString,
  signed: z.boolean(),
  itemsDone: z.number().int(),
  itemsTotal: z.number().int(),
  requiredOpen: z.number().int(),
});

const detailShape = summaryShape.extend({ items: z.array(itemShape) });

const toSummary = (c: ChecklistRow): z.input<typeof summaryShape> => ({
  id: c.id,
  version: c.version,
  templateId: c.templateId,
  templateName: c.templateName,
  templateVersion: c.templateVersion,
  standardKey: c.standardKey,
  status: c.status,
  vehicleId: c.vehicleId,
  orderId: c.orderId,
  createdAt: iso(c.createdAt),
  completedAt: isoOrNull(c.completedAt),
  signed: c.signed,
  itemsDone: c.progress.done,
  itemsTotal: c.progress.total,
  requiredOpen: c.requiredOpen,
});

const toDetail = (c: ChecklistDetail): z.input<typeof detailShape> => ({
  ...toSummary(c),
  items: c.items.map((i) => ({
    id: i.id,
    version: i.version,
    position: i.position,
    label: i.label,
    type: (ITEM_TYPES as readonly string[]).includes(i.type) ? (i.type as (typeof ITEM_TYPES)[number]) : "check",
    unit: i.unit,
    minValue: i.minValue,
    maxValue: i.maxValue,
    targetValue: i.targetValue,
    options: parseOptions(i.options),
    required: i.required,
    hint: i.hint,
    done: i.done,
    numberValue: i.numberValue,
    textValue: i.textValue,
    outOfRange: i.outOfRange,
  })),
});

const templateShape = z.object({
  id: z.string(),
  name: z.string(),
  standardKey: nullableString,
  version: z.number().int(),
  signatureMode: z.enum(SIGNATURE_MODES),
  items: z.array(itemShape.omit({ id: true, version: true, done: true, numberValue: true, textValue: true, outOfRange: true })),
});


/** Aktive Vorlagen (oder eine) mit den Punkten der aktuellen Version. */
async function templatesFor(call: Parameters<ApiEndpoint["handler"]>[0], only?: string) {
  const rows = (await listTemplates(call.principal)).filter((r) => !only || r.id === only);
  const versions = await db.checklistTemplate.findMany({
    where: { id: { in: rows.map((r) => r.id) } },
    select: { id: true, versions: { orderBy: { version: "desc" }, take: 1, select: { items: { orderBy: { position: "asc" } } } } },
  });
  const items = new Map(versions.map((v) => [v.id, v.versions[0]?.items ?? []]));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    standardKey: r.standardKey,
    version: r.version,
    signatureMode: r.signatureMode,
    items: (items.get(r.id) ?? []).map((i) => ({
      position: i.position,
      label: i.label,
      type: (ITEM_TYPES as readonly string[]).includes(i.type) ? (i.type as (typeof ITEM_TYPES)[number]) : "check",
      unit: i.unit,
      minValue: i.minValue,
      maxValue: i.maxValue,
      targetValue: i.targetValue,
      options: parseOptions(i.options),
      required: i.required,
      hint: i.hint,
    })),
  }));
}

const common = { feature: "workshop.checklists" as const, tag: "Checklists" };
const SORTS = ["createdAt"] as const;

export const endpoints: ApiEndpoint[] = [
  {
    ...common,
    method: "GET",
    path: "/checklist-templates",
    permission: "checklists.view",
    operationId: "checklist-templates.list",
    summary: "List the active checklist templates with the items of their current version",
    operations: [],
    query: z.strictObject({}),
    sorts: ["name"],
    response: templateShape,
    list: true,
    handler: async (call) => {
      const data = await templatesFor(call);
      return { status: 200, body: { data, page: { number: 1, limit: Math.max(1, data.length), total: data.length, pages: 1 } } };
    },
  },
  {
    ...common,
    method: "GET",
    path: "/checklist-templates/{id}",
    permission: "checklists.view",
    operationId: "checklist-templates.get",
    summary: "Get a checklist template with the items of its current version",
    operations: [],
    response: templateShape,
    handler: async (call) => {
      if (!ID_SHAPE.test(call.params.id)) throw apiProblem("not_found");
      const [template] = await templatesFor(call, call.params.id);
      if (!template) throw apiProblem("not_found");
      return { status: 200, body: { data: template } };
    },
  },
  {
    ...common,
    method: "GET",
    path: "/checklists",
    permission: "checklists.view",
    operationId: "checklists.list",
    summary: "List checklists (only those the token may see)",
    operations: [],
    query: z.strictObject({ status: z.enum(CHECKLIST_STATUSES).optional(), vehicleId: z.string().max(64).optional(), orderId: z.string().max(64).optional(), standardKey: z.string().max(20).optional() }),
    sorts: SORTS,
    response: summaryShape,
    list: true,
    handler: async (call) => {
      const paging = parsePaging(call.searchParams);
      const sort = parseSort(call.searchParams.get("sort"), SORTS, [{ key: "createdAt", dir: "desc" }]);
      for (const bad of [paging, sort]) if (isParamError(bad)) throw apiProblem("validation_failed", { fields: { [bad.field]: { code: bad.code } } });
      const { page, limit } = paging as { page: number; limit: number };
      const q = call.query as { status?: (typeof CHECKLIST_STATUSES)[number]; vehicleId?: string; orderId?: string; standardKey?: string };
      const { rows, total } = await listChecklists(call.principal, { ...q, status: q.status ?? "all" }, { skip: (page - 1) * limit, take: limit });
      const ordered = (sort as Array<{ dir: string }>)[0]?.dir === "asc" ? [...rows].reverse() : rows;
      return { status: 200, body: { data: ordered.map(toSummary), page: { number: page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) } } };
    },
  },
  {
    ...common,
    method: "GET",
    path: "/checklists/{id}",
    permission: "checklists.view",
    operationId: "checklists.get",
    summary: "Get a checklist with its items (each item carries its own version for If-Match)",
    operations: [],
    response: detailShape,
    etag: true,
    handler: async (call) => {
      if (!ID_SHAPE.test(call.params.id)) throw apiProblem("not_found");
      const checklist = await getChecklist(call.principal, call.params.id);
      if (!checklist) throw apiProblem("not_found");
      const etag = etagOf(checklist.version);
      if (ifNoneMatchHit(call.ifNoneMatch, etag)) return { status: 304, headers: { etag } };
      return { status: 200, body: { data: toDetail(checklist) }, headers: { etag } };
    },
  },
  {
    ...common,
    method: "POST",
    path: "/checklists",
    permission: "checklists.fill",
    operationId: "checklists.create",
    summary: "Start a checklist from the current version of a template, on a vehicle or an open order",
    operations: [startChecklistOperation.name],
    body: z.strictObject({ templateId: requiredRef, vehicleId: optionalRef, orderId: optionalRef }),
    response: detailShape,
    status: 201,
    etag: true,
    handler: async (call) => {
      const body = call.body as { templateId: string; vehicleId?: string | null; orderId?: string | null };
      const { id } = await runApiOperation(startChecklistOperation, call.principal, { templateId: body.templateId, ...(body.vehicleId ? { vehicleId: body.vehicleId } : {}), ...(body.orderId ? { orderId: body.orderId } : {}) });
      call.committed({ status: 201, body: { data: { id } }, headers: { location: `/api/v1/checklists/${id}` } });
      const checklist = await getChecklist(call.principal, id);
      if (!checklist) throw apiProblem("internal_error");
      return { status: 201, body: { data: toDetail(checklist) }, headers: { location: `/api/v1/checklists/${id}`, etag: etagOf(checklist.version) } };
    },
  },
  {
    ...common,
    method: "PATCH",
    path: "/checklist-items/{id}",
    permission: "checklists.fill",
    operationId: "checklist-items.update",
    summary: "Save the result of one item: done (tick), numberValue (measurement, torque), textValue (choice, text). Send the item's own version as the ETag in If-Match",
    operations: [setItemOperation.name],
    body: z.strictObject({ done: z.boolean().optional(), numberValue: z.number().nullable().optional(), textValue: text(4000) }),
    response: itemShape,
    ifMatch: true,
    etag: true,
    handler: async (call) => {
      if (!ID_SHAPE.test(call.params.id)) throw apiProblem("not_found");
      const match = parseIfMatch(call.ifMatch);
      if (match.kind === "none") throw apiProblem("precondition_required");
      if (match.kind === "invalid") throw apiProblem("bad_request", { fields: { "If-Match": { code: "validation.invalid" } } });
      const body = call.body as { done?: boolean; numberValue?: number | null; textValue?: string | null };
      if (Object.keys(body).length === 0) throw apiProblem("validation_failed", { reason: "validation.required" });
      const result = await runApiOperation(setItemOperation, call.principal, {
        id: call.params.id,
        version: match.version,
        ...(body.done !== undefined ? { done: body.done ? "1" : "0" } : {}),
        ...(body.numberValue !== undefined ? { numberValue: body.numberValue } : {}),
        ...(body.textValue !== undefined && body.textValue !== null ? { textValue: body.textValue } : {}),
      });
      call.committed({ status: 200, body: { data: { id: call.params.id } } });
      const item = await db.checklistItem.findUnique({ where: { id: call.params.id }, select: { checklistId: true } });
      const checklist = item ? await getChecklist(call.principal, item.checklistId) : null;
      const row = checklist?.items.find((i) => i.id === call.params.id);
      if (!checklist || !row) throw apiProblem("not_found");
      const detail = toDetail(checklist).items.find((i) => i.id === row.id)!;
      return { status: 200, body: { data: detail }, headers: { etag: etagOf(result.version) } };
    },
  },
  {
    ...common,
    method: "POST",
    path: "/checklists/{id}/complete",
    permission: "checklists.fill",
    operationId: "checklists.complete",
    summary: "Complete the checklist (If-Match: ETag of the checklist). A customer signature is possible here only as a typed name that equals customerName; drawn signatures exist only in the user interface",
    operations: [completeChecklistOperation.name],
    body: z.strictObject({ customerName: text(80), signedName: text(80), note: text(1000) }),
    response: detailShape,
    ifMatch: true,
    etag: true,
    handler: async (call) => {
      if (!ID_SHAPE.test(call.params.id)) throw apiProblem("not_found");
      const match = parseIfMatch(call.ifMatch);
      if (match.kind === "none") throw apiProblem("precondition_required");
      if (match.kind === "invalid") throw apiProblem("bad_request", { fields: { "If-Match": { code: "validation.invalid" } } });
      const body = call.body as { customerName?: string | null; signedName?: string | null; note?: string | null };
      await runApiOperation(completeChecklistOperation, call.principal, {
        id: call.params.id,
        version: match.version,
        ...(body.customerName ? { customerName: body.customerName } : {}),
        ...(body.signedName ? { signature: `typed:${body.signedName}` } : {}),
        ...(body.note ? { note: body.note } : {}),
      });
      call.committed({ status: 200, body: { data: { id: call.params.id } } });
      const fresh = await getChecklist(call.principal, call.params.id);
      if (!fresh) throw apiProblem("not_found");
      return { status: 200, body: { data: toDetail(fresh) }, headers: { etag: etagOf(fresh.version) } };
    },
  },
];

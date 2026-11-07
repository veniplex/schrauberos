import { z } from "zod";
import { isParamError, parsePaging, parseSort, etagOf, ifNoneMatchHit, type SortKey } from "@/lib/api/query";
import { dayKey, timeKey } from "@/lib/zone";
import { dateOnly, iso, isoOrNull, nullableString, optionalRef, text } from "@/server/api/format";
import { ID_SHAPE } from "@/server/api/resource";
import type { ApiEndpoint } from "@/server/api/types";
import { apiProblem, runApiOperation } from "@/server/operations";
import { ENTRY_SOURCES } from "./constants";
import { entryMinutes } from "./domain";
import { addManualTimeOperation, startTimeOperation, stopTimeOperation } from "./operations";
import { getEntry, pageEntries, type EntryRow } from "./queries";

/**
 * API-Ressource `/time-entries` (Zeiterfassung): eigene Zeiten lesen, stempeln (`POST /time-entries/start` und `/stop`) und nachtragen (`POST /time-entries`). Mit dem Recht `time.viewAll`
 * lesen Token auch die Zeiten aller Mitarbeiter (`employeeId`-Filter). Alle schreibenden Wege laufen über dieselben Operationen wie die Oberfläche (genau ein laufender Eintrag, Idempotenz).
 *
 *  - **Idempotenz:** `Idempotency-Key` wirkt wie überall (gleiche Antwort bei Wiederholung) und wird zusätzlich als Schlüssel der Buchung an die Operation gereicht – auch ein Token-Wechsel bucht nicht doppelt.
 *  - Zeiten sind Zeitpunkte (ISO 8601, UTC) und – wie im Formular – Tag und Uhrzeit in der Zeitzone der Werkstatt (`date`, `startTime`, `endTime`). Beim Nachtragen: `startDate`/`startTime`/`endDate`/`endTime`.
 *  - **Korrigieren und Stornieren** gibt es nicht über die API (`api-exceptions.ts`): Arbeitszeitnachweise ändert eine Person mit Begründung in der Oberfläche.
 */

const itemShape = z.object({
  id: z.string(),
  version: z.string(),
  employeeId: z.string(),
  orderId: nullableString,
  startedAt: z.string(),
  endedAt: nullableString,
  date: z.string(),
  startTime: z.string(),
  endTime: nullableString,
  breakMinutes: z.number().int(),
  /** Arbeitszeit in Minuten (nach Abzug der Pause; ein laufender Eintrag zählt bis jetzt) */
  minutes: z.number().int(),
  activity: nullableString,
  note: nullableString,
  source: z.enum(ENTRY_SOURCES),
  running: z.boolean(),
  voided: z.boolean(),
  transferred: z.boolean(),
});

const toItem = (row: EntryRow, now = new Date()): z.input<typeof itemShape> => ({
  id: row.id,
  version: row.version,
  employeeId: row.employeeId,
  orderId: row.orderId,
  startedAt: iso(row.startedAt),
  endedAt: isoOrNull(row.endedAt),
  date: dayKey(row.startedAt),
  startTime: timeKey(row.startedAt),
  endTime: row.endedAt ? timeKey(row.endedAt) : null,
  breakMinutes: row.breakMinutes,
  minutes: entryMinutes(row, now),
  activity: row.activity,
  note: row.note,
  source: row.source === "manual" ? "manual" : "stamp",
  running: row.endedAt === null && !row.voided,
  voided: row.voided,
  transferred: row.transferred,
});

const common = { feature: "office.time" as const, tag: "Time" };
const SORTS = ["startedAt"] as const;

const timeText = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const endpoints: ApiEndpoint[] = [
  {
    ...common,
    method: "GET",
    path: "/time-entries",
    permission: "time.view",
    operationId: "time-entries.list",
    summary: "List time entries (your own; with time.viewAll those of all employees, filter employeeId)",
    operations: [],
    query: z.strictObject({
      from: dateOnly.optional(),
      to: dateOnly.optional(),
      employeeId: z.string().max(64).optional(),
      orderId: z.string().max(64).optional(),
      running: z.enum(["true", "false"]).optional(),
      voided: z.enum(["true", "false"]).optional(),
    }),
    sorts: SORTS,
    response: itemShape,
    list: true,
    handler: async (call) => {
      const paging = parsePaging(call.searchParams);
      const sort = parseSort(call.searchParams.get("sort"), SORTS, [{ key: "startedAt", dir: "desc" }]);
      for (const bad of [paging, sort]) if (isParamError(bad)) throw apiProblem("validation_failed", { fields: { [bad.field]: { code: bad.code } } });
      const { page, limit } = paging as { page: number; limit: number };
      const q = call.query as { from?: string; to?: string; employeeId?: string; orderId?: string; running?: "true" | "false"; voided?: "true" | "false" };
      const { rows, total } = await pageEntries(
        call.principal,
        { from: q.from, to: q.to, employeeId: q.employeeId, orderId: q.orderId, running: q.running === undefined ? undefined : q.running === "true", includeVoided: q.voided === "true" },
        { skip: (page - 1) * limit, take: limit },
      );
      const now = new Date();
      const ordered = (sort as SortKey[])[0]?.dir === "asc" ? [...rows].reverse() : rows;
      return { status: 200, body: { data: ordered.map((r) => toItem(r, now)), page: { number: page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) } } };
    },
  },
  {
    ...common,
    method: "GET",
    path: "/time-entries/{id}",
    permission: "time.view",
    operationId: "time-entries.get",
    summary: "Get a time entry (your own; with time.viewAll any)",
    operations: [],
    response: itemShape,
    etag: true,
    handler: async (call) => {
      if (!ID_SHAPE.test(call.params.id)) throw apiProblem("not_found");
      const entry = await getEntry(call.principal, call.params.id);
      if (!entry) throw apiProblem("not_found");
      const etag = etagOf(entry.version);
      if (ifNoneMatchHit(call.ifNoneMatch, etag)) return { status: 304, headers: { etag } };
      return { status: 200, body: { data: toItem(entry) }, headers: { etag } };
    },
  },
  {
    ...common,
    method: "POST",
    path: "/time-entries/start",
    permission: "time.stamp",
    operationId: "time-entries.start",
    summary: "Start the clock (one running entry per employee; the Idempotency-Key makes a repeat harmless)",
    operations: [startTimeOperation.name],
    body: z.strictObject({ orderId: optionalRef, activity: text(120) }),
    response: itemShape,
    status: 201,
    etag: true,
    handler: async (call) => {
      const body = call.body as { orderId?: string | null; activity?: string | null };
      const key = call.request.headers.get("idempotency-key");
      const { id } = await runApiOperation(startTimeOperation, call.principal, { ...(body.orderId ? { orderId: body.orderId } : {}), ...(body.activity ? { activity: body.activity } : {}), ...(key ? { key } : {}) });
      call.committed({ status: 201, body: { data: { id } }, headers: { location: `/api/v1/time-entries/${id}` } });
      const entry = await getEntry(call.principal, id);
      if (!entry) throw apiProblem("internal_error");
      return { status: 201, body: { data: toItem(entry) }, headers: { location: `/api/v1/time-entries/${id}`, etag: etagOf(entry.version) } };
    },
  },
  {
    ...common,
    method: "POST",
    path: "/time-entries/stop",
    permission: "time.stamp",
    operationId: "time-entries.stop",
    summary: "Stop the running entry of the token owner",
    operations: [stopTimeOperation.name],
    body: z.strictObject({ breakMinutes: z.number().int().min(0).max(600).optional() }),
    response: itemShape,
    etag: true,
    handler: async (call) => {
      const body = call.body as { breakMinutes?: number };
      const key = call.request.headers.get("idempotency-key");
      const { id } = await runApiOperation(stopTimeOperation, call.principal, { ...(body.breakMinutes !== undefined ? { breakMinutes: body.breakMinutes } : {}), ...(key ? { key } : {}) });
      call.committed({ status: 200, body: { data: { id } } });
      const entry = await getEntry(call.principal, id);
      if (!entry) throw apiProblem("internal_error");
      return { status: 200, body: { data: toItem(entry) }, headers: { etag: etagOf(entry.version) } };
    },
  },
  {
    ...common,
    method: "POST",
    path: "/time-entries",
    permission: "time.correct",
    operationId: "time-entries.create",
    summary: "Add a missed time entry (a reason is mandatory; for other employees time.correctAll is needed)",
    operations: [addManualTimeOperation.name],
    body: z.strictObject({
      employeeId: optionalRef,
      startDate: dateOnly,
      startTime: timeText,
      endDate: dateOnly,
      endTime: timeText,
      breakMinutes: z.number().int().min(0).max(600).optional(),
      orderId: optionalRef,
      activity: text(120),
      note: text(500),
      reason: z.string().min(5).max(300),
    }),
    response: itemShape,
    status: 201,
    etag: true,
    handler: async (call) => {
      const b = call.body as Record<string, unknown>;
      const input = Object.fromEntries(Object.entries(b).filter(([, v]) => v !== null && v !== undefined && v !== ""));
      const { id } = await runApiOperation(addManualTimeOperation, call.principal, input);
      call.committed({ status: 201, body: { data: { id } }, headers: { location: `/api/v1/time-entries/${id}` } });
      const entry = await getEntry(call.principal, id);
      if (!entry) throw apiProblem("internal_error");
      return { status: 201, body: { data: toItem(entry) }, headers: { location: `/api/v1/time-entries/${id}`, etag: etagOf(entry.version) } };
    },
  },
];

import { addDays } from "date-fns";
import { z } from "zod";
import type { Appointment, AppointmentType, Bay } from "@/generated/prisma/client";
import { versionOf } from "@/lib/concurrency";
import { parseLocalDateTime, toDateInput, toTimeInput } from "@/lib/dates";
import { dateOnly, iso, nullableString, optionalRef } from "@/server/api/format";
import { defineResource, type Delegate } from "@/server/api/resource";
import { db } from "@/server/db";
import { apiProblem } from "@/server/operations";
import { APPOINTMENT_KINDS, APPOINTMENT_STATUSES, QUICK_STATUSES } from "./constants";
import { createAppointmentOperation, deleteAppointmentOperation, setAppointmentStatusOperation, updateAppointmentOperation } from "./operations";

/**
 * API-Ressourcen „Termine“ (`/api/v1/appointments`) sowie die Nachschlagelisten Arbeitsplätze (`/bays`) und Terminarten (`/appointment-types`, nur lesend –
 * ihre Pflege ist Konfiguration in der Oberfläche). Anlegen und Ändern laufen über dieselben Operationen wie das Terminformular, also mit derselben
 * Doppelbelegungs-Prüfung des Arbeitsplatzes (`findBayClash`, in der Transaktion).
 *
 * Zeiten: `date` + `time` + `durationMinutes` in der Zeitzone der Werkstatt (wie im Formular); `startsAt`/`endsAt` sind dieselben Zeitpunkte in ISO 8601 (UTC).
 */
const ref = optionalRef;

const body = z.strictObject({
  title: z.string().trim().min(1).max(120),
  typeId: ref,
  vehicleId: ref,
  bayId: ref,
  assigneeId: ref,
  tireSetId: ref,
  date: dateOnly,
  time: z.string().regex(/^\d{2}:\d{2}$/),
  durationMinutes: z.number().int().min(5).max(720),
  status: z.enum(APPOINTMENT_STATUSES).optional(),
  notes: z.string().max(2000).nullable().optional(),
});

const item = z.object({
  id: z.string(),
  version: z.string(),
  title: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  date: z.string(),
  time: z.string(),
  durationMinutes: z.number().int(),
  status: z.enum(APPOINTMENT_STATUSES),
  notes: nullableString,
  typeId: nullableString,
  bayId: nullableString,
  customerId: nullableString,
  vehicleId: nullableString,
  tireSetId: nullableString,
  assigneeId: nullableString,
  createdAt: z.string(),
  updatedAt: z.string(),
});

const durationOf = (a: Appointment) => Math.round((a.endsAt.getTime() - a.startsAt.getTime()) / 60_000);

/** API-Körper → Eingabe der Operation (`duration`, `status` hat dort einen Standard). */
const toInput = ({ durationMinutes, ...rest }: Record<string, unknown>): Record<string, unknown> => ({ ...rest, duration: durationMinutes });

/** Beginn des Tages in Ortszeit. Gibt es ihn nicht (Zeitumstellung um Mitternacht), ist der Filter ungültig: 422 statt stillem Weglassen des Filters. */
const dayStart = (value: string, field: string): Date => {
  const start = parseLocalDateTime(value, "00:00");
  if (!start) throw apiProblem("validation_failed", { fields: { [field]: { code: "validation.invalid" } } });
  return start;
};

export const appointmentEndpoints = defineResource({
  feature: "workshop.appointments",
  tag: "Appointments",
  name: "appointments",
  singular: "appointment",
  path: "/appointments",
  read: "appointments.view",
  model: db.appointment as unknown as Delegate<Appointment>,
  item,
  version: versionOf,
  toItem: (a): z.input<typeof item> => ({
    id: a.id,
    version: versionOf(a),
    title: a.title,
    startsAt: iso(a.startsAt),
    endsAt: iso(a.endsAt),
    date: toDateInput(a.startsAt),
    time: toTimeInput(a.startsAt),
    durationMinutes: durationOf(a),
    status: (APPOINTMENT_STATUSES as readonly string[]).includes(a.status) ? (a.status as (typeof APPOINTMENT_STATUSES)[number]) : "scheduled",
    notes: a.notes,
    typeId: a.typeId,
    bayId: a.bayId,
    customerId: a.customerId,
    vehicleId: a.vehicleId,
    tireSetId: a.tireSetId,
    assigneeId: a.assigneeId,
    createdAt: iso(a.createdAt),
    updatedAt: iso(a.updatedAt),
  }),
  list: {
    filters: z.strictObject({
      /** Termine ab diesem Tag (einschließlich) */
      from: dateOnly.optional(),
      /** … bis zu diesem Tag (einschließlich) */
      to: dateOnly.optional(),
      status: z.enum(APPOINTMENT_STATUSES).optional(),
      bayId: z.string().max(64).optional(),
      vehicleId: z.string().max(64).optional(),
      customerId: z.string().max(64).optional(),
      assigneeId: z.string().max(64).optional(),
    }),
    where: ({ from, to, status, bayId, vehicleId, customerId, assigneeId }) => {
      const start = from ? dayStart(from, "from") : null;
      const end = to ? dayStart(to, "to") : null;
      return {
        ...(start || end ? { startsAt: { ...(start ? { gte: start } : {}), ...(end ? { lt: addDays(end, 1) } : {}) } } : {}),
        ...(status ? { status } : {}),
        ...(bayId ? { bayId } : {}),
        ...(vehicleId ? { vehicleId } : {}),
        ...(customerId ? { customerId } : {}),
        ...(assigneeId ? { assigneeId } : {}),
      };
    },
    sorts: { startsAt: (dir) => ({ startsAt: dir }), title: (dir) => ({ title: dir }), createdAt: (dir) => ({ createdAt: dir }), updatedAt: (dir) => ({ updatedAt: dir }) },
    defaultSort: [{ key: "startsAt", dir: "asc" }],
  },
  create: { permission: "appointments.create", operation: createAppointmentOperation, body, toInput, rename: { duration: "durationMinutes" } },
  update: {
    permission: "appointments.edit",
    operation: updateAppointmentOperation,
    current: (a) => ({
      title: a.title,
      typeId: a.typeId,
      vehicleId: a.vehicleId,
      bayId: a.bayId,
      assigneeId: a.assigneeId,
      tireSetId: a.tireSetId,
      date: toDateInput(a.startsAt),
      time: toTimeInput(a.startsAt),
      durationMinutes: durationOf(a),
      status: a.status,
      notes: a.notes,
    }),
    toInput: (merged, { id, version }) => ({ ...toInput(merged), id, version }),
    rename: { duration: "durationMinutes" },
  },
  remove: { permission: "appointments.delete", operation: deleteAppointmentOperation },
  actions: [
    {
      name: "status",
      summary: "Quick status step: start (in_progress) or finish (done) an appointment; only the status changes (send the current ETag in If-Match)",
      permission: "appointments.edit",
      operation: setAppointmentStatusOperation,
      body: z.strictObject({ status: z.enum(QUICK_STATUSES) }),
      ifMatch: true,
      toInput: (id, b, { version }) => ({ id, status: b.status, version }),
    },
  ],
});

const bayItem = z.object({ id: z.string(), name: z.string(), active: z.boolean(), sortOrder: z.number().int() });

export const bayEndpoints = defineResource({
  feature: "workshop.appointments",
  tag: "Appointments",
  name: "appointment-bays",
  singular: "bay",
  path: "/appointment-bays",
  read: "appointments.view",
  model: db.bay as unknown as Delegate<Bay>,
  item: bayItem,
  toItem: (b): z.input<typeof bayItem> => ({ id: b.id, name: b.name, active: b.active, sortOrder: b.sortOrder }),
  list: {
    filters: z.strictObject({}),
    sorts: { sortOrder: (dir) => ({ sortOrder: dir }), name: (dir) => ({ name: dir }) },
    defaultSort: [{ key: "sortOrder", dir: "asc" }],
  },
});

const typeItem = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
  defaultMinutes: z.number().int(),
  kind: z.enum(APPOINTMENT_KINDS),
  active: z.boolean(),
  sortOrder: z.number().int(),
});

export const typeEndpoints = defineResource({
  feature: "workshop.appointments",
  tag: "Appointments",
  name: "appointment-types",
  singular: "appointment type",
  path: "/appointment-types",
  read: "appointments.view",
  model: db.appointmentType as unknown as Delegate<AppointmentType>,
  item: typeItem,
  toItem: (t): z.input<typeof typeItem> => ({
    id: t.id,
    name: t.name,
    color: t.color,
    defaultMinutes: t.defaultMinutes,
    kind: t.kind === "tire_change" ? "tire_change" : "general",
    active: t.active,
    sortOrder: t.sortOrder,
  }),
  list: {
    filters: z.strictObject({}),
    sorts: { sortOrder: (dir) => ({ sortOrder: dir }), name: (dir) => ({ name: dir }) },
    defaultSort: [{ key: "sortOrder", dir: "asc" }],
  },
});

export const endpoints = [...appointmentEndpoints, ...bayEndpoints, ...typeEndpoints];

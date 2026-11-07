import { z } from "zod";
import { todayInput } from "@/lib/dates";
import { dateOnly } from "@/server/api/format";
import type { ApiCall, ApiEndpoint } from "@/server/api/types";
import { apiProblem } from "@/server/operations";
import { canOpenReport, type ReportId } from "./access";
import { MAX_UTILIZATION_DAYS, parsePeriod, parseRevenuePeriod, thisMonthUntil, thisYearUntil } from "./domain";
import { DUE_MONTH_CHOICES, dueReport, openItemsReport, revenueReport, storageReport, utilizationReport } from "./queries";

/**
 * API-Ressourcen `/reports/*` (F9): die fünf Berichte **nur lesend**. Verlangt wird `reports.view` am Token (der Router prüft es) **und** das Leserecht der Quelle (hier, `access.ts`): Token-Scope ∩ Rechte des
 * Besitzers gilt für beides – ein Bericht liefert nie, was der Besitzer an der Quelle nicht sehen dürfte. Beträge sind ganze Cent, Tage `JJJJ-MM-TT`, Monate `JJJJ-MM`. Namen von Kunden gibt es in den Berichten nicht
 * (offene Posten nennen den Geschäftspartner der Rechnung, nie Kunden mit eingeschränkter Verarbeitung – Art. 18). Ein Zeitraum außerhalb der Grenzen ist 422.
 */
const common = { feature: "office.reports" as const, tag: "Reports", permission: "reports.view" as const, operations: [] as string[] };

const cents = z.number().int();
const month = z.string().regex(/^\d{4}-\d{2}$/);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Das Quellrecht fehlt: 403 (die Antwort nennt nicht, welches). */
function requireReport(call: ApiCall, id: ReportId): void {
  if (!canOpenReport(call.principal, id)) throw apiProblem("forbidden");
}

const invalidPeriod = (problem: string) => apiProblem("validation_failed", { fields: { from: { code: `period.${problem}` } } });

export const endpoints: ApiEndpoint[] = [
  {
    ...common,
    method: "GET",
    path: "/reports/revenue",
    operationId: "reports.revenue",
    summary: "Revenue per month (outgoing invoices by invoice date, net/tax/gross in cents; credit notes negative; quotes and drafts never count). Needs invoices.view as well",
    query: z.strictObject({ from: dateOnly.optional(), to: dateOnly.optional() }),
    response: z.object({
      from: day,
      to: day,
      months: z.array(z.object({ month, count: z.number().int(), netCents: cents, vatCents: cents, grossCents: cents, incomplete: z.number().int(), derived: z.number().int() })),
      total: z.object({ count: z.number().int(), netCents: cents, vatCents: cents, grossCents: cents, incomplete: z.number().int(), derived: z.number().int() }),
    }),
    handler: async (call) => {
      requireReport(call, "revenue");
      const q = call.query as { from?: string; to?: string };
      const today = todayInput();
      const period = parseRevenuePeriod(q.from ?? thisYearUntil(today).from, q.to ?? thisYearUntil(today).to);
      if (!period.ok) throw invalidPeriod(period.problem);
      const report = await revenueReport(call.principal, period);
      if (!report) throw apiProblem("forbidden");
      return { status: 200, body: { data: report } };
    },
  },
  {
    ...common,
    method: "GET",
    path: "/reports/open-items",
    operationId: "reports.open-items",
    summary: "Open items by age of the due date (receivables or payables). Needs invoices.view as well; customers with restricted processing are only in the totals; open documents with a negative amount (hand-entered credits) are not netted but reported separately as credits",
    query: z.strictObject({ direction: z.enum(["outgoing", "incoming"]).optional() }),
    response: z.object({
      direction: z.enum(["outgoing", "incoming"]),
      today: day,
      buckets: z.array(z.object({ bucket: z.enum(["notDue", "d1_30", "d31_60", "d61_90", "d91plus"]), count: z.number().int(), cents })),
      total: z.object({ count: z.number().int(), cents }),
      items: z.array(z.object({ id: z.string(), number: z.string(), partyName: z.string(), dueDay: day.nullable(), outstandingCents: cents, daysOverdue: z.number().int(), bucket: z.enum(["notDue", "d1_30", "d31_60", "d61_90", "d91plus"]) })),
      hiddenCount: z.number().int(),
      credits: z.object({ count: z.number().int(), cents }),
    }),
    handler: async (call) => {
      requireReport(call, "openItems");
      const q = call.query as { direction?: "outgoing" | "incoming" };
      const report = await openItemsReport(call.principal, { direction: q.direction ?? "outgoing", today: todayInput() });
      if (!report) throw apiProblem("forbidden");
      return { status: 200, body: { data: report } };
    },
  },
  {
    ...common,
    method: "GET",
    path: "/reports/utilization",
    operationId: "reports.utilization",
    summary: "Utilization per bay (minutes booked within the opening hours of the period). Needs appointments.view as well",
    query: z.strictObject({ from: dateOnly.optional(), to: dateOnly.optional() }),
    response: z.object({
      from: day,
      to: day,
      capacityMinutes: z.number(),
      rows: z.array(z.object({ id: z.string().nullable(), name: z.string().nullable(), active: z.boolean(), appointments: z.number().int(), bookedMinutes: z.number(), utilization: z.number().nullable() })),
      truncated: z.boolean(),
    }),
    handler: async (call) => {
      requireReport(call, "utilization");
      const q = call.query as { from?: string; to?: string };
      const today = todayInput();
      const period = parsePeriod(q.from ?? thisMonthUntil(today).from, q.to ?? thisMonthUntil(today).to, { maxDays: MAX_UTILIZATION_DAYS });
      if (!period.ok) throw invalidPeriod(period.problem);
      const report = await utilizationReport(call.principal, period);
      if (!report) throw apiProblem("forbidden");
      return { status: 200, body: { data: report } };
    },
  },
  {
    ...common,
    method: "GET",
    path: "/reports/storage",
    operationId: "reports.storage",
    summary: "Stored tire sets by storage location and season (counts only). Needs tires.view as well",
    response: z.object({
      total: z.number().int(),
      bySeason: z.object({ summer: z.number().int(), winter: z.number().int(), allseason: z.number().int() }),
      rows: z.array(z.object({ location: z.string().nullable(), summer: z.number().int(), winter: z.number().int(), allseason: z.number().int(), total: z.number().int(), oldestDay: day })),
      moreLocations: z.number().int(),
    }),
    handler: async (call) => {
      requireReport(call, "storage");
      const report = await storageReport(call.principal);
      if (!report) throw apiProblem("forbidden");
      return { status: 200, body: { data: report } };
    },
  },
  {
    ...common,
    method: "GET",
    path: "/reports/due",
    operationId: "reports.due",
    summary: "Deadlines: vehicle inspection months, fleet deadlines and payment terms for the next months; each part only with the read permission of its source (otherwise null)",
    query: z.strictObject({ months: z.enum(DUE_MONTH_CHOICES.map(String) as [string, ...string[]]).optional() }),
    response: z.object({
      today: day,
      months: z.number().int(),
      untilMonth: month,
      days: z.number().int(),
      inspection: z
        .object({
          overdue: z.number().int(),
          months: z.array(z.object({ month, count: z.number().int() })),
          items: z.array(z.object({ id: z.string(), plate: z.string(), vehicleName: z.string(), month })),
        })
        .nullable(),
      fleet: z.array(z.object({ id: z.string(), kind: z.enum(["hu", "service"]), plate: z.string(), day })).nullable(),
      payments: z
        .object({
          outgoing: z.object({ count: z.number().int(), cents, hiddenCount: z.number().int(), items: z.array(z.object({ id: z.string(), number: z.string(), partyName: z.string(), dueDay: day, outstandingCents: cents })) }),
          incoming: z.object({ count: z.number().int(), cents, hiddenCount: z.number().int(), items: z.array(z.object({ id: z.string(), number: z.string(), partyName: z.string(), dueDay: day, outstandingCents: cents })) }),
        })
        .nullable(),
    }),
    handler: async (call) => {
      requireReport(call, "due");
      const q = call.query as { months?: string };
      const report = await dueReport(call.principal, { today: todayInput(), months: q.months ? Number(q.months) : 3 });
      const { payments, ...rest } = report;
      return {
        status: 200,
        body: {
          data: {
            ...rest,
            payments: payments ? { outgoing: { count: payments.outgoing.count, cents: payments.outgoing.cents, hiddenCount: payments.outgoing.hiddenCount, items: payments.outgoing.items }, incoming: { count: payments.incoming.count, cents: payments.incoming.cents, hiddenCount: payments.incoming.hiddenCount, items: payments.incoming.items } } : null,
          },
        },
      };
    },
  },
];

import { todayInput } from "@/lib/dates";
import type { AppSession } from "@/server/auth/session";
import { formatDay } from "@/server/csv/format";
import type { ExportDef } from "@/server/csv/types";
import { decimalCell, intCell, moneyCell, type Cell } from "@/server/csv/writer";
import { AGE_BUCKETS } from "@/modules/office/invoices/public";
import { canOpenReport, type ReportId } from "./access";
import { DUE_MONTH_CHOICES, dueReport, openItemsReport, revenueReport, storageReport, utilizationReport } from "./queries";
import { MAX_UTILIZATION_DAYS, parsePeriod, parseRevenuePeriod } from "./domain";

/**
 * CSV-Export der Berichte (F9) über den Datenaustausch (`/api/exchange/report-<art>`, `src/server/csv`): Sitzung, gleiche Herkunft, Funktion aktiv, **eigenes Recht `reports.export`** (gekennzeichnet, in keiner
 * Standardrolle) **plus** `reports.view` und das Leserecht der Quelle, Audit mit Anzahl der Zeilen. Die Datei enthält **dieselben Zahlen wie die Tabelle** des Berichts, nicht mehr: bei offenen Posten die Summen
 * je Stufe (die einzelnen Posten stehen im Export des Rechnungsarchivs), bei Fälligkeiten Kennzeichen und Fristen, keine Namen. Texte, die jemand erfasst hat (Lagerplatz, Arbeitsplatz, Kennzeichen), gehen nur über den
 * Formelschutz (`csvField`) hinaus; vom Programm errechnete Zahlen als `Raw`/`moneyCell`.
 */
const base = { feature: "office.reports" as const, permission: "reports.export" as const, audit: "reports.export" as const };

const rowsOf = async function* (rows: readonly Cell[][]): AsyncGenerator<Cell[]> {
  for (const row of rows) yield row;
};

/** Rechte je Bericht vor dem Öffnen: `reports.view` und das Quellrecht (sonst lieferte der Export, was die Seite verweigert). */
const allowed = (session: AppSession, id: ReportId) => canOpenReport(session, id);

export const revenueExport: ExportDef = {
  id: "report-revenue",
  ...base,
  also: ["reports.view", "invoices.view"],
  filename: (query) => `bericht-umsatz-${query.get("from") ?? ""}_${query.get("to") ?? ""}.csv`,
  open: async ({ session, query, format }) => {
    const period = parseRevenuePeriod(query.get("from"), query.get("to"));
    if (!period.ok) return { error: "reports.errors.invalid" };
    const report = await revenueReport(session, period);
    if (!report) return { error: "reports.errors.invalid" };
    const rows: Cell[][] = report.months.map((m) => [m.month, intCell(m.count), moneyCell(m.netCents, format), moneyCell(m.vatCents, format), moneyCell(m.grossCents, format), intCell(m.incomplete), intCell(m.derived)]);
    rows.push(["", intCell(report.total.count), moneyCell(report.total.netCents, format), moneyCell(report.total.vatCents, format), moneyCell(report.total.grossCents, format), intCell(report.total.incomplete), intCell(report.total.derived)]);
    return {
      columns: [{ labelKey: "reports.exporting.cols.month" }, { labelKey: "reports.exporting.cols.docs" }, { labelKey: "reports.exporting.cols.net" }, { labelKey: "reports.exporting.cols.vat" }, { labelKey: "reports.exporting.cols.gross" }, { labelKey: "reports.exporting.cols.incomplete" }, { labelKey: "reports.exporting.cols.derived" }],
      count: rows.length,
      target: `Umsatz ${report.from}..${report.to}`,
      rows: rowsOf(rows),
    };
  },
};

export const openItemsExport: ExportDef = {
  id: "report-open-items",
  ...base,
  also: ["reports.view", "invoices.view"],
  filename: (query) => `bericht-offene-posten-${query.get("direction") === "incoming" ? "eingang" : "ausgang"}-${formatDay(new Date())}.csv`,
  open: async ({ session, query, format, t }) => {
    const direction = query.get("direction") === "incoming" ? "incoming" : "outgoing";
    const report = await openItemsReport(session, { direction, today: todayInput() });
    if (!report) return { error: "reports.errors.invalid" };
    const rows: Cell[][] = AGE_BUCKETS.map((bucket) => {
      const row = report.buckets.find((b) => b.bucket === bucket)!;
      return [t(`reports.openItems.buckets.${bucket}`), intCell(row.count), moneyCell(row.cents, format)];
    });
    rows.push([t("reports.common.total"), intCell(report.total.count), moneyCell(report.total.cents, format)]);
    if (report.credits.count > 0) rows.push([t("reports.openItems.creditsRow"), intCell(report.credits.count), moneyCell(report.credits.cents, format)]);
    return { columns: [{ labelKey: "reports.exporting.cols.stage" }, { labelKey: "reports.common.count" }, { labelKey: "reports.exporting.cols.outstanding" }], count: rows.length, target: `Offene Posten ${direction} ${report.today}`, rows: rowsOf(rows) };
  },
};

export const utilizationExport: ExportDef = {
  id: "report-utilization",
  ...base,
  also: ["reports.view", "appointments.view"],
  filename: (query) => `bericht-auslastung-${query.get("from") ?? ""}_${query.get("to") ?? ""}.csv`,
  open: async ({ session, query, format, t }) => {
    const period = parsePeriod(query.get("from"), query.get("to"), { maxDays: MAX_UTILIZATION_DAYS });
    if (!period.ok) return { error: "reports.errors.invalid" };
    const report = await utilizationReport(session, period);
    if (!report) return { error: "reports.errors.invalid" };
    const rows: Cell[][] = report.rows.map((r) => [
      r.id === null ? t("reports.utilization.noBay") : (r.name ?? ""),
      intCell(r.appointments),
      decimalCell(Math.round((r.bookedMinutes / 60) * 10) / 10, format),
      r.id === null ? null : decimalCell(Math.round((report.capacityMinutes / 60) * 10) / 10, format),
      r.utilization === null ? null : decimalCell(r.utilization, format),
    ]);
    return {
      columns: [{ labelKey: "reports.exporting.cols.bay" }, { labelKey: "reports.exporting.cols.appointments" }, { labelKey: "reports.exporting.cols.bookedHours" }, { labelKey: "reports.exporting.cols.capacityHours" }, { labelKey: "reports.exporting.cols.utilization" }],
      count: rows.length,
      target: `Auslastung ${period.from}..${period.to}`,
      rows: rowsOf(rows),
    };
  },
};

export const storageExport: ExportDef = {
  id: "report-storage",
  ...base,
  also: ["reports.view", "tires.view"],
  filename: () => `bericht-einlagerung-${formatDay(new Date())}.csv`,
  open: async ({ session, t }) => {
    const report = await storageReport(session);
    if (!report) return { error: "reports.errors.invalid" };
    const rows: Cell[][] = report.rows.map((r) => [r.location ?? t("reports.storage.noLocation"), intCell(r.summer), intCell(r.winter), intCell(r.allseason), intCell(r.total), r.oldestDay]);
    return {
      columns: [{ labelKey: "reports.exporting.cols.location" }, { labelKey: "reports.exporting.cols.summer" }, { labelKey: "reports.exporting.cols.winter" }, { labelKey: "reports.exporting.cols.allseason" }, { labelKey: "reports.exporting.cols.total" }, { labelKey: "reports.exporting.cols.oldest" }],
      count: rows.length,
      target: "Einlagerungsbestand",
      rows: rowsOf(rows),
    };
  },
};

export const dueExport: ExportDef = {
  id: "report-due",
  ...base,
  // Fälligkeiten setzen sich aus mehreren Quellen zusammen: ausgeliefert wird nur, was die Rechte der Person je Quelle hergeben (`dueReport`); `reports.view` plus eine Quelle genügt (`allowed`)
  also: ["reports.view"],
  filename: (query) => `bericht-faelligkeiten-${query.get("months") ?? "3"}-monate-${formatDay(new Date())}.csv`,
  open: async ({ session, query, format, t }) => {
    if (!allowed(session, "due")) return { error: "reports.errors.invalid" };
    const asked = Number(query.get("months"));
    const months = (DUE_MONTH_CHOICES as readonly number[]).includes(asked) ? asked : 3;
    const report = await dueReport(session, { today: todayInput(), months });
    const rows: Cell[][] = [];
    for (const item of report.inspection?.items ?? []) rows.push([t("reports.exporting.kinds.inspection"), item.plate, item.vehicleName, item.month, null, null]);
    for (const item of report.fleet ?? []) rows.push([t(item.kind === "hu" ? "reports.exporting.kinds.fleetHu" : "reports.exporting.kinds.fleetService"), item.plate, null, item.day, null, null]);
    if (report.payments) {
      rows.push([t("reports.exporting.kinds.paymentOut"), null, null, report.untilMonth, intCell(report.payments.outgoing.count), moneyCell(report.payments.outgoing.cents, format)]);
      rows.push([t("reports.exporting.kinds.paymentIn"), null, null, report.untilMonth, intCell(report.payments.incoming.count), moneyCell(report.payments.incoming.cents, format)]);
    }
    return {
      columns: [{ labelKey: "reports.exporting.cols.kind" }, { labelKey: "reports.exporting.cols.plate" }, { labelKey: "reports.exporting.cols.vehicle" }, { labelKey: "reports.exporting.cols.day" }, { labelKey: "reports.common.count" }, { labelKey: "reports.exporting.cols.outstanding" }],
      count: rows.length,
      target: `Fälligkeiten ${months} Monate`,
      rows: rowsOf(rows),
    };
  },
};

export const reportExports: readonly ExportDef[] = [revenueExport, openItemsExport, utilizationExport, storageExport, dueExport];

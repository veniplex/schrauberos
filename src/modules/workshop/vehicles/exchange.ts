import { parseArchiveFilter } from "@/lib/archive-filter";
import { monthOf } from "@/lib/month";
import { normalizePlate } from "@/lib/plate";
import { findCustomerIdsByNumber, numberKey } from "@/modules/workshop/customers/public";
import type { AppSession } from "@/server/auth/session";
import { columnSpecs } from "@/server/csv/columns";
import { defineImport } from "@/server/csv/define-import";
import { formatDay, parseDay } from "@/server/csv/format";
import type { RowCheck } from "@/server/csv/import";
import { pageArgs, paged } from "@/server/csv/paging";
import { enumParser, zodRowMessages } from "@/server/csv/row";
import type { ExportDef } from "@/server/csv/types";
import { intCell } from "@/server/csv/writer";
import { db } from "@/server/db";
import { EXTRA_INSPECTION_KINDS, FUEL_TYPES } from "./domain";
import { VEHICLE_COLUMNS } from "./exchange-columns";
import { vehicleInput, vehicleRecord, type VehicleFields } from "./operations";
import { vehicleListWhere } from "./queries";

/** Der Halter (Kundennummer) steht nur in der Datei, wenn die Person Kunden sehen darf (Richtlinie D7: Kundendaten gehören zu `customers.view`). */
const mayUseOwner = (session: AppSession) => session.features.has("workshop.customers") && session.can("customers.view");
const columnsFor = (session: AppSession) => (mayUseOwner(session) ? VEHICLE_COLUMNS : VEHICLE_COLUMNS.filter((c) => c.key !== "customerNumber"));

/**
 * Export der Fahrzeuge (`vehicles.export` und `vehicles.view`). Auswahl wie die Fahrzeugliste: Suche `q`, `inspection=soon|none`, `month=JJJJ-MM`, `owner=none`, `archived=1|all` (Archiv; Standard nur aktive Fahrzeuge, wie die Adresse der Liste) – der Knopf „Exportieren“
 * der Liste reicht die gewählten Filter durch. Kunden erscheinen nur als Kundennummer und nur mit `customers.view`.
 */
export const vehiclesExport: ExportDef = {
  id: "vehicles",
  feature: "workshop.vehicles",
  permission: "vehicles.export",
  also: ["vehicles.view"],
  audit: "vehicle.export",
  filename: () => `fahrzeuge-${formatDay(new Date())}.csv`,
  open: async ({ session, query, t }) => {
    const inspection = query.get("inspection");
    const month = query.get("month");
    const where = vehicleListWhere(
      {
        q: (query.get("q") ?? "").trim().slice(0, 60),
        noOwnerOnly: query.get("owner") === "none",
        inspection: inspection === "soon" || inspection === "none" ? inspection : undefined,
        month: month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : undefined,
        archived: parseArchiveFilter(query.get("archived")),
      },
      session.can,
      monthOf(new Date()),
    );
    const withOwner = mayUseOwner(session);
    const fuel = (code: string | null) => (code ? t(`vehicles.fuelTypes.${code as (typeof FUEL_TYPES)[number]}`) : null);
    const kind = (code: string | null) => (code ? t(`vehicles.extraKinds.${code as (typeof EXTRA_INSPECTION_KINDS)[number]}`) : null);
    async function* rows() {
      for await (const v of paged((page) =>
        db.vehicle.findMany({ ...pageArgs(page), where, orderBy: [{ plateNorm: "asc" }, { id: "asc" }], include: { customer: { select: { customerNumber: true } } } }),
      )) {
        yield [
          v.plate,
          v.make,
          v.model,
          v.vin,
          intCell(v.year),
          intCell(v.mileageKm),
          fuel(v.fuel),
          v.hsn,
          v.tsn,
          v.firstRegistration ? formatDay(v.firstRegistration) : null,
          v.inspectionDue,
          kind(v.extraInspectionKind),
          v.extraInspectionDue ? formatDay(v.extraInspectionDue) : null,
          v.notes,
          ...(withOwner ? [v.customer?.customerNumber ?? null] : []),
        ];
      }
    }
    return { columns: columnsFor(session), count: await db.vehicle.count({ where }), target: "", rows: rows() };
  },
};

const fuelOf = enumParser(FUEL_TYPES, (code) => `vehicles.fuelTypes.${code}`);
const kindOf = enumParser(EXTRA_INSPECTION_KINDS, (code) => `vehicles.extraKinds.${code}`);

/** Eine Zeile des Imports: die geprüfte Eingabe des Fahrzeugformulars, die Kundennummer des Halters und (nach der Prüfung gegen die Datenbank) dessen Kennung. */
type VehicleRow = { fields: VehicleFields; customerNumber?: string; customerId?: string };

/** Wie die Operation `vehicles.save`: dieselbe Prüfung der Felder (`vehicleInput`) – hier mit den Datumsformaten und Auswahlwerten, wie sie in Dateien vorkommen. */
function parseVehicle(values: Record<string, string>) {
  const { customerNumber, ...rest } = values;
  const input: Record<string, string> = { ...rest };
  for (const key of ["firstRegistration", "extraInspectionDue"] as const) if (input[key]) input[key] = parseDay(input[key]) ?? input[key];
  // Excel macht aus „2026-11“ gern ein Datum: auch ein vollständiges Datum ergibt den Monat
  if (input.inspectionDue) {
    const day = parseDay(input.inspectionDue);
    if (day) input.inspectionDue = day.slice(0, 7);
  }
  if (input.fuel) input.fuel = fuelOf(input.fuel) ?? input.fuel;
  if (input.extraInspectionKind) input.extraInspectionKind = kindOf(input.extraInspectionKind) ?? input.extraInspectionKind;
  const parsed = vehicleInput.safeParse(input);
  if (!parsed.success) return { ok: false as const, messages: zodRowMessages(parsed.error) };
  const d = parsed.data;
  if (normalizePlate(d.plate).length < 2) return { ok: false as const, messages: [{ key: "validation.invalid" as const, column: "plate" }] };
  if (!!d.extraInspectionKind !== !!d.extraInspectionDue) {
    return { ok: false as const, messages: [{ key: "validation.required" as const, column: d.extraInspectionKind ? "extraInspectionDue" : "extraInspectionKind" }] };
  }
  const data: VehicleRow = { fields: d, customerNumber };
  return { ok: true as const, data };
}

export const vehiclesImport = defineImport<VehicleRow>({
  id: "vehicles",
  feature: "workshop.vehicles",
  permission: "vehicles.import",
  operationName: "vehicles.import",
  audit: "vehicle.import",
  duplicateOverride: true,
  columns: (session) => columnSpecs(columnsFor(session)),
  parse: parseVehicle,
  label: (row) => row.fields.plate,
  fileKeys: (row) => [`p:${normalizePlate(row.fields.plate)}`],
  check: async (tx, rows) => {
    const result = new Map<number, RowCheck>();
    // Halter über die Kundennummer (nur wenn die Spalte da ist; ohne das Recht, Kunden zu sehen, gibt es sie nicht)
    const owners = await findCustomerIdsByNumber(tx, rows.flatMap((r) => (r.data.customerNumber ? [r.data.customerNumber] : [])));
    for (const { index, data } of rows) {
      if (!data.customerNumber) continue;
      const found = owners.get(numberKey(data.customerNumber)) ?? [];
      if (found.length === 1) data.customerId = found[0];
      else result.set(index, { kind: "error", message: { column: "customerNumber", key: found.length === 0 ? "exchange.row.notFound" : "exchange.row.ambiguous" } });
    }
    // Kennzeichen, die es schon gibt: Warnung (wie in der Oberfläche), kein Fehler
    const byPlate = new Map<string, string>();
    const plates = [...new Set(rows.map((r) => normalizePlate(r.data.fields.plate)))];
    for (let i = 0; i < plates.length; i += 500) {
      for (const v of await tx.vehicle.findMany({ where: { plateNorm: { in: plates.slice(i, i + 500) } }, select: { plateNorm: true, plate: true } })) byPlate.set(v.plateNorm, v.plate);
    }
    for (const { index, data } of rows) {
      const existing = byPlate.get(normalizePlate(data.fields.plate));
      if (existing && !result.has(index)) result.set(index, { kind: "duplicate", message: { key: "vehicles.exchange.duplicate", params: { plate: existing } } });
    }
    return result;
  },
  create: async (tx, rows) => {
    for (const row of rows) {
      await tx.vehicle.create({
        data: { ...vehicleRecord(row.fields), customerId: row.customerId ?? null, ownerships: row.customerId ? { create: [{ customerId: row.customerId }] } : undefined },
      });
    }
  },
});

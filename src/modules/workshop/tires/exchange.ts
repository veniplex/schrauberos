import { normalizePlate } from "@/lib/plate";
import { columnSpecs } from "@/server/csv/columns";
import { defineImport } from "@/server/csv/define-import";
import { formatDay, parseDay } from "@/server/csv/format";
import type { RowCheck, RowMessage } from "@/server/csv/import";
import { pageArgs, paged } from "@/server/csv/paging";
import { enumParser, zodRowMessages } from "@/server/csv/row";
import type { ExportDef } from "@/server/csv/types";
import { decimalCell, intCell } from "@/server/csv/writer";
import { db } from "@/server/db";
import { RIM_TYPES, TIRE_CONDITIONS, TIRE_POSITIONS, TIRE_SEASONS, TIRE_SET_STATUSES, type TirePosition } from "./constants";
import { parseTireRows, type RawTireRow } from "./domain";
import { positionKey, TIRE_COLUMNS } from "./exchange-columns";
import { tireSetInput, tireSetRecord, type TireSetInput } from "./operations";

/**
 * Export der Reifensätze (`tires.export` und `tires.view`): eine Zeile je Satz mit Kennzeichen des Fahrzeugs, Größe, Lagerort und je Position DOT, Profiltiefe und Zustand.
 * Auswahl: `status=stored|mounted|disposed` (sonst alle). Es stehen keine Kundendaten in der Datei.
 */
export const tiresExport: ExportDef = {
  id: "tires",
  feature: "workshop.tires",
  permission: "tires.export",
  also: ["tires.view"],
  audit: "tire.export",
  filename: () => `reifen-${formatDay(new Date())}.csv`,
  open: async ({ query, format, t }) => {
    const status = query.get("status");
    const where = (TIRE_SET_STATUSES as readonly string[]).includes(status ?? "") ? { status: status as string } : {};
    const season = (code: string) => t(`enums.season.${code as (typeof TIRE_SEASONS)[number]}`);
    const setStatus = (code: string) => t(`enums.tireSetStatus.${code as (typeof TIRE_SET_STATUSES)[number]}`);
    const rim = (code: string) => t(`enums.rimType.${code as (typeof RIM_TYPES)[number]}`);
    const condition = (code: string) => t(`enums.condition.${code as (typeof TIRE_CONDITIONS)[number]}`);
    async function* rows() {
      for await (const set of paged((page) => db.tireSet.findMany({ ...pageArgs(page), where, orderBy: [{ vehicle: { plateNorm: "asc" } }, { id: "asc" }], include: { vehicle: { select: { plate: true } }, tires: true } }))) {
        const byPosition = new Map(set.tires.map((x) => [x.position, x]));
        yield [
          set.vehicle.plate,
          season(set.season),
          setStatus(set.status),
          set.brand,
          set.model,
          intCell(set.width),
          intCell(set.aspect),
          intCell(set.rim),
          set.loadIndex,
          set.speedIndex,
          rim(set.rimType),
          set.storageLocation,
          formatDay(set.storedAt),
          set.notes,
          ...TIRE_POSITIONS.flatMap((position) => {
            const tire = byPosition.get(position);
            return tire ? [tire.dot, decimalCell(tire.treadDepthMm, format), condition(tire.condition)] : [null, null, null];
          }),
        ];
      }
    }
    return { columns: TIRE_COLUMNS, count: await db.tireSet.count({ where }), target: status ?? "", rows: rows() };
  },
};

const seasonOf = enumParser(TIRE_SEASONS, (code) => `enums.season.${code}`);
const statusOf = enumParser(TIRE_SET_STATUSES, (code) => `enums.tireSetStatus.${code}`);
const rimOf = enumParser(RIM_TYPES, (code) => `enums.rimType.${code}`);
const conditionOf = enumParser(TIRE_CONDITIONS, (code) => `enums.condition.${code}`);

/** Eine Zeile des Imports: die geprüfte Eingabe des Reifenformulars, das Kennzeichen und (nach der Prüfung gegen die Datenbank) die Kennung des Fahrzeugs. */
type TireRow = { input: TireSetInput; plate: string; vehicleId?: string };

const keyOf = (row: TireRow, plateNorm: string) => {
  const d = row.input;
  return `t:${plateNorm}|${d.season}|${(d.brand ?? "").toLowerCase()}|${(d.model ?? "").toLowerCase()}|${d.width ?? ""}|${d.aspect ?? ""}|${d.rim ?? ""}`;
};

/** Zeile → Eingabe des Reifenformulars (`tireSetInput`): Auswahlwerte und Datum werden in die Form der Operation gebracht, die Prüfung selbst ist dieselbe. */
function parseTire(values: Record<string, string>) {
  const { plate, ...rest } = values;
  if (!plate) return { ok: false as const, messages: [{ key: "validation.required" as const, column: "plate" }] };
  const messages: RowMessage[] = [];
  const input: Record<string, unknown> = { vehicleId: "-", spare: false, tires: {} };
  for (const key of ["season", "brand", "model", "width", "aspect", "rim", "loadIndex", "speedIndex", "storageLocation", "notes"] as const) if (rest[key]) input[key] = rest[key];
  if (rest.season) input.season = seasonOf(rest.season) ?? rest.season;
  if (rest.status) input.status = statusOf(rest.status) ?? rest.status;
  if (rest.rimType) input.rimType = rimOf(rest.rimType) ?? rest.rimType;
  if (rest.storedAt) input.storedAt = parseDay(rest.storedAt) ?? rest.storedAt;
  const tires: Partial<Record<TirePosition, RawTireRow>> = {};
  for (const position of TIRE_POSITIONS) {
    // Excel verschluckt führende Nullen („0121“ → 121): ein dreistelliges DOT-Kürzel wird wieder aufgefüllt
    const dotRaw = rest[positionKey("dot", position)];
    const dot = dotRaw && /^\d{3}$/.test(dotRaw) ? `0${dotRaw}` : dotRaw;
    const tread = rest[positionKey("tread", position)];
    const conditionRaw = rest[positionKey("condition", position)];
    const condition = conditionRaw ? conditionOf(conditionRaw) : undefined;
    if (conditionRaw && !condition) messages.push({ column: positionKey("condition", position), key: "validation.invalid" });
    if (dot || tread || conditionRaw) tires[position] = { dot, tread, condition };
  }
  input.tires = tires;
  input.spare = !!tires.SPARE;
  const parsed = tireSetInput.safeParse(input);
  if (!parsed.success) {
    for (const m of zodRowMessages(parsed.error)) {
      // Fehler je Reifenfeld heißen in der Operation `tire.<POS>.dot|tread` – in der Datei sind das die Spalten `dotFL` …
      const match = /^tire\.([A-Z]+)\.(dot|tread)$/.exec(m.column ?? "");
      messages.push(match ? { ...m, column: positionKey(match[2] as "dot" | "tread", match[1] as TirePosition) } : m);
    }
  }
  if (messages.length > 0 || !parsed.success) return { ok: false as const, messages };
  const data: TireRow = { input: parsed.data, plate };
  return { ok: true as const, data };
}

export const tiresImport = defineImport<TireRow>({
  id: "tires",
  feature: "workshop.tires",
  permission: "tires.import",
  operationName: "tires.import",
  audit: "tire.import",
  duplicateOverride: true,
  columns: () => columnSpecs(TIRE_COLUMNS),
  parse: parseTire,
  label: (row) => `${row.plate} · ${row.input.season}`,
  fileKeys: (row) => [keyOf(row, normalizePlate(row.plate))],
  check: async (tx, rows) => {
    const result = new Map<number, RowCheck>();
    // Fahrzeug über das Kennzeichen: genau eines muss passen
    const plates = [...new Set(rows.map((r) => normalizePlate(r.data.plate)))];
    const byPlate = new Map<string, string[]>();
    for (let i = 0; i < plates.length; i += 500) {
      for (const v of await tx.vehicle.findMany({ where: { plateNorm: { in: plates.slice(i, i + 500) } }, select: { id: true, plateNorm: true } })) byPlate.set(v.plateNorm, [...(byPlate.get(v.plateNorm) ?? []), v.id]);
    }
    for (const { index, data } of rows) {
      const found = byPlate.get(normalizePlate(data.plate)) ?? [];
      if (found.length === 1) data.vehicleId = found[0];
      else result.set(index, { kind: "error", message: { column: "plate", key: found.length === 0 ? "exchange.row.notFound" : "exchange.row.ambiguous" } });
    }
    // Ein Satz gleicher Art am selben Fahrzeug (noch nicht entsorgt) gilt als Dublette
    const vehicleIds = [...new Set(rows.flatMap((r) => (r.data.vehicleId ? [r.data.vehicleId] : [])))];
    const existing = new Set<string>();
    for (let i = 0; i < vehicleIds.length; i += 500) {
      const sets = await tx.tireSet.findMany({ where: { vehicleId: { in: vehicleIds.slice(i, i + 500) }, status: { not: "disposed" } }, select: { vehicleId: true, season: true, brand: true, model: true, width: true, aspect: true, rim: true } });
      for (const s of sets) existing.add(`${s.vehicleId}|${s.season}|${(s.brand ?? "").toLowerCase()}|${(s.model ?? "").toLowerCase()}|${s.width ?? ""}|${s.aspect ?? ""}|${s.rim ?? ""}`);
    }
    for (const { index, data } of rows) {
      if (result.has(index) || !data.vehicleId) continue;
      const d = data.input;
      if (existing.has(`${data.vehicleId}|${d.season}|${(d.brand ?? "").toLowerCase()}|${(d.model ?? "").toLowerCase()}|${d.width ?? ""}|${d.aspect ?? ""}|${d.rim ?? ""}`)) {
        result.set(index, { kind: "duplicate", message: { key: "tires.exchange.duplicate", params: { plate: data.plate } } });
      }
    }
    return result;
  },
  create: async (tx, rows) => {
    for (const row of rows) {
      const { tires } = parseTireRows(row.input.tires as Partial<Record<TirePosition, RawTireRow>>, row.input.spare);
      await tx.tireSet.create({ data: { ...tireSetRecord(row.input, row.vehicleId!), tires: { create: tires } } });
    }
  },
});

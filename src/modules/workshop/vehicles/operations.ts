import { noon } from "@/lib/dates";
import { startOfDay } from "@/lib/zone";
import { followVehicleOwner } from "@/modules/workshop/appointments/public";
import { z } from "zod";
import { dateText } from "@/lib/zod-fields";
import { claimRow } from "@/lib/concurrency";
import { formatPlate, normalizePlate } from "@/lib/plate";
import { searchKey } from "@/lib/search-key";
import { customerDisplayName, customerNameSelect } from "@/modules/workshop/customers/public";
import { parseMonthInput } from "@/lib/month";
import { defineOperation, fail, failField, failFields } from "@/server/operations";
import { EXTRA_INSPECTION_KINDS, FUEL_TYPES, HSN_PATTERN, TSN_PATTERN, normalizeKey, parseMileage } from "./domain";

/** Häkchen und Knopf des Formulars („1“, „on“) und Wahrheitswerte der API; fehlt der Wert, gilt `false`. */
const flag = z.preprocess((v) => v === true || v === "1" || v === "on" || v === "true", z.boolean());

/** Eingabe eines Fahrzeugs – auch die Prüfung der Zeilen des CSV-Imports (`exchange.ts`). */
export const vehicleInput = z.object({
  id: z.string().optional(),
  version: z.string().optional(),
  // nur beim Anlegen: Halter (optional). Spätere Wechsel laufen über den Halterwechsel.
  customerId: z.string().optional(),
  plate: z.string().min(2).max(14),
  make: z.string().max(60).optional(),
  model: z.string().max(60).optional(),
  vin: z
    .string()
    .transform((v) => v.toUpperCase().replace(/\s/g, ""))
    .pipe(z.string().regex(/^[A-HJ-NPR-Z0-9]{17}$/, { error: "validation.vin" }))
    .optional(),
  year: z.coerce.number().int().min(1950).max(2100).optional(),
  /** zuletzt bekannter Kilometerstand; Tausenderpunkte und Leerzeichen sind erlaubt */
  mileageKm: z
    .union([z.number(), z.string()])
    .transform((v) => (typeof v === "number" ? (Number.isInteger(v) && v >= 0 && v <= 9_999_999 ? v : null) : parseMileage(v)))
    .pipe(z.number({ error: "vehicles.errors.mileage" }))
    .optional(),
  fuel: z.enum(FUEL_TYPES).optional(),
  hsn: z.string().transform(normalizeKey).pipe(z.string().regex(HSN_PATTERN, { error: "vehicles.errors.hsn" })).optional(),
  tsn: z.string().transform(normalizeKey).pipe(z.string().regex(TSN_PATTERN, { error: "vehicles.errors.tsn" })).optional(),
  firstRegistration: dateText().optional(),
  /** Hauptuntersuchung/Prüfung fällig: Monat – „2026-11“, „11/2026“ oder „11.2026“ */
  inspectionDue: z
    .string()
    .transform((v) => parseMonthInput(v))
    .pipe(z.string({ error: "vehicles.errors.month" }))
    .optional(),
  /** weitere Prüfung (Sicherheitsprüfung, Gasanlage …): Art und Datum gehören zusammen */
  extraInspectionKind: z.enum(EXTRA_INSPECTION_KINDS).optional(),
  extraInspectionDue: dateText().optional(),
  notes: z.string().max(2000).optional(),
  /** Das Kennzeichen gibt es schon, und das ist gewollt (Bestätigung nach der Warnung) */
  allowDuplicate: flag.optional(),
});

export type VehicleFields = z.output<typeof vehicleInput>;

/** Die Felder der Tabelle zu einer geprüften Eingabe (Anlegen, Ändern und CSV-Import gleich); ohne Halter und Herkunft. */
export function vehicleRecord(d: Pick<VehicleFields, "plate" | "make" | "model" | "vin" | "year" | "mileageKm" | "fuel" | "hsn" | "tsn" | "firstRegistration" | "inspectionDue" | "extraInspectionKind" | "extraInspectionDue" | "notes">) {
  return {
    plate: formatPlate(d.plate),
    searchKey: searchKey(d.make, d.model, d.vin),
    plateNorm: normalizePlate(d.plate),
    make: d.make ?? null,
    model: d.model ?? null,
    vin: d.vin ?? null,
    year: d.year ?? null,
    mileageKm: d.mileageKm ?? null,
    fuel: d.fuel ?? null,
    hsn: d.hsn ?? null,
    tsn: d.tsn ?? null,
    firstRegistration: d.firstRegistration ? noon(d.firstRegistration) : null,
    inspectionDue: d.inspectionDue ?? null,
    extraInspectionKind: d.extraInspectionKind ?? null,
    extraInspectionDue: d.extraInspectionDue ? noon(d.extraInspectionDue) : null,
    notes: d.notes ?? null,
  };
}

export const saveVehicleOperation = defineOperation({
  name: "vehicles.save",
  permission: "vehicles.edit",
  input: vehicleInput,
  audit: (input) => (input.id ? "vehicle.update" : "vehicle.create"),
  run: async ({ input: { id, version, customerId, plate, ...d }, tx, audit }) => {
    const plateNorm = normalizePlate(plate);
    if (plateNorm.length < 2) failField("plate", "validation.invalid");

    if (!!d.extraInspectionKind !== !!d.extraInspectionDue) failField(d.extraInspectionKind ? "extraInspectionDue" : "extraInspectionKind", "validation.required");

    // Ein Kennzeichen kann mehrfach vorkommen (Halterwechsel, wiederverwendete Kennzeichen, Altfahrzeug noch erfasst): Das ist eine **Warnung mit Bestätigung**, keine Sperre.
    // Die Antwort nennt das vorhandene Fahrzeug (Kennung, Kennzeichen, Halter), damit das Formular „Vorhandenes Fahrzeug öffnen“ und „Trotzdem anlegen“ anbieten kann.
    const duplicate = await tx.vehicle.findFirst({ where: { plateNorm, ...(id ? { id: { not: id } } : {}) }, include: { customer: { select: customerNameSelect } }, orderBy: { createdAt: "asc" } });
    if (duplicate && !d.allowDuplicate) {
      const owner = duplicate.customer ? customerDisplayName(duplicate.customer) : "";
      failFields(
        { plate: duplicate.customer ? { key: "vehicles.errors.plateExists", params: { customer: owner } } : { key: "vehicles.errors.plateExistsNoOwner" } },
        { duplicateId: duplicate.id, duplicatePlate: duplicate.plate, duplicateOwner: owner },
      );
    }

    if (customerId && !(await tx.customer.findUnique({ where: { id: customerId }, select: { id: true } }))) failField("customerId", "validation.invalid");

    const data = vehicleRecord({ plate, ...d });

    let savedId: string;
    if (id) {
      if (!(await claimRow(tx.vehicle, id, version))) fail("conflict");
      await tx.vehicle.update({ where: { id }, data });
      savedId = id;
    } else {
      const created = await tx.vehicle.create({
        data: {
          ...data,
          customerId: customerId ?? null,
          ownerships: customerId ? { create: [{ customerId }] } : undefined,
        },
      });
      savedId = created.id;
    }
    audit({ target: duplicate ? `${data.plate} (Dublette bestätigt)` : data.plate, entityId: savedId });
    return { id: savedId };
  },
});

const transferInput = z.object({
  vehicleId: z.string(),
  newCustomerId: z.string().optional(),
  date: dateText(),
  note: z.string().max(300).optional(),
});

/** Halterwechsel: aktuellen Halter-Eintrag beenden, neuen anlegen (oder Fahrzeug ohne Halter lassen). */
export const transferVehicleOperation = defineOperation({
  name: "vehicles.transfer",
  permission: "vehicles.edit",
  input: transferInput,
  audit: "vehicle.transfer",
  run: async ({ input: d, principal, tx, audit }) => {
    const vehicle = await tx.vehicle.findUnique({ where: { id: d.vehicleId } });
    if (!vehicle) fail("notFound");
    const newId = d.newCustomerId ?? null;
    if (newId === vehicle.customerId) failField("newCustomerId", "vehicles.errors.sameOwner");
    if (newId && !(await tx.customer.findUnique({ where: { id: newId }, select: { id: true } }))) failField("newCustomerId", "validation.invalid");

    const when = noon(d.date);
    await tx.vehicleOwnership.updateMany({ where: { vehicleId: vehicle.id, toDate: null }, data: { toDate: when } });
    if (newId) await tx.vehicleOwnership.create({ data: { vehicleId: vehicle.id, customerId: newId, fromDate: when, note: d.note ?? null } });
    await tx.vehicle.update({ where: { id: vehicle.id }, data: { customerId: newId } });
    // Offene Termine des Fahrzeugs (noch nicht vorbei, ab dem Wechseltag) ziehen mit: weiche Abhängigkeit, nur bei aktiver Terminfunktion – in derselben Transaktion
    const now = new Date();
    const changeDay = startOfDay(d.date);
    const followed = principal.features.has("workshop.appointments") ? await followVehicleOwner(tx, vehicle.id, newId, changeDay > now ? changeDay : now) : 0;
    audit({ target: followed > 0 ? `${vehicle.plate} (${followed} Termine auf den neuen Halter umgestellt)` : vehicle.plate, entityId: vehicle.id });
    return { id: vehicle.id, appointments: followed };
  },
});

export const deleteVehicleOperation = defineOperation({
  name: "vehicles.delete",
  permission: "vehicles.delete",
  input: z.object({ id: z.string().min(1) }),
  audit: "vehicle.delete",
  run: async ({ input, tx, audit }) => {
    const vehicle = await tx.vehicle.findUnique({ where: { id: input.id }, select: { plate: true } });
    if (!vehicle) fail("notFound");
    await tx.vehicle.delete({ where: { id: input.id } });
    audit({ target: vehicle.plate, entityId: input.id });
    return { id: input.id };
  },
});


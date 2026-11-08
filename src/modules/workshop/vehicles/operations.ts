import { noon } from "@/lib/dates";
import { startOfDay } from "@/lib/zone";
import { followVehicleOwner } from "@/modules/workshop/appointments/public";
import { z } from "zod";
import { dateText } from "@/lib/zod-fields";
import { claimRow } from "@/lib/concurrency";
import { formatPlate, normalizePlate } from "@/lib/plate";
import { searchKey } from "@/lib/search-key";
import { customerDisplayName, customerNameSelect, isRestricted, restrictionSelect, unrestrictedByCustomer, unrestrictedCustomerWhere } from "@/modules/workshop/customers/public";
import { parseMonthInput } from "@/lib/month";
import { writeAudit } from "@/server/audit";
import { auditActorName, defineOperation, fail, failField, failFields } from "@/server/operations";
import { EXTRA_INSPECTION_KINDS, FUEL_TYPES, HSN_PATTERN, TSN_PATTERN, normalizeKey, ownershipTransfers, parseMileage, vehicleDeletable } from "./domain";

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
  /** Das Kennzeichen gibt es schon, das vorhandene (alte) Fahrzeug soll archiviert werden: dritter Weg der Dublettenwarnung (P4b-2) */
  archiveDuplicate: flag.optional(),
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
  run: async ({ input: { id, version, customerId, plate, ...d }, principal, tx, audit }) => {
    const plateNorm = normalizePlate(plate);
    if (plateNorm.length < 2) failField("plate", "validation.invalid");

    if (!!d.extraInspectionKind !== !!d.extraInspectionDue) failField(d.extraInspectionKind ? "extraInspectionDue" : "extraInspectionKind", "validation.required");

    // Ein Kennzeichen kann mehrfach vorkommen (Halterwechsel, wiederverwendete Kennzeichen, Altfahrzeug noch erfasst): Das ist eine **Warnung mit Bestätigung**, keine Sperre.
    // Die Antwort nennt das vorhandene Fahrzeug (Kennung, Kennzeichen, Halter), damit das Formular „Vorhandenes Fahrzeug öffnen“, „Trotzdem anlegen“ und „Altfahrzeug archivieren“ anbieten kann.
    // Archivierte Fahrzeuge zählen nicht (sie sind außer Dienst; so wird ein Kennzeichen frei, wenn das Altfahrzeug archiviert ist).
    const duplicate = await tx.vehicle.findFirst({
      where: { plateNorm, archivedAt: null, ...(id ? { id: { not: id } } : {}) },
      select: { id: true, plate: true, customerId: true, customer: { select: restrictionSelect } },
      orderBy: { createdAt: "asc" },
    });
    // Was die Warnung über das vorhandene Fahrzeug verraten darf (Art. 18 DSGVO, Datensparsamkeit): Kennung und Kennzeichen nur, wenn die Person Fahrzeuge sehen darf **und** der Halter nicht eingeschränkt verarbeitet
    // wird; der Name des Halters zusätzlich nur mit `customers.view`. Sonst nur „es gibt schon eines“ – ohne Namen, Kennung oder Halter. Ein solches Fahrzeug wird auch nie als „Altfahrzeug“ archiviert.
    const duplicateVisible = Boolean(duplicate && !isRestricted(duplicate.customer) && principal.can("vehicles.view"));
    if (duplicate && ((!d.allowDuplicate && !d.archiveDuplicate) || (d.archiveDuplicate && !duplicateVisible))) {
      if (!duplicateVisible) failFields({ plate: { key: "vehicles.errors.plateExistsHidden" } }, {});
      const holder = duplicate.customerId && principal.can("customers.view") ? await tx.customer.findUnique({ where: { id: duplicate.customerId }, select: customerNameSelect }) : null;
      const owner = holder ? customerDisplayName(holder) : "";
      failFields(
        { plate: holder ? { key: "vehicles.errors.plateExists", params: { customer: owner } } : duplicate.customerId ? { key: "vehicles.errors.plateExistsHidden" } : { key: "vehicles.errors.plateExistsNoOwner" } },
        { duplicateId: duplicate.id, duplicatePlate: duplicate.plate, duplicateOwner: owner },
      );
    }

    // Ein Kunde mit eingeschränkter Verarbeitung (Art. 18 DSGVO) lässt sich nicht neu verknüpfen; das Fahrzeug, das er schon hält, bleibt bearbeitbar
    if (customerId && !(await tx.customer.findFirst({ where: { id: customerId, OR: [unrestrictedCustomerWhere, ...(id ? [{ vehicles: { some: { id } } }] : [])] }, select: { id: true } }))) failField("customerId", "validation.invalid");

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
    // Dritter Weg der Warnung: das Altfahrzeug (alle nicht archivierten mit diesem Kennzeichen) wird in derselben Transaktion archiviert, mit eigenem Audit-Eintrag je Fahrzeug
    let archivedOld = 0;
    if (duplicate && d.archiveDuplicate && duplicateVisible) {
      const old = await tx.vehicle.findMany({ where: { plateNorm, archivedAt: null, id: { not: savedId }, ...unrestrictedByCustomer }, select: { id: true, plate: true } });
      await tx.vehicle.updateMany({ where: { id: { in: old.map((v) => v.id) } }, data: { archivedAt: new Date() } });
      for (const v of old) await writeAudit(tx, "vehicle.archive", { target: `${v.plate} (Altfahrzeug beim Speichern von ${data.plate})`, entityId: v.id, actor: { id: principal.user.id, name: auditActorName(principal) } });
      archivedOld = old.length;
    }
    audit({ target: duplicate ? `${data.plate} (${archivedOld > 0 ? "Altfahrzeug archiviert" : "Dublette bestätigt"})` : data.plate, entityId: savedId });
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
    if (newId && !(await tx.customer.findFirst({ where: { id: newId, ...unrestrictedCustomerWhere }, select: { id: true } }))) failField("newCustomerId", "validation.invalid");

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

/**
 * Archivieren (P4b-2): Das Fahrzeug bleibt mit Halter-Historie, Reifensätzen und Terminen erhalten, verschwindet aber aus Auswahlfeldern, Suche, Neu-Formularen, der
 * Dublettenwarnung und dem Baustein „Prüffrist“; die Fahrzeugliste zeigt es im Filter „Archiviert“.
 */
export const archiveVehicleOperation = defineOperation({
  name: "vehicles.archive",
  permission: "vehicles.edit",
  input: z.object({ id: z.string().min(1) }),
  audit: "vehicle.archive",
  run: async ({ input, tx, audit }) => {
    const vehicle = await tx.vehicle.findUnique({ where: { id: input.id }, select: { plate: true, archivedAt: true } });
    if (!vehicle) fail("notFound");
    if (vehicle.archivedAt) fail("conflict", "archive.errors.alreadyArchived");
    await tx.vehicle.update({ where: { id: input.id }, data: { archivedAt: new Date() } });
    audit({ target: vehicle.plate, entityId: input.id });
    return { id: input.id };
  },
});

export const unarchiveVehicleOperation = defineOperation({
  name: "vehicles.unarchive",
  permission: "vehicles.edit",
  input: z.object({ id: z.string().min(1) }),
  audit: "vehicle.unarchive",
  run: async ({ input, tx, audit }) => {
    const vehicle = await tx.vehicle.findUnique({ where: { id: input.id }, select: { plate: true, archivedAt: true } });
    if (!vehicle) fail("notFound");
    if (!vehicle.archivedAt) fail("conflict", "archive.errors.notArchived");
    await tx.vehicle.update({ where: { id: input.id }, data: { archivedAt: null } });
    audit({ target: vehicle.plate, entityId: input.id });
    return { id: input.id };
  },
});

/**
 * Löschen nur ohne Geschichte: Ein Fahrzeug mit Terminen, Reifensätzen oder Halterwechseln wird **archiviert statt gelöscht** (409 mit Zählung). Ein versehentlich angelegtes Fahrzeug
 * (nur der erste Halter-Eintrag, nichts sonst) ist löschbar; sein Halter-Eintrag fällt dabei mit weg – die Halter-Historie hängt nie stillschweigend am Löschen (Schema: Restrict).
 */
export const deleteVehicleOperation = defineOperation({
  name: "vehicles.delete",
  permission: "vehicles.delete",
  input: z.object({ id: z.string().min(1) }),
  audit: "vehicle.delete",
  run: async ({ input, tx, audit }) => {
    const vehicle = await tx.vehicle.findUnique({
      where: { id: input.id },
      select: { plate: true, ownerships: { select: { id: true, toDate: true } }, _count: { select: { appointments: true, tireSets: true, orders: true, files: true, checklists: true, invoices: true } } },
    });
    if (!vehicle) fail("notFound");
    const transfers = ownershipTransfers(vehicle.ownerships);
    if (!vehicleDeletable({ appointments: vehicle._count.appointments, tireSets: vehicle._count.tireSets, orders: vehicle._count.orders, transfers, files: vehicle._count.files, checklists: vehicle._count.checklists, invoices: vehicle._count.invoices })) {
      fail("inUse", "vehicles.errors.inUse", { appointments: vehicle._count.appointments, tireSets: vehicle._count.tireSets, orders: vehicle._count.orders, transfers, files: vehicle._count.files, checklists: vehicle._count.checklists, invoices: vehicle._count.invoices });
    }
    await tx.vehicleOwnership.deleteMany({ where: { vehicleId: input.id } });
    await tx.vehicle.delete({ where: { id: input.id } });
    audit({ target: vehicle.plate, entityId: input.id });
    return { id: input.id };
  },
});


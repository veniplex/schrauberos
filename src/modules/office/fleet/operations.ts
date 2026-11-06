import { z } from "zod";
import { claimRow } from "@/lib/concurrency";
import { dateText, moneyCents } from "@/lib/zod-fields";
import { formatPlate } from "@/lib/plate";
import { COST_CATEGORIES, FLEET_STATUSES, FUEL_TYPES, nextLicenseCheck } from "@/modules/office/fleet/domain";
import { defineOperation, fail, failField } from "@/server/operations";
import type { Tx } from "@/server/operations";

const dateOpt = dateText().optional();
const dateReq = dateText();
const noon = (d: string) => new Date(`${d}T12:00:00`);

/** Das Dienstfahrzeug laden (Verweise aus dem Formular nie ungeprüft verwenden); sonst Feldfehler. */
async function requireFleetVehicle(tx: Tx, id: string, field: string): Promise<{ id: string; plate: string }> {
  const car = await tx.fleetVehicle.findUnique({ where: { id }, select: { id: true, plate: true } });
  if (!car) failField(field, "validation.invalid");
  return car;
}

/* ───────────── Fahrzeug ───────────── */

const vehicleInput = z.object({
  id: z.string().optional(),
  version: z.string().optional(),
  plate: z.string().min(2).max(14),
  make: z.string().max(60).optional(),
  model: z.string().max(60).optional(),
  vin: z
    .string()
    .transform((v) => v.toUpperCase().replace(/\s/g, ""))
    .pipe(z.string().regex(/^[A-HJ-NPR-Z0-9]{17}$/))
    .optional(),
  year: z.coerce.number().int().min(1950).max(2100).optional(),
  fuelType: z.enum(FUEL_TYPES).optional(),
  color: z.string().max(30).optional(),
  status: z.enum(FLEET_STATUSES).default("active"),
  driverId: z.string().optional(),
  location: z.string().max(80).optional(),
  huDue: dateOpt,
  serviceDue: dateOpt,
  serviceDueKm: z.coerce.number().int().min(0).max(2_000_000).optional(),
  insuranceCompany: z.string().max(80).optional(),
  insurancePolicy: z.string().max(60).optional(),
  insuranceUntil: dateOpt,
  leasingProvider: z.string().max(80).optional(),
  leasingUntil: dateOpt,
  leasingRate: moneyCents("fleet.errors.amount").pipe(z.number().refine((cents) => cents >= 0, { error: "fleet.errors.amount" })).optional(),
  fuelCardNo: z.string().max(40).optional(),
  notes: z.string().max(2000).optional(),
});

export const saveFleetVehicleOperation = defineOperation({
  name: "fleet.save",
  permission: "fleet.edit",
  input: vehicleInput,
  audit: (input) => (input.id ? "fleet.update" : "fleet.create"),
  run: async ({ input: { id, version, huDue, serviceDue, insuranceUntil, leasingUntil, leasingRate, plate, ...d }, tx, audit }) => {
    if (d.driverId && !(await tx.employee.findUnique({ where: { id: d.driverId }, select: { id: true } }))) failField("driverId", "validation.invalid");

    const data = {
      plate: formatPlate(plate),
      make: d.make ?? null,
      model: d.model ?? null,
      vin: d.vin ?? null,
      year: d.year ?? null,
      fuelType: d.fuelType ?? null,
      color: d.color ?? null,
      status: d.status,
      driverId: d.driverId ?? null,
      location: d.location ?? null,
      huDue: huDue ? noon(huDue) : null,
      serviceDue: serviceDue ? noon(serviceDue) : null,
      serviceDueKm: d.serviceDueKm ?? null,
      insuranceCompany: d.insuranceCompany ?? null,
      insurancePolicy: d.insurancePolicy ?? null,
      insuranceUntil: insuranceUntil ? noon(insuranceUntil) : null,
      leasingProvider: d.leasingProvider ?? null,
      leasingUntil: leasingUntil ? noon(leasingUntil) : null,
      leasingRateCents: leasingRate ?? null,
      fuelCardNo: d.fuelCardNo ?? null,
      notes: d.notes ?? null,
    };
    if (id && !(await claimRow(tx.fleetVehicle, id, version))) fail("conflict");
    const saved = id ? await tx.fleetVehicle.update({ where: { id }, data }) : await tx.fleetVehicle.create({ data });
    audit({ target: saved.plate, entityId: saved.id });
    return { id: saved.id };
  },
});

export const deleteFleetVehicleOperation = defineOperation({
  name: "fleet.delete",
  permission: "fleet.delete",
  input: z.object({ id: z.string().min(1) }),
  audit: "fleet.delete",
  run: async ({ input, tx, audit }) => {
    const car = await tx.fleetVehicle.findUnique({ where: { id: input.id }, select: { plate: true } });
    if (!car) fail("notFound");
    await tx.fleetVehicle.delete({ where: { id: input.id } });
    audit({ target: car.plate, entityId: input.id });
    return { id: input.id };
  },
});

/* ───────────── Kilometerstand ───────────── */

const mileageInput = z.object({
  fleetVehicleId: z.string().min(1),
  date: dateReq,
  km: z.coerce.number().int().min(0).max(2_000_000),
  note: z.string().max(100).optional(),
});

export const addMileageOperation = defineOperation({
  name: "fleet.addMileage",
  permission: "fleet.edit",
  input: mileageInput,
  audit: "fleet.mileageAdd",
  run: async ({ input: d, tx, audit }) => {
    const car = await requireFleetVehicle(tx, d.fleetVehicleId, "fleetVehicleId");
    // Ein Kilometerstand darf nicht unter dem zuletzt erfassten Wert liegen (Tippfehler-Schutz)
    const last = await tx.fleetMileage.findFirst({ where: { fleetVehicleId: d.fleetVehicleId }, orderBy: { km: "desc" } });
    if (last && d.km < last.km) failField("km", "fleet.errors.kmLower", { km: last.km });
    const row = await tx.fleetMileage.create({ data: { fleetVehicleId: d.fleetVehicleId, date: noon(d.date), km: d.km, note: d.note ?? null } });
    audit({ target: `${car.plate}: ${d.km} km`, entityId: row.id });
    return { id: row.id };
  },
});

export const deleteMileageOperation = defineOperation({
  name: "fleet.deleteMileage",
  permission: "fleet.edit",
  input: z.object({ id: z.string().min(1) }),
  audit: "fleet.mileageDelete",
  run: async ({ input, tx, audit }) => {
    const row = await tx.fleetMileage.findUnique({ where: { id: input.id }, include: { fleetVehicle: { select: { plate: true } } } });
    if (!row) fail("notFound");
    await tx.fleetMileage.delete({ where: { id: input.id } });
    audit({ target: `${row.fleetVehicle.plate}: ${row.km} km`, entityId: input.id });
    return { fleetVehicleId: row.fleetVehicleId };
  },
});

/* ───────────── Kosten ───────────── */

const costInput = z.object({
  fleetVehicleId: z.string().min(1),
  date: dateReq,
  category: z.enum(COST_CATEGORIES),
  amount: moneyCents("fleet.errors.amount").pipe(z.number().refine((cents) => cents !== 0, { error: "fleet.errors.amount" })),
  km: z.coerce.number().int().min(0).max(2_000_000).optional(),
  note: z.string().max(100).optional(),
});

export const addCostOperation = defineOperation({
  name: "fleet.addCost",
  permission: "fleet.edit",
  input: costInput,
  audit: "fleet.costAdd",
  run: async ({ input: d, tx, audit }) => {
    const car = await requireFleetVehicle(tx, d.fleetVehicleId, "fleetVehicleId");
    const row = await tx.fleetCost.create({
      data: { fleetVehicleId: d.fleetVehicleId, date: noon(d.date), category: d.category, amountCents: d.amount, km: d.km ?? null, note: d.note ?? null },
    });
    audit({ target: `${car.plate}: ${d.category}`, entityId: row.id });
    return { id: row.id };
  },
});

export const deleteCostOperation = defineOperation({
  name: "fleet.deleteCost",
  permission: "fleet.edit",
  input: z.object({ id: z.string().min(1) }),
  audit: "fleet.costDelete",
  run: async ({ input, tx, audit }) => {
    const row = await tx.fleetCost.findUnique({ where: { id: input.id }, include: { fleetVehicle: { select: { plate: true } } } });
    if (!row) fail("notFound");
    await tx.fleetCost.delete({ where: { id: input.id } });
    audit({ target: `${row.fleetVehicle.plate}: ${row.category}`, entityId: input.id });
    return { fleetVehicleId: row.fleetVehicleId };
  },
});

/* ───────────── Führerscheinkontrolle ───────────── */

const licenseInput = z.object({
  employeeId: z.string().min(1),
  checkedAt: dateReq,
  method: z.string().max(60).optional(),
  note: z.string().max(200).optional(),
});

export const saveLicenseCheckOperation = defineOperation({
  name: "fleet.saveLicenseCheck",
  permission: "fleet.edit",
  input: licenseInput,
  audit: "fleet.licenseCheck",
  run: async ({ input: d, principal, tx, audit }) => {
    const employee = await tx.employee.findUnique({ where: { id: d.employeeId }, select: { firstName: true, lastName: true } });
    if (!employee) failField("employeeId", "validation.invalid");
    const checkedAt = noon(d.checkedAt);
    const row = await tx.fleetLicenseCheck.create({
      data: { employeeId: d.employeeId, checkedAt, nextDue: nextLicenseCheck(checkedAt), method: d.method ?? null, note: d.note ?? null, checkedByName: principal.user.name },
    });
    audit({ target: `${employee.firstName} ${employee.lastName}`.trim(), entityId: row.id });
    return { id: row.id };
  },
});

export const deleteLicenseCheckOperation = defineOperation({
  name: "fleet.deleteLicenseCheck",
  permission: "fleet.edit",
  input: z.object({ id: z.string().min(1) }),
  audit: "fleet.licenseCheckDelete",
  run: async ({ input, tx, audit }) => {
    const row = await tx.fleetLicenseCheck.findUnique({ where: { id: input.id }, include: { employee: { select: { firstName: true, lastName: true } } } });
    if (!row) fail("notFound");
    await tx.fleetLicenseCheck.delete({ where: { id: input.id } });
    audit({ target: `${row.employee.firstName} ${row.employee.lastName}`.trim(), entityId: input.id });
    return { id: input.id };
  },
});


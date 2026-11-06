"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { requirePermission } from "@/server/auth/session";
import { getI18n } from "@/i18n/server";
import type { ActionState } from "@/components/ui/form";
import { COST_CATEGORIES, FLEET_STATUSES, FUEL_TYPES, nextLicenseCheck } from "@/modules/office/fleet/domain";
import { fieldErrors, formObject } from "@/lib/forms";
import { formatPlate } from "@/lib/plate";
import { parseMoneyToCents } from "@/lib/money";
import { audit } from "@/server/audit";
import { claimed } from "@/lib/concurrency";

function refresh(id?: string) {
  for (const p of ["/fleet", "/fleet/licenses", "/"]) revalidatePath(p);
  if (id) revalidatePath(`/fleet/${id}`);
}

const dateOpt = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();
const dateReq = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const noon = (d: string) => new Date(`${d}T12:00:00`);

/* ───────────── Fahrzeug ───────────── */

const vehicleSchema = z.object({
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
  leasingRate: z.string().max(20).optional(),
  fuelCardNo: z.string().max(40).optional(),
  notes: z.string().max(2000).optional(),
});

export async function saveFleetVehicle(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission("fleet.edit");
  const { t } = await getI18n();
  const parsed = vehicleSchema.safeParse(formObject(formData));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error, t) };
  const { id, huDue, serviceDue, insuranceUntil, leasingUntil, leasingRate, plate, ...d } = parsed.data;

  let leasingRateCents: number | null = null;
  if (leasingRate) {
    leasingRateCents = parseMoneyToCents(leasingRate);
    if (leasingRateCents === null || leasingRateCents < 0) return { fieldErrors: { leasingRate: t("fleet.errors.amount") } };
  }
  if (d.driverId && !(await db.employee.findUnique({ where: { id: d.driverId }, select: { id: true } }))) {
    return { fieldErrors: { driverId: t("validation.invalid") } };
  }

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
    leasingRateCents,
    fuelCardNo: d.fuelCardNo ?? null,
    notes: d.notes ?? null,
  };
  if (id && !(await claimed(d.version, (stamp, next) => db.fleetVehicle.updateMany({ where: { id: id, updatedAt: stamp }, data: { updatedAt: next } })))) return { error: t("common.conflict") };
  const saved = id ? await db.fleetVehicle.update({ where: { id }, data }) : await db.fleetVehicle.create({ data });
  refresh(saved.id);
  redirect(`/fleet/${saved.id}`);
}

export async function deleteFleetVehicle(formData: FormData) {
  await requirePermission("fleet.delete");
  const id = String(formData.get("id") ?? "");
  const car = id ? await db.fleetVehicle.findUnique({ where: { id }, select: { plate: true } }) : null;
  if (id) await db.fleetVehicle.deleteMany({ where: { id } });
  if (car) await audit("fleet.delete", { target: car.plate, entityId: id });
  refresh();
  redirect("/fleet");
}

/* ───────────── Kilometerstand ───────────── */

const mileageSchema = z.object({
  fleetVehicleId: z.string().min(1),
  date: dateReq,
  km: z.coerce.number().int().min(0).max(2_000_000),
  note: z.string().max(100).optional(),
});

export async function addMileage(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission("fleet.edit");
  const { t } = await getI18n();
  const parsed = mileageSchema.safeParse(formObject(formData));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error, t) };
  const d = parsed.data;

  // Ein Kilometerstand darf nicht unter dem zuletzt erfassten Wert liegen (Tippfehler-Schutz)
  const last = await db.fleetMileage.findFirst({ where: { fleetVehicleId: d.fleetVehicleId }, orderBy: { km: "desc" } });
  if (last && d.km < last.km) return { fieldErrors: { km: t("fleet.errors.kmLower", { km: last.km }) } };

  await db.fleetMileage.create({ data: { fleetVehicleId: d.fleetVehicleId, date: noon(d.date), km: d.km, note: d.note ?? null } });
  refresh(d.fleetVehicleId);
  return { ok: true, message: t("common.saved") };
}

export async function deleteMileage(formData: FormData) {
  await requirePermission("fleet.edit");
  const id = String(formData.get("id") ?? "");
  const row = id ? await db.fleetMileage.findUnique({ where: { id } }) : null;
  if (row) await db.fleetMileage.delete({ where: { id } });
  refresh(row?.fleetVehicleId);
}

/* ───────────── Kosten ───────────── */

const costSchema = z.object({
  fleetVehicleId: z.string().min(1),
  date: dateReq,
  category: z.enum(COST_CATEGORIES),
  amount: z.string().max(20),
  km: z.coerce.number().int().min(0).max(2_000_000).optional(),
  note: z.string().max(100).optional(),
});

export async function addCost(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission("fleet.edit");
  const { t } = await getI18n();
  const parsed = costSchema.safeParse(formObject(formData));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error, t) };
  const d = parsed.data;

  const amountCents = parseMoneyToCents(d.amount);
  if (amountCents === null || amountCents === 0) return { fieldErrors: { amount: t("fleet.errors.amount") } };

  await db.fleetCost.create({
    data: { fleetVehicleId: d.fleetVehicleId, date: noon(d.date), category: d.category, amountCents, km: d.km ?? null, note: d.note ?? null },
  });
  refresh(d.fleetVehicleId);
  return { ok: true, message: t("common.saved") };
}

export async function deleteCost(formData: FormData) {
  await requirePermission("fleet.edit");
  const id = String(formData.get("id") ?? "");
  const row = id ? await db.fleetCost.findUnique({ where: { id } }) : null;
  if (row) await db.fleetCost.delete({ where: { id } });
  refresh(row?.fleetVehicleId);
}

/* ───────────── Führerscheinkontrolle ───────────── */

const licenseSchema = z.object({
  employeeId: z.string().min(1),
  checkedAt: dateReq,
  method: z.string().max(60).optional(),
  note: z.string().max(200).optional(),
});

export async function saveLicenseCheck(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission("fleet.edit");
  const { t } = await getI18n();
  const parsed = licenseSchema.safeParse(formObject(formData));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error, t) };
  const d = parsed.data;
  if (!(await db.employee.findUnique({ where: { id: d.employeeId }, select: { id: true } }))) return { fieldErrors: { employeeId: t("validation.invalid") } };

  const checkedAt = noon(d.checkedAt);
  await db.fleetLicenseCheck.create({
    data: { employeeId: d.employeeId, checkedAt, nextDue: nextLicenseCheck(checkedAt), method: d.method ?? null, note: d.note ?? null, checkedByName: session.user.name },
  });
  refresh();
  redirect("/fleet/licenses");
}

export async function deleteLicenseCheck(formData: FormData) {
  await requirePermission("fleet.edit");
  const id = String(formData.get("id") ?? "");
  if (id) await db.fleetLicenseCheck.deleteMany({ where: { id } });
  refresh();
}

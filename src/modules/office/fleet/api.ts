import { z } from "zod";
import type { FleetCost, FleetLicenseCheck, FleetMileage, FleetVehicle } from "@/generated/prisma/client";
import { versionOf } from "@/lib/concurrency";
import { centsText, dateOnly, day, dayOrNull, iso, nullableString, oneOf, optionalDate, requiredRef, text } from "@/server/api/format";
import { defineResource, type Delegate } from "@/server/api/resource";
import { db } from "@/server/db";
import { contains } from "@/server/search";
import { COST_CATEGORIES, FLEET_STATUSES, FUEL_TYPES } from "./domain";
import {
  addCostOperation,
  addMileageOperation,
  deleteCostOperation,
  deleteFleetVehicleOperation,
  deleteLicenseCheckOperation,
  deleteMileageOperation,
  saveFleetVehicleOperation,
  saveLicenseCheckOperation,
} from "./operations";

/**
 * API-Ressourcen „Fuhrpark“: Firmenfahrzeuge (`/api/v1/fleet-vehicles`), Kilometerstände (`/fleet-mileage`), Kosten (`/fleet-costs`) und Führerscheinkontrollen
 * (`/fleet-license-checks`). Beträge sind ganze Cent. Ein neuer Kilometerstand darf nicht unter dem letzten liegen – wie in der Oberfläche.
 */
const ref = requiredRef;

/* ───────────── Fahrzeuge ───────────── */

const vehicleBody = z.strictObject({
  plate: z.string().min(2).max(14),
  make: text(60),
  model: text(60),
  vin: text(40),
  year: z.number().int().min(1950).max(2100).nullable().optional(),
  fuelType: z.enum(FUEL_TYPES).nullable().optional(),
  color: text(30),
  status: z.enum(FLEET_STATUSES).optional(),
  driverId: z.string().max(64).nullable().optional(),
  location: text(80),
  huDue: optionalDate,
  serviceDue: optionalDate,
  serviceDueKm: z.number().int().min(0).max(2_000_000).nullable().optional(),
  insuranceCompany: text(80),
  insurancePolicy: text(60),
  insuranceUntil: optionalDate,
  leasingProvider: text(80),
  leasingUntil: optionalDate,
  leasingRateCents: z.number().int().min(0).max(2_000_000_000).nullable().optional(),
  fuelCardNo: text(40),
  notes: text(2000),
});

const vehicleItem = z.object({
  id: z.string(),
  version: z.string(),
  plate: z.string(),
  make: nullableString,
  model: nullableString,
  vin: nullableString,
  year: z.number().int().nullable(),
  fuelType: z.enum(FUEL_TYPES).nullable(),
  color: nullableString,
  status: z.enum(FLEET_STATUSES),
  driverId: nullableString,
  location: nullableString,
  huDue: nullableString,
  serviceDue: nullableString,
  serviceDueKm: z.number().int().nullable(),
  insuranceCompany: nullableString,
  insurancePolicy: nullableString,
  insuranceUntil: nullableString,
  leasingProvider: nullableString,
  leasingUntil: nullableString,
  leasingRateCents: z.number().int().nullable(),
  fuelCardNo: nullableString,
  notes: nullableString,
  createdAt: z.string(),
  updatedAt: z.string(),
});

const vehicleToInput = ({ leasingRateCents, ...rest }: Record<string, unknown>): Record<string, unknown> => ({ ...rest, leasingRate: typeof leasingRateCents === "number" ? centsText(leasingRateCents) : undefined });

export const vehicleEndpoints = defineResource({
  feature: "office.fleet",
  tag: "Fleet",
  name: "fleet-vehicles",
  singular: "fleet vehicle",
  path: "/fleet-vehicles",
  read: "fleet.view",
  model: db.fleetVehicle as unknown as Delegate<FleetVehicle>,
  item: vehicleItem,
  version: versionOf,
  toItem: (v): z.input<typeof vehicleItem> => ({
    id: v.id,
    version: versionOf(v),
    plate: v.plate,
    make: v.make,
    model: v.model,
    vin: v.vin,
    year: v.year,
    fuelType: v.fuelType ? oneOf(FUEL_TYPES, v.fuelType, "other") : null,
    color: v.color,
    status: oneOf(FLEET_STATUSES, v.status, "active"),
    driverId: v.driverId,
    location: v.location,
    huDue: dayOrNull(v.huDue),
    serviceDue: dayOrNull(v.serviceDue),
    serviceDueKm: v.serviceDueKm,
    insuranceCompany: v.insuranceCompany,
    insurancePolicy: v.insurancePolicy,
    insuranceUntil: dayOrNull(v.insuranceUntil),
    leasingProvider: v.leasingProvider,
    leasingUntil: dayOrNull(v.leasingUntil),
    leasingRateCents: v.leasingRateCents,
    fuelCardNo: v.fuelCardNo,
    notes: v.notes,
    createdAt: iso(v.createdAt),
    updatedAt: iso(v.updatedAt),
  }),
  list: {
    filters: z.strictObject({ q: z.string().max(100).optional(), status: z.enum(FLEET_STATUSES).optional(), driverId: z.string().max(64).optional() }),
    where: ({ q, status, driverId }) => ({
      ...(status ? { status } : {}),
      ...(driverId ? { driverId } : {}),
      ...(q ? { OR: [{ plate: contains(q) }, { make: contains(q) }, { model: contains(q) }, { vin: contains(q) }, { location: contains(q) }] } : {}),
    }),
    sorts: { plate: (dir) => ({ plate: dir }), huDue: (dir) => ({ huDue: dir }), serviceDue: (dir) => ({ serviceDue: dir }), createdAt: (dir) => ({ createdAt: dir }), updatedAt: (dir) => ({ updatedAt: dir }) },
    defaultSort: [{ key: "plate", dir: "asc" }],
  },
  create: { permission: "fleet.edit", operation: saveFleetVehicleOperation, body: vehicleBody, toInput: vehicleToInput, rename: { leasingRate: "leasingRateCents" } },
  update: {
    permission: "fleet.edit",
    operation: saveFleetVehicleOperation,
    current: (v) => ({
      plate: v.plate,
      make: v.make,
      model: v.model,
      vin: v.vin,
      year: v.year,
      fuelType: v.fuelType,
      color: v.color,
      status: v.status,
      driverId: v.driverId,
      location: v.location,
      huDue: dayOrNull(v.huDue),
      serviceDue: dayOrNull(v.serviceDue),
      serviceDueKm: v.serviceDueKm,
      insuranceCompany: v.insuranceCompany,
      insurancePolicy: v.insurancePolicy,
      insuranceUntil: dayOrNull(v.insuranceUntil),
      leasingProvider: v.leasingProvider,
      leasingUntil: dayOrNull(v.leasingUntil),
      leasingRateCents: v.leasingRateCents,
      fuelCardNo: v.fuelCardNo,
      notes: v.notes,
    }),
    toInput: (merged, { id, version }) => ({ ...vehicleToInput(merged), id, version }),
    rename: { leasingRate: "leasingRateCents" },
  },
  remove: { permission: "fleet.delete", operation: deleteFleetVehicleOperation },
});

/* ───────────── Kilometerstände ───────────── */

const mileageBody = z.strictObject({ fleetVehicleId: ref, date: dateOnly, km: z.number().int().min(0).max(2_000_000), note: text(100) });
const mileageItem = z.object({ id: z.string(), fleetVehicleId: z.string(), date: z.string(), km: z.number().int(), note: nullableString });

export const mileageEndpoints = defineResource({
  feature: "office.fleet",
  tag: "Fleet",
  name: "fleet-mileage",
  singular: "mileage entry",
  path: "/fleet-mileage",
  read: "fleet.view",
  model: db.fleetMileage as unknown as Delegate<FleetMileage>,
  item: mileageItem,
  toItem: (m): z.input<typeof mileageItem> => ({ id: m.id, fleetVehicleId: m.fleetVehicleId, date: day(m.date), km: m.km, note: m.note }),
  list: {
    filters: z.strictObject({ fleetVehicleId: z.string().max(64).optional() }),
    where: ({ fleetVehicleId }) => (fleetVehicleId ? { fleetVehicleId } : {}),
    sorts: { date: (dir) => ({ date: dir }), km: (dir) => ({ km: dir }) },
    defaultSort: [{ key: "date", dir: "desc" }],
  },
  create: { permission: "fleet.edit", operation: addMileageOperation, body: mileageBody, toInput: (b) => b },
  remove: { permission: "fleet.edit", operation: deleteMileageOperation },
});

/* ───────────── Kosten ───────────── */

const costBody = z.strictObject({
  fleetVehicleId: ref,
  date: dateOnly,
  category: z.enum(COST_CATEGORIES),
  /** ganze Cent, nicht 0 (Gutschriften negativ) */
  amountCents: z.number().int().min(-2_000_000_000).max(2_000_000_000),
  km: z.number().int().min(0).max(2_000_000).nullable().optional(),
  note: text(100),
});
const costItem = z.object({
  id: z.string(),
  fleetVehicleId: z.string(),
  date: z.string(),
  category: z.enum(COST_CATEGORIES),
  amountCents: z.number().int(),
  km: z.number().int().nullable(),
  note: nullableString,
});

export const costEndpoints = defineResource({
  feature: "office.fleet",
  tag: "Fleet",
  name: "fleet-costs",
  singular: "cost entry",
  path: "/fleet-costs",
  read: "fleet.view",
  model: db.fleetCost as unknown as Delegate<FleetCost>,
  item: costItem,
  toItem: (c): z.input<typeof costItem> => ({ id: c.id, fleetVehicleId: c.fleetVehicleId, date: day(c.date), category: oneOf(COST_CATEGORIES, c.category, "other"), amountCents: c.amountCents, km: c.km, note: c.note }),
  list: {
    filters: z.strictObject({ fleetVehicleId: z.string().max(64).optional(), category: z.enum(COST_CATEGORIES).optional() }),
    where: ({ fleetVehicleId, category }) => ({ ...(fleetVehicleId ? { fleetVehicleId } : {}), ...(category ? { category } : {}) }),
    sorts: { date: (dir) => ({ date: dir }), amountCents: (dir) => ({ amountCents: dir }) },
    defaultSort: [{ key: "date", dir: "desc" }],
  },
  create: { permission: "fleet.edit", operation: addCostOperation, body: costBody, toInput: ({ amountCents, ...rest }) => ({ ...rest, amount: centsText(amountCents) }), rename: { amount: "amountCents" } },
  remove: { permission: "fleet.edit", operation: deleteCostOperation },
});

/* ───────────── Führerscheinkontrollen ───────────── */

const licenseBody = z.strictObject({ employeeId: ref, checkedAt: dateOnly, method: text(60), note: text(200) });
const licenseItem = z.object({
  id: z.string(),
  employeeId: z.string(),
  checkedAt: z.string(),
  nextDue: z.string(),
  method: nullableString,
  note: nullableString,
  checkedByName: nullableString,
});

export const licenseEndpoints = defineResource({
  feature: "office.fleet",
  tag: "Fleet",
  name: "fleet-license-checks",
  singular: "license check",
  path: "/fleet-license-checks",
  read: "fleet.view",
  model: db.fleetLicenseCheck as unknown as Delegate<FleetLicenseCheck>,
  item: licenseItem,
  toItem: (c): z.input<typeof licenseItem> => ({ id: c.id, employeeId: c.employeeId, checkedAt: day(c.checkedAt), nextDue: day(c.nextDue), method: c.method, note: c.note, checkedByName: c.checkedByName }),
  list: {
    filters: z.strictObject({ employeeId: z.string().max(64).optional() }),
    where: ({ employeeId }) => (employeeId ? { employeeId } : {}),
    sorts: { checkedAt: (dir) => ({ checkedAt: dir }), nextDue: (dir) => ({ nextDue: dir }) },
    defaultSort: [{ key: "checkedAt", dir: "desc" }],
  },
  create: { permission: "fleet.edit", operation: saveLicenseCheckOperation, body: licenseBody, toInput: (b) => b },
  remove: { permission: "fleet.edit", operation: deleteLicenseCheckOperation },
});

export const endpoints = [...vehicleEndpoints, ...mileageEndpoints, ...costEndpoints, ...licenseEndpoints];

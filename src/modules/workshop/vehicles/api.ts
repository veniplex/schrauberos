import { z } from "zod";
import type { Vehicle } from "@/generated/prisma/client";
import { versionOf } from "@/lib/concurrency";
import { normalizePlate } from "@/lib/plate";
import { dateOnly, iso, nullableString, text } from "@/server/api/format";
import { defineResource, type Delegate } from "@/server/api/resource";
import { db } from "@/server/db";
import { contains } from "@/server/search";
import { deleteVehicleOperation, saveVehicleOperation, transferVehicleOperation } from "./operations";

/**
 * API-Ressource „Fahrzeuge“ (`/api/v1/vehicles`). Der Halter wird nur beim Anlegen gesetzt; später wechselt er über die Aktion `transfer` (Halter-Historie).
 */

const body = z.strictObject({
  /** Halter (nur beim Anlegen); später: `POST /vehicles/{id}/transfer` */
  customerId: z.string().max(64).nullable().optional(),
  plate: z.string().min(2).max(14),
  make: text(60),
  model: text(60),
  vin: text(40),
  year: z.number().int().min(1950).max(2100).nullable().optional(),
  notes: text(2000),
});

const item = z.object({
  id: z.string(),
  version: z.string(),
  customerId: nullableString,
  plate: z.string(),
  make: nullableString,
  model: nullableString,
  vin: nullableString,
  year: z.number().int().nullable(),
  notes: nullableString,
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const endpoints = defineResource({
  feature: "workshop.vehicles",
  tag: "Vehicles",
  name: "vehicles",
  singular: "vehicle",
  path: "/vehicles",
  read: "vehicles.view",
  model: db.vehicle as unknown as Delegate<Vehicle>,
  item,
  version: versionOf,
  toItem: (v): z.input<typeof item> => ({
    id: v.id,
    version: versionOf(v),
    customerId: v.customerId,
    plate: v.plate,
    make: v.make,
    model: v.model,
    vin: v.vin,
    year: v.year,
    notes: v.notes,
    createdAt: iso(v.createdAt),
    updatedAt: iso(v.updatedAt),
  }),
  list: {
    filters: z.strictObject({ q: z.string().max(100).optional(), customerId: z.string().max(64).optional() }),
    where: ({ q, customerId }) => ({
      ...(customerId ? { customerId } : {}),
      ...(q ? { OR: [{ plateNorm: contains(normalizePlate(q) || q) }, { plate: contains(q) }, { make: contains(q) }, { model: contains(q) }, { vin: contains(q) }] } : {}),
    }),
    sorts: {
      plate: (dir) => ({ plateNorm: dir }),
      make: (dir) => ({ make: dir }),
      year: (dir) => ({ year: dir }),
      createdAt: (dir) => ({ createdAt: dir }),
      updatedAt: (dir) => ({ updatedAt: dir }),
    },
    defaultSort: [{ key: "plate", dir: "asc" }],
  },
  create: { permission: "vehicles.edit", operation: saveVehicleOperation, body, toInput: (b) => b },
  update: {
    permission: "vehicles.edit",
    operation: saveVehicleOperation,
    body: body.omit({ customerId: true }).partial(),
    current: (v) => ({ plate: v.plate, make: v.make, model: v.model, vin: v.vin, year: v.year, notes: v.notes }),
    toInput: (merged, { id, version }) => ({ ...merged, id, version }),
  },
  remove: { permission: "vehicles.delete", operation: deleteVehicleOperation },
  actions: [
    {
      name: "transfer",
      summary: "Transfer a vehicle to another owner (or to none); the owner history is kept",
      permission: "vehicles.edit",
      operation: transferVehicleOperation,
      body: z.strictObject({ customerId: z.string().max(64).nullable().optional(), date: dateOnly, note: text(300) }),
      toInput: (id, b) => ({ vehicleId: id, newCustomerId: b.customerId, date: b.date, note: b.note }),
      rename: { newCustomerId: "customerId" },
    },
  ],
});

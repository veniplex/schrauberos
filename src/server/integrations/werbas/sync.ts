import type { PrismaClient } from "@/generated/prisma/client";
import { formatPlate, normalizePlate } from "@/lib/plate";
import type { SyncStats, WerbasClient } from "./types";

const SOURCE = "werbas";

/**
 * Gleicht Kunden und Fahrzeuge aus Werbas in die lokale Datenbank ab (Upsert über `externalId`).
 * Lokal angelegte Datensätze (externalSource = null) bleiben unberührt; Reifensätze, Termine usw.
 * hängen weiter an denselben Fahrzeug-IDs.
 *
 * Aufrufbar aus einem Skript, einem Cron-/Scheduler-Job oder einer Server Action
 * (mit `db` aus "@/server/db" bzw. `createPrismaClient()`).
 */
export async function syncFromWerbas(db: PrismaClient, client: WerbasClient, since?: Date): Promise<SyncStats> {
  const stats: SyncStats = { customersCreated: 0, customersUpdated: 0, vehiclesCreated: 0, vehiclesUpdated: 0, vehiclesSkipped: 0 };
  const syncedAt = new Date();

  for await (const c of client.customers(since)) {
    const key = { externalSource_externalId: { externalSource: SOURCE, externalId: c.externalId } };
    const data = {
      customerNumber: c.customerNumber ?? null,
      firstName: c.firstName ?? null,
      lastName: c.lastName || c.company || "?",
      company: c.company ?? null,
      email: c.email ?? null,
      phone: c.phone ?? null,
      street: c.street ?? null,
      zip: c.zip ?? null,
      city: c.city ?? null,
      syncedAt,
    };
    const existing = await db.customer.findUnique({ where: key, select: { id: true } });
    if (existing) {
      await db.customer.update({ where: { id: existing.id }, data });
      stats.customersUpdated++;
    } else {
      await db.customer.create({ data: { ...data, externalSource: SOURCE, externalId: c.externalId } });
      stats.customersCreated++;
    }
  }

  for await (const v of client.vehicles(since)) {
    const customer = await db.customer.findUnique({
      where: { externalSource_externalId: { externalSource: SOURCE, externalId: v.customerExternalId } },
      select: { id: true },
    });
    if (!customer) {
      stats.vehiclesSkipped++;
      continue;
    }
    const data = {
      customerId: customer.id,
      plate: formatPlate(v.plate),
      plateNorm: normalizePlate(v.plate),
      make: v.make ?? null,
      model: v.model ?? null,
      vin: v.vin ?? null,
      year: v.year ?? null,
      syncedAt,
    };
    const existing = await db.vehicle.findUnique({
      where: { externalSource_externalId: { externalSource: SOURCE, externalId: v.externalId } },
      select: { id: true },
    });
    if (existing) {
      await db.vehicle.update({ where: { id: existing.id }, data });
      stats.vehiclesUpdated++;
    } else {
      await db.vehicle.create({ data: { ...data, externalSource: SOURCE, externalId: v.externalId } });
      stats.vehiclesCreated++;
    }
  }

  return stats;
}

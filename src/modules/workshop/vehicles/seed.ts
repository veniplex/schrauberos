import { addDays } from "@/lib/zone";
import type { PrismaClient } from "@/generated/prisma/client";
import { addMonths, monthOf } from "@/lib/month";
import { normalizePlate } from "@/lib/plate";
import type { SeedDef } from "@/modules/types";

/** Beispielfahrzeuge mit Halter (Nachname des Kunden aus dem Demo-Seed der Kunden; ohne Kunden entstehen sie ohne Halter). */
async function demo(db: PrismaClient) {
  if ((await db.vehicle.count()) > 0) return;
  console.log("Demo-Daten (Fahrzeuge) werden angelegt …");

  // Prüffristen relativ zu heute, damit Dashboard-Baustein, Filter und Druckliste Beispiele haben (überfällig, laufender Monat, bald, später, keine)
  const thisMonth = monthOf(new Date());
  const due = (months: number) => addMonths(thisMonth, months);

  const vehicles = [
  { owner: "Becker", vehicle: { plate: "B-AB 1234", make: "VW", model: "Golf VIII", year: 2021, fuel: "petrol", mileageKm: 48200, hsn: "0603", tsn: "BGD", inspectionDue: due(14) } },
  { owner: "Schulz", vehicle: { plate: "B-MS 4711", make: "BMW", model: "320d Touring", year: 2019, fuel: "diesel", mileageKm: 112500, inspectionDue: due(0) } },
  { owner: "Schulz", vehicle: { plate: "B-MS 815", make: "Mini", model: "Cooper", year: 2017, fuel: "petrol", mileageKm: 89000, inspectionDue: due(-2) } },
  { owner: "Yilmaz", vehicle: { plate: "B-EY 2020", make: "Skoda", model: "Octavia Combi", year: 2020, fuel: "diesel", mileageKm: 76400, inspectionDue: due(1) } },
  { owner: "Autohaus Nord GmbH", vehicle: { plate: "B-AN 100", make: "Ford", model: "Transit", year: 2022, fuel: "diesel", mileageKm: 61800, inspectionDue: due(8) } },
  { owner: "Krause", vehicle: { plate: "HVL-JK 77", make: "Opel", model: "Astra K", year: 2016, fuel: "lpg", mileageKm: 143000, inspectionDue: due(2), extraInspectionKind: "gas", extraInspectionDue: addDays(new Date(), 40) } },
  { owner: "Neumann", vehicle: { plate: "B-SN 909", make: "Audi", model: "A3 Sportback", year: 2018 } },
  ];

  const customerIds: Record<string, string> = {};
  for (const c of await db.customer.findMany({ select: { id: true, lastName: true } })) customerIds[c.lastName] = c.id;

  for (const { owner, vehicle } of vehicles) {
    const customerId = customerIds[owner];
    await db.vehicle.create({
      data: { ...vehicle, plateNorm: normalizePlate(vehicle.plate), customerId, ownerships: customerId ? { create: [{ customerId }] } : undefined },
    });
  }

  // Halterwechsel-Beispiel: Mini gehörte früher Familie Krause
  const mini = await db.vehicle.findFirst({ where: { plateNorm: normalizePlate("B-MS 815") } });
  if (mini && customerIds["Krause"]) {
    await db.vehicleOwnership.updateMany({ where: { vehicleId: mini.id }, data: { fromDate: new Date("2024-02-15") } });
    await db.vehicleOwnership.create({
      data: { vehicleId: mini.id, customerId: customerIds["Krause"], fromDate: new Date("2021-03-01"), toDate: new Date("2024-02-15"), note: "Verkauf" },
    });
  }
  // Fahrzeug ohne Halter (Bestand)
  await db.vehicle.create({ data: { plate: "B-GW 200", plateNorm: normalizePlate("B-GW 200"), make: "VW", model: "Polo", year: 2018, notes: "Gebrauchtwagen im Bestand" } });
}

export const seeds: SeedDef[] = [{ id: "vehicles", feature: "workshop.vehicles", order: 40, demo }];

import { addDays, setHours, setMinutes, startOfDay, startOfWeek } from "date-fns";
import type { PrismaClient } from "@/generated/prisma/client";
import { normalizePlate } from "@/lib/plate";
import type { SeedDef } from "@/modules/types";

/** Basisdaten: Einstellungszeile, Arbeitsplätze und Terminarten einer frischen Installation. */
async function base(db: PrismaClient) {
  await db.appointmentSettings.upsert({ where: { id: "default" }, update: {}, create: { id: "default" } });
  await db.bay.createMany({
    data: [
      { name: "Hebebühne 1", sortOrder: 1 },
      { name: "Hebebühne 2", sortOrder: 2 },
      { name: "Reifenplatz", sortOrder: 3 },
    ],
  });
  await db.appointmentType.createMany({
    data: [
      { name: "Inspektion", color: "#2459c9", defaultMinutes: 90, sortOrder: 1 },
      { name: "Ölwechsel", color: "#b45309", defaultMinutes: 45, sortOrder: 2 },
      { name: "Reifenwechsel", color: "#0f766e", defaultMinutes: 45, sortOrder: 3, kind: "tire_change" },
      { name: "HU/AU", color: "#7e22ce", defaultMinutes: 60, sortOrder: 4 },
      { name: "Reparatur", color: "#b91c1c", defaultMinutes: 120, sortOrder: 5 },
      { name: "Diagnose", color: "#475569", defaultMinutes: 30, sortOrder: 6 },
    ],
  });
}

/** Termine der aktuellen Woche an den Demo-Fahrzeugen (gefunden über das Kennzeichen). */
async function demo(db: PrismaClient) {
  if ((await db.appointment.count()) > 0) return;
  console.log("Demo-Daten (Termine) werden angelegt …");

  const types = await db.appointmentType.findMany();
  const bays = await db.bay.findMany({ orderBy: { sortOrder: "asc" } });
  const type = (name: string) => types.find((t) => t.name === name);
  const monday = startOfWeek(new Date(), { weekStartsOn: 1 });
  const at = (dayOffset: number, h: number, m = 0) => setMinutes(setHours(startOfDay(addDays(monday, dayOffset)), h), m);
  const today = (new Date().getDay() + 6) % 7;

  const appts = [
    { day: today, h: 8, m: 0, min: 90, type: "Inspektion", bay: 0, plate: "B-AB 1234", status: "in_progress" },
    { day: today, h: 9, m: 30, min: 45, type: "Reifenwechsel", bay: 2, plate: "B-EY 2020", status: "confirmed" },
    { day: today, h: 11, m: 0, min: 120, type: "Reparatur", bay: 1, plate: "B-MS 4711", status: "scheduled" },
    { day: today, h: 14, m: 0, min: 60, type: "HU/AU", bay: 0, plate: "HVL-JK 77", status: "scheduled" },
    { day: (today + 1) % 7, h: 8, m: 30, min: 45, type: "Ölwechsel", bay: 1, plate: "B-AN 100", status: "scheduled" },
    { day: (today + 1) % 7, h: 13, m: 0, min: 30, type: "Diagnose", bay: 0, plate: "B-SN 909", status: "confirmed" },
    { day: (today + 2) % 7, h: 10, m: 0, min: 45, type: "Reifenwechsel", bay: 2, plate: "B-MS 815", status: "scheduled" },
  ];
  for (const a of appts) {
    const start = at(a.day, a.h, a.m);
    const kind = type(a.type);
    const vehicle = await db.vehicle.findFirst({ where: { plateNorm: normalizePlate(a.plate) } });
    if (!kind || !vehicle) continue;
    // Reifenwechsel hängen am eingelagerten Satz des Fahrzeugs (zeigt nach „Fertig“ den Vorschlag „Satz ausbuchen?“)
    const tireSet = a.type === "Reifenwechsel" ? await db.tireSet.findFirst({ where: { vehicleId: vehicle.id, status: "stored" } }) : null;
    await db.appointment.create({
      data: {
        title: kind.name,
        startsAt: start,
        endsAt: new Date(start.getTime() + a.min * 60_000),
        status: a.status,
        typeId: kind.id,
        bayId: bays[a.bay]?.id,
        vehicleId: vehicle.id,
        customerId: vehicle.customerId,
        tireSetId: tireSet?.id,
      },
    });
  }
}

export const seeds: SeedDef[] = [{ id: "appointments", feature: "workshop.appointments", order: 60, base, demo }];

import "dotenv/config";
import bcrypt from "bcryptjs";
import { addDays, setHours, setMinutes, startOfDay, startOfWeek } from "date-fns";
import { createPrismaClient } from "../src/server/db-client";
import { DEFAULT_ROLES } from "../src/modules/permissions";
import { normalizePlate } from "../src/lib/domain/vehicles";

const db = createPrismaClient();

async function seedRoles() {
  for (const role of DEFAULT_ROLES) {
    const existing = await db.role.findUnique({ where: { key: role.key } });
    if (existing) continue; // Anpassungen an bestehenden Rollen nie überschreiben
    await db.role.create({
      data: {
        key: role.key,
        name: role.name,
        description: role.description,
        isAdmin: role.isAdmin ?? false,
        isSystem: role.key === "admin",
        permissions: { create: role.permissions.map((permission) => ({ permission })) },
      },
    });
    console.log(`Rolle angelegt: ${role.name}`);
  }
}

async function seedAdmin() {
  if ((await db.user.count()) > 0) return;
  const username = (process.env.SEED_ADMIN_USER ?? "admin").toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD ?? "admin";
  const adminRole = await db.role.findUniqueOrThrow({ where: { key: "admin" } });
  await db.user.create({
    data: {
      username,
      name: "Administrator",
      passwordHash: await bcrypt.hash(password, 11),
      mustChangePassword: true,
      roles: { create: [{ roleId: adminRole.id }] },
    },
  });
  console.log(`Admin-Benutzer angelegt: ${username} (Passwort muss beim ersten Login geändert werden)`);
}

async function seedWorkshopBasics() {
  await db.workshop.upsert({ where: { id: "default" }, update: {}, create: { id: "default" } });

  if ((await db.bay.count()) === 0) {
    await db.bay.createMany({
      data: [
        { name: "Hebebühne 1", sortOrder: 1 },
        { name: "Hebebühne 2", sortOrder: 2 },
        { name: "Reifenplatz", sortOrder: 3 },
      ],
    });
  }
  if ((await db.appointmentType.count()) === 0) {
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
}

const dot = (week: number, year: number) => ({
  dot: `${String(week).padStart(2, "0")}${String(year % 100).padStart(2, "0")}`,
  producedWeek: week,
  producedYear: year,
});

async function seedDemo() {
  if ((await db.customer.count()) > 0) return;
  console.log("Demo-Daten werden angelegt …");

  const customers = [
    { firstName: "Anna", lastName: "Becker", phone: "0170 1234567", email: "anna.becker@example.com", street: "Lindenstr. 12", zip: "10115", city: "Berlin", vehicles: [{ plate: "B-AB 1234", make: "VW", model: "Golf VIII", year: 2021 }] },
    { firstName: "Markus", lastName: "Schulz", phone: "0171 2345678", street: "Hauptstr. 5", zip: "10243", city: "Berlin", vehicles: [{ plate: "B-MS 4711", make: "BMW", model: "320d Touring", year: 2019 }, { plate: "B-MS 815", make: "Mini", model: "Cooper", year: 2017 }] },
    { firstName: "Elif", lastName: "Yilmaz", phone: "0172 3456789", street: "Parkallee 3", zip: "10317", city: "Berlin", vehicles: [{ plate: "B-EY 2020", make: "Skoda", model: "Octavia Combi", year: 2020 }] },
    { lastName: "Autohaus Nord GmbH", company: "Autohaus Nord GmbH", phone: "030 555010", street: "Industrieweg 8", zip: "13353", city: "Berlin", vehicles: [{ plate: "B-AN 100", make: "Ford", model: "Transit", year: 2022 }] },
    { firstName: "Jürgen", lastName: "Krause", phone: "0173 4567890", street: "Dorfstr. 21", zip: "14612", city: "Falkensee", vehicles: [{ plate: "HVL-JK 77", make: "Opel", model: "Astra K", year: 2016 }] },
    { firstName: "Sabine", lastName: "Neumann", phone: "0174 5678901", street: "Seestr. 9", zip: "13086", city: "Berlin", vehicles: [{ plate: "B-SN 909", make: "Audi", model: "A3 Sportback", year: 2018 }] },
  ];

  const vehicleIds: Record<string, string> = {};
  let nr = 10001;
  for (const c of customers) {
    const { vehicles, ...data } = c;
    const created = await db.customer.create({ data: { ...data, customerNumber: String(nr++) } });
    for (const v of vehicles) {
      const veh = await db.vehicle.create({
        data: { ...v, plateNorm: normalizePlate(v.plate), customerId: created.id },
      });
      vehicleIds[v.plate] = veh.id;
    }
  }

  // Reifensätze – bewusst mit unterschiedlichem Zustand, damit Warnungen sichtbar werden
  const sets: Array<{
    plate: string; season: string; brand: string; model: string; w: number; a: number; r: number; rim: string; loc: string;
    tires: Array<{ pos: string; week: number; year: number; tread: number; cond: string }>;
  }> = [
    { plate: "B-AB 1234", season: "winter", brand: "Continental", model: "WinterContact TS 870", w: 205, a: 55, r: 16, rim: "alloy", loc: "Halle A / Regal 1 / Fach 3",
      tires: ["FL", "FR", "RL", "RR"].map((pos) => ({ pos, week: 38, year: 2022, tread: 6.5, cond: "good" })) },
    { plate: "B-MS 4711", season: "summer", brand: "Michelin", model: "Primacy 4", w: 225, a: 45, r: 17, rim: "alloy", loc: "Halle A / Regal 2 / Fach 1",
      tires: [
        { pos: "FL", week: 12, year: 2019, tread: 3.2, cond: "fair" }, { pos: "FR", week: 12, year: 2019, tread: 3.0, cond: "fair" },
        { pos: "RL", week: 12, year: 2019, tread: 3.8, cond: "good" }, { pos: "RR", week: 12, year: 2019, tread: 3.6, cond: "good" },
      ] },
    { plate: "B-MS 815", season: "winter", brand: "Goodyear", model: "UltraGrip 9+", w: 195, a: 55, r: 16, rim: "steel", loc: "Halle A / Regal 2 / Fach 4",
      tires: ["FL", "FR", "RL", "RR"].map((pos) => ({ pos, week: 41, year: 2016, tread: 2.6, cond: "worn" })) },
    { plate: "B-EY 2020", season: "winter", brand: "Bridgestone", model: "Blizzak LM005", w: 205, a: 60, r: 16, rim: "none", loc: "Halle B / Regal 5 / Fach 2",
      tires: ["FL", "FR", "RL", "RR"].map((pos) => ({ pos, week: 44, year: 2023, tread: 7.4, cond: "new" })) },
    { plate: "B-AN 100", season: "allseason", brand: "Vredestein", model: "Quatrac Pro", w: 235, a: 65, r: 16, rim: "steel", loc: "Halle B / Regal 1 / Fach 1",
      tires: ["FL", "FR", "RL", "RR"].map((pos) => ({ pos, week: 8, year: 2020, tread: 4.4, cond: "good" })) },
    { plate: "HVL-JK 77", season: "summer", brand: "Hankook", model: "Ventus Prime 3", w: 205, a: 55, r: 16, rim: "alloy", loc: "Halle A / Regal 3 / Fach 2",
      tires: ["FL", "FR", "RL", "RR"].map((pos) => ({ pos, week: 20, year: 2024, tread: 7.0, cond: "good" })) },
    { plate: "B-SN 909", season: "winter", brand: "Pirelli", model: "Cinturato Winter", w: 225, a: 45, r: 17, rim: "alloy", loc: "Halle B / Regal 3 / Fach 4",
      tires: [
        { pos: "FL", week: 33, year: 2017, tread: 4.6, cond: "good" }, { pos: "FR", week: 33, year: 2017, tread: 4.4, cond: "good" },
        { pos: "RL", week: 33, year: 2017, tread: 5.2, cond: "good" }, { pos: "RR", week: 33, year: 2017, tread: 5.0, cond: "good" },
      ] },
  ];

  for (const s of sets) {
    await db.tireSet.create({
      data: {
        vehicleId: vehicleIds[s.plate],
        season: s.season, brand: s.brand, model: s.model, width: s.w, aspect: s.a, rim: s.r, rimType: s.rim,
        storageLocation: s.loc, status: "stored", storedAt: addDays(new Date(), -120),
        tires: {
          create: s.tires.map((t) => ({
            position: t.pos, ...dot(t.week, t.year), treadDepthMm: t.tread, condition: t.cond, measuredAt: addDays(new Date(), -120),
          })),
        },
      },
    });
  }

  // Termine in der aktuellen Woche
  const types = await db.appointmentType.findMany();
  const bays = await db.bay.findMany({ orderBy: { sortOrder: "asc" } });
  const type = (name: string) => types.find((t) => t.name === name)!;
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
    const vehicle = await db.vehicle.findUniqueOrThrow({ where: { id: vehicleIds[a.plate] } });
    await db.appointment.create({
      data: {
        title: type(a.type).name,
        startsAt: start,
        endsAt: new Date(start.getTime() + a.min * 60_000),
        status: a.status,
        typeId: type(a.type).id,
        bayId: bays[a.bay]?.id,
        vehicleId: vehicle.id,
        customerId: vehicle.customerId,
      },
    });
  }
}

async function main() {
  await seedRoles();
  await seedAdmin();
  await seedWorkshopBasics();
  if (process.env.SEED_DEMO === "true") await seedDemo();
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });

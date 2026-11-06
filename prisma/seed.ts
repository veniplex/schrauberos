import "dotenv/config";
import bcrypt from "bcryptjs";
import { addDays, setHours, setMinutes, startOfDay, startOfWeek } from "date-fns";
import { createPrismaClient } from "../src/server/db-client";
import { DEFAULT_ROLES } from "../src/modules/default-roles";
import { normalizePlate } from "../src/lib/plate";
import { slugify } from "../src/lib/slug";

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
  await db.appointmentSettings.upsert({ where: { id: "default" }, update: {}, create: { id: "default" } });
  await db.tireSettings.upsert({ where: { id: "default" }, update: {}, create: { id: "default" } });

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
  const customerIds: Record<string, string> = {};
  let nr = 10001;
  for (const c of customers) {
    const { vehicles, ...data } = c;
    const created = await db.customer.create({ data: { ...data, customerNumber: String(nr++) } });
    customerIds[c.lastName] = created.id;
    for (const v of vehicles) {
      const veh = await db.vehicle.create({
        data: { ...v, plateNorm: normalizePlate(v.plate), customerId: created.id, ownerships: { create: [{ customerId: created.id }] } },
      });
      vehicleIds[v.plate] = veh.id;
    }
  }

  // Halterwechsel-Beispiel: Mini gehörte früher Familie Krause
  await db.vehicleOwnership.updateMany({ where: { vehicleId: vehicleIds["B-MS 815"] }, data: { fromDate: new Date("2024-02-15") } });
  await db.vehicleOwnership.create({
    data: { vehicleId: vehicleIds["B-MS 815"], customerId: customerIds["Krause"], fromDate: new Date("2021-03-01"), toDate: new Date("2024-02-15"), note: "Verkauf" },
  });
  // Fahrzeug ohne Halter (Bestand)
  await db.vehicle.create({ data: { plate: "B-GW 200", plateNorm: normalizePlate("B-GW 200"), make: "VW", model: "Polo", year: 2018, notes: "Gebrauchtwagen im Bestand" } });

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

async function seedNetworkDemo() {
  if ((await db.netDevice.count()) > 0) return;
  console.log("Netzwerk-Demo-Daten werden angelegt …");

  const loc: Record<string, { id: string }> = {};
  for (const [i, name] of ["Serverraum", "Büro EG", "Werkstatt", "Lagerhalle", "Empfang"].entries()) {
    loc[name] = await db.netLocation.create({ data: { name, sortOrder: i } });
  }
  const vlan: Record<number, { id: string }> = {};
  for (const [vlanId, name] of [[10, "Büro"], [20, "Werkstatt"], [30, "Gäste-WLAN"], [99, "Management"]] as Array<[number, string]>) {
    vlan[vlanId] = await db.netVlan.create({ data: { vlanId, name } });
  }
  const subnet = (name: string, cidr: string, v: number, extra: object = {}) =>
    db.netSubnet.create({ data: { name, cidr, vlanId: vlan[v].id, ...extra } });
  const sBuero = await subnet("Büro", "192.168.10.0/24", 10, { gateway: "192.168.10.1", dnsServers: "192.168.10.2, 1.1.1.1", dhcpStart: "192.168.10.100", dhcpEnd: "192.168.10.200" });
  const sWerk = await subnet("Werkstatt", "192.168.20.0/24", 20, { gateway: "192.168.20.1", dnsServers: "192.168.10.2", dhcpStart: "192.168.20.100", dhcpEnd: "192.168.20.200" });
  const sGast = await subnet("Gäste-WLAN", "192.168.30.0/24", 30, { gateway: "192.168.30.1", dnsServers: "1.1.1.1", dhcpStart: "192.168.30.50", dhcpEnd: "192.168.30.250", description: "Nur Internetzugang, kein Zugriff auf interne Netze." });
  const sMgmt = await subnet("Management", "192.168.99.0/24", 99, { gateway: "192.168.99.1", description: "Switches, Access Points, Firewall." });
  const sn = { 10: sBuero, 20: sWerk, 30: sGast, 99: sMgmt } as const;

  const day = (d: string) => new Date(`${d}T12:00:00`);
  type Extra = Partial<{ manufacturer: string; model: string; serialNumber: string; rackInfo: string; portCount: number; assignedTo: string; warrantyUntil: string; purchaseDate: string; monitor: boolean; notes: string }>;
  const dev = async (name: string, type: string, location: string, extra: Extra = {}, ips: Array<[10 | 20 | 30 | 99, string, string?, string?]> = []) => {
    const { warrantyUntil, purchaseDate, monitor, ...rest } = extra;
    const d = await db.netDevice.create({
      data: {
        name,
        type,
        locationId: loc[location].id,
        ...rest,
        warrantyUntil: warrantyUntil ? day(warrantyUntil) : null,
        purchaseDate: purchaseDate ? day(purchaseDate) : null,
        monitorEnabled: monitor ?? false,
      },
    });
    for (const [net, address, kind = "static", mac] of ips) {
      await db.netIp.create({ data: { address, subnetId: sn[net].id, deviceId: d.id, hostname: name, kind, mac: mac ?? null } });
    }
    return d;
  };

  const fw = await dev("fw-01", "firewall", "Serverraum", { manufacturer: "Netgate", model: "4100", rackInfo: "Rack 1 / HE 1", warrantyUntil: "2027-06-30", purchaseDate: "2024-06-30", monitor: true }, [
    [10, "192.168.10.1", "gateway"],
    [20, "192.168.20.1", "gateway"],
    [30, "192.168.30.1", "gateway"],
    [99, "192.168.99.1", "gateway"],
  ]);
  const core = await dev("sw-core-01", "switch", "Serverraum", { manufacturer: "Ubiquiti", model: "USW-Pro-24", rackInfo: "Rack 1 / HE 3", portCount: 24, warrantyUntil: "2026-12-15", purchaseDate: "2023-12-15", monitor: true }, [[99, "192.168.99.10"]]);
  const swW = await dev("sw-werkstatt-01", "switch", "Werkstatt", { manufacturer: "Ubiquiti", model: "USW-16-PoE", portCount: 16, warrantyUntil: "2028-03-01", monitor: true }, [[99, "192.168.99.11"]]);
  const apB = await dev("ap-buero", "access_point", "Büro EG", { manufacturer: "Ubiquiti", model: "U6-Pro", warrantyUntil: "2026-08-20", monitor: true }, [[99, "192.168.99.20"]]);
  const apW = await dev("ap-werkstatt", "access_point", "Werkstatt", { manufacturer: "Ubiquiti", model: "U6-Lite", warrantyUntil: "2028-01-10", monitor: true }, [[99, "192.168.99.21"]]);
  const dc = await dev("srv-dc01", "server", "Serverraum", { manufacturer: "Dell", model: "PowerEdge T150", serialNumber: "7K2M9Q3", rackInfo: "Rack 1 / HE 6", warrantyUntil: "2028-02-01", monitor: true, notes: "Domänencontroller, DNS, Dateiserver." }, [[10, "192.168.10.2", "static", "AA:BB:CC:10:00:02"]]);
  const werbas = await dev("srv-werbas", "server", "Serverraum", { manufacturer: "HPE", model: "ProLiant ML30", serialNumber: "CZ2231004X", rackInfo: "Rack 1 / HE 8", warrantyUntil: "2027-09-30", monitor: true, notes: "Läuft die Werbas-Datenbank." }, [[10, "192.168.10.3", "static", "AA:BB:CC:10:00:03"]]);
  const nas = await dev("nas-backup", "nas", "Serverraum", { manufacturer: "Synology", model: "DS923+", serialNumber: "2160T5N011", warrantyUntil: "2026-09-01", monitor: true, notes: "Nächtliche Backups von srv-dc01 und srv-werbas." }, [[10, "192.168.10.4", "static", "AA:BB:CC:10:00:04"]]);
  const pcE = await dev("pc-empfang", "workstation", "Empfang", { manufacturer: "Lenovo", model: "ThinkCentre M70q", assignedTo: "Empfang", warrantyUntil: "2027-04-01" }, [[10, "192.168.10.150", "dhcp_reservation", "AA:BB:CC:10:01:50"]]);
  await dev("pc-buero-01", "workstation", "Büro EG", { manufacturer: "Lenovo", model: "ThinkCentre M70q", assignedTo: "Buchhaltung", warrantyUntil: "2027-04-01" }, [[10, "192.168.10.151", "dhcp_reservation", "AA:BB:CC:10:01:51"]]);
  await dev("pc-buero-02", "workstation", "Büro EG", { manufacturer: "Lenovo", model: "ThinkCentre M70q", assignedTo: "Serviceberatung", warrantyUntil: "2027-04-01" }, [[10, "192.168.10.152", "dhcp_reservation", "AA:BB:CC:10:01:52"]]);
  await dev("nb-chef", "laptop", "Büro EG", { manufacturer: "Dell", model: "Latitude 5440", assignedTo: "Geschäftsführung", warrantyUntil: "2027-01-20" }, [[10, "192.168.10.153", "dhcp_reservation", "AA:BB:CC:10:01:53"]]);
  const pr = await dev("drucker-buero", "printer", "Büro EG", { manufacturer: "Brother", model: "HL-L8360CDW", monitor: true }, [[10, "192.168.10.60"]]);
  const pcW = await dev("pc-werkstatt-01", "workstation", "Werkstatt", { manufacturer: "HP", model: "EliteDesk 800 G6", assignedTo: "Werkstatt (Diagnose)", warrantyUntil: "2026-12-01", monitor: true }, [[20, "192.168.20.50"]]);
  await dev("tablet-diagnose", "laptop", "Werkstatt", { manufacturer: "Samsung", model: "Galaxy Tab Active4", assignedTo: "Werkstatt" }, [[20, "192.168.20.51", "dhcp_reservation"]]);
  const cam = await dev("cam-hof", "camera", "Lagerhalle", { manufacturer: "Ubiquiti", model: "G4 Bullet", monitor: true }, [[20, "192.168.20.80"]]);
  const patch = await dev("patch-01", "patch_panel", "Serverraum", { rackInfo: "Rack 1 / HE 2", portCount: 24, notes: "Arbeitsplätze Büro EG, Ports 1–12." });

  const link = (a: { id: string }, ap: string, b: { id: string }, bp: string, cable: string) =>
    db.netConnection.create({ data: { fromDeviceId: a.id, fromPort: ap, toDeviceId: b.id, toPort: bp, cableLabel: cable } });
  await link(fw, "LAN", core, "24", "K-001");
  await link(core, "1", dc, "eth0", "K-002");
  await link(core, "2", werbas, "eth0", "K-003");
  await link(core, "3", nas, "LAN 1", "K-004");
  await link(core, "4", apB, "eth0", "K-005");
  await link(core, "5", pr, "eth0", "K-006");
  await link(core, "6", patch, "1", "K-007");
  await link(patch, "2", pcE, "eth0", "K-008");
  await link(core, "23", swW, "16", "K-010");
  await link(swW, "1", apW, "eth0", "K-011");
  await link(swW, "2", pcW, "eth0", "K-012");
  await link(swW, "3", cam, "eth0", "K-013");
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const at = (offsetDays: number) => addDays(startOfDay(new Date()), offsetDays);
const noonOf = (d: Date) => new Date(`${iso(d)}T12:00:00`);

async function seedOfficeDemo() {
  if ((await db.employee.count()) > 0) return;
  console.log("Büro-Demo-Daten (Mitarbeiter, Fuhrpark, Rechnungen) werden angelegt …");

  // ───── Mitarbeiter ─────
  const mk = (firstName: string, lastName: string, department: string, jobTitle: string, extra: Record<string, unknown> = {}) =>
    db.employee.create({
      data: {
        firstName, lastName, department, jobTitle, vacationDaysPerYear: 30, active: true,
        email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@example.com`, hireDate: new Date("2019-04-01"),
        ...extra,
      },
    });
  const chef = await mk("Thomas", "Brandt", "management", "Geschäftsführer", { personnelNumber: "1001", emergencyName: "Karin Brandt", emergencyPhone: "0170 5550101", emergencyRelation: "Ehefrau" });
  const julia = await mk("Julia", "Wagner", "office", "Assistenz der Geschäftsführung", { personnelNumber: "1002" });
  const petra = await mk("Petra", "Lehmann", "office", "Buchhaltung", { personnelNumber: "1003" });
  await mk("Ida", "Kaiser", "it", "Systemadministratorin", { personnelNumber: "1004", emergencyName: "Jonas Kaiser", emergencyPhone: "0171 5550102", emergencyRelation: "Bruder" });
  const tom = await mk("Tom", "Meyer", "workshop", "Kfz-Mechatroniker", { personnelNumber: "2001" });
  const sven = await mk("Sven", "Richter", "workshop", "Kfz-Mechatroniker", { personnelNumber: "2002" });
  const lena = await mk("Lena", "Hoffmann", "workshop", "Kfz-Meisterin / Werkstattleitung", { personnelNumber: "2003", emergencyName: "Paul Hoffmann", emergencyPhone: "0172 5550103", emergencyRelation: "Ehemann" });
  const murat = await mk("Murat", "Demir", "workshop", "Lager & Reifenservice", { personnelNumber: "2004" });
  await mk("Frank", "Neumann", "workshop", "Kfz-Mechatroniker (ausgeschieden)", { personnelNumber: "2000", active: false, leaveDate: new Date("2025-12-31") });

  // Qualifikationen (einige bald/bereits abgelaufen)
  const qual = (employeeId: string, name: string, expiresInDays: number | null) =>
    db.qualification.create({ data: { employeeId, name, issuedAt: new Date("2022-03-01"), expiresAt: expiresInDays == null ? null : at(expiresInDays) } });
  await qual(lena.id, "Hochvolt-Fachkundiger (HV 2S)", 25);
  await qual(lena.id, "Klimaservice (Kältemittel)", 400);
  await qual(tom.id, "Hochvolt-Schulung HV 1S", -12);
  await qual(sven.id, "Brandschutzhelfer", 700);
  await qual(murat.id, "Staplerschein", 45);
  await qual(julia.id, "Ersthelfer", 120);

  // Abwesenheiten
  const absence = (employeeId: string, type: string, from: number, to: number, note?: string) =>
    db.absence.create({ data: { employeeId, type, startDate: noonOf(at(from)), endDate: noonOf(at(to)), note: note ?? null } });
  await absence(julia.id, "vacation", -1, 3, "Sommerurlaub");
  await absence(sven.id, "sick", 0, 1);
  await absence(petra.id, "training", 6, 7, "DATEV-Seminar");
  await absence(tom.id, "vacation", 14, 25);
  await absence(chef.id, "vacation", 30, 38);

  // ───── Fuhrpark ─────
  const caddy = await db.fleetVehicle.create({
    data: { plate: "B-FW 101", make: "VW", model: "Caddy Cargo", year: 2022, fuelType: "diesel", driverId: tom.id, location: "Werkstatthof", huDue: at(25), serviceDueKm: 60000,
      insuranceCompany: "Sicher Versicherung AG", insurancePolicy: "KFZ-2201-884", insuranceUntil: at(280), leasingProvider: "AutoLease Bank", leasingUntil: at(300), leasingRateCents: 28900, fuelCardNo: "7001 2200 4411" },
  });
  const transit = await db.fleetVehicle.create({
    data: { plate: "B-FW 102", make: "Ford", model: "Transit Custom", year: 2021, fuelType: "diesel", driverId: lena.id, location: "Werkstatthof", huDue: at(210), serviceDue: at(18),
      insuranceCompany: "Sicher Versicherung AG", insurancePolicy: "KFZ-2102-117", insuranceUntil: at(280), leasingProvider: "AutoLease Bank", leasingUntil: at(40), leasingRateCents: 34900 },
  });
  const octavia = await db.fleetVehicle.create({
    data: { plate: "B-FW 103", make: "Škoda", model: "Octavia Combi", year: 2020, fuelType: "petrol", driverId: julia.id, location: "Büro", huDue: at(120), serviceDueKm: 45000,
      insuranceCompany: "Sicher Versicherung AG", insurancePolicy: "KFZ-2003-559", insuranceUntil: at(190) },
  });
  const km = (fleetVehicleId: string, daysAgo: number, value: number) =>
    db.fleetMileage.create({ data: { fleetVehicleId, date: noonOf(at(-daysAgo)), km: value } });
  await km(caddy.id, 180, 21000); await km(caddy.id, 90, 26500); await km(caddy.id, 5, 31800);
  await km(transit.id, 150, 62000); await km(transit.id, 60, 70400); await km(transit.id, 3, 74900);
  await km(octavia.id, 200, 40100); await km(octavia.id, 100, 42500); await km(octavia.id, 7, 44200);
  const cost = (fleetVehicleId: string, daysAgo: number, category: string, amountCents: number, note?: string) =>
    db.fleetCost.create({ data: { fleetVehicleId, date: noonOf(at(-daysAgo)), category, amountCents, note: note ?? null } });
  await cost(caddy.id, 12, "fuel", 7450); await cost(caddy.id, 40, "fuel", 6890); await cost(caddy.id, 95, "service", 31200, "Inspektion + Ölwechsel");
  await cost(transit.id, 8, "fuel", 9120); await cost(transit.id, 70, "repair", 48750, "Bremsscheiben vorn");
  await cost(octavia.id, 15, "fuel", 6240); await cost(octavia.id, 120, "tires", 52000, "Winterreifen");

  // Führerscheinkontrollen: Tom bald fällig, Lena abgelaufen, Julia nie kontrolliert
  const check = (employeeId: string, monthsAgo: number) => {
    const checkedAt = noonOf(addDays(at(0), -monthsAgo * 30));
    return db.fleetLicenseCheck.create({ data: { employeeId, checkedAt, nextDue: noonOf(addDays(checkedAt, 182)), method: "Sichtkontrolle", checkedByName: "Administrator" } });
  };
  await check(tom.id, 5);
  await check(lena.id, 8);

  // ───── Rechnungen ─────
  const customers = await db.customer.findMany({ take: 3, orderBy: { customerNumber: "asc" } });
  const inv = (direction: "incoming" | "outgoing", number: string, partyName: string, issueAgo: number, dueIn: number | null, grossCents: number, status = "open", extra: Record<string, unknown> = {}) =>
    db.invoice.create({
      data: {
        direction, number, partyName, issueDate: noonOf(at(-issueAgo)), dueDate: dueIn == null ? null : noonOf(at(dueIn)),
        grossCents, netCents: Math.round(grossCents / 1.19), vatCents: grossCents - Math.round(grossCents / 1.19),
        status, paidAt: status === "paid" ? noonOf(at(-Math.max(issueAgo - 10, 1))) : null, ...extra,
      },
    });
  await inv("incoming", "RE-2026-4411", "Reifengroßhandel Nord GmbH", 40, -10, 482350, "open", { category: "Material", reference: "Ordner Eingang 2026/11" });
  await inv("incoming", "AM-77310", "Autoteile Müller", 22, 8, 123780, "open", { category: "Material" });
  await inv("incoming", "SW-11-2026", "Stadtwerke", 15, 15, 41280, "open", { category: "Nebenkosten" });
  await inv("incoming", "TK-9981234", "Telekom Deutschland", 30, -2, 18990, "open", { category: "Telefon/Internet" });
  await inv("incoming", "BB-2026-088", "Büro-Bedarf Schmitt", 60, -30, 9450, "paid", { category: "Büro" });
  await inv("incoming", "SV-2026-Q4", "Sicher Versicherung AG", 70, -40, 214000, "paid", { category: "Versicherung", reference: "Policen-Ordner" });
  await inv("outgoing", "2026-0187", customers[0] ? `${customers[0].firstName ?? ""} ${customers[0].lastName}`.trim() : "Kunde", 35, -5, 31250, "open", { customerId: customers[0]?.id, category: "Inspektion" });
  await inv("outgoing", "2026-0188", customers[1]?.company ?? customers[1]?.lastName ?? "Kunde", 20, 10, 128900, "open", { customerId: customers[1]?.id, category: "Reparatur" });
  await inv("outgoing", "2026-0189", customers[2] ? `${customers[2].firstName ?? ""} ${customers[2].lastName}`.trim() : "Kunde", 12, 2, 8900, "open", { customerId: customers[2]?.id, category: "Reifenwechsel" });
  await inv("outgoing", "2026-0176", customers[0] ? `${customers[0].firstName ?? ""} ${customers[0].lastName}`.trim() : "Kunde", 80, -50, 45600, "paid", { customerId: customers[0]?.id, category: "Reifenlagerung" });
}

async function seedDocsDemo() {
  if ((await db.docPage.count()) > 0) return;
  console.log("Doku-Demo-Seiten werden angelegt …");

  const cat = async (area: string, name: string, sortOrder: number) => (await db.docCategory.create({ data: { area, name, sortOrder } })).id;
  const page = async (area: string, title: string, categoryId: string | null, content: string, pinned = false) => {
    const created = await db.docPage.create({
      data: { area, slug: slugify(title), title, categoryId, content, pinned, createdByName: "Administrator", updatedByName: "Administrator" },
    });
    await db.docVersion.create({ data: { pageId: created.id, title, content, savedByName: "Administrator" } });
  };

  // Werkstatt
  const wArbeit = await cat("workshop", "Arbeitsanweisungen", 1);
  const wSicher = await cat("workshop", "Sicherheit", 2);
  await page("workshop", "Reifenwechsel – Ablauf", wArbeit, [
    "## Vorbereitung", "", "- Auftrag prüfen: Kennzeichen, Reifensatz, Felgenart", "- Reifenlager: Satz anhand des Lagerorts bereitstellen", "- Fahrzeug auf der Hebebühne aufnehmen (Aufnahmepunkte beachten)", "",
    "## Durchführung", "", "1. Räder abnehmen, Bremsen und Radlager auf Sicht prüfen", "2. Profiltiefe und DOT-Alter der neuen Räder messen und in der **Reifenliste** eintragen", "3. Räder montieren, Radschrauben **über Kreuz** vorziehen", "4. Mit Drehmomentschlüssel anziehen", "", "| Felgenart | Anzugsdrehmoment |", "| --- | --- |", "| Stahlfelge | laut Herstellerangabe |", "| Alufelge | laut Herstellerangabe |", "",
    "> Das Anzugsdrehmoment steht in der Fahrzeugdokumentation – hier ist bewusst kein Wert hinterlegt.", "",
    "## Nachbereitung", "", "- [ ] Alte Räder mit Lagerort etikettieren", "- [ ] Reifensatz in der Reifenliste auf *eingelagert* setzen", "- [ ] Nach 50 km Radschrauben nachziehen (kundeninformation)",
  ].join("\n"));
  await page("workshop", "Hebebühne: Sicherheitscheck", wSicher, [
    "Vor jeder Schicht kurz prüfen:", "", "- [ ] Aufnahmeteller und Tragarme unbeschädigt", "- [ ] Sicherungen rasten hörbar ein", "- [ ] Bereich um die Bühne frei", "- [ ] Mängel sofort der Werkstattleitung melden und Bühne sperren", "",
  ].join("\n"));
  await page("workshop", "Notfall: Verletzung in der Werkstatt", wSicher, [
    "## Sofortmaßnahmen", "", "1. **Ruhe bewahren**, Unfallstelle sichern", "2. Notruf **112**", "3. Erste Hilfe leisten (Verbandskasten: Eingang Werkstatt)", "4. Ersthelfer rufen", "5. Vorfall im Verbandbuch dokumentieren", "",
    "## Wichtige Orte", "", "- Verbandskasten und Augenspülung: am Eingang", "- Feuerlöscher: neben dem Hallentor", "",
  ].join("\n"), true);

  // IT
  const iAnl = await cat("it", "Anleitungen", 1);
  const iBetrieb = await cat("it", "Betrieb", 2);
  await page("it", "Netzwerk-Übersicht", iBetrieb, [
    "Die aktuelle Dokumentation von Geräten, IP-Adressen und Verkabelung steht im Bereich **IT & Netzwerk** dieser Anwendung.", "",
    "## Grundaufbau", "", "- Internet → Firewall → Core-Switch → Server, Access Points, Arbeitsplätze", "- Getrennte VLANs für Büro, Werkstatt, Gäste und Management", "",
    "## Regeln", "", "- Neue Geräte bekommen **immer** einen Eintrag im Geräte-Inventar", "- Statische Adressen nur außerhalb des DHCP-Bereichs", "- Änderungen an der Firewall werden hier dokumentiert", "",
  ].join("\n"), true);
  await page("it", "Neuer Mitarbeiter – Onboarding", iAnl, [
    "## Checkliste", "", "- [ ] Benutzerkonto in **Verwaltung → Benutzer** anlegen und Rolle zuweisen", "- [ ] Mitarbeiter unter **Büro → Mitarbeiter** anlegen und mit dem Konto verknüpfen", "- [ ] Arbeitsplatz-PC im Geräte-Inventar erfassen", "- [ ] Erstpasswort übergeben (muss beim ersten Login geändert werden)", "",
  ].join("\n"));
  await page("it", "Backup-Konzept", iBetrieb, [
    "## Was wird gesichert?", "", "| Was | Wie oft | Wohin |", "| --- | --- | --- |", "| Datenbank dieser Anwendung | täglich | NAS |", "| Server (Dateien) | täglich | NAS |", "", "```bash", "# Datenbank-Dump (Docker)", "docker compose exec db pg_dump -U schrauberos schrauberos > backup.sql", "```", "",
    "Restore-Test: **vierteljährlich** durchführen und hier protokollieren.", "",
  ].join("\n"));

  // Büro
  const bProzess = await cat("office", "Abläufe", 1);
  const bVorlagen = await cat("office", "Vorlagen & Kontakte", 2);
  await page("office", "Rechnungsprozess", bProzess, [
    "## Eingangsrechnungen", "", "1. Rechnung im **Rechnungsarchiv → Eingang** erfassen (Beleg hochladen)", "2. Sachlich prüfen lassen (Werkstattleitung bei Material)", "3. Zur Fälligkeit bezahlen und als *bezahlt* markieren", "",
    "## Ausgangsrechnungen", "", "1. Rechnung wird im Warenwirtschaftssystem erstellt", "2. Im Archiv unter **Ausgang** erfassen und dem Kunden zuordnen", "3. Zahlungseingang prüfen – überfällige Rechnungen erscheinen auf der Übersicht", "",
  ].join("\n"), true);
  await page("office", "Urlaub & Abwesenheiten", bProzess, [
    "Urlaub, Schulungen und Krankheit werden unter **Büro → Abwesenheiten** eingetragen.", "", "- Urlaub bitte **2 Wochen** vorher mit der Geschäftsführung abstimmen", "- Krankmeldungen am ersten Tag bis 8 Uhr telefonisch melden", "- Der Kalender zeigt die Abwesenheiten aller Mitarbeiter im Monat", "",
  ].join("\n"));
  await page("office", "Wichtige Ansprechpartner", bVorlagen, [
    "| Thema | Ansprechpartner |", "| --- | --- |", "| Steuerberater | *hier eintragen* |", "| Versicherung | *hier eintragen* |", "| IT-Störung | IT-Administration |", "",
  ].join("\n"));
}

async function main() {
  await seedRoles();
  await seedAdmin();
  await seedWorkshopBasics();
  if (process.env.SEED_DEMO === "true") {
    await seedDemo();
    await seedNetworkDemo();
    await seedOfficeDemo();
    await seedDocsDemo();
  }
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });

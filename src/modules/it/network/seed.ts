import type { PrismaClient } from "@/generated/prisma/client";
import type { SeedDef } from "@/modules/types";

/** Beispiel-Netzwerk: Standorte, VLANs, Subnetze, Geräte mit Adressen und Verkabelung. */
async function demo(db: PrismaClient) {
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

export const seeds: SeedDef[] = [{ id: "network", feature: "it.network", order: 110, demo }];

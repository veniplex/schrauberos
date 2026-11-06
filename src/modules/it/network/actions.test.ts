import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { versionOf } from "@/lib/concurrency";
import { createTestEnv, form, redirectOf, type TestEnv } from "@/test/harness";

/** Netzwerk im Aktions-Rahmen: Rechte, IP-Prüfungen (Subnetz, Eindeutigkeit, MAC), Ports, Versionssperre, Audit. */
let env: TestEnv;
let actions: typeof import("./actions");
before(async () => {
  env = await createTestEnv();
  actions = await import("./actions");
});
after(() => env.cleanup());

const login = async (permissions: string[]) => {
  const user = await env.user({ username: `u-${Math.random()}`, roles: [await env.role({ permissions })] });
  await env.signIn(user);
  return user;
};
const entries = (action: string) => env.db.auditLog.findMany({ where: { action } });
const targets = async () => (await env.db.auditLog.findMany({ orderBy: { createdAt: "asc" } })).map((e) => `${e.action} ${e.target}`);

beforeEach(async () => {
  await env.db.netConnection.deleteMany();
  await env.db.netIp.deleteMany();
  await env.db.netSubnet.deleteMany();
  await env.db.netVlan.deleteMany();
  await env.db.netDevice.deleteMany();
  await env.db.netLocation.deleteMany();
  await env.db.auditLog.deleteMany();
  env.browser.reset();
});

describe("Geräte", () => {
  const save = (fields: Record<string, string | number | boolean | undefined> = {}) => actions.saveDevice({}, form({ name: "Switch EG", type: "switch", ...fields }));

  it("braucht network.edit; Anlegen protokolliert, Häkchen „Überwachung“ wird übernommen", async () => {
    await login(["network.view"]);
    assert.equal(await redirectOf(() => save()), "/forbidden");
    await login(["network.edit"]);
    const target = await redirectOf(() => save({ monitorEnabled: true, portCount: 24 }));
    const device = await env.db.netDevice.findFirstOrThrow();
    assert.equal(target, `/network/devices/${device.id}`);
    assert.deepEqual([device.monitorEnabled, device.portCount], [true, 24]);
    assert.deepEqual(await targets(), ["network.create device: Switch EG"]);
  });

  it("prüft Typ, Portanzahl und Standort", async () => {
    await login(["network.edit"]);
    assert.ok((await save({ type: "toaster" })).fieldErrors?.type);
    assert.ok((await save({ portCount: 0 })).fieldErrors?.portCount);
    assert.ok((await save({ locationId: "gibt-es-nicht" })).fieldErrors?.locationId);
    assert.equal(await env.db.netDevice.count(), 0);
  });

  it("Ändern prüft die Version; Löschen braucht network.delete", async () => {
    await login(["network.edit"]);
    await redirectOf(() => save());
    const device = await env.db.netDevice.findFirstOrThrow();
    const stale = versionOf(device);
    assert.ok(await redirectOf(() => save({ id: device.id, version: stale, model: "Neu" })));
    assert.ok((await save({ id: device.id, version: stale, model: "Veraltet" })).error);
    assert.equal((await env.db.netDevice.findUniqueOrThrow({ where: { id: device.id } })).model, "Neu");
    assert.equal(await redirectOf(() => actions.deleteDevice(form({ id: device.id }))), "/forbidden");
    await login(["network.delete"]);
    assert.equal(await redirectOf(() => actions.deleteDevice(form({ id: device.id }))), "/network/devices");
    assert.deepEqual(await targets(), ["network.create device: Switch EG", "network.update device: Switch EG", "network.delete device: Switch EG"]);
  });
});

describe("VLANs, Subnetze und IP-Adressen", () => {
  const subnet = (fields: Record<string, string | undefined> = {}) => actions.saveSubnet({}, form({ name: "Büro", cidr: "192.168.10.0/24", ...fields }));
  const ip = (subnetId: string, fields: Record<string, string | undefined> = {}) => actions.saveIp({}, form({ subnetId, address: "192.168.10.5", ...fields }));

  it("VLAN-Nummern sind eindeutig und zwischen 1 und 4094", async () => {
    await login(["network.edit"]);
    assert.equal((await actions.saveVlan({}, form({ vlanId: 10, name: "Büro" }))).ok, true);
    assert.ok((await actions.saveVlan({}, form({ vlanId: 10, name: "Doppelt" }))).fieldErrors?.vlanId);
    assert.ok((await actions.saveVlan({}, form({ vlanId: 4095, name: "Zu hoch" }))).fieldErrors?.vlanId);
    assert.equal(await env.db.netVlan.count(), 1);
    const vlan = await env.db.netVlan.findFirstOrThrow();
    assert.equal((await actions.saveVlan({}, form({ id: vlan.id, vlanId: 10, name: "Umbenannt" }))).ok, true, "die eigene Nummer bleibt erlaubt");
  });

  it("Subnetz: nur echte Netzadressen; Gateway/DHCP/DNS werden geprüft; doppelte Netze abgelehnt", async () => {
    await login(["network.edit"]);
    assert.ok((await subnet({ cidr: "kein-netz" })).fieldErrors?.cidr);
    assert.ok((await subnet({ cidr: "192.168.10.77/24" })).fieldErrors?.cidr, "Hostadresse ist keine Netzadresse");
    const errors = (await subnet({ gateway: "10.0.0.1", dhcpStart: "192.168.10.200", dhcpEnd: "192.168.10.100", dnsServers: "8.8.8.8, kaputt" })).fieldErrors ?? {};
    assert.ok(errors.gateway && errors.dhcpEnd && errors.dnsServers);
    const target = await redirectOf(() => subnet({ gateway: "192.168.10.1", dnsServers: "8.8.8.8;1.1.1.1" }));
    const created = await env.db.netSubnet.findFirstOrThrow();
    assert.equal(target, `/network/ip/${created.id}`);
    assert.equal(created.cidr, "192.168.10.0/24");
    assert.equal(created.dnsServers, "8.8.8.8, 1.1.1.1");
    assert.ok((await subnet({ name: "Noch mal" })).fieldErrors?.cidr);
    assert.ok((await subnet({ name: "Anderes", cidr: "192.168.20.0/24", vlanId: "gibt-es-nicht" })).fieldErrors?.vlanId);
  });

  it("IP: muss im Subnetz liegen, ist eindeutig, die MAC wird normalisiert und geprüft, Version schützt vor Überschreiben", async () => {
    await login(["network.edit"]);
    await redirectOf(() => subnet());
    const net = await env.db.netSubnet.findFirstOrThrow();
    assert.ok((await ip(net.id, { address: "10.0.0.5" })).fieldErrors?.address);
    assert.ok((await ip(net.id, { address: "999.1.1.1" })).fieldErrors?.address);
    assert.ok((await ip(net.id, { mac: "nicht-mac" })).fieldErrors?.mac);
    assert.ok((await ip("gibt-es-nicht")).error);
    assert.equal(await redirectOf(() => ip(net.id, { hostname: "drucker", mac: "aa-bb-cc-dd-ee-ff" })), `/network/ip/${net.id}`);
    const row = await env.db.netIp.findFirstOrThrow();
    assert.equal(row.mac, "AA:BB:CC:DD:EE:FF");
    assert.ok((await ip(net.id, { hostname: "doppelt" })).fieldErrors?.address, "Adresse nur einmal");
    assert.equal(await redirectOf(() => ip(net.id, { id: row.id, version: versionOf(row), hostname: "neu", returnTo: "/network/ip?x=1" })), "/network/ip?x=1");
    assert.ok((await ip(net.id, { id: row.id, version: versionOf(row), hostname: "veraltet" })).error);
    assert.equal((await env.db.netIp.findUniqueOrThrow({ where: { id: row.id } })).hostname, "neu");
  });

  it("Löschen von IP, Subnetz und VLAN braucht network.delete und wird protokolliert; ein Subnetz nimmt seine IPs mit", async () => {
    await login(["network.edit", "network.delete"]);
    await actions.saveVlan({}, form({ vlanId: 20, name: "Gäste" }));
    await redirectOf(() => subnet());
    const net = await env.db.netSubnet.findFirstOrThrow();
    await redirectOf(() => ip(net.id));
    const row = await env.db.netIp.findFirstOrThrow();
    assert.equal(await redirectOf(() => actions.deleteIp(form({ id: row.id, returnTo: "https://evil.example" }))), "/network/ip", "unsicheres Rücksprungziel wird ignoriert");
    await redirectOf(() => ip(net.id));
    assert.equal(await redirectOf(() => actions.deleteSubnet(form({ id: net.id }))), "/network/ip");
    assert.equal(await env.db.netIp.count(), 0);
    await actions.deleteVlan(form({ id: (await env.db.netVlan.findFirstOrThrow()).id }));
    assert.deepEqual((await targets()).filter((t) => t.startsWith("network.delete")), ["network.delete IP: 192.168.10.5", "network.delete subnet: Büro (192.168.10.0/24)", "network.delete VLAN: 20 Gäste"]);

    await login(["network.edit"]);
    assert.equal(await redirectOf(() => actions.deleteVlan(form({ id: "x" }))), "/forbidden");
  });
});

describe("Standorte und Kabel", () => {
  it("Standorte: anlegen, ändern, löschen – jeweils protokolliert", async () => {
    await login(["network.edit", "network.delete"]);
    assert.equal((await actions.saveLocation({}, form({ name: "Serverraum", sortOrder: 1 }))).ok, true);
    const loc = await env.db.netLocation.findFirstOrThrow();
    assert.equal((await actions.saveLocation({}, form({ id: loc.id, name: "Serverraum EG" }))).ok, true);
    await actions.deleteLocation(form({ id: loc.id }));
    assert.equal(await env.db.netLocation.count(), 0);
    assert.deepEqual(await targets(), ["network.create location: Serverraum", "network.update location: Serverraum EG", "network.delete location: Serverraum EG"]);
  });

  it("Verbindungen: nicht mit sich selbst, Ports nur einmal belegt, Geräte müssen existieren", async () => {
    await login(["network.edit", "network.delete"]);
    const a = await env.db.netDevice.create({ data: { name: "Switch", type: "switch" } });
    const b = await env.db.netDevice.create({ data: { name: "Server", type: "server" } });
    const connect = (fields: Record<string, string | undefined>) => actions.saveConnection({}, form({ fromDeviceId: a.id, toDeviceId: b.id, ...fields }));
    assert.ok((await connect({ toDeviceId: a.id })).fieldErrors?.toDeviceId);
    assert.ok((await connect({ toDeviceId: "gibt-es-nicht" })).fieldErrors?.toDeviceId);
    assert.equal((await connect({ fromPort: "Gi1/0/1", toPort: "eth0" })).ok, true);
    assert.ok((await connect({ fromPort: "Gi1/0/1", toPort: "eth1" })).fieldErrors?.fromPort);
    assert.ok((await connect({ fromPort: "Gi1/0/2", toPort: "eth0" })).fieldErrors?.toPort);
    assert.equal((await connect({ fromPort: "Gi1/0/2", toPort: "eth1" })).ok, true);
    assert.equal(await env.db.netConnection.count(), 2);
    await actions.deleteConnection(form({ id: (await env.db.netConnection.findFirstOrThrow()).id }));
    assert.equal(await env.db.netConnection.count(), 1);
    assert.equal((await entries("network.delete"))[0].target, "connection: Switch – Server");
  });

  it("alle Bearbeitungen verlangen network.edit, alle Löschungen network.delete", async () => {
    await login(["network.view"]);
    for (const run of [
      () => actions.saveLocation({}, form({ name: "X" })),
      () => actions.saveVlan({}, form({ vlanId: 5, name: "X" })),
      () => actions.saveConnection({}, form({ fromDeviceId: "a", toDeviceId: "b" })),
      () => actions.deleteLocation(form({ id: "x" })),
      () => actions.deleteConnection(form({ id: "x" })),
    ]) assert.equal(await redirectOf(run), "/forbidden");
    assert.equal(await env.db.auditLog.count(), 0);
  });
});

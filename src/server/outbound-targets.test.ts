import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, afterEach, before, describe, it } from "node:test";
import { createTestEnv, type TestEnv } from "@/test/harness";

/**
 * Eine Zielregel für jede ausgehende Verbindung (Block 14, Entscheid des Besitzers): Webhooks, Off-Site-Backup (SFTP und WebDAV), E-Mail-Versand und Überwachung prüfen **jede aufgelöste Adresse** einschließlich des
 * Docker-Host-Gateways – auch mit `allowPrivate`. Der Test spielt je Verbindungsart durch: Literal, Namen mit einer erlaubten und einer Gateway-Antwort, `allowPrivate` öffnet nur private Netze, und der Quelltext
 * jedes Resolvers ruft `isAllowedTarget` (keiner baut eine eigene Bedingung).
 */
let env: TestEnv;
let gateway: typeof import("./host-gateway");
let webhook: typeof import("./webhooks/target");
let mail: typeof import("./mail/transport");
let monitor: typeof import("./monitor/resolve");
let offsite: typeof import("./backup/offsite/resolve");

const GATEWAY = "172.18.0.1";
type Answers = Array<{ address: string; family: number }>;
const lookupOf = (...addresses: string[]) => async (): Promise<Answers> => addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));

before(async () => {
  env = await createTestEnv();
  gateway = await import("./host-gateway");
  webhook = await import("./webhooks/target");
  mail = await import("./mail/transport");
  monitor = await import("./monitor/resolve");
  offsite = await import("./backup/offsite/resolve");
});
after(() => env.cleanup());
afterEach(() => gateway.setGatewayTestHooks({}));

describe("isAllowedTarget", () => {
  it("sperrt das Host-Gateway immer, private Netze nur ohne Freigabe; Öffentliches ist erlaubt", () => {
    gateway.setGatewayTestHooks({ gateways: [GATEWAY] });
    assert.equal(gateway.isAllowedTarget(GATEWAY), false);
    assert.equal(gateway.isAllowedTarget(GATEWAY, { allowPrivate: true }), false, "allowPrivate öffnet nie den Server selbst");
    assert.equal(gateway.isAllowedTarget("::ffff:172.18.0.1", { allowPrivate: true }), false, "auch in der gemappten Schreibweise");
    assert.equal(gateway.isAllowedTarget("10.0.0.5"), true);
    assert.equal(gateway.isAllowedTarget("10.0.0.5", { allowPrivate: false }), false);
    assert.equal(gateway.isAllowedTarget("10.0.0.5", { allowPrivate: true }), true);
    assert.equal(gateway.isAllowedTarget("8.8.8.8", { allowPrivate: false }), true);
    assert.equal(gateway.isAllowedTarget("169.254.169.254", { allowPrivate: true }), false, "Metadaten bleiben gesperrt");
    assert.equal(gateway.isAllowedTarget("127.0.0.1", { allowPrivate: true }), false);
  });

  it("isForbiddenTargetHost (Eingabeprüfung): Docker-Host-Namen, Loopback, Gateway-Literale; gewöhnliche Namen und private Adressen nicht", () => {
    gateway.setGatewayTestHooks({ gateways: [GATEWAY] });
    for (const host of ["host.docker.internal", "localhost", "127.0.0.1", GATEWAY, "[::ffff:172.18.0.1]", "169.254.169.254"]) assert.equal(gateway.isForbiddenTargetHost(host), true, host);
    for (const host of ["nas.example.org", "10.0.0.5", "8.8.8.8"]) assert.equal(gateway.isForbiddenTargetHost(host), false, host);
  });
});

describe("jede Verbindungsart prüft jede aufgelöste Adresse inklusive Host-Gateway", () => {
  it("Webhooks (auch mit allowPrivate)", async () => {
    gateway.setGatewayTestHooks({ gateways: [GATEWAY] });
    for (const allowPrivate of [false, true]) {
      await assert.rejects(() => webhook.resolveWebhookTarget(GATEWAY, { allowPrivate }), /forbiddenHost/, "Literal");
      await assert.rejects(() => webhook.resolveWebhookTarget("hooks.example.org", { allowPrivate }, lookupOf("93.184.216.34", GATEWAY)), /forbiddenHost/, "Name mit einer Gateway-Antwort");
      await assert.rejects(() => webhook.resolveWebhookTarget("hooks.example.org", { allowPrivate }, lookupOf(GATEWAY, "93.184.216.34")), /forbiddenHost/, "Gateway als erste Antwort");
    }
    assert.equal((await webhook.resolveWebhookTarget("erp.example.org", { allowPrivate: true }, lookupOf("10.0.0.5"))).address, "10.0.0.5", "allowPrivate öffnet private Netze");
    await assert.rejects(() => webhook.resolveWebhookTarget("erp.example.org", { allowPrivate: false }, lookupOf("10.0.0.5")), /forbiddenHost/);
  });

  it("E-Mail-Versand (auch mit allowPrivate)", async () => {
    gateway.setGatewayTestHooks({ gateways: [GATEWAY] });
    for (const allowPrivate of [false, true]) {
      await assert.rejects(() => mail.resolveMailTarget(GATEWAY, { allowPrivate }), /forbiddenHost/);
      await assert.rejects(() => mail.resolveMailTarget("smtp.example.org", { allowPrivate }, lookupOf("93.184.216.34", GATEWAY)), /forbiddenHost/);
    }
    assert.equal((await mail.resolveMailTarget("relay.example.org", { allowPrivate: true }, lookupOf("10.0.0.25"))).address, "10.0.0.25");
    await assert.rejects(() => mail.resolveMailTarget("relay.example.org", { allowPrivate: false }, lookupOf("10.0.0.25")), /forbiddenHost/);
  });

  it("Überwachung", async () => {
    gateway.setGatewayTestHooks({ gateways: [GATEWAY] });
    await assert.rejects(() => monitor.resolveMonitorTarget(GATEWAY, 1000), /blocked/);
    await assert.rejects(() => monitor.resolveMonitorTarget("nas.example.org", 1000, lookupOf("10.0.0.7", GATEWAY)), /blocked/);
    const ok = await monitor.resolveMonitorTarget("nas.example.org", 1000, lookupOf("10.0.0.7"));
    assert.equal(ok.addresses[0].address, "10.0.0.7", "private Ziele sind bei der Überwachung erlaubt (es ist das Firmennetz), der Server selbst nicht");
  });

  it("Off-Site-Backup (SFTP und WebDAV teilen den Resolver)", async () => {
    gateway.setGatewayTestHooks({ gateways: [GATEWAY] });
    await assert.rejects(() => offsite.resolvePinned(GATEWAY), /forbiddenHost/);
    await assert.rejects(() => offsite.resolvePinned("backup.example.org", lookupOf("93.184.216.34", GATEWAY)), /forbiddenHost/);
    assert.equal((await offsite.resolvePinned("nas.example.org", lookupOf("10.0.0.9"))).address, "10.0.0.9");
  });
});

describe("keine eigene Bedingung in den Resolvern", () => {
  const files = ["server/webhooks/target.ts", "server/mail/transport.ts", "server/monitor/resolve.ts", "server/backup/offsite/resolve.ts"];
  for (const file of files) {
    it(`${file} nutzt isAllowedTarget und nie isHostGateway/isAllowedAddress selbst`, () => {
      const source = readFileSync(path.join(process.cwd(), "src", file), "utf8");
      assert.match(source, /isAllowedTarget\(/);
      assert.doesNotMatch(source, /\bisHostGateway\(/);
      assert.doesNotMatch(source, /\bisAllowedAddress\(/);
    });
  }
  it("die Eingabeprüfungen der Operationen nutzen isForbiddenTargetHost", () => {
    for (const file of ["modules/admin/api/operations.ts", "modules/admin/backup/offsite-actions.ts", "modules/admin/mail/operations.ts", "modules/it/network/monitor-operations.ts"]) {
      const source = readFileSync(path.join(process.cwd(), "src", file), "utf8");
      assert.match(source, /isForbiddenTargetHost\(/, file);
      assert.doesNotMatch(source, /\bisHostGateway(Host)?\(/, file);
    }
  });
});

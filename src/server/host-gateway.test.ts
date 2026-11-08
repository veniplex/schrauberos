import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { hostGatewayAddresses, isHostGateway, isHostGatewayHost, parseConnectedFirstHosts, parseDefaultGateways, parseGateways, parseIpv6Gateways, resetGatewayCache, routeSources } from "./host-gateway";

/**
 * Gateways des Containers (Z6-2 M1): nicht nur die Standardroute, sondern alle Gateways aller Routen, die erste Adresse jedes direkt verbundenen Netzes (Docker-Brücke eines zweiten
 * Compose-Netzes) und IPv6 – gegen Fake-Routentabellen. Außerhalb eines Containers ist nichts gesperrt.
 */
const original = { ...routeSources };
afterEach(() => {
  Object.assign(routeSources, original);
  resetGatewayCache();
});

const HEADER = "Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\t\tMTU\tWindow\tIRTT";
/** Container in zwei Compose-Netzen: App-Netz 172.18.0.0/16 (Standardroute über 172.18.0.1) und Proxy-Netz 172.20.0.0/16 (direkt verbunden, ohne Route zum Gateway), dazu eine Netzroute über 172.18.0.254. */
const TABLE = [
  HEADER,
  "eth0\t00000000\t010012AC\t0003\t0\t0\t0\t00000000\t0\t0\t0", // default via 172.18.0.1
  "eth0\t000012AC\t00000000\t0001\t0\t0\t0\t0000FFFF\t0\t0\t0", // 172.18.0.0/16 direkt
  "eth1\t000014AC\t00000000\t0001\t0\t0\t0\t0000FFFF\t0\t0\t0", // 172.20.0.0/16 direkt (zweites Netz)
  "eth0\t0000000A\tFE0012AC\t0003\t0\t0\t0\t000000FF\t0\t0\t0", // 10.0.0.0/8 via 172.18.0.254
  "eth2\t0000A8C0\t00000000\t0001\t0\t0\t0\t00FFFFFF\t0\t0\t0", // 192.168.0.0/24 direkt
  "eth2\tCCCCCCCC\t00000000\t0001\t0\t0\t0\t00FF00FF\t0\t0\t0", // nicht zusammenhängende Maske: ignoriert
  "zzzz\tnicht-hex\t010012AC\t0003\t0\t0\t0\t00000000\t0\t0\t0",
].join("\n");

describe("Routentabellen lesen", () => {
  it("alle Gateways aller Routen, nicht nur die Standardroute", () => {
    assert.deepEqual(parseGateways(TABLE).sort(), ["172.18.0.1", "172.18.0.254"]);
    assert.deepEqual(parseDefaultGateways(TABLE), ["172.18.0.1"]);
    assert.deepEqual(parseGateways(""), []);
  });

  it("die erste Adresse jedes direkt verbundenen Netzes (Docker-Brücke), Präfix 8 bis 30; Müll und lückenhafte Masken zählen nicht", () => {
    assert.deepEqual(parseConnectedFirstHosts(TABLE).sort(), ["172.18.0.1", "172.20.0.1", "192.168.0.1"]);
    const tiny = [HEADER, "eth0\t0000A8C0\t00000000\t0001\t0\t0\t0\tFCFFFFFF\t0\t0\t0", "eth0\t0000B0C0\t00000000\t0001\t0\t0\t0\tFFFFFFFF\t0\t0\t0"].join("\n"); // /30 und /32
    assert.deepEqual(parseConnectedFirstHosts(tiny), ["192.168.0.1"], "ein /32 hat keine erste Adresse daneben");
  });

  it("IPv6: nächster Hop mit Gateway-Flag; Routen ohne Gateway und :: zählen nicht", () => {
    const table = [
      "00000000000000000000000000000000 00 00000000000000000000000000000000 00 fe800000000000000000000000000001 00000400 00000001 00000000 00000003     eth0",
      "fd000000000000000000000000000000 40 00000000000000000000000000000000 00 00000000000000000000000000000000 00000100 00000001 00000000 00000001     eth0",
      "fd0000000000000000000000000000ff 80 00000000000000000000000000000000 00 fd000000000000000000000000000001 00000100 00000001 00000000 00000003     eth0",
      "muell",
    ].join("\n");
    assert.deepEqual(parseIpv6Gateways(table), ["fe80:0:0:0:0:0:0:1", "fd00:0:0:0:0:0:0:1"]);
    assert.deepEqual(parseIpv6Gateways(""), []);
  });
});

describe("Sperre im Container", () => {
  const inContainer = (container: boolean) => {
    routeSources.container = () => container;
    routeSources.ipv4 = () => TABLE;
    routeSources.ipv6 = () => "00000000000000000000000000000000 00 00000000000000000000000000000000 00 fd000000000000000000000000000001 00000100 00000001 00000000 00000003     eth0";
    resetGatewayCache();
  };

  it("im Container sind beide Brücken, die Netzroute und das IPv6-Gateway gesperrt – Nachbarn im selben Netz und das LAN bleiben erreichbar", () => {
    inContainer(true);
    for (const blocked of ["172.18.0.1", "172.20.0.1", "172.18.0.254", "192.168.0.1", "[fd00::1]", "::ffff:172.20.0.1"]) assert.equal(isHostGateway(blocked), true, blocked);
    for (const allowed of ["172.18.0.2", "172.20.0.2", "192.168.0.20", "10.0.0.5", "8.8.8.8", "fd00::2"]) assert.equal(isHostGateway(allowed), false, allowed);
    assert.equal(isHostGatewayHost("172.20.0.1"), true);
    assert.equal(isHostGatewayHost("nas.example.org"), false, "Namen löst erst das Verbinden auf");
  });

  it("außerhalb eines Containers (der Router ist ein erlaubtes Ziel) und ohne lesbare Tabelle ist nichts gesperrt – kein Fehler", () => {
    inContainer(false);
    assert.equal(hostGatewayAddresses().size, 0);
    assert.equal(isHostGateway("172.18.0.1"), false);
    routeSources.container = () => true;
    routeSources.ipv4 = () => {
      throw new Error("kein /proc");
    };
    routeSources.ipv6 = () => {
      throw new Error("kein IPv6");
    };
    resetGatewayCache();
    assert.equal(hostGatewayAddresses().size, 0);
  });
});

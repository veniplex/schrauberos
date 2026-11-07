import { isIP } from "node:net";
import { networkInterfaces } from "node:os";

/**
 * Welche Adressen sind als Ziel des Off-Site-Backups erlaubt? Reine Logik ohne Netzwerkzugriff (die Namensauflösung steht in `server/backup/offsite/resolve.ts`).
 *
 * **Richtlinie (ZP5-6):**
 *  - verboten: der eigene Rechner (Loopback `127.0.0.0/8`, `::1`, die eigenen Schnittstellenadressen), „dieses Netz“ (`0.0.0.0/8`, `::`), Verbindungs-lokal (`169.254.0.0/16`,
 *    `fe80::/10`), Multicast und Reserviertes (`224.0.0.0/3`, `ff00::/8`) und die Metadaten-Dienste der Cloud-Anbieter (`169.254.169.254`, `fd00:ec2::/32`, `100.100.100.200`,
 *    `168.63.129.16`, `metadata.google.internal` …) – auch als Administrator nicht;
 *  - erlaubt: **private Netze** (RFC 1918, `fc00::/7`, `100.64.0.0/10`) und öffentliche Adressen – ein NAS im LAN ist der Normalfall;
 *  - Adressen in jeder Schreibweise (Dezimal `2852039166`, Hex `0xa9fea9fe`, Oktal `0251.0376.0251.0376`, `0`, IPv4-in-IPv6 wie `::ffff:a9fe:a9fe`, NAT64, 6to4, Teredo) werden
 *    wie die kanonische Adresse behandelt;
 *  - Namen werden **aufgelöst und alle Antworten geprüft**; verbunden wird mit der geprüften Adresse (kein Wechsel zwischen Prüfung und Verbindung, `resolve.ts`).
 * Loopback ist nur in Tests erlaubt (`allowLoopbackForTests`, die Prüfung auf `NODE_TEST_CONTEXT` verhindert das im Betrieb).
 */
export const offsiteNetwork = { allowLoopback: false };

/** Nur für Tests (Fake-Server auf 127.0.0.1): erlaubt Loopback-Ziele. Im Betrieb wirkungslos – es wirft. */
export function allowLoopbackForTests(): void {
  if (!process.env.NODE_TEST_CONTEXT) throw new Error("allowLoopbackForTests: nur in Tests");
  offsiteNetwork.allowLoopback = true;
}

/** Namen, die nie ein Ziel sein sollen (Metadaten-Dienste, der eigene Rechner). */
const FORBIDDEN_NAMES = new Set(["metadata.google.internal", "metadata.goog", "instance-data", "instance-data.ec2.internal", "metadata.azure.com"]);

const toInt = (a: number, b: number, c: number, d: number) => (((a << 24) | (b << 16) | (c << 8) | d) >>> 0) as number;
const inCidr = (value: number, base: [number, number, number, number], bits: number): boolean => {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return ((value & mask) >>> 0) === ((toInt(...base) & mask) >>> 0);
};

/** Verbotene IPv4-Bereiche (außer Loopback) */
const V4_FORBIDDEN: Array<[[number, number, number, number], number]> = [
  [[0, 0, 0, 0], 8],
  [[169, 254, 0, 0], 16],
  [[224, 0, 0, 0], 4],
  [[240, 0, 0, 0], 4],
  [[100, 100, 100, 200], 32],
  [[168, 63, 129, 16], 32],
  [[192, 0, 0, 192], 32],
];

const parseV4 = (ip: string): [number, number, number, number] | null => {
  const parts = ip.split(".").map(Number);
  return parts.length === 4 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? (parts as [number, number, number, number]) : null;
};

/** Die acht 16-Bit-Gruppen einer IPv6-Adresse (aus der kanonischen Schreibweise der URL-Klasse, die auch gemischte Schreibweisen wie `::ffff:1.2.3.4` vereinheitlicht). */
function v6Groups(ip: string): number[] | null {
  let canonical: string;
  try {
    canonical = new URL(`http://[${ip.split("%")[0]}]/`).hostname.replace(/^\[|\]$/g, "");
  } catch {
    return null;
  }
  const [head, tail, ...more] = canonical.split("::");
  if (more.length) return null;
  const left = head ? head.split(":") : [];
  const right = tail === undefined ? [] : tail ? tail.split(":") : [];
  const fill = tail === undefined ? 0 : 8 - left.length - right.length;
  if (fill < 0 || (tail === undefined && left.length !== 8)) return null;
  const groups = [...left, ...Array<string>(fill).fill("0"), ...right].map((g) => Number.parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

/** In einer IPv6-Adresse eingebettete IPv4-Adresse (IPv4-gemappt, -kompatibel, NAT64, 6to4, Teredo), sonst null. */
function embeddedV4(g: number[]): [number, number, number, number] | null {
  const v4 = (hi: number, lo: number): [number, number, number, number] => [hi >> 8, hi & 255, lo >> 8, lo & 255];
  const zeros = (from: number, to: number) => g.slice(from, to).every((x) => x === 0);
  if (zeros(0, 5) && g[5] === 0xffff) return v4(g[6], g[7]); // ::ffff:a.b.c.d
  if (zeros(0, 6)) return v4(g[6], g[7]); // ::a.b.c.d (veraltet; auch ::1 → 0.0.0.1)
  if (g[0] === 0x64 && g[1] === 0xff9b && zeros(2, 6)) return v4(g[6], g[7]); // NAT64
  if (g[0] === 0x2002) return v4(g[1], g[2]); // 6to4
  if (g[0] === 0x2001 && g[1] === 0) return v4(~g[6] & 0xffff, ~g[7] & 0xffff); // Teredo (Client-Adresse, bitweise invertiert)
  return null;
}

/** Adressen der eigenen Schnittstellen (ein Ziel dort ist wie Loopback der eigene Rechner). */
function ownAddresses(): Set<string> {
  const own = new Set<string>();
  try {
    for (const list of Object.values(networkInterfaces())) for (const info of list ?? []) own.add(info.address.toLowerCase().split("%")[0]);
  } catch {
    /* ohne Schnittstellenliste bleibt es bei Loopback */
  }
  return own;
}

function v4Verdict(octets: [number, number, number, number]): boolean {
  const value = toInt(...octets);
  if (inCidr(value, [127, 0, 0, 0], 8)) return offsiteNetwork.allowLoopback;
  return !V4_FORBIDDEN.some(([base, bits]) => inCidr(value, base, bits));
}

/** Darf diese Adresse (Literal, ohne Klammern, kanonisch oder nicht) Ziel sein? `false` bei verbotenen Bereichen und bei Unlesbarem. */
export function isAllowedAddress(ip: string): boolean {
  const family = isIP(ip.split("%")[0]);
  if (family === 4) {
    const octets = parseV4(ip);
    if (!octets || !v4Verdict(octets)) return false;
  } else if (family === 6) {
    const g = v6Groups(ip);
    if (!g) return false;
    if (g.every((x) => x === 0)) return false; // ::
    if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return offsiteNetwork.allowLoopback; // ::1
    const embedded = embeddedV4(g);
    if (embedded && !v4Verdict(embedded)) return false;
    if ((g[0] & 0xffc0) === 0xfe80) return false; // fe80::/10
    if ((g[0] & 0xff00) === 0xff00) return false; // Multicast
    if (g[0] === 0xfd00 && g[1] === 0x0ec2) return false; // fd00:ec2::/32 (AWS)
  } else {
    return false;
  }
  return offsiteNetwork.allowLoopback || !ownAddresses().has(ip.toLowerCase().split("%")[0]);
}

export type CanonicalHost = { kind: "ip"; ip: string } | { kind: "name"; name: string };

/**
 * Host (Name oder Adresse in beliebiger Schreibweise, IPv6 mit oder ohne Klammern) in die kanonische Form bringen – wie es ein Browser/`new URL` tut: `2852039166`, `0xa9fea9fe`,
 * `0251.0376.0251.0376` und `0` werden zu Adressen. `null`, wenn das kein Host ist.
 */
export function canonicalHost(host: string): CanonicalHost | null {
  const h = host.trim().replace(/^\[|\]$/g, "");
  if (!h || h.length > 253) return null;
  if (isIP(h)) return { kind: "ip", ip: h };
  let name: string;
  try {
    name = new URL(`http://${h.includes(":") ? `[${h}]` : h}/`).hostname.replace(/^\[|\]$/g, "");
  } catch {
    return null;
  }
  if (!name) return null;
  return isIP(name) ? { kind: "ip", ip: name } : { kind: "name", name: name.toLowerCase().replace(/\.$/, "") };
}

/** Ist dieser Host (ohne Namensauflösung) als Ziel verboten? Für Eingabeprüfungen; verbunden wird erst nach `resolvePinned`. */
export function isForbiddenHost(host: string): boolean {
  const canonical = canonicalHost(host);
  if (!canonical) return true;
  if (canonical.kind === "ip") return !isAllowedAddress(canonical.ip);
  if (FORBIDDEN_NAMES.has(canonical.name)) return true;
  return !offsiteNetwork.allowLoopback && (canonical.name === "localhost" || canonical.name.endsWith(".localhost"));
}

/** Loopback-Adresse oder -Name (für die Regel „Klartext-HTTP nur für den eigenen Rechner“, die nur in Tests greift). */
export function isLoopbackHost(host: string): boolean {
  const canonical = canonicalHost(host);
  if (!canonical) return false;
  if (canonical.kind === "name") return canonical.name === "localhost" || canonical.name.endsWith(".localhost");
  if (isIP(canonical.ip) === 4) return /^127\./.test(canonical.ip);
  const g = v6Groups(canonical.ip);
  if (!g) return false;
  const embedded = embeddedV4(g);
  return (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) || (!!embedded && embedded[0] === 127);
}

/** Private IPv4-Bereiche, die ein Ziel „im eigenen Netz“ ausmachen (RFC 1918 und Carrier-NAT 100.64.0.0/10). */
const V4_PRIVATE: Array<[[number, number, number, number], number]> = [
  [[10, 0, 0, 0], 8],
  [[172, 16, 0, 0], 12],
  [[192, 168, 0, 0], 16],
  [[100, 64, 0, 0], 10],
];

/**
 * Liegt die Adresse in einem **privaten Netz** (RFC 1918, 100.64.0.0/10, IPv6-ULA `fc00::/7`, auch als eingebettete IPv4-Adresse)? Für Ziele, die erst nach ausdrücklicher Freigabe der
 * Administration erlaubt sind (ein interner Mail-Relay; später Webhooks) – öffentliche Adressen brauchen sie nicht. Loopback zählt nur in Tests (`allowLoopbackForTests`) als privat, damit sich
 * der Fall mit einem lokalen Fake-Server durchspielen lässt; im Betrieb ist Loopback ohnehin gesperrt (`isAllowedAddress`).
 */
export function isPrivateAddress(ip: string): boolean {
  const family = isIP(ip.split("%")[0]);
  const privateV4 = (octets: [number, number, number, number]) => {
    const value = toInt(...octets);
    return (offsiteNetwork.allowLoopback && inCidr(value, [127, 0, 0, 0], 8)) || V4_PRIVATE.some(([base, bits]) => inCidr(value, base, bits));
  };
  if (family === 4) {
    const octets = parseV4(ip);
    return !!octets && privateV4(octets);
  }
  if (family === 6) {
    const g = v6Groups(ip);
    if (!g) return false;
    if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return offsiteNetwork.allowLoopback;
    const embedded = embeddedV4(g);
    if (embedded) return privateV4(embedded);
    return (g[0] & 0xfe00) === 0xfc00; // fc00::/7
  }
  return false;
}

import { isIP } from "node:net";

/**
 * Adressbereiche (CIDR) für die optionale IP-Beschränkung eines API-Tokens – reine Logik, getestet. Eine Liste hat höchstens `MAX_NETS` Einträge, einen je Zeile
 * (Komma und Leerzeichen trennen ebenfalls); ein Eintrag ist eine Adresse oder `Adresse/Länge` (IPv4 und IPv6). Eine einzelne Adresse gilt als `/32` bzw. `/128`.
 * `/0` ist keine Beschränkung und wird abgelehnt. IPv4-in-IPv6 (`::ffff:1.2.3.4`) wird wie die IPv4-Adresse behandelt.
 */
export const MAX_NETS = 20;

// Das Ziel der Übersetzung kennt keine BigInt-Literale (`1n`): Konstanten über `BigInt(…)`
const B0 = BigInt(0);
const B1 = BigInt(1);
const B8 = BigInt(8);
const B16 = BigInt(16);
const B32 = BigInt(32);
const FFFF = BigInt(0xffff);
const FFFFFFFF = BigInt(0xffffffff);

export type Net = { family: 4 | 6; base: bigint; bits: number };

/** Adresse → Zahl (IPv4: 32 Bit, IPv6: 128 Bit); `null` bei Ungültigem. */
export function addressToBigInt(ip: string): { family: 4 | 6; value: bigint } | null {
  const bare = ip.trim().split("%")[0];
  const family = isIP(bare);
  if (family === 4) {
    const parts = bare.split(".").map(Number);
    if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    return { family: 4, value: parts.reduce((acc, n) => (acc << B8) | BigInt(n), B0) };
  }
  if (family !== 6) return null;
  let canonical: string;
  try {
    canonical = new URL(`http://[${bare}]/`).hostname.replace(/^\[|\]$/g, "");
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
  if (groups.length !== 8 || groups.some((g) => !Number.isInteger(g) || g < 0 || g > 0xffff)) return null;
  const value = groups.reduce((acc, g) => (acc << B16) | BigInt(g), B0);
  // ::ffff:a.b.c.d ist die IPv4-Adresse a.b.c.d
  if (value >> B32 === FFFF) return { family: 4, value: value & FFFFFFFF };
  return { family: 6, value };
}

const maskOf = (family: 4 | 6, bits: number): bigint => {
  const total = family === 4 ? 32 : 128;
  return ((B1 << BigInt(bits)) - B1) << BigInt(total - bits);
};

/** Ein Eintrag („10.0.0.0/8“, „2001:db8::/32“, „192.168.1.5“) → Bereich, `null` bei Ungültigem. */
export function parseNet(entry: string): Net | null {
  const text = entry.trim();
  const slash = text.indexOf("/");
  const address = addressToBigInt(slash < 0 ? text : text.slice(0, slash));
  if (!address) return null;
  const max = address.family === 4 ? 32 : 128;
  let bits = max;
  if (slash >= 0) {
    const raw = text.slice(slash + 1);
    if (!/^\d{1,3}$/.test(raw)) return null;
    bits = Number(raw);
    if (bits < 1 || bits > max) return null;
  }
  return { family: address.family, base: address.value & maskOf(address.family, bits), bits };
}

export type NetListResult = { ok: true; nets: Net[]; text: string | null } | { ok: false; reason: "invalid" | "tooMany"; entry?: string };

/** Eingabe (Zeilen, Komma oder Leerzeichen getrennt) → geprüfte Liste und die Textform zum Speichern (ein Eintrag je Zeile, ohne Doppelte); leer = keine Beschränkung. */
export function parseNetList(input: string | null | undefined): NetListResult {
  const entries = (input ?? "")
    .split(/[\s,;]+/)
    .map((e) => e.trim())
    .filter(Boolean);
  if (entries.length === 0) return { ok: true, nets: [], text: null };
  const seen = new Set<string>();
  const nets: Net[] = [];
  const kept: string[] = [];
  for (const entry of entries) {
    const net = parseNet(entry);
    if (!net) return { ok: false, reason: "invalid", entry: entry.slice(0, 60) };
    const key = `${net.family}:${net.base}:${net.bits}`;
    if (seen.has(key)) continue;
    seen.add(key);
    nets.push(net);
    kept.push(entry);
  }
  if (nets.length > MAX_NETS) return { ok: false, reason: "tooMany" };
  return { ok: true, nets, text: kept.join("\n") };
}

/** Liegt die Adresse in einem der Bereiche? Ungültige Adresse oder leere Liste → `false` (die Liste ist eine Erlaubnisliste). */
export function ipInNets(ip: string | null | undefined, nets: readonly Net[]): boolean {
  if (!ip) return false;
  const address = addressToBigInt(ip);
  if (!address) return false;
  return nets.some((net) => net.family === address.family && (address.value & maskOf(net.family, net.bits)) === net.base);
}

/** Gespeicherte Textform → Bereiche (ungültige Zeilen werden übersprungen – das Token ist dann enger, nie weiter). */
export function netsOf(text: string | null | undefined): Net[] {
  return (text ?? "")
    .split(/\n/)
    .map((line) => parseNet(line))
    .filter((n): n is Net => n !== null);
}

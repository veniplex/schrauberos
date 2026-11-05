// Reine IPv4-/Netzwerk-Hilfen (ohne Framework, getestet in network.test.ts).

/** "192.168.1.10" -> 3232235786; null bei ungültiger Adresse. */
export function parseIPv4(input: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(input.trim());
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

export function formatIPv4(n: number): string {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
}

export type Cidr = {
  prefix: number;
  /** Netzadresse */
  network: number;
  broadcast: number;
  /** Nutzbare Host-Adressen: first..last (inklusive) */
  first: number;
  last: number;
  /** Anzahl nutzbarer Hosts */
  hosts: number;
};

/** Unterstützt /16 bis /30 – genug für ein Firmennetz und begrenzt die Listengröße. */
export function parseCidr(input: string): Cidr | null {
  const m = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/.exec(input.trim());
  if (!m) return null;
  const ip = parseIPv4(m[1]);
  const prefix = Number(m[2]);
  if (ip === null || prefix < 16 || prefix > 30) return null;
  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  const network = (ip & mask) >>> 0;
  // Muss eine echte Netzadresse sein (192.168.1.5/24 ist ungültig)
  if (network !== ip) return null;
  const broadcast = (network | (~mask >>> 0)) >>> 0;
  return { prefix, network, broadcast, first: network + 1, last: broadcast - 1, hosts: broadcast - network - 1 };
}

export function ipInCidr(ip: string, cidr: string): boolean {
  const addr = parseIPv4(ip);
  const net = parseCidr(cidr);
  return addr !== null && net !== null && addr >= net.first && addr <= net.last;
}

/** Sortiert IPv4-Adressen numerisch (nicht alphabetisch). */
export function compareIPv4(a: string, b: string): number {
  return (parseIPv4(a) ?? 0) - (parseIPv4(b) ?? 0);
}

export type IpRange = { from: string; to: string; count: number };

/** Zusammenhängende freie Bereiche im Subnetz, gegeben die belegten Adressen. */
export function freeRanges(cidr: string, used: string[]): IpRange[] {
  const net = parseCidr(cidr);
  if (!net) return [];
  const taken = new Set(used.map(parseIPv4).filter((n): n is number => n !== null && n >= net.first && n <= net.last));
  const ranges: IpRange[] = [];
  let start: number | null = null;
  for (let ip = net.first; ip <= net.last + 1; ip++) {
    const free = ip <= net.last && !taken.has(ip);
    if (free && start === null) start = ip;
    if (!free && start !== null) {
      ranges.push({ from: formatIPv4(start), to: formatIPv4(ip - 1), count: ip - start });
      start = null;
    }
  }
  return ranges;
}

/** Nächste freie Adresse im Subnetz (oder null, wenn voll). */
export function nextFreeIp(cidr: string, used: string[]): string | null {
  return freeRanges(cidr, used)[0]?.from ?? null;
}

/** "AA-BB-CC-DD-EE-FF" / "aabb.ccdd.eeff" -> "AA:BB:CC:DD:EE:FF"; null bei ungültiger MAC. */
export function normalizeMac(input: string): string | null {
  const hex = input.replace(/[^0-9a-fA-F]/g, "");
  if (hex.length !== 12 || /[^0-9a-fA-F:.\-\s]/.test(input)) return null;
  return hex.toUpperCase().match(/.{2}/g)!.join(":");
}

import { dueState, type DueState } from "./due";

export type WarrantyState = DueState;

/** Garantie abgelaufen, läuft in den nächsten `soonDays` Tagen ab, oder in Ordnung (Standard: 90 Tage). */
export function warrantyState(until: Date | null | undefined, soonDays = 90, now = new Date()): WarrantyState | null {
  return dueState(until, soonDays, now);
}

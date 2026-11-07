import { isIP } from "node:net";

/**
 * Grober Teil einer Client-Adresse für die Listen „Meine Sitzungen“ und „Bekannte Geräte“ (Datensparsamkeit): IPv4 ohne das letzte Byte (`192.168.1.x`), IPv6 nur die
 * ersten 48 Bit (`2001:db8:1::/48`). Genug, um ein fremdes Netz zu erkennen; keine Zuordnung zu einem Gerät. Keine gültige Adresse → null.
 */
export function ipHint(address: string | null | undefined): string | null {
  if (!address) return null;
  const kind = isIP(address);
  if (kind === 4) {
    const [a, b, c] = address.split(".");
    return `${a}.${b}.${c}.x`;
  }
  if (kind === 6) {
    const groups = expandIpv6(address);
    return groups ? `${groups.slice(0, 3).map((g) => g.toString(16)).join(":")}::/48` : null;
  }
  return null;
}

/** IPv6-Adresse in acht Gruppen (ohne „::“-Kürzung); null, wenn nicht lesbar. */
function expandIpv6(address: string): number[] | null {
  const [head, tail, ...rest] = address.toLowerCase().split("::");
  if (rest.length > 0) return null;
  const part = (text: string | undefined) => (text ? text.split(":").filter((g) => g !== "") : []);
  const left = part(head);
  const right = part(tail);
  const gap = 8 - left.length - right.length;
  if (tail === undefined ? left.length !== 8 : gap < 0) return null;
  const groups = [...left, ...Array.from({ length: tail === undefined ? 0 : gap }, () => "0"), ...right].map((g) => Number.parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g)) ? groups : null;
}

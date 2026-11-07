/** Minimaler SemVer-2.0-Vergleich (ohne externe Abhängigkeit, auch vom Launcher genutzt). */

export type Semver = { major: number; minor: number; patch: number; pre: string[] };

const PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseSemver(version: string): Semver | null {
  const m = PATTERN.exec(version);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre: m[4] ? m[4].split(".") : [] };
}

/** Veröffentlichte Version ("1.2.3") – ohne Vorabversions-Zusatz. Nur solche sind als Update installierbar. */
export const isReleaseVersion = (version: string) => /^\d+\.\d+\.\d+$/.test(version);

function comparePre(a: string[], b: string[]): number {
  // Eine Version ohne Zusatz ist höher als eine mit Zusatz (1.0.0 > 1.0.0-dev)
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i];
    const y = b[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) {
      if (Number(x) !== Number(y)) return Number(x) < Number(y) ? -1 : 1;
    } else if (xn !== yn) {
      return xn ? -1 : 1; // Zahlen sind kleiner als Text
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

/** <0 wenn a älter als b, 0 bei Gleichheit, >0 wenn a neuer ist. Ungültige Versionen gelten als ältest möglich. */
export function compareVersions(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return pa ? 1 : pb ? -1 : 0;
  for (const key of ["major", "minor", "patch"] as const) {
    if (pa[key] !== pb[key]) return pa[key] < pb[key] ? -1 : 1;
  }
  return comparePre(pa.pre, pb.pre);
}

/**
 * Untergrenze des Starters als Tripel plus Vorabflag. Der Starter (C) vergleicht **nicht** mit eigener SemVer-Logik: `scripts/gen-trust-header.mjs` berechnet
 * hieraus die Konstanten des C-Headers, und der Vergleich in C ist nur `exceedsFloor` in Zahlen. Eine einzige Quelle der Wahrheit (`compareVersions`),
 * abgesichert durch einen Differentialtest in `semver.test.ts`.
 */
export type Floor = { major: number; minor: number; patch: number; prerelease: boolean };

export function floorOf(version: string): Floor | null {
  const p = parseSemver(version);
  return p ? { major: p.major, minor: p.minor, patch: p.patch, prerelease: p.pre.length > 0 } : null;
}

/**
 * Ist die veröffentlichte Version `x.y.z` (ohne Vorabzusatz) strikt größer als die Untergrenze? Entspricht `compareVersions(version, floor) > 0` für
 * Veröffentlichungen: gleiche Zahlen gelten als größer, wenn die Untergrenze selbst eine Vorabversion ist (`0.2.0` > `0.2.0-dev.x`).
 */
export function exceedsFloor(version: { major: number; minor: number; patch: number }, floor: Floor): boolean {
  if (version.major !== floor.major) return version.major > floor.major;
  if (version.minor !== floor.minor) return version.minor > floor.minor;
  if (version.patch !== floor.patch) return version.patch > floor.patch;
  return floor.prerelease;
}

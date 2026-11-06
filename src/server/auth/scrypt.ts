import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

/**
 * Passwort-Hash mit scrypt (`node:crypto`, läuft im Thread-Pool, kein Fremdpaket). Bewusst ohne `server-only`, damit auch das
 * Seed-Skript ihn nutzen kann.
 *
 * Format: `scrypt$<N>$<r>$<p>$<Salz base64>$<Hash base64>` – die Kosten stehen im Hash, ein späteres Anheben bleibt möglich.
 * Kosten N=2^15, r=8, p=1 (32 MiB, ~55 ms auf einem Desktop-Rechner, auf kleiner Hardware grob 0,2–0,3 s).
 */
export const SCRYPT_COST = { N: 2 ** 15, r: 8, p: 1 } as const;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
/** Obergrenze für gespeicherte Kosten (ein manipulierter Hash soll keinen riesigen Speicherbedarf auslösen) */
const MAX_N = 2 ** 17;

const derive = (password: string, salt: Buffer, N: number, r: number, p: number): Promise<Buffer> =>
  new Promise((resolve, reject) =>
    scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, { N, r, p, maxmem: 160 * N * r }, (error, key) => (error ? reject(error) : resolve(key))),
  );

export async function scryptHash(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const { N, r, p } = SCRYPT_COST;
  const key = await derive(password, salt, N, r, p);
  return ["scrypt", N, r, p, salt.toString("base64"), key.toString("base64")].join("$");
}

/** Prüft ein Passwort gegen den gespeicherten Hash; ein unlesbarer Hash gilt als „falsch“. */
export async function scryptVerify(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [N, r, p] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  if (!Number.isInteger(N) || N < 2 || N > MAX_N || (N & (N - 1)) !== 0 || !Number.isInteger(r) || r < 1 || r > 16 || !Number.isInteger(p) || p < 1 || p > 4) return false;
  const salt = Buffer.from(parts[4], "base64");
  const expected = Buffer.from(parts[5], "base64");
  if (salt.length === 0 || expected.length !== KEY_LENGTH) return false;
  const actual = await derive(password, salt, N, r, p);
  return timingSafeEqual(actual, expected);
}

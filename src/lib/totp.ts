import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Einmalcodes nach RFC 6238 (TOTP) auf Basis von RFC 4226 (HOTP). Vorgabe der Authenticator-Apps: SHA-1, 6 Stellen, 30 Sekunden – die Funktionen können mehr
 * (SHA-256/512, 8 Stellen), damit die Testvektoren des RFC geprüft werden; die Anwendung benutzt nur die Vorgabe. Reine Rechenlogik, ohne Datenbank und Uhr
 * (die Zeit wird hineingereicht), vollständig getestet.
 */
export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** Toleranz: ein Zeitschritt davor und danach (Uhrenabweichung des Telefons) */
export const TOTP_WINDOW = 1;
/** Länge des Geheimnisses in Bytes (160 Bit, wie von RFC 4226 empfohlen) */
export const TOTP_SECRET_BYTES = 20;

export type TotpAlgorithm = "sha1" | "sha256" | "sha512";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** RFC 4648 Base32 ohne Auffüllung (so zeigen es Authenticator-Apps als Textschlüssel). */
export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

/** Base32 lesen (Groß-/Kleinschreibung, Leerzeichen, Bindestriche und Auffüllung sind egal); null bei fremden Zeichen. */
export function base32Decode(text: string): Buffer | null {
  const clean = text.toUpperCase().replace(/[\s-]/g, "").replace(/=+$/, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index < 0) return null;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
    value &= (1 << bits) - 1;
  }
  return Buffer.from(out);
}

/** Neues zufälliges Geheimnis. */
export const generateTotpSecret = (): Buffer => randomBytes(TOTP_SECRET_BYTES);

/** HOTP (RFC 4226): Code für einen Zähler. */
export function hotp(secret: Uint8Array, counter: number, digits = TOTP_DIGITS, algorithm: TotpAlgorithm = "sha1"): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac(algorithm, secret).update(message).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const binary = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(binary % 10 ** digits).padStart(digits, "0");
}

/** Der Zeitschritt (Zähler) zu einem Zeitpunkt. */
export const timeStep = (nowMs: number, period = TOTP_PERIOD_SECONDS): number => Math.floor(nowMs / 1000 / period);

/** Code für einen Zeitpunkt (RFC 6238). */
export const totp = (secret: Uint8Array, nowMs: number, digits = TOTP_DIGITS, algorithm: TotpAlgorithm = "sha1", period = TOTP_PERIOD_SECONDS): string =>
  hotp(secret, timeStep(nowMs, period), digits, algorithm);

/** Eingabe vereinheitlichen: Leerzeichen und Bindestriche weg; nur genau 6 Ziffern sind ein Code, sonst null. */
export function normalizeTotpCode(input: string): string | null {
  const clean = input.replace(/[\s-]/g, "");
  return new RegExp(`^\\d{${TOTP_DIGITS}}$`).test(clean) ? clean : null;
}

const equalCodes = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Prüft einen eingegebenen Code gegen die Zeitschritte `jetzt − window … jetzt + window` und liefert den **Zeitschritt, zu dem er passt** (der Aufrufer merkt ihn
 * sich, damit derselbe Code nie zweimal gilt), sonst null. Alle Kandidaten werden verglichen (Vergleich in konstanter Zeit, kein vorzeitiger Abbruch) – die Dauer
 * verrät nicht, welcher Schritt oder welche Stelle abwich. Schritte `<= lastStep` zählen nicht (bereits benutzt).
 */
export function matchTotp(secret: Uint8Array, input: string, nowMs: number, options: { lastStep?: number; window?: number } = {}): number | null {
  const code = normalizeTotpCode(input) ?? "x".repeat(TOTP_DIGITS); // ungültige Eingabe läuft denselben Weg und passt nie
  const current = timeStep(nowMs);
  const window = options.window ?? TOTP_WINDOW;
  let matched: number | null = null;
  for (let step = current - window; step <= current + window; step++) {
    const hit = equalCodes(hotp(secret, Math.max(0, step)), code);
    if (hit && step > (options.lastStep ?? 0) && (matched === null || step > matched)) matched = step;
  }
  return matched;
}

/** Adresse für den QR-Code und den „Konto hinzufügen“-Knopf der Apps (Google-Authenticator-Format; SHA-1/6/30 sind die Vorgabe). */
export function otpauthUri(options: { issuer: string; account: string; secret: Uint8Array }): string {
  const issuer = options.issuer.replace(/[:\r\n]/g, " ").trim() || "SchrauberOS";
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(options.account)}`;
  return `otpauth://totp/${label}?secret=${base32Encode(options.secret)}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_PERIOD_SECONDS}`;
}

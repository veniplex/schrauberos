import { createHash, randomBytes } from "node:crypto";
import type { FeedExpiryChoice } from "./feed-constants";

/**
 * Token des Kalender-Abos (F10), reine Logik: `cal_` + 32 Zufallsbytes (base64url, 43 Zeichen) = 256 Bit. Wie bei API-Tokens wird nur der **SHA-256-Hash** gespeichert (bei so viel Entropie wäre ein
 * langsamer Hash sinnlos und würde nur Anfragen verteuern); der Klartext steht einmal in der Antwort der Erzeugung, nie in Log, Audit oder Datenbank. Er ist Teil der Adresse
 * (`/api/ical/<token>.ics`) – die Adresse ist das Geheimnis.
 */
export const FEED_PREFIX = "cal_";
const BODY_LENGTH = 43;
/** Form eines gültigen Tokens: nur wer sie trifft, kostet eine Datenbankabfrage. */
export const FEED_TOKEN_SHAPE = /^cal_[A-Za-z0-9_-]{43}$/;

export const generateFeedToken = (): string => `${FEED_PREFIX}${randomBytes(32).toString("base64url").slice(0, BODY_LENGTH)}`;

export const hashFeedToken = (token: string): string => createHash("sha256").update(token).digest("hex");

/** Erste Zeichen zum Wiedererkennen in der Oberfläche und im Audit – verrät praktisch nichts (24 von 256 Bit). */
export const feedTokenHint = (token: string): string => `${token.slice(0, FEED_PREFIX.length + 4)}…`;

/** Das Token aus dem letzten Teil der Adresse (`<token>.ics`); `null`, wenn die Form nicht stimmt (dann gibt es nichts nachzuschlagen). */
export function tokenFromFile(file: string): string | null {
  if (file.length > 64 || !file.endsWith(".ics")) return null;
  const token = file.slice(0, -4);
  return FEED_TOKEN_SHAPE.test(token) ? token : null;
}

export { FEED_EXPIRY_CHOICES, type FeedExpiryChoice } from "./feed-constants";

/** Ende der Gültigkeit: Tage ab `now` oder `null` = unbegrenzt. */
export function feedExpiry(choice: FeedExpiryChoice, now: Date): Date | null {
  return choice === "never" ? null : new Date(now.getTime() + Number(choice) * 86_400_000);
}

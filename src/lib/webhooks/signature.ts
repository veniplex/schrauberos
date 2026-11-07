import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Signatur der Webhooks (reine Logik, getestet; derselbe Code steht als Referenz für Empfänger in der Doku-Seite der Programmierschnittstelle).
 *
 * Verfahren **v1:** `HMAC-SHA256(secret, "<Zeitstempel>.<Ereignis-ID>.<Body>")`, hexadezimal, im Kopf `X-Webhook-Signature: v1=<hex>`. Zeitstempel (Sekunden seit 1970) und
 * Ereignis-ID stehen in `X-Webhook-Timestamp` und `X-Webhook-Id`; der **Body** ist der unveränderte Text der Anfrage (nie neu serialisiert). Der Schlüssel ist das Geheimnis als
 * Text (UTF-8), wie angezeigt (`whsec_…`).
 *
 * **Wiederholungsschutz:** Der Empfänger lehnt Zeitstempel ab, die mehr als `TOLERANCE_SECONDS` von seiner Uhr abweichen, und merkt sich Ereignis-IDs (die Zustellung ist „mindestens einmal“).
 * Der Zeitstempel wird bei **jedem Versuch** neu gesetzt (und neu signiert) – späte Wiederholungen bleiben im Fenster.
 *
 * **Rotation:** Während der Überlappung trägt der Kopf zwei Signaturen (`v1=<neu>,v1=<alt>`); der Empfänger akzeptiert, wenn eine davon zu einem seiner Geheimnisse passt.
 */
export const SIGNATURE_VERSION = "v1";
export const TOLERANCE_SECONDS = 300;
export const SECRET_PREFIX = "whsec_";

export const generateWebhookSecret = (): string => `${SECRET_PREFIX}${randomBytes(32).toString("base64url")}`;

export function signWebhook(secret: string, timestamp: number | string, eventId: string, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${eventId}.${body}`).digest("hex");
}

/** Wert des Kopfes `X-Webhook-Signature` für ein oder zwei (Rotation) Geheimnisse. */
export function signatureHeader(secrets: readonly string[], timestamp: number | string, eventId: string, body: string): string {
  return secrets.map((secret) => `${SIGNATURE_VERSION}=${signWebhook(secret, timestamp, eventId, body)}`).join(",");
}

export type VerifyFailure = "signature" | "timestamp" | "format";

/**
 * Referenzprüfung für Empfänger. `secrets`: ein oder zwei Geheimnisse (während einer Rotation beide); `now`: Sekunden seit 1970 (Tests).
 * Vergleicht in konstanter Zeit und prüft das Zeitfenster (`toleranceSeconds`, Standard 5 Minuten, in beide Richtungen).
 */
export function verifyWebhook(input: {
  secrets: readonly string[];
  timestamp: string | null | undefined;
  eventId: string | null | undefined;
  body: string;
  signature: string | null | undefined;
  now?: number;
  toleranceSeconds?: number;
}): { ok: true } | { ok: false; reason: VerifyFailure } {
  const { secrets, timestamp, eventId, body, signature } = input;
  if (!timestamp || !eventId || !signature || !/^\d{1,12}$/.test(timestamp)) return { ok: false, reason: "format" };
  const now = input.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > (input.toleranceSeconds ?? TOLERANCE_SECONDS)) return { ok: false, reason: "timestamp" };
  const given = signature
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${SIGNATURE_VERSION}=`))
    .map((part) => part.slice(SIGNATURE_VERSION.length + 1));
  if (given.length === 0) return { ok: false, reason: "format" };
  for (const secret of secrets) {
    const expected = Buffer.from(signWebhook(secret, timestamp, eventId, body), "hex");
    for (const candidate of given) {
      const bytes = Buffer.from(candidate, "hex");
      if (bytes.length === expected.length && timingSafeEqual(bytes, expected)) return { ok: true };
    }
  }
  return { ok: false, reason: "signature" };
}

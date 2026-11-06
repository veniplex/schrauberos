import { createHash, randomBytes } from "node:crypto";

/**
 * API-Tokens (reine Logik, getestet). Ein Token ist ein hochentropisches Geheimnis: `sos_` + 32 Zufallsbytes (base64url, 43 Zeichen).
 * Gespeichert wird nur der SHA-256-Hash – bei so viel Entropie wäre ein langsamer Hash (scrypt) sinnlos und würde nur die Anfrage-Flut
 * verteuern. Das Klartext-Token steht ausschließlich in der Antwort der Erzeugung, nie in Log, Audit, URL oder Datenbank.
 */
export const TOKEN_PREFIX = "sos_";
const TOKEN_BODY_LENGTH = 43;
/** Form eines gültigen Tokens: nur wer sie trifft, kostet eine Datenbankabfrage. */
export const TOKEN_SHAPE = /^sos_[A-Za-z0-9_-]{43}$/;

export const generateApiToken = (): string => `${TOKEN_PREFIX}${randomBytes(32).toString("base64url").slice(0, TOKEN_BODY_LENGTH)}`;

export const hashApiToken = (token: string): string => createHash("sha256").update(token).digest("hex");

/** Erste Zeichen zum Wiedererkennen (Liste, Audit-Log) – verrät praktisch nichts (24 von 256 Bit). */
export const tokenHint = (token: string): string => `${token.slice(0, TOKEN_PREFIX.length + 4)}…`;

/**
 * Token aus dem Header `Authorization: Bearer <token>`. Nur das Schema „Bearer“ (Groß-/Kleinschreibung egal), genau ein Leerzeichen und ein
 * Token der erwarteten Form; alles andere (Basic, fehlendes Token, Anhängsel) ergibt null.
 */
export function bearerToken(header: string | null | undefined): string | null {
  if (!header || header.length > 200) return null;
  const match = /^bearer ([^\s]+)$/i.exec(header);
  const token = match?.[1];
  return token && TOKEN_SHAPE.test(token) ? token : null;
}

import "server-only";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { decryptSecret, encryptSecret, SecretKeyUnavailableError } from "@/server/secrets";

/** Einstellungen aus der Tabelle AppSetting (Schlüssel/Wert); Geheimnisse liegen verschlüsselt darin. */

/** Client für Schreibzugriffe: der normale Client oder – in einer Operation des Aktions-Rahmens – die Transaktion (nie `db` innerhalb einer Transaktion benutzen: SQLite hat nur einen Schreiber). */
type Writer = Pick<PrismaClient | Prisma.TransactionClient, "appSetting">;

export async function getSetting(key: string): Promise<string | null> {
  return (await db.appSetting.findUnique({ where: { key } }))?.value ?? null;
}

/** `null` löscht die Einstellung. */
export async function setSetting(key: string, value: string | null, client: Writer = db): Promise<void> {
  if (value === null) await client.appSetting.deleteMany({ where: { key } });
  else await client.appSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
}

/**
 * Das Geheimnis im Klartext; `null`, wenn es nicht gesetzt ist, zu einem anderen Schlüssel gehört **oder `secret.key` gerade nicht lesbar ist** (Lesen ist folgenlos: es wird nichts
 * gelöscht – das Schreiben und Zurücksetzen scheitert bei fehlendem Schlüssel laut, siehe `secrets.ts`).
 */
export async function getSecret(key: string): Promise<string | null> {
  const blob = await getSetting(key);
  if (!blob) return null;
  try {
    return decryptSecret(blob);
  } catch (error) {
    if (error instanceof SecretKeyUnavailableError) return null;
    throw error;
  }
}

export async function setSecret(key: string, plain: string | null, client: Writer = db): Promise<void> {
  await setSetting(key, plain ? encryptSecret(plain) : null, client);
}

/** Ob ein Geheimnis gesetzt ist (ohne es preiszugeben). */
export async function hasSecret(key: string): Promise<boolean> {
  return (await getSecret(key)) !== null;
}

import "server-only";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { decryptSecret, encryptSecret } from "@/server/secrets";

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

export async function getSecret(key: string): Promise<string | null> {
  const blob = await getSetting(key);
  return blob ? decryptSecret(blob) : null;
}

export async function setSecret(key: string, plain: string | null, client: Writer = db): Promise<void> {
  await setSetting(key, plain ? encryptSecret(plain) : null, client);
}

/** Ob ein Geheimnis gesetzt ist (ohne es preiszugeben). */
export async function hasSecret(key: string): Promise<boolean> {
  return (await getSecret(key)) !== null;
}

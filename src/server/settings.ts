import "server-only";
import { db } from "@/server/db";
import { decryptSecret, encryptSecret } from "@/server/secrets";

/** Einstellungen aus der Tabelle AppSetting (Schlüssel/Wert); Geheimnisse liegen verschlüsselt darin. */

export async function getSetting(key: string): Promise<string | null> {
  return (await db.appSetting.findUnique({ where: { key } }))?.value ?? null;
}

/** `null` löscht die Einstellung. */
export async function setSetting(key: string, value: string | null): Promise<void> {
  if (value === null) await db.appSetting.deleteMany({ where: { key } });
  else await db.appSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
}

export async function getSecret(key: string): Promise<string | null> {
  const blob = await getSetting(key);
  return blob ? decryptSecret(blob) : null;
}

export async function setSecret(key: string, plain: string | null): Promise<void> {
  await setSetting(key, plain ? encryptSecret(plain) : null);
}

/** Ob ein Geheimnis gesetzt ist (ohne es preiszugeben). */
export async function hasSecret(key: string): Promise<boolean> {
  return (await getSecret(key)) !== null;
}

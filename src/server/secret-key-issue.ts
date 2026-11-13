import "server-only";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { secretKeyCheck, WRAPPED_SETTING_KEY } from "@/lib/secret-wrap";
import { db } from "@/server/db";
import { readSecretKey } from "@/server/secrets";

/**
 * Stimmt der Geheimnisschlüssel (`secret.key`) dieses Datenträgers mit der Datenbank überein? Drei Störungen (das Zustandsmodell steht in `secrets.ts`):
 *  - `missing`: die Datei fehlt, die Datenbank enthält aber Geheimnisse (nie still ein neuer Schlüssel!),
 *  - `unreadable`: die Datei ist da, aber nicht lesbar (Verzeichnis, Rechte, Ein-/Ausgabefehler, abgeschnitten),
 *  - `mismatch`: der Schlüssel ist lesbar, gehört aber nicht zur Hülle des Wiederherstellungsschlüssels in der Datenbank (fremdes Volume, Datenbank von woanders).
 * `recoverable`: Mit dem Wiederherstellungsschlüssel lässt sich der richtige Schlüssel aus der Hülle in der Datenbank rekonstruieren (Seite „Schlüssel wiederherstellen“,
 * Verwaltung → Backups → Schlüssel). Solange eine Störung besteht, bleibt die Anmeldung für Konten mit zweitem Faktor zu und wird nichts gelöscht.
 */
export type SecretKeyIssue = { kind: "missing" | "unreadable" | "mismatch"; recoverable: boolean };

type Reader = Pick<PrismaClient | Prisma.TransactionClient, "appSetting" | "twoFactor">;

export const KEY_CHECK_SETTING = "secrets.keyCheck";

export async function secretKeyIssue(client: Reader = db): Promise<SecretKeyIssue | null> {
  const key = readSecretKey();
  const rows = await client.appSetting.findMany({ where: { key: { in: [WRAPPED_SETTING_KEY, KEY_CHECK_SETTING] } }, select: { key: true, value: true } });
  const wrapped = rows.find((r) => r.key === WRAPPED_SETTING_KEY)?.value;
  const check = rows.find((r) => r.key === KEY_CHECK_SETTING)?.value;
  const hasWrap = !!wrapped && !!check;
  if (key.state === "readable") return hasWrap && check !== secretKeyCheck(key.hex) ? { kind: "mismatch", recoverable: true } : null;
  if (key.state === "missing") {
    // Fehlt die Datei und enthält die Datenbank gar nichts Verschlüsseltes, ist das keine Störung (der Schlüssel entsteht bei Bedarf)
    const holds =
      hasWrap ||
      (await client.appSetting.count({ where: { value: { startsWith: "v1:" } } })) > 0 ||
      (await client.twoFactor.count({ where: { secret: { not: null } } })) > 0; // (der IT-Tresor hängt nicht an `secret.key`: Hauptschlüssel aus der Tresor-Passphrase)
    return holds ? { kind: "missing", recoverable: hasWrap } : null;
  }
  return { kind: "unreadable", recoverable: hasWrap && key.reason === "content" };
}

import "server-only";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { revokeDevices } from "./devices";
import { pendingLogins } from "./pending";
import { revokeSessions } from "./session";

type Client = Pick<PrismaClient | Prisma.TransactionClient, "session" | "knownDevice" | "apiToken" | "calendarFeedToken">;

/**
 * Zugang eines Kontos widerrufen: **Sitzungen, bekannte Geräte, API-Tokens, die Abo-Adresse des Kalenders (F10) und offene Zwischenzustände der Anmeldung (zweiter Faktor)** – und zwar mit dem Client der Operation (`tx`), also **in derselben
 * Transaktion** wie die Änderung des Passworts. Wer das Passwort ändert (oder per Notzugang zurücksetzt), will damit jeden bisherigen Zugang beenden; ein
 * Token (Ablauf bis 365 Tage) darf das nicht überleben, und ein Fehler zwischen den Schritten darf keine alte Sitzung gültig lassen (ZP2-S-F01, S-F09).
 *
 * `exceptCurrent`: die eigene Sitzung und das eigene Gerät behalten (Passwortwechsel im Konto). Tokens gehören nie zur laufenden Sitzung und werden immer widerrufen.
 */
export async function revokeAccess(client: Client, userId: string, options: { exceptCurrent?: boolean } = {}): Promise<void> {
  await revokeSessions(userId, options.exceptCurrent ?? false, client);
  await revokeDevices(userId, options.exceptCurrent ?? false, client);
  await client.apiToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  // Die Abo-Adresse des Kalenders ist ein Zugang außerhalb der Anwendung: Wer das Passwort ändert, will auch ihn beenden (das Token wird gelöscht, nicht nur markiert)
  await client.calendarFeedToken.deleteMany({ where: { userId } });
  // Ein halb abgeschlossener Passwort-Schritt (zweiter Faktor steht aus) ist auch ein Zugang: er endet mit
  pendingLogins.deleteForUser(userId);
}

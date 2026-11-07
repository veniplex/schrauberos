import "server-only";
import { db } from "@/server/db";
import { fail, failField } from "@/server/operations";
import { accountOwner, verifyPassword } from "./password";
import { loginThrottle } from "./throttle";

/**
 * Erneute Passwortabfrage für Vorgänge, die den Schutz eines Kontos senken oder Geheimnismaterial erzeugen (zweiten Faktor einrichten/ausschalten, Sicherungscodes erneuern,
 * zweiten Faktor eines anderen Kontos zurücksetzen). Geprüft wird das Passwort der **handelnden** Person. Eigenes Limit (`loginThrottle.passwordChange`, je Konto): eine gestohlene
 * Sitzung darf damit nicht raten. Die Berechnung läuft auf dem Eigentümer-Pfad (`ownerLane`), nie hinter einer Flut von Anmeldungen.
 */
export async function confirmOwnPassword(userId: string, password: string, field = "password"): Promise<{ username: string }> {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.authSource !== "local") fail("forbidden", "recovery.account.errors.external");
  const gate = loginThrottle.passwordChange;
  const wait = gate.check(user.id);
  if (wait > 0) fail("forbidden", "account.errors.tooManyAttempts", { seconds: Math.ceil(wait / 1000) });
  gate.take(user.id);
  if (!(await verifyPassword(password, user.passwordHash, { owner: accountOwner(user.id) }))) failField(field, "account.errors.currentWrong");
  gate.succeed(user.id);
  return { username: user.username };
}

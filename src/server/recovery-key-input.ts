import "server-only";
import { parseRecoveryKey } from "@/lib/recovery-key";
import { unwrapSecretKey } from "@/lib/secret-wrap";
import { authRuntime } from "@/server/auth/runtime";
import { loginThrottle } from "@/server/auth/throttle";

/**
 * Eingabe des Wiederherstellungsschlüssels beim Restore (Verwaltung → Backups, Einrichtung). **Gedrosselt, global** (`loginThrottle.recoveryKey`): Das Budget verlangsamt ab
 * dem sechsten Versuch pro Minute, weist aber nie ab; es gibt keine Sperre pro Konto und keine scrypt-Semaphore (eigener Pfad, nichts hinter einer Flut von Anmeldungen).
 * Ohne Datenbankzugriff, damit der Restore-Code sie ohne den Datenbankclient laden kann.
 */
/** Einstellung in der Datenbank, die den mit dem Wiederherstellungsschlüssel umhüllten Geheimnisschlüssel enthält (gelesen auch aus fremden Datenbankdateien beim Restore). */
export const WRAPPED_SETTING_KEY = "secrets.wrapped";

export type KeyInput = { ok: true; key: Buffer; accept: () => void } | { ok: false; reason: "format" };

/** Belegt einen Versuch (synchron, vor dem ersten `await`), wartet ggf. die Verlangsamung ab und liest die Eingabe. `accept()` gibt den Versuch zurück, wenn der Schlüssel gepasst hat. */
export async function throttledRecoveryKey(input: string): Promise<KeyInput> {
  const { recoveryKey: budget } = loginThrottle;
  const slowdown = budget.delayMs();
  budget.record();
  if (slowdown > 0) await authRuntime.sleep(slowdown);
  const parsed = parseRecoveryKey(input);
  if (!parsed.ok) return { ok: false, reason: "format" };
  return { ok: true, key: parsed.key, accept: () => budget.release() };
}

export type OpenedKey = { ok: true; recoveryKey: Buffer; secretKeyHex: string } | { ok: false; reason: "format" | "wrong" };

/** Öffnet die in einem Backup mitgelieferte Hülle des Geheimnisschlüssels. „format“ = Tippfehler (Prüfzeichen), „wrong“ = passt nicht zu diesem Backup. */
export async function openWrappedSecretKey(input: string, wrapped: string): Promise<OpenedKey> {
  const entered = await throttledRecoveryKey(input);
  if (!entered.ok) return entered;
  const secret = unwrapSecretKey(wrapped, entered.key);
  if (!secret) return { ok: false, reason: "wrong" };
  entered.accept();
  return { ok: true, recoveryKey: entered.key, secretKeyHex: secret };
}

import "server-only";
import { passwordTooLong } from "@/lib/password-rules";
import { Semaphore } from "@/lib/semaphore";
import { authRuntime } from "./runtime";
import { scryptHash, scryptVerify } from "./scrypt";

export { MIN_PASSWORD_LENGTH, MAX_PASSWORD_CHARS, passwordProblem } from "@/lib/password-rules";

/**
 * scrypt teilt sich den Thread-Pool von libuv (4 Threads) mit Dateizugriffen. Damit Anmeldungen die App nicht ausbremsen, laufen
 * höchstens 2 Hash-Berechnungen für **Anmeldungen** gleichzeitig; sie warten in einer begrenzten Warteschlange (voll → `QueueFullError`).
 */
export const hashSemaphore = new Semaphore(2, 32);

/**
 * Eigener Pfad für alles, was **nicht** hinter einer Flut von Anmeldungen warten darf: Passwort setzen (Konto, Benutzerverwaltung,
 * Einrichtung), das Hashen des neuen Passworts beim Einlösen des Wiederherstellungs-Codes, die Passwortabfrage im Konto und die
 * Anmeldung von einem bekannten Gerät. Höchstens 1 Berechnung gleichzeitig (zusammen mit den Anmeldungen bleibt ein Thread des
 * libuv-Pools frei), die Warteschlange ist nicht begrenzt – wer hier ankommt, ist angemeldet, hat einen gültigen Code oder ein
 * bekanntes Gerät, und jeder dieser Wege ist anderweitig begrenzt.
 */
export const ownerSemaphore = new Semaphore(1, Infinity);

/** Zähler für Tests (Wie oft wurde tatsächlich gehasht?) und die gemessene typische Dauer einer Prüfung in ms (gleitender Mittelwert). */
export const hashStats = { computed: 0, typicalMs: 250 };

/** Dauer messen und in den gleitenden Mittelwert einrechnen (begrenzt, damit Ausreißer ihn nicht verzerren). */
async function timed<T>(task: () => Promise<T>): Promise<T> {
  const started = performance.now();
  try {
    return await task();
  } finally {
    const took = Math.min(2_000, Math.max(30, performance.now() - started));
    hashStats.typicalMs = Math.round(hashStats.typicalMs * 0.8 + took * 0.2);
  }
}

export function hashPassword(password: string): Promise<string> {
  return ownerSemaphore.run(() => {
    hashStats.computed += 1;
    return scryptHash(password);
  });
}

/**
 * Prüft ein Passwort. `hash` null/leer (unbekannter Benutzer, Konto ohne lokales Passwort): **es wird nicht gerechnet** – sonst könnte
 * jeder mit erfundenen Namen die Hash-Plätze belegen und alle Anmeldungen blockieren. Stattdessen wartet die Antwort per Timer so
 * lange, wie eine echte Prüfung typischerweise dauert (`hashStats.typicalMs`), und ist immer falsch.
 * `bounded`: Anmeldung (begrenzte Warteschlange, bei Überlast `QueueFullError`); sonst der eigene Pfad ohne Begrenzung.
 */
export async function verifyPassword(password: string, hash: string | null | undefined, options: { bounded?: boolean } = {}): Promise<boolean> {
  if (passwordTooLong(password)) return false; // zu lange Eingaben werden gar nicht erst gerechnet
  if (!hash) {
    await authRuntime.sleep(authRuntime.between(Math.round(hashStats.typicalMs * 0.9), Math.round(hashStats.typicalMs * 1.2)));
    return false;
  }
  const lane = options.bounded ? hashSemaphore : ownerSemaphore;
  return lane.run(
    () => {
      hashStats.computed += 1;
      return timed(() => scryptVerify(password, hash));
    },
    { bounded: options.bounded },
  );
}

export { QueueFullError } from "@/lib/semaphore";

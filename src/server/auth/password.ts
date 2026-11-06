import "server-only";
import { passwordTooLong } from "@/lib/password-rules";
import { Semaphore } from "@/lib/semaphore";
import { scryptHash, scryptVerify } from "./scrypt";

export { MIN_PASSWORD_LENGTH, MAX_PASSWORD_CHARS, passwordProblem } from "@/lib/password-rules";

/**
 * scrypt teilt sich den Thread-Pool von libuv (4 Threads) mit Dateizugriffen. Damit Anmeldungen die App nicht ausbremsen, laufen
 * höchstens 2 Hash-Berechnungen gleichzeitig; Anmeldungen warten in einer begrenzten Warteschlange (voll → `QueueFullError`).
 */
export const hashSemaphore = new Semaphore(2, 32);

/** Zähler für Tests: Wie oft wurde tatsächlich gehasht? (Gedrosselte Anmeldungen dürfen keinen Hash auslösen.) */
export const hashStats = { computed: 0 };

/** Dummy-Hash für unbekannte Benutzer, damit die Antwortzeit nicht verrät, ob es sie gibt. */
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= hashSemaphore.run(() => scryptHash("dummy-password-for-timing")));

export function hashPassword(password: string): Promise<string> {
  return hashSemaphore.run(() => {
    hashStats.computed += 1;
    return scryptHash(password);
  });
}

/**
 * Prüft ein Passwort (`hash` null = unbekannter Benutzer: es wird gegen einen Dummy-Hash geprüft und ist immer falsch).
 * `bounded`: bei voller Warteschlange abweisen (`QueueFullError`) – für die Anmeldung; sonst wird gewartet.
 */
export async function verifyPassword(password: string, hash: string | null | undefined, options: { bounded?: boolean } = {}): Promise<boolean> {
  if (passwordTooLong(password)) return false; // zu lange Eingaben werden gar nicht erst gerechnet
  const target = hash ?? (await getDummyHash());
  const ok = await hashSemaphore.run(() => {
    hashStats.computed += 1;
    return scryptVerify(password, target);
  }, options);
  return ok && !!hash;
}

export { QueueFullError } from "@/lib/semaphore";

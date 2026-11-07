import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { authRuntime } from "./runtime";

/**
 * Zwischenzustand der Anmeldung mit zweitem Faktor: Das Passwort stimmt, der Code fehlt noch. Der Zustand liegt **nur im Speicher des Servers** – der Browser bekommt
 * eine zufällige Kennung (Cookie `so_2fa`, HttpOnly, nur 5 Minuten), keinen Inhalt. Ohne Abschluss entsteht **keine Sitzung** und kein Sitzungs-Cookie. Nach einem
 * Neustart ist der Zustand weg (die Person gibt das Passwort noch einmal ein). Höchstens 5 falsche Codes je Zustand, danach ist er verbraucht; die Drosselung je Konto
 * (`loginThrottle.totp`) gilt zusätzlich. Begrenzter Speicher: bei Überlauf fallen die ältesten Einträge – zuerst die des Kontos selbst (höchstens `MAX_PER_USER` je Konto, ein
 * Konto kann also nicht mit eigenen Anmeldungen die laufenden Schritte anderer Konten verdrängen).
 *
 * Der Zustand ist an das **Passwort gebunden** (`credentialVersion`, ein Hash des gespeicherten Passwort-Hashs): Ändert sich das Passwort zwischen den beiden Schritten (Passwortwechsel,
 * Zurücksetzen durch die Administration, Notzugang), ist der Zustand ungültig; ebenso löscht `revokeAccess` alle Zustände des Kontos (`deleteForUser`).
 */
export const PENDING_TTL_MS = 5 * 60_000;
export const PENDING_MAX_FAILURES = 5;
const MAX_ENTRIES = 2_000;
export const MAX_PER_USER = 5;

export type PendingLogin = {
  userId: string;
  /** Benutzername in der Schreibweise des Drosselungs-Schlüssels */
  username: string;
  /** Stand der Zugangsdaten beim Passwort-Schritt (`credentialVersion`): verändert sich das Passwort, ist der Zustand nutzlos */
  credentialVersion: string;
  /** „Dieses Gerät merken“ wurde beim Passwort-Schritt gewählt */
  remember: boolean;
  failures: number;
  expiresAt: number;
};

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

/** Version der Zugangsdaten eines Kontos aus dem gespeicherten Passwort-Hash (nie das Passwort selbst; ohne lokales Passwort eine feste Kennung). */
export const credentialVersion = (passwordHash: string | null | undefined): string => createHash("sha256").update(`credentials:${passwordHash ?? ""}`).digest("hex");
const globalForPending = globalThis as unknown as { __pendingLogins?: Map<string, PendingLogin> };
const store = (): Map<string, PendingLogin> => (globalForPending.__pendingLogins ??= new Map());

export const pendingLogins = {
  /** Neuer Zustand; gibt die Kennung für das Cookie zurück. */
  create(entry: Omit<PendingLogin, "failures" | "expiresAt">): string {
    const map = store();
    const now = authRuntime.now();
    for (const [key, value] of map) if (value.expiresAt <= now) map.delete(key);
    // Je Konto höchstens MAX_PER_USER: der neue Eintrag verdrängt zuerst die ältesten desselben Kontos
    const own = [...map].filter(([, value]) => value.userId === entry.userId);
    for (const [key] of own.slice(0, Math.max(0, own.length - (MAX_PER_USER - 1)))) map.delete(key);
    while (map.size >= MAX_ENTRIES) map.delete(map.keys().next().value as string); // älteste zuerst (Einfügereihenfolge)
    const token = randomBytes(32).toString("base64url");
    map.set(hash(token), { ...entry, failures: 0, expiresAt: now + PENDING_TTL_MS });
    return token;
  },
  /** Der Zustand zur Kennung – nur, solange er gültig ist. */
  get(token: string | undefined): PendingLogin | undefined {
    if (!token || token.length > 200) return undefined;
    const entry = store().get(hash(token));
    if (!entry) return undefined;
    if (entry.expiresAt <= authRuntime.now()) {
      store().delete(hash(token));
      return undefined;
    }
    return entry;
  },
  /** Ein falscher Code: zählt, und beim fünften ist der Zustand verbraucht. Gibt zurück, ob er noch besteht. */
  fail(token: string): boolean {
    const entry = store().get(hash(token));
    if (!entry) return false;
    entry.failures += 1;
    if (entry.failures >= PENDING_MAX_FAILURES) {
      store().delete(hash(token));
      return false;
    }
    return true;
  },
  delete(token: string | undefined): void {
    if (token) store().delete(hash(token));
  },
  /** Alle Zwischenzustände eines Kontos verwerfen (Zugang widerrufen: Passwortwechsel, Zurücksetzen, Notzugang, Deaktivierung, überall abmelden). */
  deleteForUser(userId: string): number {
    const map = store();
    let removed = 0;
    for (const [key, value] of map) {
      if (value.userId === userId) {
        map.delete(key);
        removed++;
      }
    }
    return removed;
  },
  get size(): number {
    return store().size;
  },
  clear(): void {
    store().clear();
  },
};

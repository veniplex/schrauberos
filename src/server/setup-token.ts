import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Gate } from "@/lib/login-throttle";
import { dataDir } from "@/lib/updates/store";
import { authRuntime } from "@/server/auth/runtime";

/**
 * Einrichtungs-Token: Wer eine frische Installation zuerst aufruft, soll nicht automatisch Administrator werden. Beim ersten Start
 * (solange es keinen Benutzer gibt) entsteht ein zufälliges Token (160 Bit), liegt als Datei `setup-token` (Modus 0600) im
 * Datenverzeichnis – nicht im Backup – und wird ins Container-Log geschrieben. Die Ersteinrichtung verlangt es, vergleicht in
 * konstanter Zeit, drosselt Versuche und löscht die Datei nach dem Erfolg.
 *
 * Ausnahme von „alles über die Weboberfläche“: einmalige Installationshandlung, kein laufender Betrieb.
 */

export const setupTokenFile = () => path.join(dataDir(), "setup-token");

const sha256 = (value: string) => createHash("sha256").update(value).digest();

/** Zufälliges Token: 20 Bytes = 160 Bit, hexadezimal in Achtergruppen (zum Abtippen/Kopieren). */
export function generateSetupToken(): string {
  return randomBytes(20).toString("hex").match(/.{8}/g)!.join("-");
}

/** Schreibweise vereinheitlichen: Groß-/Kleinschreibung, Bindestriche und Leerzeichen sind egal. */
export const normalizeSetupToken = (value: string): string => value.toLowerCase().replace(/[^0-9a-f]/g, "");

/** Gespeichertes Token oder null (keine Datei). */
export function readSetupToken(): string | null {
  try {
    const value = readFileSync(setupTokenFile(), "utf8").trim();
    return value || null;
  } catch {
    return null;
  }
}

/**
 * Stellt sicher, dass für die noch nicht eingerichtete Installation ein Token existiert (und schreibt es ins Log); gibt es schon
 * einen Benutzer, wird eine übrig gebliebene Datei entfernt. Gibt das Token zurück, wenn die Einrichtung aussteht.
 */
export function ensureSetupToken(setupPending: boolean, options: { logExisting?: boolean; log?: (line: string) => void } = {}): string | null {
  const log = options.log ?? console.log;
  const file = setupTokenFile();
  if (!setupPending) {
    removeSetupToken();
    return null;
  }
  let token = readSetupToken();
  const created = !token;
  if (!token) {
    token = generateSetupToken();
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${token}\n`, { mode: 0o600 });
    try {
      chmodSync(file, 0o600);
    } catch {
      /* Dateisysteme ohne Modi (z. B. Windows) */
    }
  }
  if (created || options.logExisting) log(`[setup] Einrichtungs-Token: ${token}  (Datei: ${file})`);
  return token;
}

export function removeSetupToken(): void {
  if (existsSync(setupTokenFile())) rmSync(setupTokenFile(), { force: true });
}

/** Vergleich in konstanter Zeit (über feste Länge gehashte Werte). */
export function tokenMatches(input: string, expected: string): boolean {
  return timingSafeEqual(sha256(normalizeSetupToken(input)), sha256(normalizeSetupToken(expected)));
}

/** Versuche gedrosselt (global, ein Schlüssel): 5 freie, dann 5 s, 10 s … höchstens 60 s. Nur die Installation selbst ist betroffen. */
const create = () => new Gate({ free: 5, baseMs: 5_000, capMs: 60_000, decayMs: 15 * 60_000, maxEntries: 4, now: () => authRuntime.now() });
const globalForGate = globalThis as unknown as { __setupGate?: Gate };
export const setupGate = (globalForGate.__setupGate ??= create());

export function resetSetupGate(): void {
  setupGate.clear();
}

export type SetupTokenCheck = { ok: true } | { ok: false; reason: "invalid" } | { ok: false; reason: "throttled"; retryAfterSeconds: number };

/** Prüft das Token (Drosselung zuerst, synchron belegt; Erfolg setzt die Drosselung zurück). */
export function checkSetupToken(input: string): SetupTokenCheck {
  const wait = setupGate.check("setup");
  if (wait > 0) return { ok: false, reason: "throttled", retryAfterSeconds: Math.max(1, Math.ceil(wait / 1000)) };
  setupGate.take("setup");
  const expected = readSetupToken();
  // Ohne Datei ist keine Einrichtung möglich (kein Token = kein Zugang); trotzdem gleich viel rechnen
  const ok = tokenMatches(input, expected ?? randomBytes(20).toString("hex")) && expected !== null;
  if (!ok) return { ok: false, reason: "invalid" };
  setupGate.reset("setup");
  return { ok: true };
}

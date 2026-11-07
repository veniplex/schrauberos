import { describeError, stripControl } from "@/lib/log-safe";

/**
 * Ringpuffer der letzten Warn- und Fehlerzeilen des Prozesses für den Systemstatus (P1b-7) – damit Administratoren Fehler **in der Oberfläche** sehen und nicht am Server
 * ins Container-Log schauen müssen (Betriebskonzept: alles über die Weboberfläche).
 *
 * **Datensparsam:** In den Puffer kommt nur, was `formatLogArgs` übrig lässt – Text ohne Steuerzeichen (kein Zeilenfälschen), gekürzt; Fehlerobjekte nur als Klasse und Code
 * (`describeError`, nie Meldung oder Stack: die enthalten oft Eingaben); andere Objekte nur als Typ; lange Zeichenketten aus Schlüsselzeichen (Token, Schlüssel, Hashes) und
 * `Bearer …`/`token=…` werden durch `[…]` ersetzt. Der Puffer liegt nur im Speicher (nach einem Neustart leer), nie in der Datenbank oder in Backups.
 *
 * Liegt in `globalThis`: Instrumentierung (hier wird `console` umgehängt) und Seiten sind getrennte Bundles im selben Prozess.
 */

export type LogLevel = "warn" | "error";
export type LogEntry = { at: number; level: LogLevel; message: string };

/** So viele Zeilen hält der Puffer (die älteste fällt heraus). */
export const LOG_CAPACITY = 200;
const MAX_MESSAGE = 300;

type Store = { entries: LogEntry[]; installed: boolean };
const globalForLogs = globalThis as unknown as { __logBuffer?: Store };
const store = (): Store => (globalForLogs.__logBuffer ??= { entries: [], installed: false });

// Zugangsdaten in Klartext: „Bearer abc…“, „token=abc…“, „password: abc“ (mit Doppelpunkt oder Gleichheitszeichen) und lange Zeichenketten ohne Leerzeichen aus Schlüsselzeichen (Tokens, Hashes, Schlüssel)
// Auch JSON-artig: `"password":"x y"` (Schlüssel in Anführungszeichen, Wert in Anführungszeichen – ein ganzer Wert mit Leerzeichen wird mit entfernt)
const CREDENTIAL = /\b(bearer)\s+\S+|\b(token|secret|password|passwort|authorization|api[-_]?key)["']?\s*[:=]\s*(?:"[^"\n]*"|'[^'\n]*'|(?:(?:bearer|basic)\s+)?\S+)/gi;
const LONG_TOKEN = /[A-Za-z0-9+/_=-]{32,}/g;

/** Entfernt, was nach Zugangsdaten aussieht. Fehlalarme sind in Kauf genommen (lieber ein `[…]` zu viel). */
export function redactSecrets(text: string): string {
  return text.replace(CREDENTIAL, (_m, bearer?: string, word?: string) => `${bearer ?? word} […]`).replace(LONG_TOKEN, "[…]");
}

/** Eine Logzeile als sicherer Kurztext: Argumente einzeln aufbereiten und mit Leerzeichen verbinden. */
export function formatLogArgs(args: readonly unknown[]): string {
  const parts = args.map((arg) => {
    if (typeof arg === "string") return arg;
    if (arg instanceof Error) return describeError(arg);
    if (typeof arg === "number" || typeof arg === "boolean" || typeof arg === "bigint") return String(arg);
    return arg === null || arg === undefined ? String(arg) : typeof arg;
  });
  return stripControl(redactSecrets(parts.join(" ")), MAX_MESSAGE);
}

/** Zeile aufnehmen (die Uhr kann für Tests übergeben werden). */
export function recordLog(level: LogLevel, args: readonly unknown[], now = Date.now()): void {
  const message = formatLogArgs(args);
  if (!message) return;
  const { entries } = store();
  entries.push({ at: now, level, message });
  if (entries.length > LOG_CAPACITY) entries.splice(0, entries.length - LOG_CAPACITY);
}

/** Die letzten Zeilen, neueste zuerst. */
export function recentLogs(limit = 50): LogEntry[] {
  return store().entries.slice(-limit).reverse();
}

/** Nur für Tests: Puffer leeren. */
export function clearLogs(): void {
  store().entries.length = 0;
}

/**
 * Hängt `console.warn` und `console.error` des Prozesses um (einmal; die Ausgabe bleibt unverändert, die Zeile wird zusätzlich aufgenommen). Fehler beim Aufnehmen
 * dürfen nie die eigentliche Ausgabe stören.
 */
export function installLogCapture(target: Pick<Console, "warn" | "error"> = console): void {
  const state = store();
  if (state.installed) return;
  state.installed = true;
  for (const level of ["warn", "error"] as const) {
    const original = target[level].bind(target);
    target[level] = (...args: unknown[]) => {
      try {
        recordLog(level, args);
      } catch {
        /* nie die Ausgabe stören */
      }
      original(...args);
    };
  }
}

/** Nur für Tests: Umhängen zurücksetzen erlauben. */
export function resetLogCaptureForTest(): void {
  store().installed = false;
}

/**
 * Marker-Dateien zwischen Starter (C), Launcher und App unter `<DATA_DIR>/app/`. Alle sind **Daten** (für die uid der App beschreibbar): Der Leser nimmt nur den
 * Basisnamen der Version und Codes aus festen Listen, Pfade erscheinen nur bereinigt und gekürzt in Logs und Anzeige, nie als Pfad zum Öffnen.
 *
 *   verify-failed   Starter → Launcher der eingebauten Version: Die Integritätsprüfung einer installierten Version hat sie abgelehnt (Befund: Code 10–16, 18).
 *                   `<Version>\n<Code>\n<Pfad, höchstens 200 Zeichen>\n`
 *   inconclusive    Starter → Launcher: Die Prüfung blieb unklar (Signal, Zeitüberschreitung, Ein-/Ausgabefehler) oder fand gar nicht statt (`quiesce`: der Ruhezustand ließ sich nicht herstellen).
 *                   `<Version>\n<Grund: signal|timeout|io|fork|other|quiesce>\n`; nur `signal` und `io` zählen als Fehlversuch (`state.ts`, `countsAsAttempt`)
 *   verify-ok       Starter → App: letzte erfolgreiche Prüfung (nur Anzeige „zuletzt geprüft“). `<Version>\n<Dateien>\n<Bytes>\n<ms>\n<Unix-Sekunden>\n`
 *   incompatible    Launcher → Betreiber: Rückfall-Version zu alt für die Datenbank, die App wurde nicht gestartet. `<Version>\n<Anzahl unbekannter Migrationen>\n`
 *   (veraltet/unverträglich — Version ≤ eingebaute, base/arch passen nicht — hat keinen Marker: der Launcher gleicht den Zustand selbst ab, `chooseStart`.)
 */

/** Prüfcodes, die einen Integritätsbefund bedeuten (siehe README, Tabelle der Exit-Codes). */
export const NEGATIVE_CODES = [10, 11, 12, 13, 14, 15, 16, 18] as const;
export const INCONCLUSIVE_REASONS = ["signal", "timeout", "io", "fork", "other", "quiesce"] as const;
export type InconclusiveReason = (typeof INCONCLUSIVE_REASONS)[number];

const VERSION = /^\d+\.\d+\.\d+$/;

/** Letzter Pfadteil einer Angabe, nur wenn er eine veröffentlichte Version ist (der Marker ist Daten: nie ein Pfad, den jemand öffnet). */
export function versionFromMarker(raw: string): string | null {
  const name = raw.trim().split(/[\\/]/).pop() ?? "";
  return VERSION.test(name) ? name : null;
}

/**
 * Entfernt Steuerzeichen und kürzt (Pfade aus Markern landen in Logs, Audit-Text und Anzeige). Wie `sos_clean` im Starter (docker/verify.c): C0, DEL, C1 (U+0080–U+009F),
 * Bidi-Steuerzeichen (U+061C, U+200E/F, U+202A–E, U+2066–9) und Zeilentrenner (U+2028/9) werden zu `?`.
 */
export const cleanDetail = (value: string, max = 200): string => value.replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069\ufffd]/g, "?").slice(0, max);

export type VerifyFailedMarker = { version: string; code: (typeof NEGATIVE_CODES)[number]; path: string };

export function parseVerifyFailed(text: string): VerifyFailedMarker | null {
  const [versionLine, codeLine, ...rest] = text.split("\n");
  const version = versionFromMarker(versionLine ?? "");
  const code = Number(codeLine);
  if (!version || !(NEGATIVE_CODES as readonly number[]).includes(code)) return null;
  return { version, code: code as VerifyFailedMarker["code"], path: cleanDetail(rest[0] ?? "") };
}

export function parseInconclusive(text: string): { version: string; reason: InconclusiveReason } | null {
  const [versionLine, reasonLine] = text.split("\n");
  const version = versionFromMarker(versionLine ?? "");
  if (!version) return null;
  const reason = (INCONCLUSIVE_REASONS as readonly string[]).includes(reasonLine ?? "") ? (reasonLine as InconclusiveReason) : "other";
  return { version, reason };
}

export type VerifyOk = { version: string; files: number; bytes: number; ms: number; at: string };

export function parseVerifyOk(text: string): VerifyOk | null {
  const lines = text.split("\n");
  const version = versionFromMarker(lines[0] ?? "");
  const numbers = lines.slice(1, 5).map((l) => (/^\d{1,15}$/.test(l) ? Number(l) : NaN));
  if (!version || numbers.some((n) => Number.isNaN(n))) return null;
  const [files, bytes, ms, seconds] = numbers;
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) return null;
  return { version, files, bytes, ms, at: date.toISOString() };
}

/** Text für die Anzeige eines Befundcodes im Zustand: `integrity:<Code>`. */
export const integrityReason = (code: number) => `integrity:${code}`;
export const integrityCodeOf = (reason: string | undefined): number | null => {
  const m = /^integrity:(\d{2})$/.exec(reason ?? "");
  return m ? Number(m[1]) : null;
};

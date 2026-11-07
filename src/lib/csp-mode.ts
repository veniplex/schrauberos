import type { CspMode } from "@/lib/csp";

/**
 * Notschalter der Content-Security-Policy, **lesbar für den Proxy ohne Datenbankzugriff**: Der Zustand liegt im Prozess (`globalThis`, wie der Startzustand in
 * `server/startup-state.ts` – Proxy und App laufen im selben Node-Prozess, aber in getrennten Bundles; ein Modul-Singleton würde nicht geteilt, `globalThis` schon).
 *
 *  - Beim Start liest `startApp` den gespeicherten Wert (Einstellung `security.cspMode`) und setzt ihn hier; die Aktion in Einstellungen → Sicherheit schreibt Datenbank
 *    **und** Prozess (`server/csp-setting.ts`). Ein Prozess, eine Datenbank: kein Abgleich nötig.
 *  - Ohne gesetzten Wert (vor dem Start, unbekannter Wert) gilt `enforce` – im Zweifel streng.
 */
const globalForCsp = globalThis as unknown as { __cspMode?: CspMode };

export const CSP_MODE_KEY = "security.cspMode";

export const parseCspMode = (value: string | null | undefined): CspMode => (value === "report-only" ? "report-only" : "enforce");
export const cspMode = (): CspMode => globalForCsp.__cspMode ?? "enforce";
export function setCspModeInProcess(mode: CspMode): void {
  globalForCsp.__cspMode = mode;
}

import { execFile } from "node:child_process";
import type { VerifyFailure, VerifySuccess } from "./seal";

/**
 * Aufruf des Prüfers im Starter (`/bootstrap --verify`, docker/verify.c): Der Installer prüft damit eine entpackte Version mit **derselben Implementierung** wie der Starter
 * beim Start (README „Starter-Vertrauensanker“). Rein und ohne Next.js, damit testbar; der Prozessstart ist einspritzbar.
 */
export type StarterRun = (binary: string, args: string[], env: NodeJS.ProcessEnv) => Promise<{ code: number | null; stdout: string }>;

/** Höchstdauer einer Prüfung (der Starter selbst begrenzt sich beim Start auf 900 s (`SOS_VERIFY_TIMEOUT_SECONDS` in docker/bootstrap.c); hier dieselbe Größenordnung als äußere Grenze für langsame Platten). */
const STARTER_TIMEOUT_MS = 15 * 60_000;

export const runStarter: StarterRun = (binary, args, env) =>
  new Promise((resolve) => {
    execFile(binary, args, { env, timeout: STARTER_TIMEOUT_MS, maxBuffer: 1024 * 1024, windowsHide: true }, (error, stdout) => {
      const exit = error ? (error as NodeJS.ErrnoException & { code?: unknown }).code : 0;
      resolve({ code: typeof exit === "number" ? exit : null, stdout: String(stdout ?? "") });
    });
  });

/** Argumente von `--verify` für eine Version: Ablauf der Beglaubigung wird gegen das heutige Datum (UTC) geprüft. */
export const starterArgs = (dir: string, version: string, now: Date): string[] => ["--verify", dir, "--expect-version", version, "--check-expiry", now.toISOString().slice(0, 10)];

const text = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, "?").slice(0, max) : undefined);
const count = (value: unknown) => (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null);

/**
 * Liest das Ergebnis von `--verify`: der Exit-Code entscheidet (er ist die Aussage des Prüfers), die JSON-Zeile liefert Grund und Pfad. Alles Unlesbare, ein Signal oder eine
 * Zeitüberschreitung ist „Ein-/Ausgabefehler“ (17, unklar) – nie ein Befund über den Inhalt.
 */
export function parseStarterVerdict(code: number | null, stdout: string): VerifySuccess | VerifyFailure {
  let json: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = JSON.parse(stdout.trim().split("\n").pop() ?? "");
    if (parsed && typeof parsed === "object") json = parsed as Record<string, unknown>;
  } catch {
    /* unlesbar */
  }
  if (code === 0) {
    const floor = json?.floor;
    const files = count(json?.files);
    const bytes = count(json?.bytes);
    const ms = count(json?.ms);
    if (json?.ok === true && typeof json.version === "string" && files !== null && bytes !== null && ms !== null && (floor === "below" || floor === "equal" || floor === "above" || floor === "none")) {
      return { ok: true, version: json.version, files, bytes, ms, floor };
    }
    return { ok: false, code: 17, reason: "unreadable-result" };
  }
  const known = code !== null && ((code >= 10 && code <= 16) || code === 18 || code === 19);
  if (!known) return { ok: false, code: 17, reason: code === null ? "io" : "starter-exit" };
  const reason = text(json?.reason, 60) ?? "unknown";
  const path = text(json?.path, 200);
  return { ok: false, code, reason, ...(path ? { path } : {}) };
}

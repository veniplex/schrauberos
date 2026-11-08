import path from "node:path";

/** Gemeinsame Konstanten der Browser-CI. Die App läuft gegen ein frisches Datenverzeichnis `.e2e-data` (siehe e2e/start-server.mjs). */
export const ROOT = process.cwd();
export const PORT = Number(process.env.E2E_PORT ?? 3100);
/** E2E_BASE_URL: eine schon laufende Anwendung statt des Testservers (Probelauf gegen den Container, README „Browser-CI“; nur zusammen mit E2E_REUSE=1 und E2E_DATA_DIR) */
export const BASE_URL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;
/** TLS-Proxy mit selbstsigniertem Zertifikat vor der App (e2e/tests/https.spec.ts) */
export const HTTPS_PORT = PORT + 1;
export const HTTPS_URL = `https://127.0.0.1:${HTTPS_PORT}`;
/** E2E_DATA_DIR: das Datenverzeichnis dieser Anwendung (zum Beispiel das Volume des Containers, in den Läufer eingehängt) – das Setup liest dort das Einrichtungs-Token und legt die Konten direkt an */
export const DATA_DIR = process.env.E2E_DATA_DIR ?? path.join(ROOT, ".e2e-data");
export const DB_FILE = path.join(DATA_DIR, "schrauberos.db");
export const AUTH_DIR = path.join(ROOT, "e2e", ".auth");
export const BASELINE_DIR = path.join(ROOT, "e2e", "baselines");
export const FOUND_DIR = path.join(ROOT, "test-results", "found");

/** Alle Konten der Browser-CI teilen sich dieses (nur lokal erzeugte) Testpasswort. */
export const TEST_PASSWORD = "E2e-Test-Passwort-2026";
export const ADMIN_USER = "e2e-admin";
/** Rollen der Standardinstallation; der Administrator entsteht in der Ersteinrichtung, die anderen legt das Setup direkt an. */
export const ROLE_KEYS = ["admin", "management", "office", "advisor", "mechanic", "warehouse", "it_admin"] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];
export const userOf = (role: RoleKey) => (role === "admin" ? ADMIN_USER : `e2e-${role.replace("_", "-")}`);
export const authFile = (role: RoleKey) => path.join(AUTH_DIR, `${role}.json`);

/** Mit E2E_UPDATE_BASELINE=1 schreibt der Lauf die Baseline-Listen (bekannte Verstöße, JS-Budget) neu, statt zu prüfen. */
export const UPDATE_BASELINE = process.env.E2E_UPDATE_BASELINE === "1";
export const UPDATE_SNAPSHOTS = process.env.E2E_UPDATE_SNAPSHOTS === "1";

/**
 * Funktionen mit `defaultEnabled: false` müssen in der Browser-CI an sein, sonst wären ihre Seiten 404 und blieben ungeprüft. Die Einrichtung wählt das Preset
 * „Werkstattalltag“; was kein Preset zusammen mit ihm einschaltet, setzt das Setup danach als Schalter (wie die Seite „Module & Funktionen“).
 */
export const DEFAULT_OFF_PRESET = "daily";
export const EXTRA_ENABLED_FEATURES = ["office.billing"] as const;
/** Rechte, die nur ausdrücklich vergeben werden (`explicitOnly`, z. B. IT-Tresor): das Setup gibt sie der Administrator-Rolle, damit die Seiten geprüft werden. */
export const ADMIN_EXPLICIT_PERMISSIONS = ["docsIt.vault", "docsIt.vaultManage"] as const;

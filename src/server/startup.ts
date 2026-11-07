import "server-only";
import { readApplied } from "@/lib/updates/restore";
import { createBackup } from "@/server/backup/core";
import { logError } from "@/lib/log-safe";
import { isValidTimeZone, setWorkshopZone } from "@/lib/zone";
import { writeAudit } from "@/server/audit";
import { loadCspMode } from "@/server/csp-setting";
import { db } from "@/server/db";
import { databaseFile } from "@/server/db-client";
import { startJobRunner } from "@/server/jobs";
import { appliedMigrations, MigrationError, runMigrations } from "@/server/migrate";
import { reportIntegrityOnce } from "@/server/integrity-report";
import { ensureBaseData } from "@/server/seed/base";
import { resetUnreadableSecrets } from "@/server/secret-reset";
import { ensureSecretKey } from "@/server/secrets";
import { ensureSetupToken } from "@/server/setup-token";
import { startupState, type StartupState } from "@/server/startup-state";

export { startupState, type StartupState };

/** Ist das ein gültiger Zeitzonen-Name? Ändert nichts. */
export function isValidTimezone(timezone: string): boolean {
  return isValidTimeZone(timezone);
}

/**
 * Macht die Zeitzone der Werkstatt wirksam: Sie wird als **Werkstatt-Zone** gesetzt (`setWorkshopZone`, `src/lib/zone.ts` – darin rechnen Termine, Öffnungszeiten, Fristen, Jobs
 * und die Anzeige von Zeitpunkten) und zusätzlich als `process.env.TZ` (Gewohnheit für Bibliotheken, die die Prozesszeit lesen; die Datumslogik hängt nicht daran). Aktionen
 * prüfen vorher mit `isValidTimezone` und rufen dies erst auf, wenn gespeichert ist – ein abgebrochener Vorgang ändert die Zeitzone nie.
 */
export function applyTimezone(timezone: string): boolean {
  if (!setWorkshopZone(timezone)) return false;
  process.env.TZ = timezone;
  return true;
}

/**
 * Nach einer Wiederherstellung (der Launcher hat die Datenbank getauscht und noch nicht bestätigt: `restore/applied.json`) gelten **keine API-Tokens** mehr: Die
 * Sicherung kennt keine Widerrufe, die seitdem geschehen sind – ein inzwischen widerrufenes (etwa gestohlenes) Token wäre sonst wieder gültig. Alle Tokens werden beim ersten
 * Start widerrufen (und im Audit-Log festgehalten); neue Tokens sind schnell erzeugt. Ebenso entfallen die Abo-Adressen des Kalenders (`CalendarFeedToken`). Läuft bei jedem Start bis zur Bestätigung (idempotent). Liefert die Anzahl.
 *
 * **Webhooks werden nach jeder Wiederherstellung ausgeschaltet** (Grund `restore`, mit oder ohne Wiederherstellungsschlüssel): Eine Kopie – etwa eine Testinstanz, die mit einer Sicherung der Produktivinstanz aufgesetzt wird –
 * darf nie an die Empfänger der Produktivinstanz senden, und gesicherte wartende Zustellungen sollen nicht ungeprüft nachgeholt werden (sie werden zurückgestellt, `held`). Die Verwaltung zeigt den Hinweis im
 * Systemstatus, Audit `webhook.disabled`; wer geprüft hat, schaltet die Ziele wieder ein.
 */
export async function revokeApiTokensAfterRestore(dataRoot?: string): Promise<number> {
  const applied = readApplied(dataRoot);
  if (!applied) return 0;
  return db.$transaction(async (tx) => {
    const { count } = await tx.apiToken.updateMany({ where: { revokedAt: null }, data: { revokedAt: new Date() } });
    if (count > 0) await writeAudit(tx, "apiToken.restoreRevoked", { target: `${count} (Sicherung ${applied.from})`, actor: { id: null, name: "System" } });
    // Dasselbe gilt für die Abo-Adressen des Kalenders (F10): Ein inzwischen widerrufenes oder ersetztes Token (etwa nach einem Diebstahl) wäre mit der Sicherung wieder gültig
    const feeds = await tx.calendarFeedToken.deleteMany({});
    if (feeds.count > 0) await writeAudit(tx, "calendarFeed.restoreRevoked", { target: `${feeds.count} (Sicherung ${applied.from})`, actor: { id: null, name: "System" } });
    // Webhooks: ausschalten (nur die eingeschalteten – ein bewusst ausgeschaltetes Ziel behält seinen Grund) und wartende Zustellungen zurückstellen
    const hooks = await tx.webhook.findMany({ where: { enabled: true }, select: { id: true, name: true } });
    for (const hook of hooks) {
      await tx.webhook.update({ where: { id: hook.id }, data: { enabled: false, disabledReason: "restore" } });
      await writeAudit(tx, "webhook.disabled", { target: `${hook.name}: restore (Sicherung ${applied.from})`, entityId: hook.id, actor: { id: null, name: "System" } });
    }
    await tx.webhookDelivery.updateMany({ where: { status: "pending" }, data: { status: "held" } });
    return count;
  });
}

/**
 * Bereitet die Datenbank vor: Sicherungskopie vor Migrationen, Migrationen, Basisdaten, Zeitzone, Job-Runner (Backups, Aufräumen, Outbox).
 * Scheitert etwas, beendet sich der Prozess – der Launcher erkennt das und fällt bei einem frischen Update zurück.
 */
export async function startApp(): Promise<void> {
  const state = startupState();
  try {
    const file = databaseFile();
    // Nur eine bestehende Datenbank wird vor Migrationen gesichert (eine frische hat nichts zu verlieren)
    const hadData = appliedMigrations(file).length > 0;
    const applied = await runMigrations(file, undefined, async () => {
      if (hadData) await createBackup("pre-migration", file).catch((error) => console.error("[start] Sicherung vor Migration fehlgeschlagen:", error));
    });
    if (applied.length) console.log(`[start] Migrationen angewendet: ${applied.join(", ")}`);

    // Dauerhafte Einstellungen für SQLite: Write-Ahead-Log (bleibt in der Datei) und volle Synchronisation
    await db.$queryRawUnsafe("PRAGMA journal_mode = WAL");
    await db.$executeRawUnsafe("PRAGMA synchronous = FULL");

    await ensureBaseData(db);
    // Notschalter der Content-Security-Policy: der Proxy liest den Zustand aus dem Prozess, nicht aus der Datenbank
    await loadCspMode();
    const revoked = await revokeApiTokensAfterRestore();
    if (revoked > 0) console.log(`[start] Nach der Wiederherstellung: ${revoked} API-Token(s) widerrufen.`);
    // Geheimnisschlüssel: bei frischer Datenbank anlegen; fehlt er bei vorhandenen Geheimnissen oder ist er nicht lesbar, wird nichts angelegt und nichts gelöscht (siehe secrets.ts)
    // Integritätsbefund des Starters (installierte Version abgelehnt): einmal im Audit-Log festhalten; ein Fehler dabei verhindert nie den Start
    await reportIntegrityOnce().catch((error) => logError("start:integrity", error));
    const keyState = ensureSecretKey();
    if (keyState.state !== "readable") console.error(`[start] secret.key ist ${keyState.state === "missing" ? "nicht vorhanden" : "nicht lesbar"}: Zwei-Faktor-Anmeldung, Update-Token und Zugangsdaten sind gesperrt, bis der Schlüssel wieder da ist (Anmeldeseite: „Schlüssel wiederherstellen“, Verwaltung → Backups → Schlüssel).`);
    // Geheimnisse, die der Schlüssel dieses Datenträgers nicht entschlüsseln kann (Wiederherstellung ohne Wiederherstellungsschlüssel): werden über das Register der Geheimnis-Verbraucher
    // zurückgesetzt – nur bei lesbarem Schlüssel, nach Sicherung der Zeilen, mit Audit-Eintrag und Hinweis für Administratoren (Bedingungen: secret-reset.ts)
    const secretsReset = await resetUnreadableSecrets().catch((error) => (logError("start:secrets", error), []));
    if (secretsReset.length > 0) console.log(`[start] Nicht lesbare Geheimnisse zurückgesetzt (Schlüssel passt nicht zum Backup): ${secretsReset.map((i) => `${i.id}=${i.count}`).join(", ")}`);
    const workshop = await db.workshop.findUnique({ where: { id: "default" }, select: { timezone: true } });
    if (workshop && !applyTimezone(workshop.timezone)) console.error(`[start] Unbekannte Zeitzone ${workshop.timezone}`);

    // Frische Installation: Einrichtungs-Token erzeugen und ins Container-Log schreiben (nach der Einrichtung entfernt)
    ensureSetupToken((await db.user.count()) === 0, { logExisting: true });

    startJobRunner();
    state.status = "ready";
  } catch (error) {
    if (error instanceof MigrationError && error.code === "foreignHistory") {
      // Kein Absturz (Neustart-Schleife), kein Eingriff in die fremde Datenbank: klar melden und stehen bleiben
      state.status = "reinstall";
      state.error = error.message;
      console.error(`[start] ${error.message}`);
      return;
    }
    state.status = "failed";
    state.error = error instanceof Error ? error.message : String(error);
    console.error("[start] Start fehlgeschlagen:", error);
    process.exit(1);
  }
}

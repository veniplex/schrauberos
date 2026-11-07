import "server-only";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { integrityCodeOf } from "@/lib/updates/markers";
import { readSmallFile, readState, updatesDir } from "@/lib/updates/store";
import { writeAudit } from "@/server/audit";
import { db } from "@/server/db";

/** Merkdatei: für welchen Befund (`<Version>|<Zeitpunkt>`) der Audit-Eintrag schon geschrieben ist. */
const reportedFile = () => path.join(updatesDir(), "integrity-reported");

/**
 * Hat der Starter eine installierte Version wegen der Integritätsprüfung abgelehnt (`state.last.reason = integrity:<Code>`, vom Launcher der eingebauten Version
 * eingetragen), schreibt die App **einmal** einen Audit-Eintrag `system.integrityFailed` – beim Start, ohne Zutun eines Benutzers. Idempotent über eine eigene Merkdatei
 * (nicht über `state.json`: die schreibt der Launcher, und zwei Schreiber derselben Datei verlören Änderungen). Liefert `true`, wenn ein Eintrag entstanden ist.
 * Der Pfad der Abweichung stammt aus einer Datei, die die Anwendung selbst schreiben darf: `writeAudit` befreit ihn von Steuerzeichen und kürzt ihn.
 */
export async function reportIntegrityOnce(): Promise<boolean> {
  const last = readState().last;
  if (!last || last.status !== "rolled-back" || integrityCodeOf(last.reason) === null) return false;
  const key = `${last.version}|${last.at}`;
  if (readSmallFile(reportedFile())?.trim() === key) return false;
  await writeAudit(db, "system.integrityFailed", {
    target: `${last.version}: ${last.reason}${last.detail ? ` (${last.detail})` : ""}`,
    actor: { id: null, name: "System" },
  });
  mkdirSync(updatesDir(), { recursive: true });
  const tmp = `${reportedFile()}.${process.pid}.tmp`;
  writeFileSync(tmp, `${key}\n`);
  renameSync(tmp, reportedFile());
  return true;
}

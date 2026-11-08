import "server-only";
import { secretKeyCheck, WRAPPED_SETTING_KEY } from "@/lib/secret-wrap";
import { audit } from "@/server/audit";
import { openWrappedSecretKey } from "@/server/recovery-key-input";
import { KEY_CHECK_SETTING, secretKeyIssue } from "@/server/secret-key-issue";
import { secretHoldings, withHoldings } from "@/server/secret-holdings";
import { readSecretKey, setAsideSecretKey, writeSecretKeyFile } from "@/server/secrets";
import { getSetting } from "@/server/settings";

/**
 * `secret.key` mit dem Wiederherstellungsschlüssel rekonstruieren: Die Hülle in der Datenbank enthält eine Kopie des Geheimnisschlüssels (mit dem Wiederherstellungsschlüssel
 * umhüllt). Fehlt die Datei oder gehört sie nicht zur Datenbank (fremdes Volume), öffnet die Eingabe des Wiederherstellungsschlüssels die Hülle, und der richtige Schlüssel wird
 * als `secret.key` angelegt (eine vorhandene, falsche Datei wandert zur Seite, sie wird nie gelöscht). Danach sind alle Geheimnisse wieder lesbar – ohne Neustart.
 *
 * Öffentlich erreichbar (Anmeldeseite, denn Konten mit zweitem Faktor kommen ohne den Schlüssel nicht hinein), aber nur **in einem Störungsfall** und nur mit dem 256-Bit-Schlüssel;
 * die Eingabe ist global gedrosselt (`throttledRecoveryKey`: verlangsamt, weist nie ab).
 */
export type ReconstructResult = { ok: true } | { ok: false; reason: "notNeeded" | "noWrappedKey" | "format" | "wrong" | "unwritable" };

export async function reconstructSecretKey(input: string): Promise<ReconstructResult> {
  const issue = await secretKeyIssue();
  if (!issue) return { ok: false, reason: "notNeeded" };
  if (!issue.recoverable) return { ok: false, reason: issue.kind === "unreadable" ? "unwritable" : "noWrappedKey" };
  const [wrapped, check] = await Promise.all([getSetting(WRAPPED_SETTING_KEY), getSetting(KEY_CHECK_SETTING)]);
  if (!wrapped || !check) return { ok: false, reason: "noWrappedKey" };
  const opened = await openWrappedSecretKey(input, wrapped);
  if (!opened.ok) return { ok: false, reason: opened.reason === "format" ? "format" : "wrong" };
  // Die Hülle ist beglaubigt, aber gehört der Kennwert dazu? (Schutz vor einer vertauschten Hülle)
  if (secretKeyCheck(opened.secretKeyHex) !== check) return { ok: false, reason: "wrong" };
  try {
    const current = readSecretKey();
    if (current.state === "readable" && current.hex === opened.secretKeyHex) return { ok: false, reason: "notNeeded" };
    if (current.state !== "missing") setAsideSecretKey();
    writeSecretKeyFile(opened.secretKeyHex);
  } catch {
    return { ok: false, reason: "unwritable" };
  }
  await audit("secrets.keyReconstructed", { actor: { id: null, name: "–" }, target: withHoldings(issue.kind, await secretHoldings()) });
  return { ok: true };
}

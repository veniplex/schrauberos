"use server";

import { z } from "zod";
import type { MessageKey } from "@/i18n/translate";
import { formObject } from "@/lib/forms";
import { logError } from "@/lib/log-safe";
import { HOST_KEY_FINGERPRINT, normalizeRemotePath, normalizeWebdavUrl, OFFSITE_KEEP_MAX, OFFSITE_NAME, OFFSITE_PROTOCOLS, validateHost, validatePort } from "@/lib/offsite/target";
import { RestoreError } from "@/server/backup/restore";
import { fetchOffsiteBackup, testOffsite } from "@/server/backup/offsite/service";
import { getOffsiteCredentials, getOffsiteSettings, saveOffsiteCredentials, saveOffsiteSettings, saveUploadedNames, type OffsiteCredentials } from "@/server/backup/offsite/settings";
import { fetchSftpHostKey } from "@/server/backup/offsite/sftp";
import { OffsiteError } from "@/server/backup/offsite/transport";
import { jobRunner } from "@/server/jobs";
import { defineAction, defineOperation, fail, failField } from "@/server/operations";
import { recoveryKeyConfirmed } from "@/server/recovery-key";

/** Meldung zu einem Fehler beim Zugriff auf das Ziel (`backup.offsite.errors.<code>`) samt Kurzangabe ohne Geheimnisse. */
function failOffsite(error: unknown): never {
  if (error instanceof OffsiteError) fail("failed", `backup.offsite.errors.${error.code}` as MessageKey, { detail: error.detail ?? "", fingerprint: error.fingerprint ?? "" });
  if (error instanceof RestoreError) fail("failed", `backup.errors.${error.code}` as MessageKey);
  logError("backup:offsite", error);
  fail("failed", "backup.offsite.errors.server", { detail: "", fingerprint: "" });
}

const text = (max: number) => z.string().trim().max(max).optional();

const settingsInput = z.object({
  enabled: z.boolean(),
  protocol: z.enum(OFFSITE_PROTOCOLS),
  host: text(253),
  port: z.coerce.number().int().min(1).max(65535).optional(),
  path: text(300),
  url: text(500),
  username: z.string().trim().min(1).max(200),
  hostKey: text(100),
  hostKeyConfirmed: z.boolean(),
  keep: z.coerce.number().int().min(1).max(OFFSITE_KEEP_MAX),
  password: z.string().max(1024).optional(),
  privateKey: z.string().max(20_000).optional(),
  passphrase: z.string().max(1024).optional(),
});

/**
 * Off-Site-Einstellungen speichern. Regeln:
 *  - **SFTP:** der Fingerabdruck des Hostschlüssels ist Pflicht und muss ausdrücklich bestätigt werden, sobald sich Server, Anschluss oder Fingerabdruck ändern.
 *  - **WebDAV:** nur HTTPS (Klartext nur für den eigenen Rechner), ohne Zugangsdaten in der Adresse.
 *  - **Zugangsdaten** (Geheimnis, verschlüsselt): leere Felder behalten die gespeicherten. Ändert sich aber das Ziel (Protokoll, Server, Adresse, Benutzer), müssen sie neu eingegeben
 *    werden – gespeicherte Zugangsdaten gehen nie an ein anderes Ziel.
 *  - **Einschalten** geht erst, wenn der Wiederherstellungsschlüssel erzeugt und als gesichert bestätigt ist (er verschlüsselt die Dateien am Ziel).
 */
const saveOffsiteOperation = defineOperation({
  name: "admin.backup.saveOffsite",
  permission: "backup.manage",
  input: settingsInput,
  audit: "backup.offsiteSettings",
  // Lesen außerhalb der Transaktion (SQLite hat nur einen Schreiber)
  prepare: async () => ({ current: await getOffsiteSettings(), credentials: await getOffsiteCredentials(), keyConfirmed: await recoveryKeyConfirmed() }),
  run: async ({ input, prepared, tx, audit: setAudit }) => {
    const { current } = prepared;
    let host = "";
    let port = 22;
    let path = "";
    let url = "";
    let hostKey = "";
    if (input.protocol === "sftp") {
      host = (input.host ?? "").replace(/^\[|\]$/g, "");
      const hostProblem = validateHost(host);
      if (hostProblem) failField("host", `backup.offsite.errors.${hostProblem}` as MessageKey);
      port = input.port ?? 22;
      if (validatePort(port)) failField("port", "backup.offsite.errors.port");
      path = normalizeRemotePath(input.path ?? "") ?? failField("path", "backup.offsite.errors.path");
      hostKey = input.hostKey ?? "";
      if (!HOST_KEY_FINGERPRINT.test(hostKey)) failField("hostKey", "backup.offsite.errors.hostKeyMissing");
      // Der Fingerabdruck wird nur nach ausdrücklicher Bestätigung (neu) hinterlegt
      if ((host !== current.host || port !== current.port || hostKey !== current.hostKey) && !input.hostKeyConfirmed) failField("hostKeyConfirmed", "backup.offsite.errors.hostKeyConfirm");
    } else {
      const normalized = normalizeWebdavUrl(input.url ?? "");
      if (!normalized.ok) failField("url", `backup.offsite.errors.${normalized.problem}` as MessageKey);
      url = normalized.url;
    }

    const privateKey = input.privateKey?.trim();
    if (privateKey && !/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(privateKey)) failField("privateKey", "backup.offsite.errors.privateKey");
    const provided: OffsiteCredentials = {
      ...(input.password ? { password: input.password } : {}),
      ...(input.protocol === "sftp" && privateKey ? { privateKey, ...(input.passphrase ? { passphrase: input.passphrase } : {}) } : {}),
    };
    const hasNew = !!(provided.password || provided.privateKey);
    const targetChanged = input.protocol !== current.protocol || host !== current.host || port !== current.port || url !== current.url || input.username !== current.username;
    if (!hasNew && targetChanged && prepared.credentials) failField("password", "backup.offsite.errors.credentialsRequired");
    const credentials = hasNew ? provided : prepared.credentials;
    if (input.enabled || hasNew) {
      const usable = input.protocol === "webdav" ? !!credentials?.password : !!(credentials?.password || credentials?.privateKey);
      if (!usable) failField("password", "backup.offsite.errors.credentialsMissing");
    }
    if (input.enabled && !prepared.keyConfirmed) failField("enabled", "backup.offsite.errors.keyRequired");

    await saveOffsiteSettings({ enabled: input.enabled, protocol: input.protocol, host, port, path, url, username: input.username, hostKey, keep: input.keep }, tx);
    if (hasNew) await saveOffsiteCredentials(provided, tx);
    if (targetChanged) await saveUploadedNames(new Set(), tx); // anderes Ziel: nichts gilt als schon hochgeladen
    setAudit({ target: `${input.protocol} ${input.protocol === "sftp" ? `${host}:${port}${path.startsWith("/") ? "" : "/"}${path}` : url} · ${input.enabled ? "an" : "aus"} · behalten ${input.keep}` });
    return { saved: true };
  },
});

export const saveOffsite = defineAction(saveOffsiteOperation, {
  form: (fd) => {
    const raw = (name: string) => {
      const value = fd.get(name);
      return typeof value === "string" && value !== "" ? value : undefined; // Passwörter nie kürzen
    };
    return { ...formObject(fd), enabled: fd.get("enabled") === "on", hostKeyConfirmed: fd.get("hostKeyConfirmed") === "on", password: raw("password"), privateKey: raw("privateKey"), passphrase: raw("passphrase") };
  },
  revalidate: ["/admin/backup/offsite"],
  message: "common.saved",
});

/** SFTP: Fingerabdruck des Hostschlüssels abrufen (Verbindung bis zum Schlüsselaustausch, keine Anmeldung) – das Ergebnis muss der Administrator vergleichen und bestätigen. */
const fetchHostKeyOperation = defineOperation({
  name: "admin.backup.fetchHostKey",
  permission: "backup.manage",
  input: z.object({ host: z.string().trim().min(1).max(253), port: z.coerce.number().int().min(1).max(65535).default(22) }),
  audit: false,
  auditReason: "Liest nur den öffentlichen Hostschlüssel eines Servers; gespeichert wird erst mit dem Speichern der Einstellungen (dort protokolliert)",
  transaction: false,
  run: async ({ input }) => {
    const host = input.host.replace(/^\[|\]$/g, "");
    const problem = validateHost(host);
    if (problem) failField("host", `backup.offsite.errors.${problem}` as MessageKey);
    try {
      return { fingerprint: await fetchSftpHostKey(host, input.port) };
    } catch (error) {
      return failOffsite(error);
    }
  },
});

export const fetchHostKey = defineAction(fetchHostKeyOperation, { state: ({ fingerprint }) => ({ hostKey: fingerprint }) });

/** „Verbindung testen“ mit den gespeicherten Einstellungen. */
const testOffsiteOperation = defineOperation({
  name: "admin.backup.testOffsite",
  permission: "backup.manage",
  input: z.object({}),
  audit: false,
  auditReason: "Ändert nichts (verbindet und listet das Verzeichnis); Einrichtung und Fehlschläge der Läufe sind protokolliert",
  transaction: false,
  run: async () => {
    try {
      return await testOffsite();
    } catch (error) {
      return failOffsite(error);
    }
  },
});

export const testOffsiteAction = defineAction(testOffsiteOperation, { state: ({ files }) => ({ files }) });

/** „Jetzt hochladen“: führt den Job `backup.offsite` sofort aus. */
const runOffsiteOperation = defineOperation({
  name: "admin.backup.runOffsite",
  permission: "backup.manage",
  input: z.object({}),
  audit: "backup.runNow",
  transaction: false,
  run: async ({ audit: setAudit }) => {
    const result = await jobRunner().runNow("backup.offsite");
    if (!result) fail("busy", "backup.errors.busy");
    if (result.status === "error") fail("failed", "backup.offsite.errors.runFailed", { detail: result.message });
    setAudit({ target: "backup.offsite" });
    return { ran: true };
  },
});

export const runOffsiteNow = defineAction(runOffsiteOperation, { revalidate: ["/admin/backup/offsite", "/admin/backup"], message: "backup.offsite.runDone" });

/** Rückweg: eine Sicherung vom Ziel holen, entschlüsseln und als hochgeladenes Backup in die lokale Liste übernehmen. */
const fetchOffsiteOperation = defineOperation({
  name: "admin.backup.fetchOffsite",
  permission: "backup.manage",
  input: z.object({ file: z.string().min(1).max(200) }),
  audit: "backup.offsiteFetch",
  transaction: false,
  run: async ({ input, audit: setAudit }) => {
    if (!OFFSITE_NAME.test(input.file)) fail("notFound", "backup.errors.notFound");
    let name: string;
    try {
      name = await fetchOffsiteBackup(input.file);
    } catch (error) {
      return failOffsite(error);
    }
    setAudit({ target: input.file });
    return { name };
  },
});

export const fetchOffsiteBackupAction = defineAction(fetchOffsiteOperation, { revalidate: ["/admin/backup", "/admin/backup/offsite"], message: "backup.offsite.fetched" });

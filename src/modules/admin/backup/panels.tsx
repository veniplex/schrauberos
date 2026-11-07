"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Loader2, Upload } from "lucide-react";
import { Button, SubmitButton } from "@/components/ui/buttons";
import { ConfirmSubmitButton } from "@/components/ui/confirm-dialog";
import { Disclosure } from "@/components/ui/disclosure";
import { Alert, Card } from "@/components/ui/layout";
import { createManualBackup, restoreBackup, runAutoBackupNow } from "./actions";
import { Checkbox, Field, FieldHint, FileInput, Form, FormMessage, Input, Select, type ActionState } from "@/components/ui/form";
import { useI18n } from "@/i18n/client";
import { RecoveryCodeView } from "@/platform/account/recovery-code-view";
import { confirmRecoveryKeyAction, createRecoveryKey } from "./key-actions";
import { fetchHostKey, runOffsiteNow, saveOffsite, testOffsiteAction } from "./offsite-actions";

/** Größte angenommene Sicherungsdatei – wie `BACKUP_UPLOAD_MAX_BYTES` der Upload-Route (kein Server-Action-Limit, die Datei wird gestreamt); die Prüfung der Größe macht der Server. */
const BACKUP_UPLOAD_MAX_BYTES = 100 * 1024 ** 3;

export function CreateBackupForm({ label }: { label: string }) {
  return (
    <Form action={createManualBackup} className="flex flex-col gap-3">
      <FormMessage />
      <div>
        <SubmitButton>{label}</SubmitButton>
      </div>
    </Form>
  );
}

/** „Jetzt erneut versuchen“ in der Fehlermeldung des automatischen Backups. */
export function RetryAutoBackupForm({ label }: { label: string }) {
  return (
    <Form action={runAutoBackupNow} className="mt-3 flex flex-col gap-2">
      <FormMessage />
      <div>
        <SubmitButton variant="secondary" size="sm">
          {label}
        </SubmitButton>
      </div>
    </Form>
  );
}

/** Wiederherstellen-Knopf einer Zeile (mit Rückfrage). */
export function RestoreForm({ name, label, confirm }: { name: string; label: string; confirm: string }) {
  const { t } = useI18n();
  return (
    <Form action={restoreBackup} className="flex flex-col items-end gap-2">
      <input type="hidden" name="name" value={name} />
      {/* Optional: der Wiederherstellungsschlüssel öffnet die im Backup mitgelieferte Kopie von secret.key (alle Geheimnisse bleiben lesbar) */}
      <Disclosure title={t("backup.list.restoreKeyLabel")} className="w-full max-w-md text-left">
        <Field label={t("backup.list.restoreKeyField")} htmlFor={`recovery-key-${name}`} name="recoveryKey" hint={t("backup.list.restoreKeyHint")}>
          <Input id={`recovery-key-${name}`} name="recoveryKey" type="password" autoComplete="off" autoCapitalize="characters" autoCorrect="off" spellCheck={false} maxLength={200} />
        </Field>
      </Disclosure>
      {/* Folgenreichste Aktion der Verwaltung: das Wort muss eingetippt werden */}
      <ConfirmSubmitButton message={confirm} variant="secondary" size="sm" typeToConfirm={t("backup.list.restoreWord")}>
        {label}
      </ConfirmSubmitButton>
      <FormMessage />
    </Form>
  );
}

/**
 * Wird gezeigt, solange eine Wiederherstellung vorgemerkt ist (die Anwendung startet gerade neu). Fragt ab, bis sie wieder
 * antwortet bzw. – weil die wiederhergestellte Datenbank die Sitzung nicht kennt – zur Anmeldung führt, und lädt dann neu.
 */
export function RestoreWatcher({ labels }: { labels: { restarting: string; timeout: string } }) {
  const [gaveUp, setGaveUp] = useState(false);
  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(async () => {
      try {
        const res = await fetch("/api/backups/status", { cache: "no-store" });
        if (res.status === 401) {
          clearInterval(timer);
          window.location.reload();
          return;
        }
        if (res.ok && !((await res.json()) as { pending: boolean }).pending) {
          clearInterval(timer);
          window.location.reload();
          return;
        }
      } catch {
        /* Anwendung startet gerade neu */
      }
      if (Date.now() - started > 3 * 60 * 1000) {
        clearInterval(timer);
        setGaveUp(true);
      }
    }, 2000);
    return () => clearInterval(timer);
  }, []);
  return gaveUp ? (
    <Alert tone="warning">{labels.timeout}</Alert>
  ) : (
    <Alert tone="info">
      <span className="flex items-center gap-2">
        <Loader2 className="size-4 animate-spin" aria-hidden /> {labels.restarting}
      </span>
    </Alert>
  );
}

/** Backup-Datei (.db.gz oder .db) hochladen; sie erscheint danach in der Liste und kann wiederhergestellt werden. */
export function UploadForm({ labels }: { labels: { button: string; hint: string; uploading: string; done: string; keyLabel: string; keyHint: string; errors: Record<string, string> } }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [recoveryKey, setRecoveryKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  async function upload(file: File) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/backups/upload", { method: "POST", body: file, headers: { "x-requested-with": "schrauberos", "content-type": "application/octet-stream", ...(recoveryKey.trim() ? { "x-recovery-key": recoveryKey.trim() } : {}) } });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.ok) {
        setMessage({ tone: "success", text: labels.done });
        router.refresh();
      } else {
        setMessage({ tone: "danger", text: labels.errors[json.error ?? ""] ?? labels.errors.uploadFailed });
      }
    } catch {
      setMessage({ tone: "danger", text: labels.errors.uploadFailed });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-ink-muted">{labels.hint}</p>
      <Field label={labels.keyLabel} htmlFor="upload-recovery-key" hint={labels.keyHint} className="max-w-md">
        <Input id="upload-recovery-key" type="password" value={recoveryKey} onChange={(e) => setRecoveryKey(e.target.value)} autoComplete="off" autoCapitalize="characters" autoCorrect="off" spellCheck={false} maxLength={200} />
      </Field>
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
      <div>
        <FileInput ref={input} accept=".tar,.gz,.tgz,.db,.sqlite,.sobk" maxBytes={BACKUP_UPLOAD_MAX_BYTES} hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        <Button disabled={busy} onClick={() => input.current?.click()}>
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Upload className="size-4" aria-hidden />}
          {busy ? labels.uploading : labels.button}
        </Button>
      </div>
    </div>
  );
}

/* ───────────── Wiederherstellungsschlüssel ───────────── */

type KeyActionState = ActionState & { recoveryKey?: string; issuedOn?: string };

/** Wiederherstellungsschlüssel erzeugen (Passwortabfrage) und einmalig anzeigen – mit Druckansicht und Pflicht-Bestätigung „gesichert“. */
export function RecoveryKeyForm({ status }: { status: { exists: boolean; stale: boolean; createdOn: string | null; confirmed: boolean } }) {
  const { t } = useI18n();
  const router = useRouter();
  // Das Formular behält die letzte Antwort (samt Schlüssel): „Weiter“ merkt sich, welcher Schlüssel schon abgehakt ist
  const [dismissed, setDismissed] = useState<string | null>(null);
  const labels = {
    keep: t("backup.key.keep"),
    shownOnce: t("backup.key.shownOnce"),
    yourCode: t("backup.key.yourKey"),
    saved: t("backup.key.saved"),
    printTitle: t("backup.key.printTitle"),
    printWarning: t("backup.key.printWarning"),
  };
  return (
    <Form<KeyActionState> action={createRecoveryKey} className="flex flex-col gap-4">
      {(state) =>
        state.recoveryKey && state.recoveryKey !== dismissed ? (
          <RecoveryCodeView
            code={state.recoveryKey}
            issuedOn={state.issuedOn}
            labels={labels}
            testId="recovery-key"
            onConfirm={() => confirmRecoveryKeyAction(new FormData())}
            onContinue={() => {
              setDismissed(state.recoveryKey ?? null);
              router.refresh();
            }}
          />
        ) : (
          <>
            <p className="text-sm text-ink-muted">{t("backup.key.intro")}</p>
            <p className="text-sm">
              {status.stale
                ? t("backup.key.status.stale")
                : status.exists
                  ? `${status.createdOn ? t("backup.key.status.created", { date: status.createdOn }) : ""} ${status.confirmed ? t("backup.key.status.confirmed") : t("backup.key.status.notConfirmed")}`
                  : t("backup.key.status.none")}
            </p>
            {status.exists ? <Alert tone="warning">{t("backup.key.regenerateWarning")}</Alert> : null}
            <Field label={t("backup.key.password")} htmlFor="key-password" name="password" hint={t("backup.key.passwordHint")} required>
              <Input id="key-password" name="password" type="password" maxLength={128} autoComplete="current-password" required />
            </Field>
            <FormMessage />
            <div>
              <SubmitButton>{status.exists ? t("backup.key.regenerate") : t("backup.key.generate")}</SubmitButton>
            </div>
            <p className="text-xs text-ink-muted">{t("backup.key.howTo")}</p>
          </>
        )
      }
    </Form>
  );
}

/* ───────────── Off-Site ───────────── */

export type OffsiteFormValues = {
  enabled: boolean;
  protocol: "sftp" | "webdav";
  host: string;
  port: number;
  path: string;
  url: string;
  username: string;
  hostKey: string;
  keep: number;
};

/** Einstellungen des Off-Site-Ziels; Zugangsdaten werden nie vorbelegt (leer lassen = behalten). */
export function OffsiteForm({ initial, hasCredentials, keyReady, keepMax }: { initial: OffsiteFormValues; hasCredentials: boolean; keyReady: boolean; keepMax: number }) {
  const { t } = useI18n();
  const [protocol, setProtocol] = useState(initial.protocol);
  const [host, setHost] = useState(initial.host);
  const [port, setPort] = useState(String(initial.port));
  const [hostKey, setHostKey] = useState(initial.hostKey);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const keyChanged = protocol === "sftp" && (hostKey !== initial.hostKey || host !== initial.host || port !== String(initial.port));

  async function fetchKey() {
    setFetching(true);
    setFetchError(null);
    try {
      const data = new FormData();
      data.set("host", host);
      data.set("port", port || "22");
      const result = (await fetchHostKey({}, data)) as ActionState & { hostKey?: string };
      if (result.hostKey) setHostKey(result.hostKey);
      else setFetchError(result.fieldErrors?.host ?? result.error ?? t("common.errors.failed"));
    } catch {
      setFetchError(t("common.errors.failed"));
    } finally {
      setFetching(false);
    }
  }

  return (
    <Form action={saveOffsite} className="flex max-w-3xl flex-col gap-5">
      <Card title={t("backup.offsite.title")}>
        <div className="flex flex-col gap-4">
          <Checkbox name="enabled" defaultChecked={initial.enabled} label={t("backup.offsite.enabled")} hint={t("backup.offsite.enabledHint")} disabled={!keyReady && !initial.enabled} />
          <Field label={t("backup.offsite.protocol")} htmlFor="protocol" name="protocol" className="sm:max-w-xs">
            <Select id="protocol" name="protocol" value={protocol} onChange={(e) => setProtocol(e.target.value as "sftp" | "webdav")}>
              <option value="sftp">{t("backup.offsite.protocols.sftp")}</option>
              <option value="webdav">{t("backup.offsite.protocols.webdav")}</option>
            </Select>
          </Field>
          {protocol === "sftp" ? (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_8rem]">
                <Field label={t("backup.offsite.host")} htmlFor="host" name="host" required>
                  <Input id="host" name="host" value={host} onChange={(e) => setHost(e.target.value)} maxLength={253} autoCapitalize="none" autoCorrect="off" spellCheck={false} required />
                </Field>
                <Field label={t("backup.offsite.port")} htmlFor="port" name="port" required>
                  <Input id="port" name="port" type="number" min={1} max={65535} value={port} onChange={(e) => setPort(e.target.value)} required />
                </Field>
              </div>
              <Field label={t("backup.offsite.path")} htmlFor="path" name="path" hint={t("backup.offsite.pathHint")} required>
                <Input id="path" name="path" defaultValue={initial.path} maxLength={300} autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="/backups/schrauberos" required />
              </Field>
            </>
          ) : (
            <Field label={t("backup.offsite.url")} htmlFor="url" name="url" hint={t("backup.offsite.urlHint")} required>
              <Input id="url" name="url" type="url" defaultValue={initial.url} maxLength={500} autoCapitalize="none" autoCorrect="off" spellCheck={false} required />
            </Field>
          )}
          <Field label={t("backup.offsite.username")} htmlFor="username" name="username" required>
            <Input id="username" name="username" defaultValue={initial.username} maxLength={200} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} required />
          </Field>
          <Field label={t("backup.offsite.password")} htmlFor="password" name="password" hint={hasCredentials ? t("backup.offsite.passwordSet") : t("backup.offsite.passwordHint")}>
            <Input id="password" name="password" type="password" maxLength={1024} autoComplete="new-password" />
          </Field>
          {protocol === "sftp" ? (
            <>
              <Field label={t("backup.offsite.privateKey")} htmlFor="privateKey" name="privateKey" hint={t("backup.offsite.privateKeyHint")}>
                <Input id="privateKey" name="privateKey" type="password" maxLength={20000} autoComplete="off" spellCheck={false} />
              </Field>
              <Field label={t("backup.offsite.passphrase")} htmlFor="passphrase" name="passphrase">
                <Input id="passphrase" name="passphrase" type="password" maxLength={1024} autoComplete="new-password" />
              </Field>
            </>
          ) : null}
          <Field label={t("backup.offsite.keep")} htmlFor="keep" name="keep" hint={t("backup.offsite.keepHint")} className="sm:max-w-xs" required>
            <Input id="keep" name="keep" type="number" min={1} max={keepMax} defaultValue={initial.keep} required />
          </Field>
        </div>
      </Card>

      {protocol === "sftp" ? (
        <Card title={t("backup.offsite.hostKey.title")}>
          <div className="flex flex-col gap-4">
            <p className="text-sm text-ink-muted">{t("backup.offsite.hostKey.intro")}</p>
            <div>
              <Button disabled={fetching || !host} onClick={fetchKey}>
                {fetching ? t("backup.offsite.hostKey.fetching") : t("backup.offsite.hostKey.fetch")}
              </Button>
            </div>
            {fetchError ? <Alert tone="danger">{fetchError}</Alert> : null}
            <Field label={t("backup.offsite.hostKey.fingerprint")} htmlFor="hostKey" name="hostKey">
              <Input id="hostKey" name="hostKey" value={hostKey} readOnly className="font-mono" />
            </Field>
            {initial.hostKey ? <FieldHint>{t("backup.offsite.hostKey.stored", { fingerprint: initial.hostKey })}</FieldHint> : null}
            {keyChanged && hostKey ? (
              <>
                {initial.hostKey && hostKey !== initial.hostKey ? <Alert tone="warning">{t("backup.offsite.hostKey.changed")}</Alert> : null}
                <Checkbox name="hostKeyConfirmed" label={t("backup.offsite.hostKey.confirm")} />
              </>
            ) : null}
          </div>
        </Card>
      ) : null}

      <FormMessage />
      <div>
        <SubmitButton>{t("common.save")}</SubmitButton>
      </div>
    </Form>
  );
}

/** „Verbindung testen“ (gespeicherte Einstellungen) und „Jetzt übertragen“. */
export function OffsiteTools({ canRun }: { canRun: boolean }) {
  const { t, tp } = useI18n();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  async function test() {
    setBusy(true);
    setResult(null);
    try {
      const state = (await testOffsiteAction({}, new FormData())) as ActionState & { files?: number };
      setResult(state.ok ? { tone: "success", text: tp("backup.offsite.testOk", state.files ?? 0) } : { tone: "danger", text: state.error ?? t("common.errors.failed") });
    } catch {
      setResult({ tone: "danger", text: t("common.errors.failed") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-ink-muted">{t("backup.offsite.testHint")}</p>
      {result ? <Alert tone={result.tone}>{result.text}</Alert> : null}
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} onClick={test}>
          {busy ? t("backup.offsite.testing") : t("backup.offsite.test")}
        </Button>
        {canRun ? (
          <Form action={runOffsiteNow}>
            <SubmitButton variant="secondary">{t("backup.offsite.run")}</SubmitButton>
            <FormMessage />
          </Form>
        ) : null}
      </div>
    </div>
  );
}

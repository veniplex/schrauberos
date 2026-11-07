"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Loader2, Upload } from "lucide-react";
import { Button, SubmitButton } from "@/components/ui/buttons";
import { ConfirmSubmitButton } from "@/components/ui/confirm-dialog";
import { Alert } from "@/components/ui/layout";
import { createManualBackup, restoreBackup, runAutoBackupNow } from "./actions";
import { FileInput, Form, FormMessage } from "@/components/ui/form";
import { useI18n } from "@/i18n/client";

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
    <Form action={restoreBackup}>
      <input type="hidden" name="name" value={name} />
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
export function UploadForm({ labels }: { labels: { button: string; hint: string; uploading: string; done: string; errors: Record<string, string> } }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  async function upload(file: File) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/backups/upload", { method: "POST", body: file, headers: { "x-requested-with": "schrauberos", "content-type": "application/octet-stream" } });
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
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
      <div>
        <FileInput ref={input} accept=".tar,.gz,.tgz,.db,.sqlite" maxBytes={BACKUP_UPLOAD_MAX_BYTES} hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        <Button disabled={busy} onClick={() => input.current?.click()}>
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Upload className="size-4" aria-hidden />}
          {busy ? labels.uploading : labels.button}
        </Button>
      </div>
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import { Loader2, Upload } from "lucide-react";
import { Button, ConfirmSubmitButton, SubmitButton } from "@/components/ui/buttons";
import { Alert } from "@/components/ui/layout";
import type { ActionState } from "@/components/ui/form";
import { createManualBackup, restoreBackup, runAutoBackupNow } from "./actions";
import { FieldError, FileInput } from "@/components/ui/form";

export function CreateBackupForm({ label }: { label: string }) {
  const [state, action] = useActionState<ActionState, FormData>(createManualBackup, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      {state.error ? <Alert tone="danger">{state.error}</Alert> : state.ok ? <Alert tone="success">{state.message}</Alert> : null}
      <div>
        <SubmitButton>{label}</SubmitButton>
      </div>
    </form>
  );
}

/** „Jetzt erneut versuchen“ in der Fehlermeldung des automatischen Backups. */
export function RetryAutoBackupForm({ label }: { label: string }) {
  const [state, action] = useActionState<ActionState, FormData>(runAutoBackupNow, {});
  return (
    <form action={action} className="mt-3 flex flex-col gap-2">
      {state.error ? <FieldError>{state.error}</FieldError> : null}
      <div>
        <SubmitButton variant="secondary" size="sm">
          {label}
        </SubmitButton>
      </div>
    </form>
  );
}

/** Wiederherstellen-Knopf einer Zeile (mit Rückfrage). */
export function RestoreForm({ name, label, confirm }: { name: string; label: string; confirm: string }) {
  const [state, action] = useActionState<ActionState, FormData>(restoreBackup, {});
  return (
    <form action={action}>
      <input type="hidden" name="name" value={name} />
      <ConfirmSubmitButton message={confirm} variant="secondary" size="sm">
        {label}
      </ConfirmSubmitButton>
      {state.error ? <FieldError className="mt-1">{state.error}</FieldError> : null}
    </form>
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
        <FileInput ref={input} accept=".tar,.gz,.tgz,.db,.sqlite" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        <Button disabled={busy} onClick={() => input.current?.click()}>
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Upload className="size-4" aria-hidden />}
          {busy ? labels.uploading : labels.button}
        </Button>
      </div>
    </div>
  );
}

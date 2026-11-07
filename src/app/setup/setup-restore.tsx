"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/buttons";
import { Disclosure } from "@/components/ui/disclosure";
import { Field, FileInput, Input } from "@/components/ui/form";
import { Alert } from "@/components/ui/layout";
import { useI18n } from "@/i18n/client";

/** Größte angenommene Sicherungsdatei – wie die Upload-Route (kein Server-Action-Limit, die Datei wird gestreamt); die Prüfung der Größe macht der Server. */
const MAX_BYTES = 100 * 1024 ** 3;

/**
 * Wiederherstellung in der Einrichtung (neuer Server, vorhandenes Backup): Einrichtungs-Token (Pflicht, steht im Container-Log), optional der Wiederherstellungsschlüssel
 * und die Backup-Datei (.tar oder verschlüsselte .sobk). Die Datei geht gestreamt an `/api/setup/restore`; danach startet die Anwendung neu, und die Seite führt zur Anmeldung.
 */
export function SetupRestore() {
  const { t, td } = useI18n();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [token, setToken] = useState("");
  const [recoveryKey, setRecoveryKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Nach dem Neustart: warten, bis die Anwendung wieder antwortet, dann zur Anmeldung (die ersten Sekunden gehören noch dem alten Prozess)
  useEffect(() => {
    if (!restarting) return;
    const started = Date.now();
    const timer = setInterval(async () => {
      if (Date.now() - started < 4000) return;
      try {
        const res = await fetch("/api/health", { cache: "no-store" });
        if (res.ok) {
          clearInterval(timer);
          router.replace("/login");
        }
      } catch {
        /* Anwendung startet gerade neu */
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [restarting, router]);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/setup/restore", {
        method: "POST",
        body: file,
        headers: {
          "x-requested-with": "schrauberos",
          "content-type": "application/octet-stream",
          "x-setup-token": token.trim(),
          ...(recoveryKey.trim() ? { "x-recovery-key": recoveryKey.trim() } : {}),
        },
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; retryAfterSeconds?: number };
      if (res.ok) {
        setRestarting(true);
        return;
      }
      const code = json.error ?? "failed";
      if (code === "tokenThrottled") setError(t("backup.setupRestore.errors.tokenThrottled", { seconds: json.retryAfterSeconds ?? 5 }));
      else if (code === "token") setError(t("backup.setupRestore.errors.token"));
      else if (code === "done") setError(t("backup.setupRestore.errors.done"));
      else setError(td(`backup.errors.${code}`, t("backup.setupRestore.errors.failed")));
    } catch {
      setError(t("backup.setupRestore.errors.failed"));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <Disclosure title={t("backup.setupRestore.title")} className="mt-4">
      <div className="flex flex-col gap-4 p-1">
        <p className="text-sm text-ink-muted">{t("backup.setupRestore.intro")}</p>
        {restarting ? (
          <Alert tone="info">
            <span className="flex items-center gap-2">
              <Loader2 className="size-4 animate-spin" aria-hidden /> {t("backup.setupRestore.restarting")}
            </span>
          </Alert>
        ) : (
          <>
            {error ? <Alert tone="danger">{error}</Alert> : null}
            <Field label={t("backup.setupRestore.token")} htmlFor="restore-token" required>
              <Input id="restore-token" value={token} onChange={(e) => setToken(e.target.value)} maxLength={100} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
            </Field>
            <Field label={t("backup.setupRestore.key")} htmlFor="restore-key" hint={t("backup.setupRestore.keyHint")}>
              <Input id="restore-key" type="password" value={recoveryKey} onChange={(e) => setRecoveryKey(e.target.value)} maxLength={200} autoComplete="off" autoCapitalize="characters" autoCorrect="off" spellCheck={false} />
            </Field>
            <div>
              <FileInput ref={input} accept=".tar,.gz,.tgz,.db,.sqlite,.sobk" maxBytes={MAX_BYTES} hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
              <Button disabled={busy || !token.trim()} onClick={() => input.current?.click()}>
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Upload className="size-4" aria-hidden />}
                {busy ? t("backup.setupRestore.working") : t("backup.setupRestore.file")}
              </Button>
            </div>
          </>
        )}
      </div>
    </Disclosure>
  );
}

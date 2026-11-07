"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { ConfirmSubmitButton } from "@/components/ui/confirm-dialog";
import { Alert } from "@/components/ui/layout";
import { Form, FormMessage } from "@/components/ui/form";
import { installUpdate } from "./actions";

const POLL_MS = 2000;
const GIVE_UP_MS = 3 * 60 * 1000;

/** Formular zum Installieren der angezeigten Version (mit Rückfrage). */
export function InstallForm({ version, labels }: { version: string; labels: { button: string; confirm: string } }) {
  return (
    <Form action={installUpdate} className="flex flex-col gap-3">
      <input type="hidden" name="version" value={version} />
      <FormMessage />
      <div>
        <ConfirmSubmitButton message={labels.confirm} variant="primary" size="md">
          {labels.button}
        </ConfirmSubmitButton>
      </div>
    </Form>
  );
}

/**
 * Wird gezeigt, solange eine installierte Version noch nicht als gesund bestätigt ist (also direkt nach dem Update).
 * Fragt ab, bis die Anwendung mit der neuen Version – oder nach automatischem Rückfall – wieder antwortet, und lädt dann neu.
 */
export function UpdateWatcher({ target, labels }: { target: string; labels: { restarting: string; timeout: string } }) {
  const [gaveUp, setGaveUp] = useState(false);

  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(async () => {
      try {
        const res = await fetch("/api/updates/status", { cache: "no-store" });
        if (res.ok) {
          const status = (await res.json()) as { version: string; last: { version: string; status: string } | null };
          const rolledBack = status.last?.version === target && status.last.status === "rolled-back";
          if (status.version === target || rolledBack) {
            clearInterval(timer);
            window.location.reload();
            return;
          }
        }
      } catch {
        /* Anwendung startet gerade neu */
      }
      if (Date.now() - started > GIVE_UP_MS) {
        clearInterval(timer);
        setGaveUp(true);
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [target]);

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

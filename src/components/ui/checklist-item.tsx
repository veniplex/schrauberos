"use client";

import clsx from "clsx";
import { useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Loader2, RotateCw, TriangleAlert } from "lucide-react";
import { useI18n } from "@/i18n/client";
import { Button } from "./buttons";

/**
 * Punkt einer Checkliste (Annahmeprotokoll, Ölwechsel, Reifenwechsel …): **speichert jeden Punkt für sich**, sobald er abgehakt wird – am Handy wird zwischen den Handgriffen abgehakt,
 * ohne dass am Ende „Speichern“ nötig wäre. Die ganze Zeile ist das Ziel (mindestens 44 px, auch am Rechner). Scheitert das Speichern, bleibt der Haken **sichtbar als nicht gespeichert**
 * stehen (kein stilles Zurückspringen, kein Verlust) und die Zeile bietet „Erneut versuchen“ an.
 *
 * `onSave(checked)` speichert (wirft bei Fehlern, z. B. ein Netzwerkfehler). `checked` ist der gespeicherte Stand vom Server; ändert er sich, folgt der Baustein, solange nichts
 * gespeichert wird oder aussteht. Zusatzfelder (Messwert, Notiz) gehören als `children` darunter.
 */
export function ChecklistItem({
  label,
  checked,
  onSave,
  hint,
  disabled,
  children,
  className,
}: {
  label: ReactNode;
  checked: boolean;
  onSave: (checked: boolean) => Promise<void>;
  hint?: ReactNode;
  disabled?: boolean;
  children?: ReactNode;
  className?: string;
}) {
  const { t } = useI18n();
  const statusId = useId();
  const [shown, setShown] = useState(checked);
  const [status, setStatus] = useState<"idle" | "saving" | "failed" | "saved">("idle");
  const [lastProp, setLastProp] = useState(checked);
  // Der Server-Stand gilt wieder, sobald nichts mehr aussteht (Ableitung beim Rendern statt Effekt)
  if (checked !== lastProp) {
    setLastProp(checked);
    if (status === "idle" || status === "saved") setShown(checked);
  }
  const attempt = useRef(0);

  async function save(next: boolean) {
    const mine = ++attempt.current;
    setShown(next);
    setStatus("saving");
    try {
      await onSave(next);
      if (mine === attempt.current) setStatus("saved");
    } catch {
      if (mine === attempt.current) setStatus("failed");
    }
  }

  const failed = status === "failed";
  return (
    <div className={clsx("rounded-md", failed && "bg-danger-bg", className)}>
      <div className="flex min-h-11 items-center gap-2">
        <label className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-3 py-1 text-sm">
          <input
            type="checkbox"
            checked={shown}
            disabled={disabled}
            // Beim Speichern nicht `disabled`: ein gesperrtes Feld verliert den Fokus (Tastatur und Bildschirmleser landen auf <body>); stattdessen `aria-busy`, und Eingaben ignoriert die Zeile
            aria-busy={status === "saving" || undefined}
            aria-describedby={statusId}
            aria-invalid={failed || undefined}
            onChange={(event) => {
              if (status !== "saving") void save(event.target.checked);
            }}
            className="size-6 shrink-0 accent-[var(--accent)]"
          />
          <span className="min-w-0">
            <span className={clsx(shown && "text-ink-muted line-through decoration-ink-muted/60")}>{label}</span>
            {hint ? <span className="block text-xs text-ink-muted">{hint}</span> : null}
          </span>
        </label>
        {/* immer im DOM, damit der Wechsel angesagt wird */}
        <span id={statusId} role="status" className="flex shrink-0 items-center gap-1.5 text-xs">
          {status === "saving" ? (
            <span className="flex items-center gap-1 text-ink-muted">
              <Loader2 className="size-3.5 animate-spin" aria-hidden /> {t("ui.checklist.saving")}
            </span>
          ) : failed ? (
            <span className="flex items-center gap-1 text-danger-ink">
              <TriangleAlert className="size-3.5" aria-hidden /> {t("ui.checklist.failed")}
            </span>
          ) : status === "saved" ? (
            <span className="sr-only">{t("ui.checklist.saved")}</span>
          ) : null}
        </span>
        {failed ? (
          <Button size="sm" onClick={() => void save(shown)}>
            <RotateCw className="size-3.5" aria-hidden /> {t("ui.checklist.retry")}
          </Button>
        ) : null}
      </div>
      {children ? <div className="pb-2 pl-9">{children}</div> : null}
    </div>
  );
}

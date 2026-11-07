"use client";

import clsx from "clsx";
import { useEffect, useId, useRef, useState } from "react";
import { Copy, Eye, EyeOff, X } from "lucide-react";
import { useI18n } from "@/i18n/client";
import { Alert } from "./layout";
import { Button } from "./buttons";
import { Input } from "./form-fields";
import { useCopy } from "./copy";

/**
 * Anzeige eines Geheimnisses (API-Token, Wiederherstellungsschlüssel, Tresor-Passwort, Webhook-Secret): **verborgen**, mit „Anzeigen“ und „Kopieren“.
 *
 *  - **Klartext nur im Zustand der Komponente.** Solange das Geheimnis verborgen ist, steht im Feld nur ein Platzhalter gleicher Länge für alle (kein Rückschluss auf die Länge) und der Klartext ist
 *    nirgends im DOM; erst „Anzeigen“ schreibt ihn ins Feld, „Verbergen“ nimmt ihn wieder heraus. Das Feld trägt `data-no-draft` und hat keinen `name`: Es geht nie in einen Formularentwurf
 *    und nie mit einem Formular zum Server.
 *  - **Einmalige Anzeige** (`once`): für Geheimnisse, die der Server nur jetzt herausgibt (neues Token). Der Hinweis „wird nur einmal angezeigt“ steht dabei, „Ausblenden“ wirft den Klartext
 *    aus dem Zustand (`onDismiss` – der Aufrufer löscht seine Kopie, z. B. den Zustand der Aktion), nach `autoHideSeconds` (Standard 120) geschieht das von selbst. Ausgeblendet ist weg.
 *  - **Kopieren** funktioniert auch ohne HTTPS (Rückfall in `copy.ts`), die Rückmeldung steht in einer Live-Region. Der Klartext erscheint nie in einer Meldung.
 */
export function SecretField({
  value,
  label,
  once,
  autoHideSeconds = 120,
  onDismiss,
  className,
}: {
  value: string | null;
  label: string;
  once?: boolean;
  autoHideSeconds?: number;
  onDismiss?: () => void;
  className?: string;
}) {
  const { t } = useI18n();
  const id = useId();
  const [revealed, setRevealed] = useState(false);
  const [secret, setSecret] = useState<string | null>(value);
  const [lastValue, setLastValue] = useState(value);
  const [gone, setGone] = useState(false);
  if (value !== lastValue) {
    // ein neues Geheimnis von außen ersetzt das alte (und beginnt wieder verborgen)
    setLastValue(value);
    setSecret(value);
    setRevealed(false);
    setGone(false);
  }
  const { status, copy } = useCopy();
  // der Rückruf darf sich bei jedem Rendern ändern, ohne den Ablauf der Frist neu zu starten
  const dismissCallback = useRef(onDismiss);
  useEffect(() => {
    dismissCallback.current = onDismiss;
  });

  function hideForGood() {
    setGone(true);
    setSecret(null);
    setRevealed(false);
    dismissCallback.current?.();
  }

  useEffect(() => {
    if (!once || !secret) return;
    const timer = setTimeout(hideForGood, autoHideSeconds * 1000);
    return () => clearTimeout(timer);
    // hideForGood nutzt nur Setter und den Rückruf aus der Referenz
  }, [once, secret, autoHideSeconds]);

  if (secret === null) {
    return once && gone ? (
      <p role="status" className="text-sm text-ink-muted">
        {t("ui.secret.dismissed")}
      </p>
    ) : null;
  }

  return (
    <div className={clsx("flex flex-col gap-2", className)}>
      {once ? (
        <Alert tone="warning" live={false}>
          {t("ui.secret.once")} {t("ui.secret.autoHide", { seconds: autoHideSeconds })}
        </Alert>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id={id}
          readOnly
          aria-label={label}
          data-no-draft
          data-secret=""
          value={revealed ? secret : t("ui.secret.hiddenValue")}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          onFocus={(event) => revealed && event.currentTarget.select()}
          className={clsx("min-w-0 flex-1 basis-60 font-mono", !revealed && "tracking-widest text-ink-muted")}
        />
        <Button aria-pressed={revealed} onClick={() => setRevealed((v) => !v)}>
          {revealed ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
          {revealed ? t("ui.secret.hide") : t("ui.secret.show")}
        </Button>
        <Button onClick={() => void copy(secret)}>
          <Copy className="size-4" aria-hidden /> {t("ui.secret.copy")}
        </Button>
        {once ? (
          <Button variant="ghost" onClick={hideForGood}>
            <X className="size-4" aria-hidden /> {t("ui.secret.dismiss")}
          </Button>
        ) : null}
      </div>
      <p role="status" className={clsx("text-sm", status === "failed" ? "text-danger-ink" : "text-success-ink", status === "idle" && "sr-only")}>
        {status === "copied" ? t("ui.secret.copied") : status === "failed" ? t("ui.secret.copyFailed") : ""}
      </p>
    </div>
  );
}

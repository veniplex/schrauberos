"use client";

import clsx from "clsx";
import { Loader2 } from "lucide-react";
import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { useI18n } from "@/i18n/client";
import { Button, buttonClass, type ButtonSize, type ButtonVariant } from "./buttons";
import { Input } from "./form-fields";

type ConfirmDialogProps = {
  open: boolean;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: ReactNode;
  cancelLabel?: ReactNode;
  variant?: ButtonVariant;
  /** Wort, das eingetippt werden muss (ohne Beachtung der Groß-/Kleinschreibung) */
  typeToConfirm?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * Rückfrage vor einer Aktion – ersetzt `window.confirm`. Ein natives `<dialog>` (Fokusfalle, Escape, Hintergrund inaktiv kommen vom Browser) mit
 * übersetzten Knöpfen. Der Titel **benennt die Aktion** („Kunde löschen?“), die Bestätigung trägt die Beschriftung der Aktion („Löschen“).
 * `typeToConfirm`: bei besonders folgenreichen Aktionen (Wiederherstellung) muss das Wort eingetippt werden, bevor die Bestätigung freigegeben ist.
 *
 * Wird nur gerendert, solange sie offen ist (`open`); das Schließen meldet `onCancel` (Abbrechen, Escape, Klick daneben). Beim Schließen **geht der Fokus zurück** an das Element, das ihn
 * vor dem Öffnen hatte (WCAG 2.4.3 – ein ausgehängtes `<dialog>` gibt ihn nicht von selbst zurück); jedes Öffnen beginnt frisch (ein getipptes Bestätigungswort bleibt nicht stehen).
 */
export function ConfirmDialog(props: ConfirmDialogProps) {
  return props.open ? <OpenConfirmDialog {...props} /> : null;
}

function OpenConfirmDialog({ title, description, confirmLabel, cancelLabel, variant = "danger", typeToConfirm, onConfirm, onCancel }: ConfirmDialogProps) {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  const downOnBackdrop = useRef(false);
  const titleId = useId();
  const descriptionId = useId();
  const [typed, setTyped] = useState("");

  useEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  const allowed = !typeToConfirm || typed.trim().toLowerCase() === typeToConfirm.toLowerCase();
  return (
    <dialog
      ref={ref}
      className="modal confirm-dialog"
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      // Klick auf den Hintergrund schließt nur, wenn auch das Drücken dort begann (Text markieren und außerhalb loslassen ist kein „Klick daneben“)
      onMouseDown={(event) => {
        downOnBackdrop.current = event.target === ref.current;
      }}
      onClick={(event) => {
        if (event.target === ref.current && downOnBackdrop.current) onCancel();
        downOnBackdrop.current = false;
      }}
    >
      <div className="flex flex-col gap-3 p-5">
        <h2 id={titleId} className="text-base font-semibold">
          {title}
        </h2>
        {description ? (
          <p id={descriptionId} className="text-sm text-ink-muted">
            {description}
          </p>
        ) : null}
        {typeToConfirm ? (
          <div>
            <label htmlFor={`${titleId}-type`} className="field-label">
              {t("common.typeToConfirm", { word: typeToConfirm })}
            </label>
            <Input id={`${titleId}-type`} value={typed} onChange={(event) => setTyped(event.target.value)} autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              onKeyDown={(event) => {
                // Enter bestätigt (wenn erlaubt) und sendet nicht das umgebende Formular ab
                if (event.key !== "Enter") return;
                event.preventDefault();
                if (allowed) onConfirm();
              }}
            />
          </div>
        ) : null}
        <div className="mt-1 flex flex-wrap justify-end gap-2">
          <Button onClick={onCancel}>
            {cancelLabel ?? t("common.cancel")}
          </Button>
          <Button variant={variant} disabled={!allowed} onClick={onConfirm}>
            {confirmLabel ?? t("common.confirm")}
          </Button>
        </div>
      </div>
    </dialog>
  );
}

/**
 * Absende-Knopf mit Rückfrage (Löschen, Wiederherstellen, Ausschalten …): Der Klick öffnet einen `ConfirmDialog`, erst die Bestätigung sendet das Formular ab
 * (mit diesem Knopf als Absender, `name`/`value`/`formAction` gelten also weiter).
 * `message` erklärt die Folgen; der Titel ist die Beschriftung der Aktion mit Fragezeichen („Kunde löschen?“), die Bestätigung trägt dieselbe Beschriftung –
 * bei reinen Symbolknöpfen der `aria-label`. `title`/`confirmLabel` überschreiben das.
 *
 * `label`: Symbolknopf mit Beschriftung (Löschen in Tabellenzeilen). Unter `md` steht der **Text sichtbar** neben dem Symbol (Touch: kein Raten, was das Symbol tut), am
 * Desktop nur das Symbol mit dem Text für Screenreader (`sr-only`) und als `title` – es gibt bewusst keinen eigenen Tooltip-Baustein.
 */
export function ConfirmSubmitButton({
  message,
  title,
  confirmLabel,
  typeToConfirm,
  label,
  target,
  children,
  variant = "danger",
  size = "sm",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  message: string;
  title?: string;
  confirmLabel?: string;
  typeToConfirm?: string;
  label?: string;
  /** Wovon die Rede ist („Meier, 3.–7. Mai“): macht gleichnamige Knöpfe in Listen unterscheidbar (Name „Löschen: Meier, 3.–7. Mai“, Titel der Rückfrage) */
  target?: string;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const { pending } = useFormStatus();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const action = confirmLabel ?? label ?? (typeof children === "string" ? children : props["aria-label"]);
  const verb = label ?? (typeof children === "string" ? children : props["aria-label"]);
  const named = target && verb ? `${verb.replace(/[?:]+$/, "")}: ${target}` : undefined;
  return (
    <>
      <button
        {...props}
        ref={button}
        type="submit"
        title={named ?? label}
        aria-label={named ?? props["aria-label"]}
        disabled={pending || props.disabled}
        aria-busy={pending || undefined}
        className={clsx(buttonClass(variant, size), className)}
        onClick={(event) => {
          event.preventDefault();
          setOpen(true);
        }}
      >
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
        {children}
        {label ? <span className="md:sr-only">{label}</span> : null}
      </button>
      <ConfirmDialog
        open={open}
        title={title ?? (named ? `${named}?` : action ? `${action.replace(/[?:]+$/, "")}?` : t("common.confirmTitle"))}
        description={message}
        confirmLabel={action ?? t("common.confirm")}
        variant={variant}
        typeToConfirm={typeToConfirm}
        onCancel={() => setOpen(false)}
        onConfirm={() => {
          setOpen(false);
          button.current?.form?.requestSubmit(button.current);
        }}
      />
    </>
  );
}

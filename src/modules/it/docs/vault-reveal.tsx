"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/buttons";
import { useCopy } from "@/components/ui/copy";
import { Field, Form, FormActions, Input } from "@/components/ui/form";
import { Alert, Card } from "@/components/ui/layout";
import { SecretField } from "@/components/ui/secret-field";
import { useI18n } from "@/i18n/client";
import { revealVaultEntry } from "./vault-actions";

const SHOW_SECONDS = 30;

type Revealed = { title: string; url: string; username: string; secret: string; note: string };
type RevealState = { ok?: boolean; error?: string; fieldErrors?: Record<string, string>; message?: string; vault?: Revealed };

/** Ein Wert mit „Kopieren“ (Benutzername, Adresse) */
function CopyRow({ label, value }: { label: string; value: string }) {
  const { t } = useI18n();
  const { status, copy } = useCopy();
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs text-ink-muted">{label}</p>
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 basis-60 break-all font-mono text-sm">{value}</span>
        <Button size="sm" onClick={() => void copy(value)}>
          <Copy className="size-3.5" aria-hidden /> {t("vault.reveal.copy")}
        </Button>
      </div>
      <p role="status" className={status === "idle" ? "sr-only" : status === "failed" ? "text-sm text-danger-ink" : "text-sm text-success-ink"}>
        {status === "copied" ? t("vault.reveal.copied") : status === "failed" ? t("vault.reveal.copyFailed") : ""}
      </p>
    </div>
  );
}

/**
 * „Zugangsdaten anzeigen“: erneute Passwortabfrage, danach steht der Klartext **nur im Zustand dieser Komponente** (die Antwort der Aktion trägt ihn nicht weiter), verschwindet nach 30 Sekunden von selbst
 * oder mit „Ausblenden“ und wird nie in einen Formularentwurf, die URL oder den Verlauf geschrieben. Das Passwortfeld hat `data-no-draft` und wird vom Formular-Rahmen nie wiederhergestellt.
 */
export function VaultReveal({ id }: { id: string }) {
  const { t } = useI18n();
  const [shown, setShown] = useState<Revealed | null>(null);
  const [gone, setGone] = useState(false);

  const reveal = useCallback(async (prev: RevealState, formData: FormData) => {
    const result = (await revealVaultEntry(prev as never, formData)) as RevealState;
    if (result.vault) {
      setShown(result.vault);
      setGone(false);
      // der Formularzustand trägt den Klartext nicht weiter: er bleibt nur hier
      const { vault: _vault, ...rest } = result;
      void _vault;
      return rest;
    }
    return result;
  }, []);

  const hide = useCallback(() => {
    setShown(null);
    setGone(true);
  }, []);

  useEffect(() => {
    if (!shown) return;
    const timer = setTimeout(hide, SHOW_SECONDS * 1000);
    return () => clearTimeout(timer);
  }, [shown, hide]);

  if (shown) {
    return (
      <Card title={t("vault.reveal.shown", { title: shown.title })}>
        <div className="flex flex-col gap-4">
          <Alert tone="warning" live={false}>
            {t("vault.reveal.hint", { seconds: SHOW_SECONDS })} {t("vault.reveal.clipboard")}
          </Alert>
          {shown.url ? <CopyRow label={t("vault.fields.url")} value={shown.url} /> : null}
          {shown.username ? <CopyRow label={t("vault.fields.username")} value={shown.username} /> : null}
          {shown.secret ? <SecretField value={shown.secret} label={t("vault.fields.secret")} autoHideSeconds={SHOW_SECONDS} /> : null}
          {shown.note ? (
            <div className="flex flex-col gap-1">
              <p className="text-xs text-ink-muted">{t("vault.reveal.noteLabel")}</p>
              <p className="whitespace-pre-wrap break-words text-sm">{shown.note}</p>
            </div>
          ) : null}
          <div>
            <Button variant="secondary" onClick={hide}>
              <EyeOff className="size-4" aria-hidden /> {t("vault.reveal.hide")}
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card title={t("vault.sections.reveal")}>
      {gone ? (
        <p role="status" className="mb-3 text-sm text-ink-muted">
          {t("vault.reveal.gone")}
        </p>
      ) : null}
      <Form<RevealState> action={reveal} className="flex max-w-md flex-col gap-4">
        <input type="hidden" name="id" value={id} />
        <Field label={t("vault.fields.password")} htmlFor="vault-password" name="password" required hint={t("vault.fields.passwordHint")}>
          <Input id="vault-password" name="password" type="password" required autoComplete="current-password" data-no-draft />
        </Field>
        <p className="text-sm text-ink-muted">{t("vault.reveal.hint", { seconds: SHOW_SECONDS })}</p>
        <FormActions submitLabel={t("vault.reveal.submit")} />
      </Form>
    </Card>
  );
}

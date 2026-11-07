"use client";

import { useState } from "react";
import { Printer } from "lucide-react";
import { Alert } from "@/components/ui/layout";
import { Button } from "@/components/ui/buttons";
import { Checkbox } from "@/components/ui/form";
import { useI18n } from "@/i18n/client";

/**
 * Zeigt einen neuen Wiederherstellungs-Code: groß lesbar, mit Druckansicht und einer **Pflicht-Bestätigung** „Ich habe den Code
 * gesichert“, ohne die „Weiter“ gesperrt bleibt. Der Code kommt aus der Antwort einer Server Action und wird nirgends gespeichert.
 * `onConfirm` (optional) merkt die Bestätigung serverseitig; `onContinue` führt weiter (Navigation oder Ausblenden).
 */
export function RecoveryCodeView({
  code,
  issuedOn,
  account,
  workshop,
  continueLabel,
  onConfirm,
  onContinue,
}: {
  code: string;
  issuedOn?: string;
  account?: { name: string; username: string };
  workshop?: string;
  continueLabel?: string;
  onConfirm?: () => Promise<unknown>;
  onContinue: () => void;
}) {
  const { t } = useI18n();
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function proceed() {
    setBusy(true);
    setFailed(false);
    try {
      await onConfirm?.();
    } catch {
      setFailed(true);
      setBusy(false);
      return;
    }
    onContinue();
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Bildschirm */}
      <div className="flex flex-col gap-4 print:hidden">
        <Alert tone="warning">{t("recovery.keepLikePassword")}</Alert>
        <p className="text-sm text-ink-muted">{t("recovery.shownOnce")}</p>
        <div>
          <p className="mb-1 text-xs font-medium text-ink-muted">{t("recovery.yourCode")}</p>
          <p data-testid="recovery-code" className="select-all break-words rounded-md border border-line-strong bg-surface-2 px-3 py-3 font-mono text-base font-semibold tracking-wider">
            {code}
          </p>
        </div>
        <div>
          <Button variant="secondary" onClick={() => window.print()}>
            <Printer className="size-4" aria-hidden /> {t("recovery.print")}
          </Button>
        </div>
        <Checkbox label={t("recovery.saved")} checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        {failed ? (
          <Alert tone="danger" className="px-3 py-2">
            {t("recovery.confirmFailed")}
          </Alert>
        ) : null}
        <div>
          <Button variant="primary" disabled={!saved || busy} aria-busy={busy || undefined} onClick={proceed}>
            {continueLabel ?? t("recovery.continue")}
          </Button>
        </div>
      </div>

      {/* Druckansicht: nur beim Drucken sichtbar */}
      <section className="hidden print:block" aria-hidden>
        <h1 className="mb-2 text-2xl font-semibold">{t("recovery.printTitle")}</h1>
        {workshop ? <p className="text-sm">{t("recovery.printWorkshop", { workshop })}</p> : null}
        {account ? <p className="text-sm">{t("recovery.printFor", { name: account.name, username: account.username })}</p> : null}
        {issuedOn ? <p className="mb-4 text-sm">{t("recovery.printIssued", { date: issuedOn })}</p> : null}
        <p className="my-6 break-words border-2 border-black px-4 py-5 font-mono text-xl font-bold tracking-widest">{code}</p>
        <p className="text-sm">{t("recovery.printWarning")}</p>
      </section>
    </div>
  );
}

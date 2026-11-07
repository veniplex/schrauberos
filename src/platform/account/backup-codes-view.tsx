"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/buttons";
import { Alert } from "@/components/ui/layout";
import { useI18n } from "@/i18n/client";

/**
 * Zeigt Sicherungscodes der Zwei-Faktor-Anmeldung: groß lesbar in zwei Spalten, mit Druckansicht. Die Codes kommen aus der Antwort einer Server Action und werden nirgends
 * gespeichert (die Datenbank kennt nur ihre Prüfsummen). Die Bestätigung „gesichert“ liegt beim Aufrufer (bei der Einrichtung ist sie Pflicht für „Aktivieren“).
 */
export function BackupCodesView({ codes, issuedOn, account }: { codes: string[]; issuedOn?: string; account: { name: string; username: string } }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 print:hidden">
        <Alert tone="warning">{t("security.backupCodes.keep")}</Alert>
        <p className="text-sm text-ink-muted">{t("security.backupCodes.shownOnce")}</p>
        <ul data-testid="backup-codes" className="grid grid-cols-1 gap-2 rounded-md border border-line-strong bg-surface-2 p-3 font-mono text-base font-semibold tracking-wider sm:grid-cols-2">
          {codes.map((code) => (
            <li key={code} className="select-all">
              {code}
            </li>
          ))}
        </ul>
        <div>
          <Button variant="secondary" onClick={() => window.print()}>
            <Printer className="size-4" aria-hidden /> {t("recovery.print")}
          </Button>
        </div>
      </div>

      {/* Druckansicht: nur beim Drucken sichtbar */}
      <section className="hidden print:block" aria-hidden>
        <h1 className="mb-2 text-2xl font-semibold">{t("security.backupCodes.printTitle")}</h1>
        <p className="text-sm">{t("recovery.printFor", { name: account.name, username: account.username })}</p>
        {issuedOn ? <p className="mb-4 text-sm">{t("recovery.printIssued", { date: issuedOn })}</p> : null}
        <ul className="my-6 grid grid-cols-2 gap-3 border-2 border-black px-4 py-5 font-mono text-lg font-bold tracking-widest">
          {codes.map((code) => (
            <li key={code}>{code}</li>
          ))}
        </ul>
        <p className="text-sm">{t("security.backupCodes.printWarning")}</p>
      </section>
    </div>
  );
}

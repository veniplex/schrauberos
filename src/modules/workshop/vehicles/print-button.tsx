"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/buttons";
import { useI18n } from "@/i18n/client";

/** „Drucken“ der Druckliste (öffnet den Druckdialog des Browsers). */
export function PrintButton() {
  const { t } = useI18n();
  return (
    <Button variant="primary" onClick={() => window.print()}>
      <Printer className="size-4" aria-hidden /> {t("vehicles.print.do")}
    </Button>
  );
}

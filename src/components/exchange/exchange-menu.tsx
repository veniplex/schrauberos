import { ArrowDownToLine, ArrowUpFromLine, ArrowLeftRight } from "lucide-react";
import { Menu, MenuLink } from "@/components/ui/menu";
import { getI18n } from "@/i18n/server";

/**
 * „Export / Import“ im Kopf einer Liste (Kunden, Fahrzeuge, Reifen, Rechnungen): ein Menü mit den Seiten, die diese Person öffnen darf. Ohne eines der Rechte gibt es das Menü nicht
 * (die Seiten prüfen ihr Recht ohnehin selbst). `exportHref` darf Filter der Liste mitnehmen.
 */
export async function ExchangeMenu({ exportHref, importHref }: { exportHref?: string; importHref?: string }) {
  if (!exportHref && !importHref) return null;
  const { t } = await getI18n();
  return (
    <Menu trigger={<><ArrowLeftRight className="size-4" aria-hidden /> {t("exchange.menu")}</>} variant="secondary" align="end">
      {exportHref ? (
        <MenuLink href={exportHref}>
          <ArrowDownToLine className="size-4" aria-hidden /> {t("exchange.export")}
        </MenuLink>
      ) : null}
      {importHref ? (
        <MenuLink href={importHref}>
          <ArrowUpFromLine className="size-4" aria-hidden /> {t("exchange.import")}
        </MenuLink>
      ) : null}
    </Menu>
  );
}

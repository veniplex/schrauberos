import clsx from "clsx";
import type { ReactNode } from "react";
import { getI18n } from "@/i18n/server";
import { Button, LinkButton } from "./buttons";
import { FilterExtras } from "./filter-extras";

/**
 * Filterleiste über einer Liste (GET-Formular): `search` (das Suchfeld – bleibt auf jedem Bildschirm sichtbar), Zusatzfilter als Kinder (unter `sm` hinter „Weitere Filter“
 * eingeklappt, versteckte Felder wie `dir=incoming` gehören dazu), der Absenden-Knopf kommt von selbst dazu.
 * `active`: es ist ein Filter gesetzt – dann erscheint „Zurücksetzen“ (Link auf `resetHref`, die Liste ohne Filter). `extrasOpen`: ein Zusatzfilter ist gesetzt, die Leiste startet unter `sm` aufgeklappt.
 * `columns` ist die Spaltenaufteilung ab `sm` (Tailwind, z. B. "sm:grid-cols-[minmax(0,1fr)_10rem_auto]"): Suche, Zusatzfilter …, zuletzt der Knopf-Block.
 */
export async function FilterBar({
  columns,
  search,
  children,
  active,
  resetHref,
  extrasOpen,
}: {
  columns: string;
  search: ReactNode;
  children?: ReactNode;
  active?: boolean;
  resetHref: string;
  extrasOpen?: boolean;
}) {
  const { t } = await getI18n();
  return (
    <form method="get" role="search" className={clsx("card card-pad mb-5 grid gap-3", columns)}>
      {search}
      {children ? <FilterExtras defaultOpen={extrasOpen}>{children}</FilterExtras> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="secondary" className="max-sm:flex-1">
          {t("common.filter")}
        </Button>
        {active ? (
          <LinkButton href={resetHref} variant="ghost">
            {t("common.resetFilters")}
          </LinkButton>
        ) : null}
      </div>
    </form>
  );
}

import { ChevronLeft, ChevronRight, CircleHelp } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { getI18n } from "@/i18n/server";
import { LinkButton } from "./buttons";
import { TextLink } from "./layout";

export type Crumb = { href: string; label: ReactNode };

/**
 * Seitenkopf: Überschrift, Beschreibung, Aktionen.
 *
 * - `back` / `breadcrumbs`: der Weg zurück. **Auf jeder Detail-, Bearbeiten- und Neu-Seite Pflicht** (ein installiertes Web-App-Fenster auf dem iPhone hat keine
 *   Zurück-Taste). `breadcrumbs` sind die Vorfahren von oben nach unten (ohne die aktuelle Seite), `back` ist der unmittelbare Vorfahre. Ab `sm` steht der ganze
 *   Pfad, darunter nur „← Vorfahre“.
 * - `help`: Kapitel der Hilfe (`/help/<id>`, Id aus der `help.ts` der Funktion oder ein Allgemein-Kapitel wie `arbeiten-in-der-anwendung`) – ein Hilfe-Knopf in den Aktionen.
 *   Nur setzen, wenn das Kapitel für jeden sichtbar ist, der die Seite sehen darf.
 */
export async function PageHeader({
  title,
  description,
  actions,
  back,
  breadcrumbs,
  help,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  back?: Crumb;
  breadcrumbs?: Crumb[];
  help?: string;
}) {
  const { t } = await getI18n();
  const trail = breadcrumbs ?? (back ? [back] : []);
  const parent = trail[trail.length - 1];
  return (
    <header className="mb-6">
      {parent ? (
        <nav aria-label={t("common.breadcrumb")} className="mb-2">
          <ol className="hidden flex-wrap items-center gap-x-1 text-sm text-ink-muted sm:flex">
            {trail.map((crumb, i) => (
              <Fragment key={`${crumb.href}-${i}`}>
                {i > 0 ? <ChevronRight className="size-3.5 shrink-0" aria-hidden /> : null}
                <li>
                  <TextLink href={crumb.href} className="text-ink-muted no-underline hover:text-ink hover:underline">
                    {crumb.label}
                  </TextLink>
                </li>
              </Fragment>
            ))}
          </ol>
          <TextLink href={parent.href} className="gap-1 sm:hidden">
            <ChevronLeft className="size-4 shrink-0" aria-hidden />
            {parent.label}
          </TextLink>
        </nav>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">{title}</h1>
          {description ? <div className="mt-1 max-w-prose text-sm text-ink-muted">{description}</div> : null}
        </div>
        {actions || help ? (
          <div className="flex flex-wrap items-center gap-2">
            {actions}
            {help ? (
              <LinkButton href={`/help/${help}`} variant="ghost" size="icon" aria-label={t("common.helpForPage")} title={t("common.helpForPage")}>
                <CircleHelp className="size-4" aria-hidden />
              </LinkButton>
            ) : null}
          </div>
        ) : null}
      </div>
    </header>
  );
}

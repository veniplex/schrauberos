import { ChevronLeft, ChevronRight, CircleHelp } from "lucide-react";
import type { ReactNode } from "react";
import { getI18n } from "@/i18n/server";
import { helpTopicVisible } from "@/modules/help";
import { getSession } from "@/server/auth/session";
import { LinkButton } from "./buttons";
import { TextLink } from "./layout";

export type Crumb = { href: string; label: ReactNode };

/**
 * Seitenkopf: Überschrift, Beschreibung, Aktionen.
 *
 * - `back` / `breadcrumbs`: der Weg zurück. **Auf jeder Detail-, Bearbeiten- und Neu-Seite Pflicht** (ein installiertes Web-App-Fenster auf dem iPhone hat keine
 *   Zurück-Taste). `breadcrumbs` sind die Vorfahren von oben nach unten (ohne die aktuelle Seite), `back` ist der unmittelbare Vorfahre. Ab `sm` steht der ganze
 *   Pfad, darunter nur „← Vorfahre“.
 * - `help`: Kapitel der Hilfe (`/help/<id>`, Id aus der `help.ts` der Funktion oder ein Allgemein-Kapitel wie `arbeiten-in-der-anwendung`) – ein Hilfe-Symbol am Ende der Titelzeile (nicht bei den Aktionen: dort rutschte es mobil in eine eigene Zeile).
 *   Der Knopf erscheint nur, wenn das Kapitel für diese Anmeldung sichtbar ist (Funktion aktiv, Leserecht) – sonst führte er auf eine 404-Seite.
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
  const session = help ? await getSession() : null;
  const showHelp = Boolean(help && session && helpTopicVisible(help, session));
  const trail = breadcrumbs ?? (back ? [back] : []);
  const parent = trail[trail.length - 1];
  return (
    <header className="mb-6">
      {parent ? (
        <nav aria-label={t("common.breadcrumb")} className="mb-2">
          <ol className="hidden flex-wrap items-center gap-x-1 text-sm text-ink-muted sm:flex">
            {trail.map((crumb, i) => (
              // Trenner im Listenelement (ein `ol` darf nur `li` enthalten), vor allem **nach** jedem Vorfahren: der Pfad endet am nächsten Vorfahren, die aktuelle Seite steht darunter in der Überschrift
              <li key={`${crumb.href}-${i}`} className="flex items-center gap-x-1">
                <TextLink href={crumb.href} className="text-ink-muted no-underline hover:text-ink hover:underline">
                  {crumb.label}
                </TextLink>
                {i < trail.length - 1 ? <ChevronRight className="size-3.5 shrink-0" aria-hidden /> : null}
              </li>
            ))}
          </ol>
          <TextLink href={parent.href} className="gap-1 sm:hidden">
            <ChevronLeft className="size-4 shrink-0" aria-hidden />
            {parent.label}
          </TextLink>
        </nav>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        {/* `grow` statt `flex-1`: Basis bleibt die Inhaltsbreite, damit die Aktionen darunter umbrechen, statt den Titel zusammenzudrücken (und das Hilfe-Symbol zu überdecken) */}
        <div className="min-w-0 grow">
          {/* Das Hilfe-Symbol steht immer am Ende der Titelzeile – auf jeder Seite und in jeder Breite an derselben Stelle (nie allein in einer eigenen Zeile zwischen Beschreibung und Aktionen) */}
          <div className="flex items-start justify-between gap-2" data-page-title-row="">
            <h1 className="min-w-0 text-2xl font-semibold [overflow-wrap:anywhere]">{title}</h1>
            {showHelp ? (
              // `shrink-0`: ein langer Titel darf das Symbol nie zusammendrücken (es würde vom Titel teilweise verdeckt – zu kleines Touch-Ziel)
              <span className="shrink-0">
                <LinkButton href={`/help/${help}`} variant="ghost" size="icon" aria-label={t("common.helpForPage")} title={t("common.helpForPage")}>
                  <CircleHelp className="size-4" aria-hidden />
                </LinkButton>
              </span>
            ) : null}
          </div>
          {description ? <div className="mt-1 max-w-prose text-sm text-ink-muted">{description}</div> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

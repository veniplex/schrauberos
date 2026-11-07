import "server-only";
import { getI18n } from "@/i18n/server";
import type { SearchProviderDef } from "@/modules/types";
import { REPORT_HREF, openableReports } from "./access";

/**
 * Schnellsuche: die Berichte selbst (nach Titel und Beschreibung), nur die, die die Person mit ihren Rechten öffnen darf (`reports.view` und das Leserecht der Quelle). Es gibt keine Daten zu durchsuchen –
 * die Berichte zeigen Auswertungen, keine Datensätze.
 */
export const searchProviders: SearchProviderDef[] = [
  {
    id: "reports",
    feature: "office.reports",
    permission: "reports.view",
    groupKey: "reports.search.group",
    order: 45,
    async search(q, { session, limit }) {
      const { t } = await getI18n();
      const needle = q.trim().toLocaleLowerCase();
      if (!needle) return [];
      return openableReports(session)
        .map((id) => ({ id, title: t(`reports.cards.${id}.title`), subtitle: t(`reports.cards.${id}.text`) }))
        .filter((report) => `${report.title} ${report.subtitle}`.toLocaleLowerCase().includes(needle))
        .slice(0, limit)
        .map((report) => ({ id: report.id, title: report.title, subtitle: report.subtitle, href: REPORT_HREF[report.id] }));
    },
  },
];

import { CardLink } from "@/components/ui/layout";
import { getI18n } from "@/i18n/server";
import { INTL_LOCALE } from "@/i18n/config";
import { todayInput } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { monthStart } from "@/lib/month";
import type { WidgetDef } from "@/modules/types";
import { getSession } from "@/server/auth/session";
import { canOpenReport } from "./access";
import { monthPeriod, revenueReport } from "./queries";

/**
 * Baustein „Umsatz im laufenden Monat“ (Brutto, Netto, Zahl der Belege) mit Link zum Bericht – **nur mit `reports.view` und `invoices.view`** (die Beträge gibt es nur, wer die Rechnungen sehen darf; ohne das Recht
 * bleibt der Baustein leer) und nur bei aktiven Rechnungen. Gerechnet wird wie im Bericht (nur Ausgangsliste: nie Angebote oder Entwürfe, Stornos negativ).
 */
export async function RevenueWidget() {
  const [{ t, tp, date, locale }, session] = await Promise.all([getI18n(), getSession()]);
  if (!session || !canOpenReport(session, "revenue")) return null;
  const today = todayInput();
  const report = await revenueReport(session, monthPeriod(today));
  if (!report) return null;
  const eur = (cents: number) => formatCents(cents, INTL_LOCALE[locale]);
  const month = date(monthStart(today.slice(0, 7)), { month: "long", year: "numeric" });
  return (
    <CardLink href="/reports/revenue" aria-label={`${t("reports.widget.title")}: ${month}, ${t("reports.widget.gross")} ${eur(report.total.grossCents)}, ${tp("reports.widget.documents", report.total.count)}`}>
      <p className="text-sm text-ink-muted">
        {t("reports.widget.title")} · {month}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular">{eur(report.total.grossCents)}</p>
      <p className="text-xs text-ink-muted">
        {t("reports.widget.gross")} · {t("reports.widget.net")} {eur(report.total.netCents)} · {tp("reports.widget.documents", report.total.count)}
      </p>
      <p className="mt-2 text-sm font-medium text-accent-text">{t("reports.widget.link")}</p>
    </CardLink>
  );
}

/** Dashboard-Bausteine dieser Funktion (von der Registry eingesammelt). */
export const widgets: WidgetDef[] = [{ id: "reports-revenue", titleKey: "reports.widget.title", priority: 40, feature: "office.reports", permission: "reports.view", uses: ["office.invoices"], span: 1, order: 45, Component: RevenueWidget }];

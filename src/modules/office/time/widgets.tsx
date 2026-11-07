import { Card, TextLink } from "@/components/ui/layout";
import { getI18n } from "@/i18n/server";
import type { WidgetDef } from "@/modules/types";
import { stampableOrders } from "@/modules/workshop/orders/public";
import { getSession } from "@/server/auth/session";
import { formatDuration } from "./domain";
import { dashboardStamp } from "./queries";
import { StampPanel } from "./stamp-panel";

/**
 * Baustein „Stempeln“ der Übersicht (hohe Wichtigkeit): derselbe große Stempel-Knopf wie auf der Seite, mit dem Stand von heute. Am Handy der häufigste Handgriff – deshalb ohne Umweg über die Seite.
 * Ohne Mitarbeiterprofil zum Konto weist der Baustein darauf hin, statt einen Knopf zu zeigen, der nur Fehler meldet.
 */
export async function StampWidget() {
  const session = await getSession();
  if (!session) return null;
  const [{ t, date }, state] = await Promise.all([getI18n(), dashboardStamp(session)]);
  const withOrders = session.features.has("workshop.orders") && session.can("orders.view") && session.can("time.stamp");
  const orders = withOrders ? await stampableOrders() : [];
  return (
    <Card
      headingLevel={3}
      title={t("time.widgets.stampTitle")}
      actions={
        <TextLink href="/time" className="text-sm">
          {t("time.widgets.open")}
        </TextLink>
      }
    >
      {!state.hasProfile ? (
        <p className="text-sm text-ink-muted">{t("time.noProfile.none")}</p>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-ink-muted">{t("time.widgets.today", { duration: formatDuration(state.todayMinutes) })}</p>
          {session.can("time.stamp") ? (
            <StampPanel
              running={state.running ? { id: state.running.id, orderLabel: state.running.orderNumber ? [state.running.orderNumber, state.running.plate].filter(Boolean).join(" · ") : null } : null}
              since={state.running ? date(state.running.startedAt, { timeStyle: "short" }) : null}
              orders={orders.map((o) => ({ id: o.id, label: `${o.number} · ${o.plate}` }))}
            />
          ) : null}
        </div>
      )}
    </Card>
  );
}

export const widgets: WidgetDef[] = [{ id: "time-stamp", titleKey: "time.widgets.stampTitle", priority: 11, feature: "office.time", permission: "time.view", span: 1, order: 11, Component: StampWidget }];

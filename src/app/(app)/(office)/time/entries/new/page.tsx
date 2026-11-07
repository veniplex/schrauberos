import type { Metadata } from "next";
import { Alert } from "@/components/ui/layout";
import { PageHeader } from "@/components/ui/page-header";
import { getI18n } from "@/i18n/server";
import { todayInput } from "@/lib/dates";
import { ManualForm } from "@/modules/office/time/entry-forms";
import { myEmployee, staffForManual } from "@/modules/office/time/queries";
import { stampableOrders } from "@/modules/workshop/orders/public";
import { requirePermission } from "@/server/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("time.manual.title") };
}

/** Zeit nachtragen (vergessen zu stempeln): mit Begründung, Herkunft „nachgetragen“. Für andere Mitarbeiter nur mit `time.correctAll`. */
export default async function NewEntryPage() {
  const session = await requirePermission("time.correct");
  const { t } = await getI18n();
  const mine = await myEmployee(session);
  const staff = await staffForManual(session);
  const orders = session.features.has("workshop.orders") && session.can("orders.view") ? await stampableOrders() : [];

  return (
    <>
      <PageHeader back={{ href: "/time/entries", label: t("time.tabs.entries") }} help="office.time" title={t("time.manual.title")} description={t("time.manual.description")} />
      {!mine && staff.length === 0 ? (
        <Alert tone="warning">{t("time.noProfile.none")}</Alert>
      ) : (
        <ManualForm
          initial={{ startDate: todayInput(), startTime: "", endDate: todayInput(), endTime: "", breakMinutes: "0", orderId: "", activity: "", note: "" }}
          orders={orders.map((o) => ({ id: o.id, label: `${o.number} · ${o.plate}` }))}
          staff={staff}
          cancelHref="/time/entries"
        />
      )}
    </>
  );
}

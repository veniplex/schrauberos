import type { Metadata } from "next";
import { Suspense } from "react";
import clsx from "clsx";
import { loadNavIcons, FALLBACK_ICON } from "@/components/shell/nav-icons";
import { WidgetBoundary } from "@/components/shell/widget-boundary";
import { LinkButton } from "@/components/ui/buttons";
import { Disclosure } from "@/components/ui/disclosure";
import { Card, EmptyState } from "@/components/ui/layout";
import { PageHeader } from "@/components/ui/page-header";
import { getI18n } from "@/i18n/server";
import { SETUP_CHECKLIST_HIDDEN, pickWidgets } from "@/lib/dashboard";
import { setupChecksFor, shortcutsFor, widgetsFor, type WidgetEntry } from "@/modules/registry";
import { SetupChecklist, ShowSetupChecklist } from "@/platform/dashboard/setup-checklist";
import { connectionIsSecure } from "@/server/auth/connection";
import { requireSession } from "@/server/auth/session";
import { getSetting } from "@/server/settings";
import { getWorkshop } from "@/server/workshop";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("nav.dashboard") };
}

function WidgetSkeleton() {
  return <Card as="div" padded={false} className="h-48 animate-pulse bg-surface-2" aria-hidden />;
}

function WidgetGrid({ widgets }: { widgets: WidgetEntry[] }) {
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      {widgets.map(({ id, span, Component }) => (
        <div key={id} className={clsx("min-w-0", span === 2 && "lg:col-span-2")}>
          <WidgetBoundary>
            <Suspense fallback={<WidgetSkeleton />}>
              <Component />
            </Suspense>
          </WidgetBoundary>
        </div>
      ))}
    </div>
  );
}

/**
 * Übersicht (P2b-4): Schnellaktionen der Rolle, bei Administratoren die Einrichtungs-Checkliste, dann die vier wichtigsten Bausteine („heute und morgen“ zuerst) – der Rest ist als
 * „Weitere Bausteine“ zugeklappt. Was zu sehen ist, ergeben Funktion, Recht und `uses` (`widgetsFor`); die Rangfolge die `priority` der Funktionen (`pickWidgets`).
 */
export default async function DashboardPage() {
  const session = await requireSession();
  const [{ t, tp, date }, workshop] = await Promise.all([getI18n(), getWorkshop()]);
  const { shown, more } = pickWidgets(widgetsFor(session));
  const shortcuts = shortcutsFor(session);
  const icons = await loadNavIcons([...new Set(shortcuts.map((a) => a.module))]);
  const checklistHidden = session.user.isAdmin ? (await getSetting(SETUP_CHECKLIST_HIDDEN)) === "true" : true;
  const checks = session.user.isAdmin && !checklistHidden ? await setupChecksFor(session, await connectionIsSecure()) : [];

  const now = new Date();

  return (
    <>
      <PageHeader
        title={t("dashboard.welcome", { name: session.user.name.split(" ")[0] })}
        description={
          <>
            {/* `<time>`: das Tagesdatum ändert sich täglich – die Baseline-Screenshots der Browser-CI maskieren `time` */}
            <time dateTime={now.toISOString()}>{date(now, { dateStyle: "full" })}</time> · {workshop.name}
          </>
        }
      />
      <SetupChecklist items={checks} />
      {shortcuts.length > 0 ? (
        <section aria-label={t("dashboard.shortcuts")} className="mb-6 flex flex-wrap gap-2">
          {shortcuts.map((a) => {
            const Icon = icons[a.icon] ?? FALLBACK_ICON;
            return (
              <LinkButton key={a.id} href={a.href} variant="secondary">
                <Icon className="size-4" aria-hidden /> {t(a.labelKey)}
              </LinkButton>
            );
          })}
        </section>
      ) : null}
      {shown.length === 0 ? (
        <EmptyState title={t("dashboard.noWidgets")} hint={t("dashboard.askAdmin")} />
      ) : (
        <div className="flex flex-col gap-6">
          <WidgetGrid widgets={shown} />
          {more.length > 0 ? (
            <Disclosure title={tp("dashboard.moreWidgetsCount", more.length)}>
              <div className="pt-3">
                <WidgetGrid widgets={more} />
              </div>
            </Disclosure>
          ) : null}
        </div>
      )}
      {session.user.isAdmin && checklistHidden ? <ShowSetupChecklist /> : null}
    </>
  );
}

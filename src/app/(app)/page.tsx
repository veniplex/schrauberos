import type { Metadata } from "next";
import { Suspense } from "react";
import clsx from "clsx";
import { PageHeader } from "@/components/ui/layout";
import { getI18n } from "@/i18n/server";
import { widgetsFor } from "@/modules/registry";
import type { WidgetDef } from "@/modules/types";
import { requireSession } from "@/server/auth/session";
import { getWorkshop } from "@/server/workshop";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("nav.dashboard") };
}

function WidgetSkeleton() {
  return <div className="card h-48 animate-pulse bg-surface-2" aria-hidden />;
}

const AREAS = ["workshop", "office", "it"] as const;

export default async function DashboardPage() {
  const session = await requireSession();
  const [{ t, date }, workshop] = await Promise.all([getI18n(), getWorkshop()]);
  const widgets = widgetsFor(session);
  const byArea = AREAS.map((area) => ({ area, widgets: widgets.filter((w: WidgetDef) => w.area === area) })).filter((g) => g.widgets.length > 0);

  return (
    <>
      <PageHeader
        title={t("dashboard.welcome", { name: session.user.name.split(" ")[0] })}
        description={`${date(new Date(), { dateStyle: "full" })} · ${workshop.name}`}
      />
      {byArea.length === 0 ? (
        <p className="text-sm text-ink-muted">{t("dashboard.noWidgets")}</p>
      ) : (
        <div className="flex flex-col gap-8">
          {byArea.map(({ area, widgets: list }) => (
            <section key={area} aria-labelledby={`area-${area}`}>
              <h2 id={`area-${area}`} className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                {t(`areas.${area}`)}
              </h2>
              <div className="grid gap-5 lg:grid-cols-2">
                {list.map(({ id, span, Component }) => (
                  <div key={id} className={clsx("min-w-0", span === 2 && "lg:col-span-2")}>
                    <Suspense fallback={<WidgetSkeleton />}>
                      <Component />
                    </Suspense>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

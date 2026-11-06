import type { Metadata } from "next";
import { Suspense } from "react";
import clsx from "clsx";
import { Card, PageHeader } from "@/components/ui/layout";
import { getI18n } from "@/i18n/server";
import { widgetsFor } from "@/modules/registry";
import { MODULES } from "@/modules/catalog";
import { requireSession } from "@/server/auth/session";
import { getWorkshop } from "@/server/workshop";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("nav.dashboard") };
}

function WidgetSkeleton() {
  return <Card as="div" padded={false} className="h-48 animate-pulse bg-surface-2" aria-hidden />;
}

export default async function DashboardPage() {
  const session = await requireSession();
  const [{ t, date }, workshop] = await Promise.all([getI18n(), getWorkshop()]);
  const widgets = widgetsFor(session);
  const byModule = MODULES.map((m) => ({ module: m, widgets: widgets.filter((w) => w.module === m.id) })).filter((g) => g.widgets.length > 0);

  return (
    <>
      <PageHeader
        title={t("dashboard.welcome", { name: session.user.name.split(" ")[0] })}
        description={`${date(new Date(), { dateStyle: "full" })} · ${workshop.name}`}
      />
      {byModule.length === 0 ? (
        <p className="text-sm text-ink-muted">{t("dashboard.noWidgets")}</p>
      ) : (
        <div className="flex flex-col gap-8">
          {byModule.map(({ module: m, widgets: list }) => (
            <section key={m.id} aria-labelledby={`module-${m.id}`}>
              <h2 id={`module-${m.id}`} className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                {t(m.nameKey)}
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

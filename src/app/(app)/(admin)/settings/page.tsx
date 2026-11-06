import type { Metadata } from "next";
import clsx from "clsx";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/layout";
import { getI18n } from "@/i18n/server";
import { settingsTabsFor } from "@/modules/registry";
import { requireSession } from "@/server/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("nav.settings") };
}

/** Die Reiter liefern die Funktionen selbst (siehe SettingsTabDef) – ausgeschaltete Funktionen haben hier keinen Reiter. */
export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  // Jede Funktion bringt ihre Reiter mit ihrem eigenen Recht mit (Verwaltung: settings.manage, Termine: appointments.configure …)
  const session = await requireSession();
  const [{ t }, sp] = await Promise.all([getI18n(), searchParams]);
  const tabs = settingsTabsFor(session);
  if (tabs.length === 0) redirect("/forbidden");
  const active = tabs.find((tab) => tab.id === sp.tab) ?? tabs[0];

  return (
    <>
      <PageHeader title={t("settings.title")} description={t("settings.description")} />
      <nav aria-label={t("settings.title")} className="mb-5 flex gap-1 overflow-x-auto overflow-y-hidden border-b border-line">
        {tabs.map((tab) => (
          <Link
            key={tab.id}
            href={`/settings?tab=${tab.id}`}
            aria-current={active?.id === tab.id ? "page" : undefined}
            className={clsx(
              "-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium",
              active?.id === tab.id ? "border-accent text-accent-text" : "border-transparent text-ink-muted hover:text-ink",
            )}
          >
            {t(tab.labelKey)}
          </Link>
        ))}
      </nav>
      {active ? <active.Component /> : null}
    </>
  );
}

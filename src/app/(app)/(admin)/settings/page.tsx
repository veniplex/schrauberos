import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { TabNav } from "@/components/ui/tab-nav";
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
      {/* ohne `help`: Die Reiter haben verschiedene Rechte, das Hilfekapitel „Einstellungen“ aber nur settings.manage */}
      <PageHeader title={t("settings.title")} description={t("settings.description")} help="admin.settings" />
      <TabNav label={t("settings.title")} items={tabs.map((tab) => ({ href: `/settings?tab=${tab.id}`, label: t(tab.labelKey), active: active?.id === tab.id }))} />
      {active ? <active.Component /> : null}
    </>
  );
}

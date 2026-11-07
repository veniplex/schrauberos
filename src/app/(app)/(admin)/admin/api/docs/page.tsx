import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { getI18n } from "@/i18n/server";
import { ApiTabs } from "@/modules/admin/api/api-tabs";
import { docModel } from "@/modules/admin/api/docs";
import { DocsView } from "@/modules/admin/api/docs-view";
import { offeredEvents } from "@/modules/admin/api/operations";
import { getActiveFeatureIds } from "@/modules/features";
import { apiDocument } from "@/server/api/doc";
import { requirePermission } from "@/server/auth/session";
import { getPublicUrl } from "@/server/public-url";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("api.docs.title") };
}

/** Dokumentation der Programmierschnittstelle (Recht `api.manage`): Konventionen, Versionierung, Webhooks mit Prüfcode, alle Endpunkte aktiver Funktionen – serverseitig gerendert. */
export default async function ApiDocsPage({ searchParams }: { searchParams: Promise<{ tag?: string }> }) {
  await requirePermission("api.manage");
  const [{ t, td }, { tag }] = await Promise.all([getI18n(), searchParams]);
  const [features, publicUrl] = await Promise.all([getActiveFeatureIds(), getPublicUrl()]);
  const base = publicUrl ?? "https://<adresse-der-anwendung>";
  const groups = docModel(apiDocument(features), base);
  const events = (await offeredEvents()).map((event) => ({ type: event.type, resource: event.resource, label: td(`api.webhooks.events.${event.type}`, event.type) }));
  return (
    <>
      <PageHeader title={t("api.title")} description={t("api.description")} help="admin.api" />
      <ApiTabs active="docs" />
      <DocsView groups={groups} events={events} base={base} jsonHref="/admin/api/openapi.json" tag={tag} />
    </>
  );
}

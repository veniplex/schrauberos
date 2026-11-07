import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { getI18n } from "@/i18n/server";
import { scopeGroups } from "@/modules/admin/api/scope-groups";
import { TokenForm } from "@/modules/admin/api/token-form";
import { getActiveFeatureIds } from "@/modules/features";
import { apiGrantablePermissions } from "@/server/api/doc";
import { isBehindProxy } from "@/server/auth/network";
import { requirePermission } from "@/server/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("api.tokens.new") };
}

/** Neues API-Token: Rechte je Ressource (nichts vorgewählt), Ablauf, optionale Adressbereiche, erneute Passwortabfrage. Nur Rechte, die die Schnittstelle nutzt und die man selbst hat. */
export default async function NewApiTokenPage() {
  const session = await requirePermission("api.manage");
  const [i18n, features, behindProxy] = await Promise.all([getI18n(), getActiveFeatureIds(), isBehindProxy()]);
  const { t, td } = i18n;
  const groups = scopeGroups(apiGrantablePermissions(features), (p) => session.permissions.has(p as never), { td });
  const markLabels = { send: t("api.tokens.marks.send"), sensitive: t("api.tokens.marks.sensitive"), export: t("api.tokens.marks.export"), import: t("api.tokens.marks.import"), reveal: t("api.tokens.marks.reveal"), api: t("api.tokens.marks.api") };
  return (
    <>
      <PageHeader back={{ href: "/admin/api", label: t("api.title") }} title={t("api.tokens.new")} help="admin.api" />
      <TokenForm groups={groups} markLabels={markLabels} behindProxy={behindProxy} />
    </>
  );
}

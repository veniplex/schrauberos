import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { getI18n } from "@/i18n/server";
import { TemplateEditor } from "@/modules/workshop/checklists/template-editor";
import { requirePermission } from "@/server/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("checklists.templates.new") };
}

/** Neue Vorlage (Version 1) mit einem ersten Punkt. */
export default async function NewTemplatePage() {
  await requirePermission("checklists.manage");
  const { t } = await getI18n();
  return (
    <>
      <PageHeader back={{ href: "/checklists/templates", label: t("checklists.templates.title") }} help="workshop.checklists" title={t("checklists.templates.new")} />
      <TemplateEditor
        initial={{
          name: "",
          description: "",
          signatureMode: "none",
          items: [{ label: "", type: "check", required: true, unit: "", minValue: "", maxValue: "", targetValue: "", options: "", hint: "" }],
        }}
      />
    </>
  );
}

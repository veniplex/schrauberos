import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/layout";
import { getI18n } from "@/i18n/server";
import { db } from "@/server/db";
import { requireDocEdit } from "@/capabilities/docs/access";
import { DocEditor } from "@/capabilities/docs/doc-editor";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("docs.new") };
}

export default async function NewDocPage({ params, searchParams }: { params: Promise<{ area: string }>; searchParams: Promise<{ cat?: string }> }) {
  const [{ area: areaParam }, sp] = await Promise.all([params, searchParams]);
  const { area } = await requireDocEdit(areaParam);
  const [{ t }, categories] = await Promise.all([getI18n(), db.docCategory.findMany({ where: { area }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] })]);

  return (
    <>
      <PageHeader title={t("docs.new")} description={t(`docs.areas.${area}.title`)} />
      <DocEditor
        area={area}
        categories={categories}
        cancelHref={`/docs/${area}`}
        initial={{ title: "", categoryId: categories.some((c) => c.id === sp.cat) ? sp.cat! : "", content: "", pinned: false }}
      />
    </>
  );
}

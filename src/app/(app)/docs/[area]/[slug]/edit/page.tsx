import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/layout";
import { ConfirmSubmitButton } from "@/components/ui/buttons";
import { getI18n } from "@/i18n/server";
import { db } from "@/server/db";
import { requireDocEdit } from "@/capabilities/docs/access";
import { deleteDocPage } from "@/capabilities/docs/actions";
import { DocEditor } from "@/capabilities/docs/doc-editor";
import { versionOf } from "@/lib/concurrency";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("docs.edit") };
}

export default async function EditDocPage({ params }: { params: Promise<{ area: string; slug: string }> }) {
  const { area: areaParam, slug } = await params;
  const { area } = await requireDocEdit(areaParam);
  const [{ t }, page, categories] = await Promise.all([
    getI18n(),
    db.docPage.findUnique({ where: { area_slug: { area, slug } } }),
    db.docCategory.findMany({ where: { area }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
  ]);
  if (!page) notFound();

  return (
    <>
      <PageHeader title={t("docs.edit")} description={page.title} />
      <div className="flex flex-col gap-4">
        <DocEditor
          key={page.id}
          area={area}
          categories={categories}
          cancelHref={`/docs/${area}/${page.slug}`}
          initial={{ id: page.id, version: versionOf(page), title: page.title, categoryId: page.categoryId ?? "", content: page.content, pinned: page.pinned }}
        />
        <form action={deleteDocPage} className="border-t border-line pt-4">
          <input type="hidden" name="area" value={area} />
          <input type="hidden" name="id" value={page.id} />
          <ConfirmSubmitButton message={t("docs.confirmDelete", { title: page.title })}>{t("docs.delete")}</ConfirmSubmitButton>
        </form>
      </div>
    </>
  );
}

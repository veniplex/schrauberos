import type { Metadata } from "next";
import { getI18n } from "@/i18n/server";
import { requirePermission } from "@/server/auth/session";
import { HandbookView } from "@/modules/admin/handbook/view";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("handbook.title") };
}

export default async function HandbookChapterPage({ params }: { params: Promise<{ slug: string }> }) {
  await requirePermission("handbook.view");
  const { slug } = await params;
  return <HandbookView slug={slug} />;
}

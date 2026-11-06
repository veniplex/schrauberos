import type { Metadata } from "next";
import { getI18n } from "@/i18n/server";
import { helpFor } from "@/modules/help";
import { requireSession } from "@/server/auth/session";
import { HelpView } from "@/platform/help/view";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("help.title") };
}

export default async function HelpTopicPage({ params }: { params: Promise<{ slug: string }> }) {
  const session = await requireSession();
  const { slug } = await params;
  return <HelpView groups={helpFor(session)} topicId={slug} />;
}

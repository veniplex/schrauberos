import type { Metadata } from "next";
import { getI18n } from "@/i18n/server";
import { requireSession } from "@/server/auth/session";
import { HelpView } from "@/platform/help/view";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("help.title") };
}

/** Hilfe: für alle angemeldeten Benutzer (Plattform, kein Recht nötig). */
export default async function HelpPage() {
  await requireSession();
  return <HelpView />;
}

import type { Metadata } from "next";
import { getI18n } from "@/i18n/server";
import { helpFor } from "@/modules/help";
import { requireSession } from "@/server/auth/session";
import { HelpView } from "@/platform/help/view";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("help.title") };
}

/** Hilfe: für alle angemeldeten Benutzer (Plattform, kein Recht nötig); die Kapitel der Funktionen nur bei aktiver Funktion und Recht. */
export default async function HelpPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const session = await requireSession();
  const { q } = await searchParams;
  return <HelpView groups={helpFor(session)} query={q} />;
}

import { notFound } from "next/navigation";
import { ReinstallNotice } from "@/app/reinstall-notice";
import { e2eMode } from "@/server/e2e-mode";

/**
 * Nur für die Browser-CI (siehe `e2e-mode.ts`): Zustände **ohne** Anwendungsrahmen. `error` wirft (Fehlergrenze der Wurzel, Vollbild),
 * `reinstall` zeigt den Hinweis „Neuinstallation nötig“ so, wie ihn das Root-Layout bei fremder Datenbank anstelle der Anwendung zeigt.
 * Außerhalb des Testmodus: 404.
 */
export default async function E2eFaultPage({ params }: { params: Promise<{ state: string }> }) {
  const { state } = await params;
  if (!e2eMode()) notFound();
  if (state === "error") throw new Error("E2E: absichtlicher Fehler ohne Anwendungsrahmen");
  if (state === "reinstall") return <ReinstallNotice />;
  notFound();
}

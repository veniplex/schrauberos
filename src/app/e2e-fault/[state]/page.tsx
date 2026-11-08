import { notFound } from "next/navigation";
import { ReinstallNotice } from "@/app/reinstall-notice";
import { allowLoopbackForTests } from "@/lib/offsite/host-policy";
import { e2eMode } from "@/server/e2e-mode";

/**
 * Nur für die Browser-CI (siehe `e2e-mode.ts`): Zustände **ohne** Anwendungsrahmen. `error` wirft (Fehlergrenze der Wurzel, Vollbild),
 * `reinstall` zeigt den Hinweis „Neuinstallation nötig“ so, wie ihn das Root-Layout bei fremder Datenbank anstelle der Anwendung zeigt.
 * `loopback` erlaubt der Zielsperre (E-Mail-Versand, Webhooks, Überwachung) den eigenen Rechner – die Browser-CI stellt kleine Empfänger auf 127.0.0.1 auf und kann sonst nichts erreichen
 * (nur mit `NODE_TEST_CONTEXT`, das start-server.mjs für den Testserver setzt; im Betrieb wirft `allowLoopbackForTests`). Außerhalb des Testmodus: 404.
 */
export default async function E2eFaultPage({ params }: { params: Promise<{ state: string }> }) {
  const { state } = await params;
  if (!e2eMode()) notFound();
  if (state === "error") throw new Error("E2E: absichtlicher Fehler ohne Anwendungsrahmen");
  if (state === "reinstall") return <ReinstallNotice />;
  if (state === "loopback") {
    allowLoopbackForTests();
    return <p data-e2e="loopback">Loopback-Ziele sind erlaubt.</p>;
  }
  notFound();
}

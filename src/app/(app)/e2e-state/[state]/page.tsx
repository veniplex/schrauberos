import { notFound } from "next/navigation";
import { e2eMode } from "@/server/e2e-mode";

/**
 * Nur für die Browser-CI (siehe `e2e-mode.ts`): erzeugt absichtlich einen Fehler **im Anwendungsrahmen**, damit getestet werden kann, dass die Fehlerseite
 * (`data-status="error"`) erkannt und auf Barrierefreiheit, Überbreite und Touch-Ziele geprüft wird. Außerhalb des Testmodus: 404.
 */
export default async function E2eStatePage({ params }: { params: Promise<{ state: string }> }) {
  const { state } = await params;
  if (!e2eMode() || state !== "error") notFound();
  throw new Error("E2E: absichtlicher Fehler im Anwendungsrahmen");
}

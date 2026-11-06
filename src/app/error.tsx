"use client";

import { ErrorView } from "@/components/shell/error-view";

// Fehlergrenze für Seiten außerhalb des Anwendungsrahmens (Anmeldung, Einrichtung) und für Fehler im Anwendungsrahmen selbst.
export default function RootError({ error, retry }: { error: unknown; retry: () => void }) {
  return <ErrorView error={error} retry={retry} fullscreen />;
}

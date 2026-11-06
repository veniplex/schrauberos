"use client";

import { ErrorView } from "@/components/shell/error-view";

// Fehlergrenze im Anwendungsrahmen: die Navigation bleibt, nur der Inhalt wird ersetzt.
export default function AppError({ error, retry }: { error: unknown; retry: () => void }) {
  return <ErrorView error={error} retry={retry} />;
}

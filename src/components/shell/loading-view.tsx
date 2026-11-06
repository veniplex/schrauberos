"use client";

import { Skeleton } from "@/components/ui/layout";

/**
 * Ladeseite (`loading.tsx`) im Anwendungsrahmen: Gerüst aus Kopfzeile und Karten. Angesagt wird das Laden nicht hier, sondern von der dauerhaften
 * Live-Region in `NavProgress` (eine Region, die erst mit der Ladeseite entsteht, bliebe für Screenreader stumm).
 */
export function LoadingView() {
  return (
    <div aria-busy="true">
      <Skeleton className="mb-6 h-8 w-64 max-w-full" />
      <div className="grid gap-5 lg:grid-cols-2">
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
        <Skeleton className="h-48 lg:col-span-2" />
      </div>
    </div>
  );
}

/** Ladeseite für Seiten ohne Anwendungsrahmen (Anmeldung, Einrichtung, „Kein Zugriff“): eine einzelne Karte statt des Übersichts-Gerüsts. */
export function FullscreenLoadingView() {
  return (
    <main aria-busy="true" className="grid min-h-dvh place-items-center px-4">
      <Skeleton className="h-72 w-full max-w-sm" />
    </main>
  );
}

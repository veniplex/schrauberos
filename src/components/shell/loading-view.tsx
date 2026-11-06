"use client";

import { Skeleton } from "@/components/ui/layout";
import { useI18n } from "@/i18n/client";

/** Ladeseite (`loading.tsx`): Gerüst aus Kopfzeile und Karten, dazu die Ansage „Wird geladen“ für Screenreader. */
export function LoadingView() {
  const { t } = useI18n();
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">{t("errors.loading")}</span>
      <Skeleton className="mb-6 h-8 w-64 max-w-full" />
      <div className="grid gap-5 lg:grid-cols-2">
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
        <Skeleton className="h-48 lg:col-span-2" />
      </div>
    </div>
  );
}

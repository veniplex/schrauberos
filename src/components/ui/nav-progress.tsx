"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useI18n } from "@/i18n/client";

/**
 * Dünner Fortschrittsbalken am oberen Rand, solange eine Navigation läuft. Die Links (`LinkPending`, über `useLinkStatus`) melden ihren
 * Wartezustand; der Balken erscheint erst nach einer kurzen Verzögerung (CSS), damit schnelle Seitenwechsel nicht flackern.
 * Dazu eine **dauerhaft vorhandene** Live-Region (`role="status"`) für Screenreader: Sie steht schon im DOM, bevor sich ihr Text ändert – nur dann
 * wird die Änderung angesagt (eine erst beim Laden eingefügte Region bliebe stumm).
 */
let pendingCount = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

/** Meldet, solange `pending` wahr ist, eine laufende Navigation. */
export function useReportNavigationPending(pending: boolean) {
  useEffect(() => {
    if (!pending) return;
    pendingCount++;
    emit();
    return () => {
      pendingCount--;
      emit();
    };
  }, [pending]);
}

export function NavProgress() {
  const { t } = useI18n();
  const active = useSyncExternalStore(subscribe, () => pendingCount > 0, () => false);
  return (
    <>
      {active ? <div role="presentation" aria-hidden className="nav-progress no-print" /> : null}
      <div role="status" aria-live="polite" className="sr-only no-print">
        {active ? t("errors.loading") : ""}
      </div>
    </>
  );
}

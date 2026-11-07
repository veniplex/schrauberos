"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/buttons";
import type { FormAction } from "@/components/ui/form-frame";
import { useInlineAction } from "@/components/ui/inline-action";
import type { FormState } from "@/components/ui/form-context";
import { useI18n } from "@/i18n/client";
import { setAppointmentStatus } from "./actions";
import { quickStatusOptions } from "./domain";

type QuickState = FormState & { status?: string };

/**
 * Schnellstatus eines Termins: „Starten“ (In Arbeit) und „Fertig“ direkt auf Karte, Liste und Übersicht – zwei Knöpfe je nach Status, ohne das Bearbeiten zu öffnen.
 * Jeder Knopf sendet `id`, `version` (Konfliktprüfung) und den Zielstatus an `setAppointmentStatus`; Erfolg und Fehler (auch „inzwischen geändert“) kommen als Toast.
 *
 * `prompt` ist ein vorbereiteter Vorschlag der Seite (z. B. „Reifensatz ausbuchen?“ von der Reifenfunktion), den die Karte **erst nach „Fertig“** zeigt – die Funktion
 * Termine kennt die Reifen nicht, die Seite setzt beides zusammen. Ohne mögliche Schritte und ohne Vorschlag zeigt die Karte nichts.
 */
export function QuickStatus({ id, version, status, title, prompt }: { id: string; version: string; status: string; title: string; prompt?: ReactNode }) {
  const { t } = useI18n();
  const [state, dispatch, pending] = useInlineAction<QuickState>(setAppointmentStatus as unknown as FormAction<QuickState>);
  const options = quickStatusOptions(status);

  return (
    <>
      {options.length > 0 ? (
        <form action={dispatch} role="group" aria-label={t("appointments.quickStatus.group")} className="inline-flex flex-wrap items-center gap-1.5">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="version" value={version} />
          {options.map((next) => (
            <Button
              key={next}
              type="submit"
              name="status"
              value={next}
              size="sm"
              variant={next === "done" ? "secondary" : "primary"}
              disabled={pending}
              aria-label={t(next === "done" ? "appointments.quickStatus.finishFor" : "appointments.quickStatus.startFor", { title })}
            >
              {t(next === "done" ? "appointments.quickStatus.finish" : "appointments.quickStatus.start")}
            </Button>
          ))}
        </form>
      ) : null}
      {state.ok && state.status === "done" ? prompt : null}
    </>
  );
}

"use client";

import { useEffect, useState } from "react";
import { Alert } from "@/components/ui/layout";
import { useI18n } from "@/i18n/client";
import type { AbsenceHints } from "./absence-overlap";

/**
 * Ruhige Hinweisliste im Formular „Abwesenheit eintragen“ (P2b-2): Ist für die Person im geplanten Zeitraum schon etwas eingetragen, steht es hier – nur als Hinweis, das Speichern bleibt möglich;
 * allein die exakte Dublette lehnt der Server ab (dann zeigt die Liste es vorab als Warnung). Die Hinweise holt `GET /api/employees/absence-hints` (kurz nach der letzten Änderung);
 * Krankheit bleibt ohne `employees.sensitive` maskiert: Der Server liefert dann nur den Zeitraum, die Liste nennt „abwesend“. Fehlt die Antwort (offline), fehlt nur der Hinweis.
 * Gilt auch für die Vorbelegung aus dem Abwesenheitsraster (Zelle anklicken): die Abfrage läuft schon beim Öffnen.
 */
export function AbsenceHintList({ employeeId, type, start, end }: { employeeId: string; type: string; start: string; end: string }) {
  const { t, td, date } = useI18n();
  const key = employeeId && start && end && end >= start ? [employeeId, type, start, end].join("|") : "";
  const [result, setResult] = useState<{ key: string; hints: AbsenceHints } | null>(null);

  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/employees/absence-hints?${new URLSearchParams({ employeeId, type, start, end })}`, { signal: controller.signal })
        .then((response) => (response.ok ? (response.json() as Promise<AbsenceHints>) : null))
        .then((hints) => {
          if (hints) setResult({ key, hints });
        })
        .catch(() => {});
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key, employeeId, type, start, end]);

  const hints = result?.key === key ? result.hints : null;
  const day = (value: string) => date(`${value}T12:00:00Z`, { dateStyle: "medium", timeZone: "UTC" });
  return (
    <div aria-live="polite">
      {hints && hints.overlaps.length > 0 ? (
        <Alert tone={hints.duplicate ? "warning" : "info"} live={false} data-testid="absence-hints">
          <p className="font-medium">{hints.duplicate ? t("employees.overlap.duplicate") : t("employees.overlap.title")}</p>
          <ul className="mt-1 list-disc pl-5">
            {hints.overlaps.map((o, i) => {
              const label = o.type === "masked" ? t("employees.overlap.masked") : td(`employees.absenceTypes.${o.type}`, o.type);
              return <li key={i}>{o.start === o.end ? t("employees.overlap.itemSingle", { from: day(o.start), type: label }) : t("employees.overlap.item", { from: day(o.start), to: day(o.end), type: label })}</li>;
            })}
          </ul>
          {hints.duplicate ? null : <p className="mt-1 text-xs opacity-80">{t("employees.overlap.hint")}</p>}
        </Alert>
      ) : null}
    </div>
  );
}

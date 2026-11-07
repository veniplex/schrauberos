"use client";

import { useEffect, useState } from "react";
import { Alert } from "@/components/ui/layout";
import { useI18n } from "@/i18n/client";
import type { AppointmentHint } from "./hints";

/**
 * Ruhige Hinweisliste im Terminformular (P4b-1): Feiertag, Öffnungszeiten, Termin über Mitternacht, Abwesenheit und weitere Termine der zuständigen Person, Fahrzeug mit Termin am selben Tag.
 * Nur Hinweise – keine eigene Bestätigung, das Speichern bleibt möglich (hart bleibt allein die Doppelbelegung des Arbeitsplatzes, die der Server beim Speichern meldet). Die Hinweise holt
 * `GET /api/appointments/hints` kurz nach der letzten Änderung; fehlt die Antwort (offline), fehlt nur der Hinweis. Abwesenheit steht als „abwesend“, nie mit der Art.
 */
export function AppointmentHintList({
  id,
  date,
  time,
  duration,
  assigneeId,
  vehicleId,
}: {
  id?: string;
  date: string;
  time: string;
  duration: number;
  assigneeId: string;
  vehicleId: string;
}) {
  const { t, td, date: formatDate } = useI18n();
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{2}:\d{2}$/.test(time) && Number.isInteger(duration) && duration >= 5 && duration <= 720;
  const key = valid ? [id ?? "", date, time, duration, assigneeId, vehicleId].join("|") : "";
  const [result, setResult] = useState<{ key: string; hints: AppointmentHint[] } | null>(null);

  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ date, time, duration: String(duration) });
      if (assigneeId) params.set("assigneeId", assigneeId);
      if (vehicleId) params.set("vehicleId", vehicleId);
      if (id) params.set("id", id);
      fetch(`/api/appointments/hints?${params}`, { signal: controller.signal })
        .then((response) => (response.ok ? (response.json() as Promise<{ hints: AppointmentHint[] }>) : null))
        .then((body) => {
          if (body) setResult({ key, hints: body.hints });
        })
        .catch(() => {});
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key, id, date, time, duration, assigneeId, vehicleId]);

  const hints = result?.key === key ? result.hints : [];
  const day = (value: string) => formatDate(`${value}T12:00:00Z`, { weekday: "short", day: "numeric", month: "long", timeZone: "UTC" });

  function text(hint: AppointmentHint): string {
    switch (hint.kind) {
      case "holiday": {
        const name = hint.key ? td(`holidays.names.${hint.key}`, hint.key) : (hint.name ?? "");
        return t(hint.half ? "appointments.hints.halfHoliday" : "appointments.hints.holiday", { day: day(hint.day), name });
      }
      case "closed":
        return t("appointments.hints.closed", { day: day(hint.day) });
      case "outsideHours":
        return t("appointments.hints.outsideHours", { day: day(hint.day), from: hint.from, to: hint.to });
      case "crossesMidnight":
        return t("appointments.hints.crossesMidnight", { endDay: day(hint.endDay), endTime: hint.endTime });
      case "assigneeAbsent":
        return t("appointments.hints.assigneeAbsent", { name: hint.name });
      case "assigneeBusy":
        return t("appointments.hints.assigneeBusy", { name: hint.name, title: hint.title, from: hint.from, to: hint.to });
      case "vehicleBooked":
        return t("appointments.hints.vehicleBooked", { plate: hint.plate, title: hint.title, day: day(hint.day), from: hint.from, to: hint.to });
    }
  }

  return (
    <div aria-live="polite">
      {hints.length > 0 ? (
        <Alert tone="info" live={false} data-testid="appointment-hints">
          <p className="font-medium">{t("appointments.hints.title")}</p>
          <ul className="mt-1 list-disc pl-5">
            {hints.map((hint, i) => (
              <li key={i}>{text(hint)}</li>
            ))}
          </ul>
          <p className="mt-1 text-xs opacity-80">{t("appointments.hints.note")}</p>
        </Alert>
      ) : null}
    </div>
  );
}

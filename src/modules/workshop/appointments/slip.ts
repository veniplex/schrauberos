import type { Translator } from "@/i18n/translate";
import type { CardModel } from "@/lib/print-card";
import { isSameDay } from "@/lib/zone";
import { formatTireSize } from "@/modules/workshop/tires/public";
import type { AppointmentSlipData } from "./queries";

/**
 * Das Modell des **Terminzettels** (F8): Datum und Uhrzeit (Zeitzone der Werkstatt), Anliegen, Terminart, Fahrzeug, Kunde (Anzeigename; Telefon nur, wenn die Abfrage es geliefert hat), Reifensatz, auf Wunsch
 * die Notizen („Hinweise“) und Schreiblinien. Kein Arbeitsplatz, kein Zuständiger, kein QR-Code: Der Zettel geht an den Kunden, die Anwendung öffnet er nicht. PDF und Druckansicht zeichnen dasselbe Modell.
 */
export type SlipWorkshop = { name: string; street: string | null; zip: string | null; city: string | null; phone: string | null };

const join = (parts: Array<string | null | undefined>, separator: string) => parts.filter((p): p is string => !!p && p.trim() !== "").join(separator);

export function appointmentSlipModel(data: AppointmentSlipData, context: { i18n: Pick<Translator, "t" | "td" | "date">; workshop: SlipWorkshop; withNotes: boolean }): CardModel {
  const { t, td, date } = context.i18n;
  const day = date(data.startsAt, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const from = date(data.startsAt, { timeStyle: "short" });
  const to = isSameDay(data.startsAt, data.endsAt) ? date(data.endsAt, { timeStyle: "short" }) : date(data.endsAt, { dateStyle: "medium", timeStyle: "short" });
  const facts: Array<readonly [string, string]> = [
    [t("appointments.slip.date"), day],
    [t("appointments.slip.time"), t("appointments.slip.timeRange", { from, to })],
    [t("appointments.slip.concern"), data.title],
  ];
  if (data.typeName) facts.push([t("appointments.slip.kind"), data.typeName]);
  if (data.plate) facts.push([t("appointments.slip.vehicle"), join([data.plate, data.vehicleName], " · ")]);
  if (data.customerName) facts.push([t("appointments.slip.customer"), data.customerName]);
  if (data.phone) facts.push([t("appointments.slip.phone"), data.phone]);
  if (data.tireSet) {
    const size = formatTireSize(data.tireSet);
    facts.push([t("appointments.slip.tires"), join([td(`enums.season.${data.tireSet.season}`, data.tireSet.season), size === "–" ? null : size], " · ")]);
  }
  return {
    documentTitle: t("appointments.slip.documentTitle", { title: data.title }),
    subtitle: join([context.workshop.name, join([context.workshop.street, join([context.workshop.zip, context.workshop.city], " ")], ", "), context.workshop.phone], " · "),
    title: t("appointments.slip.title"),
    facts,
    blocks: context.withNotes && data.notes?.trim() ? [{ heading: t("appointments.slip.notes"), text: data.notes.trim() }] : [],
    notes: { heading: t("appointments.slip.write"), lines: 5 },
    footer: context.workshop.name,
    pageLabel: (page, total) => t("appointments.slip.page", { page, total }),
  };
}

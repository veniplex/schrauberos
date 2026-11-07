import type { Translator } from "@/i18n/translate";
import { versionOf } from "@/lib/concurrency";
import { formatTireSize, suggestedStockStatus, TireStockPrompt } from "@/modules/workshop/tires/public";
import { quickStatusOptions } from "./domain";
import { QuickStatus } from "./quick-status";

/** Was die Terminkarte vom Termin braucht (Zeile aus `appointmentsBetween` oder jede Zeile mit denselben Feldern). */
export type QuickStatusAppointment = {
  id: string;
  title: string;
  status: string;
  updatedAt: Date;
  tireSet?: {
    id: string;
    status: string;
    season: string;
    brand: string | null;
    width: number | null;
    aspect: number | null;
    rim: number | null;
    loadIndex: string | null;
    speedIndex: string | null;
    updatedAt: Date;
    vehicle: { plate: string };
  } | null;
};

/**
 * Schnellstatus mit Vorschlag für Karte, Liste und Übersicht (Server-Teil): zeigt „Starten“/„Fertig“ nur mit dem Recht zum Bearbeiten und baut – nur mit dem Recht zum Ein-/Ausbuchen
 * (`canStock`: schließt die aktive Reifenfunktion ein, die Sitzung kennt kein Recht ausgeschalteter Funktionen) und nur bei einem verknüpften, buchbaren Reifensatz – den
 * Vorschlag „Satz jetzt ein-/ausbuchen?“ der Reifenfunktion, den die Karte nach „Fertig“ zeigt. Ohne Schritt und ohne Vorschlag entsteht nichts.
 */
export function AppointmentQuickStatus({ a, canEdit, canStock, i18n }: { a: QuickStatusAppointment; canEdit: boolean; canStock: boolean; i18n: Translator }) {
  if (!canEdit || quickStatusOptions(a.status).length === 0) return null;
  const set = canStock ? a.tireSet : null;
  const prompt =
    set && suggestedStockStatus(set.status) ? (
      <TireStockPrompt
        id={set.id}
        version={versionOf(set)}
        status={set.status}
        label={[set.vehicle.plate, i18n.td(`enums.season.${set.season}`, set.season), set.brand, formatTireSize(set)].filter((part) => part && part !== "–").join(" · ")}
      />
    ) : undefined;
  return <QuickStatus id={a.id} version={versionOf(a)} status={a.status} title={a.title} prompt={prompt} />;
}

import type { ReactNode } from "react";
import { Button } from "@/components/ui/buttons";
import { DateRange } from "@/components/ui/date-range";
import { Card } from "@/components/ui/layout";
import { getI18n } from "@/i18n/server";

/**
 * Zeitraumwahl eines Berichts: ein GET-Formular mit dem Baustein `DateRange` (Von/Bis, Schnellauswahl aus dem „heute“ der Werkstatt-Zone). Die Auswahl steht in der Adresse (Lesezeichen, „Zurück“ geht);
 * `children` sind weitere Felder des Berichts, `hidden` Parameter, die erhalten bleiben sollen.
 */
export async function PeriodForm({ today, from, to, maxDays, presets, hidden = {}, children }: { today: string; from: string; to: string; maxDays: number; presets?: Array<"today" | "yesterday" | "last7" | "last30" | "thisMonth" | "lastMonth" | "thisYear">; hidden?: Record<string, string>; children?: ReactNode }) {
  const { t } = await getI18n();
  return (
    <Card className="mb-5">
      <form method="get" className="flex flex-col gap-3">
        {Object.entries(hidden).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <DateRange today={today} defaultFrom={from} defaultTo={to} maxDays={maxDays} presets={presets} required />
        {children}
        <div>
          <Button type="submit" variant="secondary">
            {t("reports.period.apply")}
          </Button>
        </div>
      </form>
    </Card>
  );
}

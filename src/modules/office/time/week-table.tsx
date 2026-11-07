import { Badge } from "@/components/ui/layout";
import { Table } from "@/components/ui/layout";
import { getI18n } from "@/i18n/server";
import { noon } from "@/lib/dates";
import { formatDuration, type WeekSummary } from "./domain";

/** Wochenübersicht Ist/Soll/Saldo je Tag; Feiertag, Abwesenheit und freier Tag stehen als Text in der Zeile (nie nur als Farbe). Abwesenheit nennt keinen Grund. */
export async function WeekTable({ week }: { week: WeekSummary }) {
  const { t, td, date } = await getI18n();
  const signed = (minutes: number) => (minutes > 0 ? `+${formatDuration(minutes)}` : formatDuration(minutes));
  return (
    <Table caption={t("time.week.caption")} className="min-w-[28rem]">
      <thead>
        <tr>
          <th scope="col">{t("time.week.day")}</th>
          <th scope="col" className="text-right">
            {t("time.week.worked")}
          </th>
          <th scope="col" className="text-right">
            {t("time.week.target")}
          </th>
          <th scope="col" className="text-right">
            {t("time.week.balance")}
          </th>
        </tr>
      </thead>
      <tbody>
        {week.days.map((day) => (
          <tr key={day.day}>
            <th scope="row" className="font-normal">
              {date(noon(day.day), { weekday: "short", day: "2-digit", month: "2-digit" })}
              {day.holiday ? (
                <Badge tone="info" className="ml-2">
                  {day.holiday.name ?? td(`holidays.names.${day.holiday.key}`, t("time.week.holiday"))}
                  {day.holiday.half ? ` (${t("time.week.half")})` : ""}
                </Badge>
              ) : null}
              {day.absent ? (
                <Badge tone="neutral" className="ml-2">
                  {t("time.week.absent")}
                </Badge>
              ) : null}
              {!day.scheduled && !day.holiday && !day.absent ? <span className="ml-2 text-xs text-ink-muted">{t("time.week.free")}</span> : null}
            </th>
            <td className="tabular text-right">{day.worked > 0 ? formatDuration(day.worked) : "–"}</td>
            <td className="tabular text-right">{day.target > 0 ? formatDuration(day.target) : "–"}</td>
            <td className="tabular text-right">{day.worked > 0 || day.target > 0 ? signed(day.worked - day.target) : "–"}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <th scope="row">{t("time.week.total")}</th>
          <td className="tabular text-right font-semibold">{formatDuration(week.worked)}</td>
          <td className="tabular text-right font-semibold">{formatDuration(week.target)}</td>
          <td className="tabular text-right font-semibold">{signed(week.balance)}</td>
        </tr>
      </tfoot>
    </Table>
  );
}

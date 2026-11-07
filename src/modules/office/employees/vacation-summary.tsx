import { getI18n } from "@/i18n/server";
import type { VacationBalance } from "./vacation";
import { WEEKDAY_DISPLAY_ORDER, isFullWeek, parseWorkWeekdays } from "./work-pattern";

/**
 * Urlaubsstand im Mitarbeiterdetail (P4b-4): Anspruch (im Ein-/Austrittsjahr anteilig), Übertrag aus dem Vorjahr (mit Verfall-Stichtag), genommen, Rest. Die Rechnung steht in
 * `vacation.ts`; hier wird sie nur angezeigt.
 */
export async function VacationSummary({ balance, workWeekdays }: { balance: VacationBalance; workWeekdays: string }) {
  const { t, date, number } = await getI18n();
  const day = (key: string) => date(`${key}T12:00:00Z`, { dateStyle: "medium", timeZone: "UTC" });
  const days = (value: number) => number(value, { maximumFractionDigits: 2 });
  const pattern = parseWorkWeekdays(workWeekdays);
  const rows: Array<{ label: string; value: string; strong?: boolean; muted?: boolean }> = [];

  if (balance.entitlement) {
    rows.push({ label: balance.entitlement.prorated ? t("employees.vacation.entitlementProrated", { months: balance.entitlement.months }) : t("employees.vacation.entitlement"), value: days(balance.entitlement.days) });
  }
  if (balance.carryIn > 0) {
    rows.push({ label: t("employees.vacation.carryIn", { year: balance.year - 1 }), value: days(balance.carryIn) });
    if (balance.carryOpen > 0) rows.push({ label: t("employees.vacation.carryOpen", { date: day(balance.deadline) }), value: days(balance.carryOpen), muted: true });
    if (balance.carryExpired > 0) rows.push({ label: t("employees.vacation.carryExpired", { date: day(balance.deadline) }), value: days(balance.carryExpired), muted: true });
  }
  rows.push({ label: t("employees.vacation.used"), value: days(balance.used) });
  if (balance.entitlement) {
    rows.push({ label: t("employees.vacation.remaining"), value: days(balance.remaining), strong: true });
    rows.push({ label: t("employees.vacation.carryOut"), value: days(balance.carryOut), muted: true });
  }

  return (
    <div className="border-b border-line px-5 py-3 text-sm">
      <p className="font-medium">{t("employees.vacation.title", { year: balance.year })}</p>
      {balance.entitlement ? null : <p className="mt-1 text-ink-muted">{t("employees.vacation.noEntitlement")}</p>}
      <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
        {rows.map((row) => (
          <div key={row.label} className="contents">
            <dt className={row.muted ? "text-ink-muted" : undefined}>{row.label}</dt>
            <dd className={`tabular text-right ${row.strong ? "font-semibold" : ""} ${row.muted ? "text-ink-muted" : ""}`}>{row.value}</dd>
          </div>
        ))}
      </dl>
      {isFullWeek(pattern) ? null : (
        <p className="mt-2 text-xs text-ink-muted">{t("employees.vacation.workDays", { days: WEEKDAY_DISPLAY_ORDER.filter((d) => pattern.has(d)).map((d) => t(`employees.weekdaysShort.${d}`)).join(", ") })}</p>
      )}
      <p className="mt-2 text-xs text-ink-muted">{t("employees.vacation.note")}</p>
    </div>
  );
}

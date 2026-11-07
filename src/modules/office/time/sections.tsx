import { Clock } from "lucide-react";
import { ConfirmSubmitButton } from "@/components/ui/confirm-dialog";
import { Field, Select } from "@/components/ui/form";
import { Alert, Card, StatusBadge, TextLink } from "@/components/ui/layout";
import { getI18n } from "@/i18n/server";
import type { SectionDef, SectionProps } from "@/modules/types";
import { orderRef } from "@/modules/workshop/orders/public";
import { getWorkshop } from "@/server/workshop";
import { transferTime } from "./actions";
import { entryMinutes, formatDuration } from "./domain";
import { orderTimes } from "./queries";

/**
 * Beitrag zur Auftragsseite: „Zeiten“ – die Summe der gestempelten Zeiten auf dem Auftrag (alle Mitarbeiter, nur Zahlen), die eigenen Einzelzeiten (mit `time.viewAll` alle) und – mit `orders.edit`
 * und `orders.prices` an einem offenen Auftrag – „Zeiten als Positionen übernehmen“ (einmalig je Eintrag). Der Auftrag kennt diesen Abschnitt nicht; er hängt sich über den Erweiterungspunkt
 * `orders/detail` ein.
 */
async function OrderTimesSection({ entityId, session }: SectionProps) {
  const [{ t, date, number }, times, ref, workshop] = await Promise.all([getI18n(), orderTimes(session, entityId), orderRef(entityId), getWorkshop()]);
  if (!ref) return null;
  const now = new Date();
  const aw = (minutes: number) => t("time.aw", { aw: number(minutes / Math.max(1, workshop.workUnitMinutes), { maximumFractionDigits: 1 }) });
  const canTransfer = session.can("orders.edit") && session.can("orders.prices") && ref.open && times.openMinutes > 0 && workshop.hourlyRateCents != null;

  return (
    <Card title={t("time.section.title")}>
      <p className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
        <span>
          <span className="tabular text-lg font-semibold">{formatDuration(times.totalMinutes)}</span> <span className="text-ink-muted">{aw(times.totalMinutes)}</span>
        </span>
        {times.openMinutes !== times.totalMinutes ? <span className="text-ink-muted">{t("time.section.open", { duration: formatDuration(times.openMinutes) })}</span> : null}
        {times.running > 0 ? <StatusBadge tone="info">{t("time.section.running", { count: times.running })}</StatusBadge> : null}
      </p>

      {times.entries.length === 0 ? (
        <p className="mt-3 text-sm text-ink-muted">{times.totalMinutes > 0 ? t("time.section.noneVisible") : t("time.section.empty")}</p>
      ) : (
        <ul className="mt-3 flex flex-col divide-y divide-line text-sm">
          {times.entries.map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2 first:pt-0 last:pb-0">
              <div className="min-w-0">
                <TextLink href={`/time/entries/${entry.id}`} className="tabular">
                  {date(entry.startedAt, { dateStyle: "medium", timeStyle: "short" })}
                </TextLink>
                <p className="truncate text-xs text-ink-muted">{[entry.employeeName, entry.activity].filter(Boolean).join(" · ") || t("time.general")}</p>
              </div>
              <span className="flex items-center gap-2">
                {entry.transferred ? <StatusBadge tone="success">{t("time.flags.transferred")}</StatusBadge> : null}
                <span className="tabular">{formatDuration(entryMinutes(entry, now))}</span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {canTransfer ? (
        <form action={transferTime} className="mt-4 flex flex-wrap items-end gap-3 border-t border-line pt-4">
          <input type="hidden" name="orderId" value={entityId} />
          <input type="hidden" name="label" value={t("time.transfer.label")} />
          <Field label={t("time.transfer.unit")} htmlFor={`transfer-unit-${entityId}`} className="min-w-48">
            <Select id={`transfer-unit-${entityId}`} name="unit" defaultValue="h">
              <option value="h">{t("time.transfer.hours")}</option>
              <option value="aw">{t("time.transfer.aw", { minutes: workshop.workUnitMinutes })}</option>
            </Select>
          </Field>
          <ConfirmSubmitButton message={t("time.transfer.confirm", { duration: formatDuration(times.openMinutes) })} variant="secondary" size="md" confirmLabel={t("time.transfer.action")}>
            <Clock className="size-4" aria-hidden /> {t("time.transfer.action")}
          </ConfirmSubmitButton>
        </form>
      ) : session.can("orders.edit") && session.can("orders.prices") && ref.open && times.openMinutes > 0 ? (
        <p className="mt-3 text-sm text-ink-muted">{t("time.transfer.noRate")}</p>
      ) : null}
    </Card>
  );
}

/**
 * Beitrag zum Statusbereich der Auftragsseite (Erweiterungspunkt `orders/close`): ein ruhiger Hinweis vor dem Abschließen, wenn noch Zeiten laufen oder nicht als Positionen übernommen sind (nur Zahlen, keine Namen).
 * **Keine Sperre:** Der Abschluss bleibt möglich; nach dem Abschluss lassen sich Zeiten nur über „Wieder öffnen“ übernehmen.
 */
async function CloseHintSection({ entityId, session }: SectionProps) {
  const [{ t, tp }, times] = await Promise.all([getI18n(), orderTimes(session, entityId)]);
  if (times.running === 0 && times.openMinutes === 0) return null;
  return (
    <Alert tone="warning">
      {times.running > 0 ? <>{tp("time.section.closeHintRunning", times.running)} </> : null}
      {times.openMinutes > 0 ? <>{t("time.section.closeHintOpen", { duration: formatDuration(times.openMinutes) })} </> : null}
      {t("time.section.closeHintAfter")}
    </Alert>
  );
}

export const sections: SectionDef[] = [
  { id: "time-order", feature: "office.time", host: "orders/detail", permission: "time.view", order: 30, uses: ["workshop.orders"], Component: OrderTimesSection },
  { id: "time-order-close", feature: "office.time", host: "orders/close", permission: "time.view", order: 30, uses: ["workshop.orders"], Component: CloseHintSection },
];

import { RotateCw } from "lucide-react";
import { DataTable } from "@/components/ui/data-table";
import { ConfirmSubmitButton } from "@/components/ui/confirm-dialog";
import { EmptyState, StatusBadge } from "@/components/ui/layout";
import { getI18n } from "@/i18n/server";
import type { DeliveryStatus } from "@/lib/webhooks/schedule";
import { redeliver } from "./actions";
import type { DeliveryRow } from "./queries";
import { DELIVERY_STATUS_TONE } from "./status-tone";

/**
 * Zustellprotokoll (Server Component): Zeit, Ziel, Ereignis, Zustand, Versuche, Statuscode oder Fehlercode, Dauer – **ohne Nutzlast und ohne Antworttext**. „Erneut zustellen“ nimmt eine abgeschlossene oder
 * aufgegebene Zustellung wieder auf (gleiche Ereignis-ID, der Empfänger erkennt Doppeltes); Test-Ereignisse nicht.
 */
export async function DeliveryTable({ rows, showWebhook }: { rows: DeliveryRow[]; showWebhook: boolean }) {
  const { t, td, date } = await getI18n();
  const when = (d: Date) => date(d, { dateStyle: "short", timeStyle: "medium" });
  return (
    <DataTable
      caption={t("api.webhooks.log.title")}
      rows={rows}
      rowKey={(r) => r.id}
      minWidth="52rem"
      empty={<EmptyState title={t("api.webhooks.log.empty")} />}
      columns={[
        { id: "time", header: t("api.webhooks.log.time"), priority: "primary", cell: (r) => <span className="tabular whitespace-nowrap">{when(r.createdAt)}</span> },
        ...(showWebhook ? [{ id: "target", header: t("api.webhooks.log.target"), cell: (r: DeliveryRow) => r.webhookName }] : []),
        { id: "type", header: t("api.webhooks.log.event"), cell: (r) => <code className="text-xs">{r.type}</code> },
        { id: "status", header: t("api.webhooks.log.status"), cell: (r) => <StatusBadge tone={DELIVERY_STATUS_TONE[r.status as DeliveryStatus] ?? "neutral"}>{td(`api.webhooks.status.${r.status}`, r.status)}</StatusBadge> },
        { id: "attempts", header: t("api.webhooks.log.attempts"), cell: (r) => <span className="tabular text-ink-muted">{r.attempts}</span> },
        {
          id: "result",
          header: t("api.webhooks.log.result"),
          cell: (r) => (
            <span className="text-sm text-ink-muted">
              {r.lastStatus ? `HTTP ${r.lastStatus}` : r.lastError ? td(`api.webhooks.errorCodes.${r.lastError}`, r.lastError) : "–"}
              {r.lastDurationMs ? ` · ${r.lastDurationMs} ms` : ""}
              {r.status === "pending" && r.attempts > 0 ? ` · ${t("api.webhooks.log.next", { time: when(r.nextAttemptAt) })}` : ""}
            </span>
          ),
        },
        { id: "event", header: t("api.webhooks.log.eventId"), priority: "low", cell: (r) => <code className="break-all text-[11px] text-ink-muted">{r.eventId}</code> },
        {
          id: "actions",
          header: t("common.actions"),
          hideHeader: true,
          align: "end",
          cell: (r) =>
            r.type !== "webhook.test" && r.status !== "pending" && r.status !== "held" && r.status !== "suppressed" ? (
              <form action={redeliver}>
                <input type="hidden" name="id" value={r.id} />
                <ConfirmSubmitButton variant="secondary" message={t("api.webhooks.log.redeliverConfirm")} label={t("api.webhooks.log.redeliver")} target={r.type}>
                  <RotateCw className="size-3.5" aria-hidden />
                </ConfirmSubmitButton>
              </form>
            ) : null,
        },
      ]}
    />
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Field, Input, Select } from "@/components/ui/form";
import { StampButton } from "@/components/ui/stamp-button";
import { useI18n } from "@/i18n/client";
import { startTime, stopTime } from "./actions";

export type StampOrder = { id: string; label: string };

/** Ruft eine Stempel-Aktion auf; ein Fehler (auch eine Fehlerantwort des Servers) wirft, damit der Knopf „Nicht gebucht“ zeigt und den Schlüssel für die Wiederholung behält. */
async function book(action: typeof startTime | typeof stopTime, values: Record<string, string>): Promise<void> {
  const data = new FormData();
  for (const [name, value] of Object.entries(values)) if (value !== "") data.set(name, value);
  const state = await action({}, data);
  if (!state?.ok) throw new Error(state?.error ?? "failed");
}

/**
 * Stempel-Bereich: ein großer Knopf („Kommen“/„Auftrag starten“ bzw. „Gehen“/„Beenden“) gegen Doppeltippen und mit Schlüssel für die Wiederholung (`StampButton`, `actionId` bindet den
 * Schlüssel an die Aktion: nach dem Wechsel von „Starten“ zu „Beenden“ ist es ein neuer). Beim Starten lässt sich ein offener Auftrag und eine Tätigkeit wählen, beim Beenden eine Pause eintragen.
 * Der Server entscheidet (Rechte, „läuft schon“, Schlüssel): die Oberfläche glaubt sich nichts.
 */
export function StampPanel({ running, orders, since }: { running: { id: string; orderLabel: string | null } | null; orders: StampOrder[]; since: string | null }) {
  const { t } = useI18n();
  const router = useRouter();
  const [orderId, setOrderId] = useState("");
  const [activity, setActivity] = useState("");
  const [pause, setPause] = useState("0");

  if (running) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm">
          {running.orderLabel ? t("time.stamp.runningOrder", { order: running.orderLabel, since: since ?? "" }) : t("time.stamp.running", { since: since ?? "" })}
        </p>
        <Field label={t("time.fields.break")} hint={t("time.fields.breakHint")} htmlFor="stamp-break" className="max-w-xs">
          <Input id="stamp-break" type="number" inputMode="numeric" min={0} max={600} value={pause} onChange={(event) => setPause(event.target.value)} />
        </Field>
        <StampButton
          actionId={`stop:${running.id}`}
          tone="neutral"
          onStamp={async (key) => {
            await book(stopTime, { key, breakMinutes: pause });
            setPause("0");
            router.refresh();
          }}
        >
          {running.orderLabel ? t("time.stamp.stopOrder") : t("time.stamp.stop")}
        </StampButton>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {orders.length > 0 ? (
        <Field label={t("time.fields.order")} htmlFor="stamp-order" hint={t("time.stamp.orderHint")}>
          <Select id="stamp-order" value={orderId} onChange={(event) => setOrderId(event.target.value)}>
            <option value="">{t("time.stamp.noOrder")}</option>
            {orders.map((order) => (
              <option key={order.id} value={order.id}>
                {order.label}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      <Field label={t("time.fields.activity")} htmlFor="stamp-activity">
        <Input id="stamp-activity" maxLength={120} value={activity} onChange={(event) => setActivity(event.target.value)} autoComplete="off" />
      </Field>
      <StampButton
        actionId={`start:${orderId || "general"}`}
        onStamp={async (key) => {
          await book(startTime, { key, orderId, activity });
          setActivity("");
          router.refresh();
        }}
      >
        {orderId ? t("time.stamp.startOrder") : t("time.stamp.start")}
      </StampButton>
    </div>
  );
}

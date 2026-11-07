"use client";

import { Field, Form, FormActions, Input, Select, Textarea } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/buttons";
import { Card } from "@/components/ui/layout";
import { useI18n } from "@/i18n/client";
import { addManualTime, correctTime, voidTime } from "./actions";

export type EntryFormValues = {
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  breakMinutes: string;
  orderId: string;
  activity: string;
  note: string;
};

type OrderOption = { id: string; label: string };

/** Beginn, Ende, Pause, Auftrag, Tätigkeit, Notiz und die Pflicht-Begründung: gemeinsam für Korrektur und Nachtrag. */
function EntryFields({ initial, orders, running }: { initial: EntryFormValues; orders: OrderOption[]; running?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Field label={t("time.fields.startDate")} htmlFor="startDate" name="startDate" required>
        <Input id="startDate" name="startDate" type="date" defaultValue={initial.startDate} />
      </Field>
      <Field label={t("time.fields.startTime")} htmlFor="startTime" name="startTime" required>
        <Input id="startTime" name="startTime" type="time" defaultValue={initial.startTime} />
      </Field>
      <Field label={t("time.fields.endDate")} htmlFor="endDate" name="endDate" required={!running} hint={running ? t("time.fields.endRunningHint") : undefined}>
        <Input id="endDate" name="endDate" type="date" defaultValue={initial.endDate} />
      </Field>
      <Field label={t("time.fields.endTime")} htmlFor="endTime" name="endTime" required={!running}>
        <Input id="endTime" name="endTime" type="time" defaultValue={initial.endTime} />
      </Field>
      <Field label={t("time.fields.break")} htmlFor="breakMinutes" name="breakMinutes" hint={t("time.fields.breakHint")}>
        <Input id="breakMinutes" name="breakMinutes" type="number" inputMode="numeric" min={0} max={600} defaultValue={initial.breakMinutes} />
      </Field>
      {orders.length === 0 && initial.orderId ? (
        // Auswahl nicht angeboten (Aufträge aus oder kein Recht zum Ansehen): der Auftrag bleibt unverändert, statt still gelöst zu werden
        <input type="hidden" name="orderId" value={initial.orderId} />
      ) : null}
      {orders.length > 0 ? (
        <Field label={t("time.fields.order")} htmlFor="orderId" name="orderId">
          <Select id="orderId" name="orderId" defaultValue={initial.orderId}>
            <option value="">{t("time.stamp.noOrder")}</option>
            {orders.map((order) => (
              <option key={order.id} value={order.id}>
                {order.label}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      <Field label={t("time.fields.activity")} htmlFor="activity" name="activity">
        <Input id="activity" name="activity" maxLength={120} defaultValue={initial.activity} autoComplete="off" />
      </Field>
      <Field label={t("time.fields.note")} htmlFor="note" name="note" className="sm:col-span-2">
        <Textarea id="note" name="note" rows={2} maxLength={500} defaultValue={initial.note} />
      </Field>
      <Field label={t("time.fields.reason")} htmlFor="reason" name="reason" required hint={t("time.fields.reasonHint")} className="sm:col-span-2">
        <Textarea id="reason" name="reason" rows={2} maxLength={300} />
      </Field>
    </div>
  );
}

/** Eintrag korrigieren (Begründung Pflicht; der Stand davor bleibt im Verlauf stehen). */
export function CorrectForm({ id, version, initial, orders, running, cancelHref }: { id: string; version: string; initial: EntryFormValues; orders: OrderOption[]; running: boolean; cancelHref: string }) {
  const { t } = useI18n();
  return (
    <Form action={correctTime} draftKey={`time-correct:${id}`} className="flex flex-col gap-5">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="version" value={version} />
      <Card title={t("time.correct.title")}>
        <p className="mb-4 text-sm text-ink-muted">{t("time.correct.intro")}</p>
        <EntryFields initial={initial} orders={orders} running={running} />
      </Card>
      <FormActions cancelHref={cancelHref} submitLabel={t("time.correct.save")} />
    </Form>
  );
}

/** Zeit nachtragen; für andere Mitarbeiter nur mit `time.correctAll` (`staff` ist dann gefüllt). */
export function ManualForm({ initial, orders, staff, cancelHref }: { initial: EntryFormValues; orders: OrderOption[]; staff: Array<{ id: string; name: string }>; cancelHref: string }) {
  const { t } = useI18n();
  return (
    <Form action={addManualTime} draftKey="time-manual" className="flex flex-col gap-5">
      <Card title={t("time.manual.title")}>
        <p className="mb-4 text-sm text-ink-muted">{t("time.manual.intro")}</p>
        {staff.length > 0 ? (
          <Field label={t("time.fields.employee")} htmlFor="employeeId" name="employeeId" className="mb-4 max-w-sm">
            <Select id="employeeId" name="employeeId" defaultValue="">
              <option value="">{t("time.manual.myself")}</option>
              {staff.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <EntryFields initial={initial} orders={orders} />
      </Card>
      <FormActions cancelHref={cancelHref} submitLabel={t("time.manual.save")} />
    </Form>
  );
}

/** Eintrag stornieren (bleibt mit Begründung im Verlauf, zählt nicht mehr). */
export function VoidForm({ id, version }: { id: string; version: string }) {
  const { t } = useI18n();
  return (
    <Form action={voidTime} draftKey={`time-void:${id}`} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="version" value={version} />
      <Field label={t("time.fields.reason")} htmlFor="void-reason" name="reason" required hint={t("time.fields.reasonHint")}>
        <Textarea id="void-reason" name="reason" rows={2} maxLength={300} />
      </Field>
      <div>
        <SubmitButton variant="danger">{t("time.void.save")}</SubmitButton>
      </div>
    </Form>
  );
}

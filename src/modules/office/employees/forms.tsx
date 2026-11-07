"use client";

import { useState } from "react";
import { Checkbox, Field, Form, FormActions, Input, Select, Textarea } from "@/components/ui/form";
import { LinkButton, SubmitButton } from "@/components/ui/buttons";
import { Card } from "@/components/ui/layout";
import { ABSENCE_TYPES, DEPARTMENTS } from "@/modules/office/employees/domain";
import { useI18n } from "@/i18n/client";
import { WEEKDAY_DISPLAY_ORDER } from "./work-pattern";
import { endAfterStartChange } from "./absence-dates";
import { AbsenceHintList } from "./absence-hints";
import { saveAbsence, saveEmployee, saveQualification } from "./actions";

export type EmployeeFormInitial = {
  id?: string;
  /** Version der Zeile beim Öffnen (optimistische Sperre) */
  version?: string;
  firstName: string;
  lastName: string;
  personnelNumber: string;
  jobTitle: string;
  department: string;
  email: string;
  phone: string;
  mobile: string;
  hireDate: string;
  leaveDate: string;
  active: boolean;
  vacationDaysPerYear: string;
  /** Arbeitstage der Woche (0 = Sonntag … 6 = Samstag) */
  workWeekdays: number[];
  /** Von Hand erfasster Resturlaub zu Beginn des Jahres */
  vacationCarryYear: string;
  vacationCarryDays: string;
  notes: string;
  emergencyName: string;
  emergencyPhone: string;
  emergencyRelation: string;
  userId: string;
};

export function EmployeeForm({
  initial,
  users,
  canSensitive,
  cancelHref,
}: {
  initial: EmployeeFormInitial;
  users: Array<{ id: string; name: string; username: string }>;
  canSensitive: boolean;
  cancelHref: string;
}) {
  const { t, td } = useI18n();
  return (
    <Form action={saveEmployee} draftKey={`employee:${initial.id ?? "new"}`} className="flex max-w-4xl flex-col gap-5">
      {initial.id ? (
        <>
          <input type="hidden" name="id" value={initial.id} />
          <input type="hidden" name="version" value={initial.version ?? ""} />
        </>
      ) : null}

      <Card title={t("employees.sections.person")}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t("employees.fields.firstName")} htmlFor="firstName" name="firstName" required>
            <Input id="firstName" name="firstName" defaultValue={initial.firstName} maxLength={60} required autoComplete="off" />
          </Field>
          <Field label={t("employees.fields.lastName")} htmlFor="lastName" name="lastName" required>
            <Input id="lastName" name="lastName" defaultValue={initial.lastName} maxLength={60} required autoComplete="off" />
          </Field>
          <Field label={t("employees.fields.personnelNumber")} htmlFor="personnelNumber" name="personnelNumber">
            <Input id="personnelNumber" name="personnelNumber" defaultValue={initial.personnelNumber} maxLength={30} autoComplete="off" />
          </Field>
          <Field label={t("employees.fields.jobTitle")} htmlFor="jobTitle">
            <Input id="jobTitle" name="jobTitle" defaultValue={initial.jobTitle} maxLength={80} autoComplete="off" />
          </Field>
          <Field label={t("employees.fields.department")} htmlFor="department">
            <Select id="department" name="department" defaultValue={initial.department}>
              {DEPARTMENTS.map((x) => (
                <option key={x} value={x}>
                  {td(`employees.departments.${x}`, x)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("employees.fields.vacationDays")} htmlFor="vacationDaysPerYear" name="vacationDaysPerYear" hint={t("employees.fields.vacationDaysHint")}>
            <Input id="vacationDaysPerYear" name="vacationDaysPerYear" type="number" min={0} max={60} defaultValue={initial.vacationDaysPerYear} />
          </Field>
        </div>
      </Card>

      <Card title={t("employees.sections.workTime")}>
        <p className="mb-3 text-sm text-ink-muted">{t("employees.fields.workWeekdaysHint")}</p>
        <Field label={t("employees.fields.workWeekdays")} name="workWeekdays" group>
          <div className="flex flex-wrap gap-x-5">
            {WEEKDAY_DISPLAY_ORDER.map((day) => (
              <Checkbox key={day} name="workWeekdays" value={day} defaultChecked={initial.workWeekdays.includes(day)} label={t(`employees.weekdays.${day}`)} />
            ))}
          </div>
        </Field>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t("employees.fields.carryYear")} htmlFor="vacationCarryYear" name="vacationCarryYear" hint={t("employees.fields.carryHint")}>
            <Input id="vacationCarryYear" name="vacationCarryYear" type="number" min={2000} max={2100} inputMode="numeric" defaultValue={initial.vacationCarryYear} />
          </Field>
          <Field label={t("employees.fields.carryDays")} htmlFor="vacationCarryDays" name="vacationCarryDays">
            <Input id="vacationCarryDays" name="vacationCarryDays" inputMode="decimal" defaultValue={initial.vacationCarryDays} placeholder="0" />
          </Field>
        </div>
      </Card>

      <Card title={t("employees.sections.contact")}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label={t("customers.fields.email")} htmlFor="email" name="email">
            <Input id="email" name="email" type="email" defaultValue={initial.email} autoComplete="off" />
          </Field>
          <Field label={t("customers.fields.phone")} htmlFor="phone">
            <Input id="phone" name="phone" type="tel" defaultValue={initial.phone} autoComplete="off" />
          </Field>
          <Field label={t("employees.fields.mobile")} htmlFor="mobile">
            <Input id="mobile" name="mobile" type="tel" defaultValue={initial.mobile} autoComplete="off" />
          </Field>
        </div>
      </Card>

      <Card title={t("employees.sections.employment")}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t("employees.fields.hireDate")} htmlFor="hireDate">
            <Input id="hireDate" name="hireDate" type="date" defaultValue={initial.hireDate} />
          </Field>
          <Field label={t("employees.fields.leaveDate")} htmlFor="leaveDate" name="leaveDate">
            <Input id="leaveDate" name="leaveDate" type="date" defaultValue={initial.leaveDate} />
          </Field>
        </div>
        <Checkbox name="active" defaultChecked={initial.active} label={t("employees.fields.active")} className="mt-4" />
        <Field label={t("employees.fields.userAccount")} htmlFor="userId" name="userId" hint={t("employees.fields.userAccountHint")} className="mt-4">
          <Select id="userId" name="userId" defaultValue={initial.userId}>
            <option value="">{t("employees.fields.noUser")}</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.username})
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("common.notes")} htmlFor="notes" className="mt-4">
          <Textarea id="notes" name="notes" defaultValue={initial.notes} maxLength={2000} />
        </Field>
      </Card>

      {canSensitive ? (
        <Card title={t("employees.sections.emergency")}>
          <p className="mb-3 text-sm text-ink-muted">{t("employees.sensitiveHint")}</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label={t("employees.fields.emergencyName")} htmlFor="emergencyName">
              <Input id="emergencyName" name="emergencyName" data-no-draft defaultValue={initial.emergencyName} maxLength={80} autoComplete="off" />
            </Field>
            <Field label={t("employees.fields.emergencyPhone")} htmlFor="emergencyPhone">
              <Input id="emergencyPhone" name="emergencyPhone" data-no-draft type="tel" defaultValue={initial.emergencyPhone} autoComplete="off" />
            </Field>
            <Field label={t("employees.fields.emergencyRelation")} htmlFor="emergencyRelation">
              <Input id="emergencyRelation" name="emergencyRelation" data-no-draft defaultValue={initial.emergencyRelation} maxLength={40} autoComplete="off" />
            </Field>
          </div>
        </Card>
      ) : null}

      <FormActions cancelHref={cancelHref} />
    </Form>
  );
}

/* ───────────── Abwesenheit (im Modal) ───────────── */

/** Eine vorhandene Abwesenheit zum Bearbeiten (Zeitraum als `JJJJ-MM-TT`). */
export type AbsenceEdit = { id: string; version: string; type: string; startDate: string; endDate: string; note: string };

export function AbsenceForm({
  employees,
  initialEmployeeId,
  initialDate,
  canSensitive,
  returnTo,
  closeHref,
  edit,
}: {
  employees: Array<{ id: string; name: string }>;
  initialEmployeeId: string;
  initialDate: string;
  canSensitive: boolean;
  returnTo: string;
  closeHref: string;
  edit?: AbsenceEdit;
}) {
  const { t, td } = useI18n();
  const [start, setStart] = useState(edit?.startDate ?? initialDate);
  const [end, setEnd] = useState(edit?.endDate ?? initialDate);
  // Person und Art steuern die Überschneidungshinweise (absence-hints.tsx)
  const [employeeId, setEmployeeId] = useState(initialEmployeeId);
  const [type, setType] = useState(edit?.type ?? "vacation");
  // „Bis“ zieht „Von“ nach (absence-dates.ts)
  const moveStart = (value: string) => {
    setEnd((current) => endAfterStartChange(current, start, value));
    setStart(value);
  };
  return (
    <Form action={saveAbsence} className="flex flex-col gap-4">
      <input type="hidden" name="returnTo" value={returnTo} />
      {edit ? (
        <>
          <input type="hidden" name="id" value={edit.id} />
          <input type="hidden" name="version" value={edit.version} />
          {/* beim Bearbeiten bleibt die Person dieselbe (ein gesperrtes Feld würde nicht gesendet) */}
          <input type="hidden" name="employeeId" value={employeeId} />
        </>
      ) : null}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t("employees.title")} htmlFor="employeeId" name="employeeId" required>
          <Select id="employeeId" name={edit ? undefined : "employeeId"} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} disabled={!!edit} required>
            <option value="" disabled>
              {t("employees.fields.choose")}
            </option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("employees.fields.absenceType")} htmlFor="type" name="type" required>
          <Select id="type" name="type" value={type} onChange={(e) => setType(e.target.value)}>
            {ABSENCE_TYPES.filter((x) => x !== "sick" || canSensitive).map((x) => (
              <option key={x} value={x}>
                {td(`employees.absenceTypes.${x}`, x)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("employees.fields.from")} htmlFor="startDate" name="startDate" required>
          <Input id="startDate" name="startDate" type="date" value={start} onChange={(e) => moveStart(e.target.value)} required />
        </Field>
        <Field label={t("employees.fields.to")} htmlFor="endDate" name="endDate" hint={t("employees.fields.toHint")} required>
          <Input id="endDate" name="endDate" type="date" value={end} min={start || undefined} onChange={(e) => setEnd(e.target.value)} required />
        </Field>
      </div>
      <AbsenceHintList employeeId={employeeId} type={type} start={start} end={end} excludeId={edit?.id} />
      <Field label={t("common.notes")} htmlFor="note">
        <Input id="note" name="note" maxLength={200} defaultValue={edit?.note} />
      </Field>
      <FormActions cancelHref={closeHref} />
    </Form>
  );
}

/* ───────────── Qualifikation (Inline) ───────────── */

/** Eine vorhandene Qualifikation zum Bearbeiten (Daten als `JJJJ-MM-TT`). */
export type QualificationEdit = { id: string; version: string; name: string; issuedAt: string; expiresAt: string; note: string };

export function QualificationForm({ employeeId, edit, cancelHref }: { employeeId: string; edit?: QualificationEdit; cancelHref?: string }) {
  const { t } = useI18n();
  return (
    <Form action={saveQualification} className="flex flex-wrap items-start gap-3">
      <input type="hidden" name="employeeId" value={employeeId} />
      {edit ? (
        <>
          <input type="hidden" name="id" value={edit.id} />
          <input type="hidden" name="version" value={edit.version} />
        </>
      ) : null}
      <Input name="name" placeholder={t("employees.fields.qualification")} aria-label={t("employees.fields.qualification")} className="min-w-48 flex-[2]" maxLength={100} defaultValue={edit?.name} required />
      <Field label={t("employees.fields.issuedAt")} htmlFor="issuedAt" className="min-w-36 flex-1">
        <Input id="issuedAt" name="issuedAt" type="date" defaultValue={edit?.issuedAt} />
      </Field>
      <Field label={t("employees.fields.expiresAt")} htmlFor="expiresAt" name="expiresAt" className="min-w-36 flex-1">
        <Input id="expiresAt" name="expiresAt" type="date" defaultValue={edit?.expiresAt} />
      </Field>
      {edit ? (
        <Field label={t("common.notes")} htmlFor="qualificationNote" className="min-w-48 flex-[2]">
          <Input id="qualificationNote" name="note" maxLength={200} defaultValue={edit.note} />
        </Field>
      ) : null}
      <SubmitButton size="sm" className="mt-5">
        {edit ? t("common.save") : t("common.add")}
      </SubmitButton>
      {edit && cancelHref ? (
        <LinkButton size="sm" href={cancelHref} className="mt-5">
          {t("common.cancel")}
        </LinkButton>
      ) : null}
    </Form>
  );
}

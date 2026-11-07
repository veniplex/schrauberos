import { noon } from "@/lib/dates";
import { z } from "zod";
import { dateText } from "@/lib/zod-fields";
import { claimRow } from "@/lib/concurrency";
import { ABSENCE_TYPES, DEPARTMENTS, employeeName } from "@/modules/office/employees/domain";
import { writeAudit } from "@/server/audit";
import { defineOperation, fail, failField } from "@/server/operations";
import { DEFAULT_WORK_WEEKDAYS, formatWorkWeekdays } from "./work-pattern";

const date = dateText().optional();

/** Tage mit Komma oder Punkt als Dezimalzeichen (Formular „5,5“, API-Zahl); in halben Tagen. */
const halfDays = z.preprocess(
  (value) => (typeof value === "string" ? Number(value.trim().replace(",", ".")) : value),
  z.number({ error: "employees.errors.carryDays" }).min(0, { error: "employees.errors.carryDays" }).max(366, { error: "employees.errors.carryDays" }).refine((n) => Number.isInteger(n * 2), { error: "employees.errors.carryDays" }),
);

/* ───────────── Mitarbeiter ───────────── */

const employeeInput = z
  .object({
    id: z.string().optional(),
    version: z.string().optional(),
    firstName: z.string().trim().min(1).max(60),
    lastName: z.string().trim().min(1).max(60),
    personnelNumber: z.string().max(30).optional(),
    jobTitle: z.string().max(80).optional(),
    department: z.enum(DEPARTMENTS).default("other"),
    email: z.string().email().max(200).optional(),
    phone: z.string().max(40).optional(),
    mobile: z.string().max(40).optional(),
    hireDate: date,
    leaveDate: date,
    active: z.boolean(),
    vacationDaysPerYear: z.coerce.number().int().min(0).max(60).optional(),
    /** Arbeitstage der Woche (0 = Sonntag … 6 = Samstag), mindestens einer; die Formulare senden die angehakten Tage */
    workWeekdays: z.array(z.coerce.number().int().min(0).max(6)).min(1, { error: "employees.errors.noWorkday" }),
    /** Von Hand erfasster Resturlaub zu Beginn des Jahres (beide Angaben zusammen) */
    vacationCarryYear: z.coerce.number().int().min(2000).max(2100).optional(),
    vacationCarryDays: halfDays.optional(),
    notes: z.string().max(2000).optional(),
    emergencyName: z.string().max(80).optional(),
    emergencyPhone: z.string().max(40).optional(),
    emergencyRelation: z.string().max(40).optional(),
    userId: z.string().optional(),
  })
  .superRefine((d, ctx) => {
    if (d.hireDate && d.leaveDate && d.leaveDate < d.hireDate) ctx.addIssue({ code: "custom", message: "employees.errors.leaveBeforeHire", path: ["leaveDate"] });
    if ((d.vacationCarryYear === undefined) !== (d.vacationCarryDays === undefined)) ctx.addIssue({ code: "custom", message: "employees.errors.carryBoth", path: [d.vacationCarryYear === undefined ? "vacationCarryYear" : "vacationCarryDays"] });
  });

/** Nach dem Speichern wird nur gebraucht, was Audit und Antwort nennen (nie der Notfallkontakt). */
const SAVED = { id: true, firstName: true, lastName: true } as const;

export const saveEmployeeOperation = defineOperation({
  name: "employees.save",
  permission: "employees.edit",
  input: employeeInput,
  audit: (input) => (input.id ? "employee.update" : "employee.create"),
  run: async ({ input: { id, version, hireDate, leaveDate, active, ...d }, principal, tx, audit }) => {
    if (d.personnelNumber) {
      const dup = await tx.employee.findFirst({ where: { personnelNumber: d.personnelNumber, ...(id ? { id: { not: id } } : {}) } });
      if (dup) failField("personnelNumber", "employees.errors.numberTaken");
    }
    if (d.userId) {
      const user = await tx.user.findUnique({ where: { id: d.userId }, include: { employee: { select: { id: true, firstName: true, lastName: true } } } });
      if (!user) failField("userId", "validation.invalid");
      if (user.employee && user.employee.id !== id) {
        // der Name des anderen Mitarbeiters nur mit `employees.view` (sonst erfährt ein Token mit nur `employees.edit` Namen aus der Fehlermeldung)
        if (!principal.can("employees.view")) failField("userId", "employees.errors.userTakenHidden");
        failField("userId", "employees.errors.userTaken", { name: employeeName(user.employee) });
      }
    }

    // Notfallkontakt nur mit dem Recht ändern – sonst bleibt der gespeicherte Wert unangetastet
    const sensitive = principal.can("employees.sensitive");
    const emergency = { emergencyName: d.emergencyName ?? null, emergencyPhone: d.emergencyPhone ?? null, emergencyRelation: d.emergencyRelation ?? null };
    const data = {
      firstName: d.firstName,
      lastName: d.lastName,
      personnelNumber: d.personnelNumber ?? null,
      jobTitle: d.jobTitle ?? null,
      department: d.department,
      email: d.email ?? null,
      phone: d.phone ?? null,
      mobile: d.mobile ?? null,
      hireDate: hireDate ? noon(hireDate) : null,
      leaveDate: leaveDate ? noon(leaveDate) : null,
      active,
      vacationDaysPerYear: d.vacationDaysPerYear ?? null,
      workWeekdays: formatWorkWeekdays(d.workWeekdays) || DEFAULT_WORK_WEEKDAYS,
      vacationCarryYear: d.vacationCarryYear ?? null,
      vacationCarryDays: d.vacationCarryDays ?? null,
      notes: d.notes ?? null,
      userId: d.userId ?? null,
      ...(sensitive ? emergency : {}),
    };

    let saved;
    let emergencyChanged = false;
    if (id) {
      if (!(await tx.employee.findUnique({ where: { id }, select: { id: true } }))) fail("notFound");
      // Der bisherige Notfallkontakt wird nur gelesen, wenn er sich mit diesem Recht überhaupt ändern lässt
      const before = sensitive ? await tx.employee.findUnique({ where: { id }, select: { emergencyName: true, emergencyPhone: true, emergencyRelation: true } }) : null;
      if (!(await claimRow(tx.employee, id, version))) fail("conflict");
      saved = await tx.employee.update({ where: { id }, data, select: SAVED });
      emergencyChanged = before !== null && (before.emergencyName !== emergency.emergencyName || before.emergencyPhone !== emergency.emergencyPhone || before.emergencyRelation !== emergency.emergencyRelation);
    } else {
      saved = await tx.employee.create({ data, select: SAVED });
      emergencyChanged = sensitive && Object.values(emergency).some((value) => value !== null);
    }
    audit({ target: employeeName(saved), entityId: saved.id });
    // Notfallkontakt ist besonders geschützt: eigener Eintrag, ohne die Werte selbst festzuhalten
    if (emergencyChanged) await writeAudit(tx, "employee.sensitiveUpdate", { target: employeeName(saved), entityId: saved.id, actor: { id: principal.user.id, name: principal.user.name } });
    return { id: saved.id };
  },
});

export const deleteEmployeeOperation = defineOperation({
  name: "employees.delete",
  permission: "employees.delete",
  input: z.object({ id: z.string().min(1) }),
  audit: "employee.delete",
  run: async ({ input, tx, audit }) => {
    const employee = await tx.employee.findUnique({ where: { id: input.id }, select: { firstName: true, lastName: true } });
    if (!employee) fail("notFound");
    await tx.employee.delete({ where: { id: input.id } });
    audit({ target: employeeName(employee), entityId: input.id });
    return { id: input.id };
  },
});

/* ───────────── Abwesenheiten ───────────── */

const absenceInput = z
  .object({
    /** Bearbeiten: Kennung und Version der Zeile (die Person bleibt dieselbe) */
    id: z.string().optional(),
    version: z.string().optional(),
    employeeId: z.string().min(1),
    type: z.enum(ABSENCE_TYPES),
    startDate: dateText(),
    endDate: dateText(),
    note: z.string().max(200).optional(),
    returnTo: z.string().optional(),
  })
  .superRefine((d, ctx) => {
    if (d.endDate < d.startDate) ctx.addIssue({ code: "custom", message: "employees.errors.endBeforeStart", path: ["endDate"] });
  });

export const saveAbsenceOperation = defineOperation({
  name: "employees.saveAbsence",
  permission: "employees.edit",
  input: absenceInput,
  audit: (input) => (input.id ? "employee.absenceUpdate" : "employee.absenceCreate"),
  run: async ({ input: d, principal, tx, audit }) => {
    const sensitive = principal.can("employees.sensitive");
    // Krankheit ist besonders geschützt (Gesundheitsdaten): weder anlegen noch (um)schreiben noch in eine andere Art ändern ohne das Recht
    if (d.type === "sick" && !sensitive) failField("type", "employees.errors.sickRestricted");
    const employee = await tx.employee.findUnique({ where: { id: d.employeeId }, select: { firstName: true, lastName: true } });
    if (!employee) failField("employeeId", "validation.invalid");
    if (d.id) {
      const before = await tx.absence.findUnique({ where: { id: d.id }, select: { employeeId: true, type: true } });
      if (!before) fail("notFound");
      if (before.employeeId !== d.employeeId) failField("employeeId", "validation.invalid");
      if (before.type === "sick" && !sensitive) fail("forbidden", "employees.errors.sickRestricted");
    }
    // Exakte Dublette (dieselbe Art, derselbe Zeitraum): die einzige Überschneidung, die blockiert – alle anderen zeigt das Formular nur als Hinweis (`absence-overlap.ts`)
    if (await tx.absence.findFirst({ where: { employeeId: d.employeeId, type: d.type, startDate: noon(d.startDate), endDate: noon(d.endDate), ...(d.id ? { id: { not: d.id } } : {}) }, select: { id: true } })) failField("startDate", "employees.errors.absenceDuplicate");
    const data = { type: d.type, startDate: noon(d.startDate), endDate: noon(d.endDate), note: d.note ?? null };
    let absence;
    if (d.id) {
      if (!(await claimRow(tx.absence, d.id, d.version))) fail("conflict");
      absence = await tx.absence.update({ where: { id: d.id }, data });
    } else {
      absence = await tx.absence.create({ data: { employeeId: d.employeeId, ...data } });
    }
    // Das Audit-Log nennt weder Art (Krankheit) noch Zeitraum noch Notiz
    audit({ target: employeeName(employee), entityId: absence.id });
    return { id: absence.id };
  },
});

export const deleteAbsenceOperation = defineOperation({
  name: "employees.deleteAbsence",
  permission: "employees.edit",
  input: z.object({ id: z.string().min(1), returnTo: z.string().optional() }),
  audit: "employee.absenceDelete",
  run: async ({ input, principal, tx, audit }) => {
    const absence = await tx.absence.findUnique({ where: { id: input.id }, include: { employee: { select: { firstName: true, lastName: true } } } });
    if (!absence) fail("notFound");
    // Krankheitseinträge dürfen nur mit dem Recht für sensible Daten gelöscht werden
    if (absence.type === "sick" && !principal.can("employees.sensitive")) fail("forbidden", "employees.errors.sickRestricted");
    await tx.absence.delete({ where: { id: input.id } });
    audit({ target: employeeName(absence.employee), entityId: input.id });
    return { employeeId: absence.employeeId };
  },
});

/* ───────────── Qualifikationen ───────────── */

const qualificationInput = z
  .object({
    /** Bearbeiten: Kennung und Version der Zeile (die Person bleibt dieselbe) */
    id: z.string().optional(),
    version: z.string().optional(),
    employeeId: z.string().min(1),
    name: z.string().trim().min(1).max(100),
    issuedAt: date,
    expiresAt: date,
    note: z.string().max(200).optional(),
  })
  .superRefine((d, ctx) => {
    if (d.issuedAt && d.expiresAt && d.expiresAt < d.issuedAt) ctx.addIssue({ code: "custom", message: "employees.errors.expiresBeforeIssued", path: ["expiresAt"] });
  });

export const saveQualificationOperation = defineOperation({
  name: "employees.saveQualification",
  permission: "employees.edit",
  input: qualificationInput,
  audit: (input) => (input.id ? "employee.qualificationUpdate" : "employee.qualificationCreate"),
  run: async ({ input: { id, version, employeeId, issuedAt, expiresAt, ...d }, tx, audit }) => {
    const employee = await tx.employee.findUnique({ where: { id: employeeId }, select: { firstName: true, lastName: true } });
    if (!employee) failField("employeeId", "validation.invalid");
    const data = { name: d.name, note: d.note ?? null, issuedAt: issuedAt ? noon(issuedAt) : null, expiresAt: expiresAt ? noon(expiresAt) : null };
    let q;
    if (id) {
      const before = await tx.qualification.findUnique({ where: { id }, select: { employeeId: true } });
      if (!before) fail("notFound");
      if (before.employeeId !== employeeId) failField("employeeId", "validation.invalid");
      if (!(await claimRow(tx.qualification, id, version))) fail("conflict");
      q = await tx.qualification.update({ where: { id }, data });
    } else {
      q = await tx.qualification.create({ data: { employeeId, ...data } });
    }
    audit({ target: `${employeeName(employee)}: ${d.name}`, entityId: q.id });
    return { id: q.id };
  },
});

export const deleteQualificationOperation = defineOperation({
  name: "employees.deleteQualification",
  permission: "employees.edit",
  input: z.object({ id: z.string().min(1) }),
  audit: "employee.qualificationDelete",
  run: async ({ input, tx, audit }) => {
    const q = await tx.qualification.findUnique({ where: { id: input.id }, include: { employee: { select: { firstName: true, lastName: true } } } });
    if (!q) fail("notFound");
    await tx.qualification.delete({ where: { id: input.id } });
    audit({ target: `${employeeName(q.employee)}: ${q.name}`, entityId: input.id });
    return { employeeId: q.employeeId };
  },
});


/* ───────────── Einstellungen ───────────── */

const settingsInput = z
  .object({
    vacationCarryMonth: z.coerce.number().int().min(1).max(12),
    vacationCarryDay: z.coerce.number().int().min(1).max(31),
  })
  .superRefine((d, ctx) => {
    // Schaltjahr als Maßstab: der 29. Februar ist erlaubt (im Nichtschaltjahr gilt der 28.)
    if (d.vacationCarryDay > new Date(Date.UTC(2024, d.vacationCarryMonth, 0)).getUTCDate()) ctx.addIssue({ code: "custom", message: "employees.errors.carryDeadline", path: ["vacationCarryDay"] });
  });

/** Stichtag, an dem der Resturlaub des Vorjahres verfällt (Standard 31.03.). */
export const saveEmployeeSettingsOperation = defineOperation({
  name: "employees.saveSettings",
  permission: "settings.manage",
  input: settingsInput,
  audit: "settings.employees",
  run: async ({ input: d, tx, audit }) => {
    await tx.employeeSettings.upsert({ where: { id: "default" }, update: d, create: { id: "default", ...d } });
    audit({ target: `${String(d.vacationCarryDay).padStart(2, "0")}.${String(d.vacationCarryMonth).padStart(2, "0")}.`, entityId: "default" });
    return {};
  },
});

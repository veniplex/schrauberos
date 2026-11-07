import { noon } from "@/lib/dates";
import { z } from "zod";
import { dateText } from "@/lib/zod-fields";
import { claimRow } from "@/lib/concurrency";
import { ABSENCE_TYPES, DEPARTMENTS, employeeName } from "@/modules/office/employees/domain";
import { writeAudit } from "@/server/audit";
import { defineOperation, fail, failField } from "@/server/operations";

const date = dateText().optional();

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
    notes: z.string().max(2000).optional(),
    emergencyName: z.string().max(80).optional(),
    emergencyPhone: z.string().max(40).optional(),
    emergencyRelation: z.string().max(40).optional(),
    userId: z.string().optional(),
  })
  .superRefine((d, ctx) => {
    if (d.hireDate && d.leaveDate && d.leaveDate < d.hireDate) ctx.addIssue({ code: "custom", message: "employees.errors.leaveBeforeHire", path: ["leaveDate"] });
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
      if (user.employee && user.employee.id !== id) failField("userId", "employees.errors.userTaken", { name: employeeName(user.employee) });
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
  audit: "employee.absenceCreate",
  run: async ({ input: d, principal, tx, audit }) => {
    // Krankheit ist besonders geschützt (Gesundheitsdaten)
    if (d.type === "sick" && !principal.can("employees.sensitive")) failField("type", "employees.errors.sickRestricted");
    const employee = await tx.employee.findUnique({ where: { id: d.employeeId }, select: { firstName: true, lastName: true } });
    if (!employee) failField("employeeId", "validation.invalid");
    // Exakte Dublette (dieselbe Art, derselbe Zeitraum): die einzige Überschneidung, die blockiert – alle anderen zeigt das Formular nur als Hinweis (`absence-overlap.ts`)
    if (await tx.absence.findFirst({ where: { employeeId: d.employeeId, type: d.type, startDate: noon(d.startDate), endDate: noon(d.endDate) }, select: { id: true } })) failField("startDate", "employees.errors.absenceDuplicate");
    const absence = await tx.absence.create({
      data: { employeeId: d.employeeId, type: d.type, startDate: noon(d.startDate), endDate: noon(d.endDate), note: d.note ?? null },
    });
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
  audit: "employee.qualificationCreate",
  run: async ({ input: { employeeId, issuedAt, expiresAt, ...d }, tx, audit }) => {
    const employee = await tx.employee.findUnique({ where: { id: employeeId }, select: { firstName: true, lastName: true } });
    if (!employee) failField("employeeId", "validation.invalid");
    const q = await tx.qualification.create({
      data: { employeeId, name: d.name, note: d.note ?? null, issuedAt: issuedAt ? noon(issuedAt) : null, expiresAt: expiresAt ? noon(expiresAt) : null },
    });
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


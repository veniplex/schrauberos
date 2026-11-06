import { z } from "zod";
import type { Absence, Employee, Qualification } from "@/generated/prisma/client";
import { versionOf } from "@/lib/concurrency";
import { dateOnly, dayOrNull, iso, optionalDate } from "@/server/api/format";
import { defineResource, type Delegate } from "@/server/api/resource";
import { db } from "@/server/db";
import { contains } from "@/server/search";
import { ABSENCE_TYPES, DEPARTMENTS } from "./domain";
import {
  deleteAbsenceOperation,
  deleteEmployeeOperation,
  deleteQualificationOperation,
  saveAbsenceOperation,
  saveEmployeeOperation,
  saveQualificationOperation,
} from "./operations";

/**
 * API-Ressourcen „Mitarbeiter“ (`/api/v1/employees`, `/employee-absences`, `/employee-qualifications`) – **ohne sensible Daten, auch nicht mit Scope**:
 * kein Notfallkontakt, keine Krankheit (Abwesenheiten der Art „Krankheit“ gibt es in der API nicht: nicht lesbar, nicht anlegbar, nicht löschbar),
 * keine Verknüpfung zum Benutzerkonto. Das Recht `employees.sensitive` kann kein Token tragen (`isApiForbidden`).
 */
const text = (max: number) => z.string().max(max).nullable().optional();
const nullableString = z.string().nullable();

/* ───────────── Mitarbeiter ───────────── */

const body = z.strictObject({
  firstName: z.string().trim().min(1).max(60),
  lastName: z.string().trim().min(1).max(60),
  personnelNumber: text(30),
  jobTitle: text(80),
  department: z.enum(DEPARTMENTS).optional(),
  email: z.email().max(200).nullable().optional(),
  phone: text(40),
  mobile: text(40),
  hireDate: optionalDate,
  leaveDate: optionalDate,
  active: z.boolean().optional(),
  vacationDaysPerYear: z.number().int().min(0).max(60).nullable().optional(),
  notes: text(2000),
});

const item = z.object({
  id: z.string(),
  version: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  personnelNumber: nullableString,
  jobTitle: nullableString,
  department: z.enum(DEPARTMENTS),
  email: nullableString,
  phone: nullableString,
  mobile: nullableString,
  hireDate: nullableString,
  leaveDate: nullableString,
  active: z.boolean(),
  vacationDaysPerYear: z.number().int().nullable(),
  notes: nullableString,
  createdAt: z.string(),
  updatedAt: z.string(),
});

const oneOf = <T extends string>(list: readonly T[], value: string, fallback: T): T => ((list as readonly string[]).includes(value) ? (value as T) : fallback);

export const employeeEndpoints = defineResource({
  feature: "office.employees",
  tag: "Employees",
  name: "employees",
  singular: "employee",
  path: "/employees",
  read: "employees.view",
  model: db.employee as unknown as Delegate<Employee>,
  item,
  version: versionOf,
  toItem: (e): z.input<typeof item> => ({
    id: e.id,
    version: versionOf(e),
    firstName: e.firstName,
    lastName: e.lastName,
    personnelNumber: e.personnelNumber,
    jobTitle: e.jobTitle,
    department: oneOf(DEPARTMENTS, e.department, "other"),
    email: e.email,
    phone: e.phone,
    mobile: e.mobile,
    hireDate: dayOrNull(e.hireDate),
    leaveDate: dayOrNull(e.leaveDate),
    active: e.active,
    vacationDaysPerYear: e.vacationDaysPerYear,
    notes: e.notes,
    createdAt: iso(e.createdAt),
    updatedAt: iso(e.updatedAt),
  }),
  list: {
    filters: z.strictObject({ q: z.string().max(100).optional(), department: z.enum(DEPARTMENTS).optional(), active: z.enum(["true", "false"]).optional() }),
    where: ({ q, department, active }) => ({
      ...(department ? { department } : {}),
      ...(active ? { active: active === "true" } : {}),
      ...(q ? { OR: [{ lastName: contains(q) }, { firstName: contains(q) }, { personnelNumber: contains(q) }, { jobTitle: contains(q) }, { email: contains(q) }] } : {}),
    }),
    sorts: { lastName: (dir) => ({ lastName: dir }), firstName: (dir) => ({ firstName: dir }), createdAt: (dir) => ({ createdAt: dir }), updatedAt: (dir) => ({ updatedAt: dir }) },
    defaultSort: [
      { key: "lastName", dir: "asc" },
      { key: "firstName", dir: "asc" },
    ],
  },
  create: { permission: "employees.edit", operation: saveEmployeeOperation, body, toInput: (b) => ({ ...b, active: b.active ?? true }) },
  update: {
    permission: "employees.edit",
    operation: saveEmployeeOperation,
    current: (e) => ({
      firstName: e.firstName,
      lastName: e.lastName,
      personnelNumber: e.personnelNumber,
      jobTitle: e.jobTitle,
      department: e.department,
      email: e.email,
      phone: e.phone,
      mobile: e.mobile,
      hireDate: dayOrNull(e.hireDate),
      leaveDate: dayOrNull(e.leaveDate),
      active: e.active,
      vacationDaysPerYear: e.vacationDaysPerYear,
      notes: e.notes,
    }),
    // die Verknüpfung zum Benutzerkonto bleibt unangetastet (sie ist nicht Teil der API)
    toInput: (merged, { id, version, row }) => ({ ...merged, userId: row?.userId ?? undefined, id, version }),
  },
  remove: { permission: "employees.delete", operation: deleteEmployeeOperation },
});

/* ───────────── Abwesenheiten ───────────── */

const absenceBody = z.strictObject({
  employeeId: z.string().min(1).max(64),
  /** „Krankheit“ gibt es in der API nicht */
  type: z.enum(ABSENCE_TYPES.filter((t) => t !== "sick") as ["vacation", "training", "other"]),
  startDate: dateOnly,
  endDate: dateOnly,
  note: text(200),
});

const absenceItem = z.object({
  id: z.string(),
  employeeId: z.string(),
  type: z.enum(["vacation", "training", "other"]),
  startDate: z.string(),
  endDate: z.string(),
  note: nullableString,
  createdAt: z.string(),
});

export const absenceEndpoints = defineResource({
  feature: "office.employees",
  tag: "Employees",
  name: "employee-absences",
  singular: "absence",
  path: "/employee-absences",
  read: "employees.view",
  model: db.absence as unknown as Delegate<Absence>,
  // Krankheit ist besonders geschützt: für die API gibt es sie nicht
  visible: (a) => a.type !== "sick",
  item: absenceItem,
  toItem: (a): z.input<typeof absenceItem> => ({
    id: a.id,
    employeeId: a.employeeId,
    type: a.type === "vacation" || a.type === "training" ? a.type : "other",
    startDate: dayOrNull(a.startDate)!,
    endDate: dayOrNull(a.endDate)!,
    note: a.note,
    createdAt: iso(a.createdAt),
  }),
  list: {
    filters: z.strictObject({ employeeId: z.string().max(64).optional(), type: absenceBody.shape.type.optional(), from: dateOnly.optional(), to: dateOnly.optional() }),
    where: ({ employeeId, type, from, to }) => ({
      type: type ?? { not: "sick" },
      ...(employeeId ? { employeeId } : {}),
      // Überschneidung mit dem Zeitraum
      ...(from ? { endDate: { gte: new Date(`${from}T00:00:00`) } } : {}),
      ...(to ? { startDate: { lte: new Date(`${to}T23:59:59`) } } : {}),
    }),
    sorts: { startDate: (dir) => ({ startDate: dir }), endDate: (dir) => ({ endDate: dir }), createdAt: (dir) => ({ createdAt: dir }) },
    defaultSort: [{ key: "startDate", dir: "desc" }],
  },
  create: { permission: "employees.edit", operation: saveAbsenceOperation, body: absenceBody, toInput: (b) => b },
  remove: { permission: "employees.edit", operation: deleteAbsenceOperation },
});

/* ───────────── Qualifikationen ───────────── */

const qualificationBody = z.strictObject({
  employeeId: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(100),
  issuedAt: optionalDate,
  expiresAt: optionalDate,
  note: text(200),
});

const qualificationItem = z.object({
  id: z.string(),
  employeeId: z.string(),
  name: z.string(),
  issuedAt: nullableString,
  expiresAt: nullableString,
  note: nullableString,
});

export const qualificationEndpoints = defineResource({
  feature: "office.employees",
  tag: "Employees",
  name: "employee-qualifications",
  singular: "qualification",
  path: "/employee-qualifications",
  read: "employees.view",
  model: db.qualification as unknown as Delegate<Qualification>,
  item: qualificationItem,
  toItem: (q): z.input<typeof qualificationItem> => ({ id: q.id, employeeId: q.employeeId, name: q.name, issuedAt: dayOrNull(q.issuedAt), expiresAt: dayOrNull(q.expiresAt), note: q.note }),
  list: {
    filters: z.strictObject({ employeeId: z.string().max(64).optional() }),
    where: ({ employeeId }) => (employeeId ? { employeeId } : {}),
    sorts: { name: (dir) => ({ name: dir }), expiresAt: (dir) => ({ expiresAt: dir }) },
    defaultSort: [{ key: "name", dir: "asc" }],
  },
  create: { permission: "employees.edit", operation: saveQualificationOperation, body: qualificationBody, toInput: (b) => b },
  remove: { permission: "employees.edit", operation: deleteQualificationOperation },
});

export const endpoints = [...employeeEndpoints, ...absenceEndpoints, ...qualificationEndpoints];

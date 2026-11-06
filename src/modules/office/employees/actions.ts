"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { requirePermission } from "@/server/auth/session";
import { getI18n } from "@/i18n/server";
import type { ActionState } from "@/components/ui/form";
import { ABSENCE_TYPES, DEPARTMENTS, employeeName } from "@/modules/office/employees/domain";
import { fieldErrors, formObject, safeReturn } from "@/lib/forms";
import { audit } from "@/server/audit";
import { claimed } from "@/lib/concurrency";

function refresh(id?: string) {
  for (const p of ["/employees", "/employees/absences", "/fleet", "/admin/users", "/"]) revalidatePath(p);
  if (id) revalidatePath(`/employees/${id}`);
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();
const noon = (d: string) => new Date(`${d}T12:00:00`);

/* ───────────── Mitarbeiter ───────────── */

const employeeSchema = z.object({
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
  vacationDaysPerYear: z.coerce.number().int().min(0).max(60).optional(),
  notes: z.string().max(2000).optional(),
  emergencyName: z.string().max(80).optional(),
  emergencyPhone: z.string().max(40).optional(),
  emergencyRelation: z.string().max(40).optional(),
  userId: z.string().optional(),
});

export async function saveEmployee(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission("employees.edit");
  const { t } = await getI18n();
  const parsed = employeeSchema.safeParse(formObject(formData));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error, t) };
  const { id, hireDate, leaveDate, ...d } = parsed.data;

  if (hireDate && leaveDate && leaveDate < hireDate) return { fieldErrors: { leaveDate: t("employees.errors.leaveBeforeHire") } };

  if (d.personnelNumber) {
    const dup = await db.employee.findFirst({ where: { personnelNumber: d.personnelNumber, ...(id ? { id: { not: id } } : {}) } });
    if (dup) return { fieldErrors: { personnelNumber: t("employees.errors.numberTaken") } };
  }
  if (d.userId) {
    const user = await db.user.findUnique({ where: { id: d.userId }, include: { employee: true } });
    if (!user) return { fieldErrors: { userId: t("validation.invalid") } };
    if (user.employee && user.employee.id !== id) {
      return { fieldErrors: { userId: t("employees.errors.userTaken", { name: `${user.employee.firstName} ${user.employee.lastName}` }) } };
    }
  }

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
    active: formData.get("active") === "on",
    vacationDaysPerYear: d.vacationDaysPerYear ?? null,
    notes: d.notes ?? null,
    userId: d.userId ?? null,
    // Notfallkontakt nur mit dem Recht ändern – sonst bleibt der gespeicherte Wert unangetastet
    ...(session.can("employees.sensitive")
      ? { emergencyName: d.emergencyName ?? null, emergencyPhone: d.emergencyPhone ?? null, emergencyRelation: d.emergencyRelation ?? null }
      : {}),
  };
  if (id && !(await claimed(d.version, (stamp, next) => db.employee.updateMany({ where: { id: id, updatedAt: stamp }, data: { updatedAt: next } })))) return { error: t("common.conflict") };
  const saved = id ? await db.employee.update({ where: { id }, data }) : await db.employee.create({ data });
  refresh(saved.id);
  redirect(`/employees/${saved.id}`);
}

export async function deleteEmployee(formData: FormData) {
  await requirePermission("employees.delete");
  const id = String(formData.get("id") ?? "");
  const employee = id ? await db.employee.findUnique({ where: { id }, select: { firstName: true, lastName: true } }) : null;
  if (id) await db.employee.deleteMany({ where: { id } });
  if (employee) await audit("employee.delete", { target: employeeName(employee), entityId: id });
  refresh();
  redirect("/employees");
}

/* ───────────── Abwesenheiten ───────────── */

const absenceSchema = z.object({
  employeeId: z.string().min(1),
  type: z.enum(ABSENCE_TYPES),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().max(200).optional(),
  returnTo: z.string().optional(),
});

export async function saveAbsence(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission("employees.edit");
  const { t } = await getI18n();
  const parsed = absenceSchema.safeParse(formObject(formData));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error, t) };
  const d = parsed.data;

  if (d.endDate < d.startDate) return { fieldErrors: { endDate: t("employees.errors.endBeforeStart") } };
  if (d.type === "sick" && !session.can("employees.sensitive")) return { fieldErrors: { type: t("employees.errors.sickRestricted") } };
  if (!(await db.employee.findUnique({ where: { id: d.employeeId }, select: { id: true } }))) return { fieldErrors: { employeeId: t("validation.invalid") } };

  await db.absence.create({
    data: { employeeId: d.employeeId, type: d.type, startDate: noon(d.startDate), endDate: noon(d.endDate), note: d.note ?? null },
  });
  refresh(d.employeeId);
  redirect(safeReturn(d.returnTo, "/employees", `/employees/absences?month=${d.startDate.slice(0, 7)}`));
}

export async function deleteAbsence(formData: FormData) {
  const session = await requirePermission("employees.edit");
  const id = String(formData.get("id") ?? "");
  const returnTo = safeReturn(String(formData.get("returnTo") ?? ""), "/employees", "/employees/absences");
  const absence = id ? await db.absence.findUnique({ where: { id } }) : null;
  // Krankheitseinträge dürfen nur mit dem Recht für sensible Daten gelöscht werden
  if (absence && (absence.type !== "sick" || session.can("employees.sensitive"))) await db.absence.delete({ where: { id } });
  refresh(absence?.employeeId);
  redirect(returnTo);
}

/* ───────────── Qualifikationen ───────────── */

const qualificationSchema = z.object({
  employeeId: z.string().min(1),
  name: z.string().trim().min(1).max(100),
  issuedAt: date,
  expiresAt: date,
  note: z.string().max(200).optional(),
});

export async function saveQualification(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission("employees.edit");
  const { t } = await getI18n();
  const parsed = qualificationSchema.safeParse(formObject(formData));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error, t) };
  const { employeeId, issuedAt, expiresAt, ...d } = parsed.data;
  if (issuedAt && expiresAt && expiresAt < issuedAt) return { fieldErrors: { expiresAt: t("employees.errors.expiresBeforeIssued") } };

  await db.qualification.create({
    data: { employeeId, name: d.name, note: d.note ?? null, issuedAt: issuedAt ? noon(issuedAt) : null, expiresAt: expiresAt ? noon(expiresAt) : null },
  });
  refresh(employeeId);
  return { ok: true, message: t("common.saved") };
}

export async function deleteQualification(formData: FormData) {
  await requirePermission("employees.edit");
  const id = String(formData.get("id") ?? "");
  const q = id ? await db.qualification.findUnique({ where: { id } }) : null;
  if (q) await db.qualification.delete({ where: { id } });
  refresh(q?.employeeId);
}

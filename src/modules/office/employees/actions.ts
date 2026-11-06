"use server";

import { formObject, safeReturn } from "@/lib/forms";
import { defineAction } from "@/server/operations";
import { deleteAbsenceOperation, deleteEmployeeOperation, deleteQualificationOperation, saveAbsenceOperation, saveEmployeeOperation, saveQualificationOperation } from "./operations";

const refreshPaths = ["/employees", "/employees/absences", "/fleet", "/admin/users", "/"];
const refresh = (employeeId?: string | null) => [...refreshPaths, ...(employeeId ? [`/employees/${employeeId}`] : [])];

export const saveEmployee = defineAction(saveEmployeeOperation, {
  form: (fd) => ({ ...formObject(fd), active: fd.get("active") === "on" }),
  revalidate: ({ id }) => refresh(id),
  redirect: ({ id }) => `/employees/${id}`,
});

export const deleteEmployee = defineAction(deleteEmployeeOperation, { revalidate: refresh(), redirect: "/employees", message: "common.deleted" });

export const saveAbsence = defineAction(saveAbsenceOperation, {
  form: formObject,
  revalidate: (_data, input) => refresh(input.employeeId),
  redirect: (_data, input) => safeReturn(input.returnTo, "/employees", `/employees/absences?month=${input.startDate.slice(0, 7)}`),
});

export const deleteAbsence = defineAction(deleteAbsenceOperation, {
  revalidate: ({ employeeId }) => refresh(employeeId),
  redirect: (_data, input) => safeReturn(input.returnTo, "/employees", "/employees/absences"),
  message: "common.deleted",
  redirectOnError: (formData) => safeReturn(String(formData.get("returnTo") ?? ""), "/employees", "/employees/absences"),
});

export const saveQualification = defineAction(saveQualificationOperation, { form: formObject, revalidate: (_data, input) => refresh(input.employeeId), message: "common.saved" });

export const deleteQualification = defineAction(deleteQualificationOperation, { revalidate: ({ employeeId }) => refresh(employeeId), message: "common.deleted" });

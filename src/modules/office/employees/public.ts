/**
 * Öffentliche Schnittstelle der Funktion office.employees. Andere Funktionen importieren NUR aus dieser Datei
 * (und nur, wenn sie die Funktion in `requires`/`uses` ihrer feature.ts deklariert haben).
 */
export { DEPARTMENTS, employeeName, visibleAbsenceType, workdaysBetween, workdaysWithin } from "./domain";
export { activeEmployees, staffWithAccount, userAbsentBetween, type EmployeeName } from "./queries";

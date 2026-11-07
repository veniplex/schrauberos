import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/server/auth/session";
import { absenceHintsFor } from "@/modules/office/employees/queries";
import { ABSENCE_TYPES } from "@/modules/office/employees/domain";
import { isCalendarDay } from "@/lib/dates";

/**
 * Hinweise für das Formular „Abwesenheit eintragen“ (P2b-2): Überschneidungen derselben Person mit dem geplanten Zeitraum und exakte Dublette. Verlangt `employees.edit`;
 * Krankheit bleibt ohne `employees.sensitive` maskiert (nur der Zeitraum, nie Art oder Anmerkung – siehe `absenceHintsFor`). Nur Lesen, ohne Seiteneffekt.
 */
const query = z.object({
  employeeId: z.string().min(1).max(64),
  type: z.enum(ABSENCE_TYPES),
  start: z.string().refine(isCalendarDay),
  end: z.string().refine(isCalendarDay),
  exclude: z.string().min(1).max(64).optional(),
});

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session || session.user.mustChangePassword || session.user.mustSetupTwoFactor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!session.features.has("office.employees") || !session.can("employees.edit")) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const parsed = query.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success || parsed.data.end < parsed.data.start) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const { employeeId, type, start, end, exclude } = parsed.data;
  // Eine Person ohne Krankheitsrecht trägt keine Krankheit ein; die Art bestimmt nur die Dublette
  if (type === "sick" && !session.can("employees.sensitive")) return NextResponse.json({ duplicate: false, overlaps: [] });
  return NextResponse.json(await absenceHintsFor(session, { employeeId, type, start, end, excludeId: exclude }));
}

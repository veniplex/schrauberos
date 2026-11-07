import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { isCalendarDay } from "@/lib/dates";
import { getSession } from "@/server/auth/session";
import { appointmentHintsFor } from "@/modules/workshop/appointments/queries";

/**
 * Hinweise für das Terminformular (P4b-1): Feiertag, Öffnungszeiten, Termin über Mitternacht, Abwesenheit und weitere Termine der zuständigen Person, Fahrzeug mit Termin am selben Tag.
 * Verlangt `appointments.create` oder `appointments.edit`. Nur Lesen, ohne Seiteneffekt. Abwesenheit kommt nur als „abwesend“, nie mit der Art (Krankheit bleibt unsichtbar).
 */
const query = z.object({
  date: z.string().refine(isCalendarDay),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  duration: z.coerce.number().int().min(5).max(720),
  assigneeId: z.string().max(64).optional(),
  vehicleId: z.string().max(64).optional(),
  id: z.string().max(64).optional(),
});

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session || session.user.mustChangePassword || session.user.mustSetupTwoFactor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!session.features.has("workshop.appointments") || !(session.can("appointments.create") || session.can("appointments.edit"))) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const parsed = query.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const hints = await appointmentHintsFor(session, parsed.data);
  if (!hints) return NextResponse.json({ error: "invalid" }, { status: 400 });
  return NextResponse.json({ hints });
}

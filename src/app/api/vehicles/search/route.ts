import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/server/db";
import { getSession } from "@/server/auth/session";
import { customerDisplayName } from "@/modules/workshop/customers/public";
import { vehicleTextWhere } from "@/modules/workshop/vehicles/queries";

const ALLOWED = ["appointments.create", "appointments.edit", "tires.create", "tires.edit", "vehicles.view"] as const;

/**
 * Fahrzeugsuche für die Auswahlfelder (Kennzeichen, Kundenname, Hersteller/Modell). Kunden erscheinen nur als Anzeigename
 * (Richtlinie D7): Kontaktdaten, Adresse und Notizen gibt es hier nicht – dafür braucht es `customers.view`.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session || session.user.mustChangePassword || session.user.mustSetupTwoFactor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!session.features.has("workshop.vehicles") || !ALLOWED.some((p) => session.can(p))) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const q = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 60);
  if (q.length < 1) return NextResponse.json({ results: [] });

  const vehicles = await db.vehicle.findMany({
    // archivierte Fahrzeuge sind nicht wählbar (P4b-2)
    where: { archivedAt: null, OR: vehicleTextWhere(q) },
    select: { id: true, plate: true, make: true, model: true, customer: { select: { firstName: true, lastName: true, company: true } } },
    orderBy: { plateNorm: "asc" },
    take: 8,
  });

  return NextResponse.json({
    results: vehicles.map((v) => {
      const description = [v.make, v.model].filter(Boolean).join(" ");
      const owner = v.customer ? customerDisplayName(v.customer) : "";
      return { id: v.id, label: v.plate, sublabel: [description, owner].filter(Boolean).join(" · "), plate: v.plate, description, customer: customerDisplayName(v.customer) };
    }),
  });
}

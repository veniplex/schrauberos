import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/server/db";
import { getSession } from "@/server/auth/session";
import { contains } from "@/server/search";
import { customerDisplayName } from "@/modules/workshop/customers/public";

const ALLOWED = ["customers.view", "customers.edit", "invoices.edit"] as const;

/** Kundensuche für Auswahlfelder (Name, Firma, Kundennummer, Ort). */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session || session.user.mustChangePassword) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!session.features.has("workshop.customers") || !ALLOWED.some((p) => session.can(p))) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const q = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 60);
  if (!q) return NextResponse.json({ results: [] });

  const customers = await db.customer.findMany({
    where: { OR: [{ lastName: contains(q) }, { firstName: contains(q) }, { company: contains(q) }, { customerNumber: contains(q) }, { city: contains(q) }] },
    orderBy: { lastName: "asc" },
    take: 8,
  });
  return NextResponse.json({
    results: customers.map((c) => ({
      id: c.id,
      label: customerDisplayName(c),
      sublabel: [c.customerNumber ? `#${c.customerNumber}` : "", c.city ?? ""].filter(Boolean).join(" · "),
    })),
  });
}

import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/server/db";
import { getSession } from "@/server/auth/session";
import { contains, keyContains } from "@/server/search";
import { customerDisplayName } from "@/modules/workshop/customers/public";

const ALLOWED = ["customers.view", "customers.edit", "invoices.edit"] as const;

/**
 * Kundensuche für Auswahlfelder (Name, Firma, Kundennummer). Der Anzeigename ist in jedem Auswahl-Kontext sichtbar (Richtlinie D7);
 * der Wohnort ist Adressdaten und wird nur mit `customers.view` durchsucht und angezeigt.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session || session.user.mustChangePassword || session.user.mustSetupTwoFactor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!session.features.has("workshop.customers") || !ALLOWED.some((p) => session.can(p))) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const q = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 60);
  if (!q) return NextResponse.json({ results: [] });

  const withAddress = session.can("customers.view");
  const customers = await db.customer.findMany({
    where: { OR: [keyContains("nameKey", q), { customerNumber: contains(q) }, ...(withAddress ? [keyContains("cityKey", q)] : [])] },
    select: { id: true, firstName: true, lastName: true, company: true, customerNumber: true, ...(withAddress ? { city: true } : {}) },
    orderBy: { lastName: "asc" },
    take: 8,
  });
  return NextResponse.json({
    results: customers.map((c) => ({
      id: c.id,
      label: customerDisplayName(c),
      sublabel: [c.customerNumber ? `#${c.customerNumber}` : "", "city" in c ? (c.city ?? "") : ""].filter(Boolean).join(" · "),
    })),
  });
}

import { NextResponse, type NextRequest } from "next/server";
import { getI18n } from "@/i18n/server";
import { INTL_LOCALE } from "@/i18n/config";
import { formatCents } from "@/lib/money";
import { getSession } from "@/server/auth/session";
import { deductionCandidates } from "@/modules/office/billing/queries";
import { unrestrictedCustomerWhere } from "@/modules/workshop/customers/public";
import { db } from "@/server/db";

export const dynamic = "force-dynamic";

/**
 * Anrechenbare Abschlagsrechnungen eines Kunden für das Formular einer Schlussrechnung (`?customer=<Kennung>`): festgeschriebene, nicht stornierte Abschläge des Kunden, die noch in keiner festgeschriebenen
 * Schlussrechnung angerechnet sind. Nur mit `billing.edit` (wer Belege bearbeitet) und nur für Kunden, die man neu verknüpfen darf (`unrestrictedCustomerWhere`: nicht eingeschränkt nach Art. 18).
 * Die Antwort trägt Kennung, Beschriftung (Nummer, Datum, Betrag) und – vorbelegt – „angerechnet“; keine Kundendaten.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session || session.user.mustChangePassword || session.user.mustSetupTwoFactor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!session.can("billing.edit")) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const customerId = (request.nextUrl.searchParams.get("customer") ?? "").slice(0, 64);
  if (!customerId) return NextResponse.json({ results: [] });
  const customer = await db.customer.findFirst({ where: { id: customerId, ...unrestrictedCustomerWhere }, select: { id: true } });
  if (!customer) return NextResponse.json({ results: [] });

  const { t, date, locale } = await getI18n();
  const rows = await deductionCandidates(customer.id);
  return NextResponse.json({
    results: rows.map((row) => ({ id: row.id, label: t("billing.deductions.line", { number: row.number, date: date(row.issueDate), amount: formatCents(row.grossCents, INTL_LOCALE[locale]) }), checked: true })),
  });
}

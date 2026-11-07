import { NextResponse, type NextRequest } from "next/server";
import { getI18n } from "@/i18n/server";
import { dayKey } from "@/lib/zone";
import { collectDisclosure, privacySubject } from "@/modules/privacy";
import { audit } from "@/server/audit";
import { getSession } from "@/server/auth/session";

export const dynamic = "force-dynamic";

const baseHeaders = { "cache-control": "no-store", "x-content-type-options": "nosniff" };

/**
 * Auskunft über einen Kunden als JSON-Datei (Art. 15 und 20 DSGVO): alle gespeicherten Daten aus allen aktiven Funktionen, samt Freitexten. Verlangt \`customers.disclose\` und \`customers.view\`
 * (gekennzeichnetes Recht, nie in einem Token oder einer Standardrolle). Die Antwort ist eine Datei zum Herunterladen (\`attachment\`, \`nosniff\`), nie zwischengespeichert; \`JSON.stringify\`
 * maskiert alle Freitexte. Das Audit-Log hält fest, wer wann Auskunft über welchen Kunden gezogen hat (nur die Kennung).
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.user.mustChangePassword || session.user.mustSetupTwoFactor) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: baseHeaders });
  if (!session.features.has("workshop.customers") || !session.can("customers.disclose") || !session.can("customers.view")) return NextResponse.json({ error: "forbidden" }, { status: 403, headers: baseHeaders });

  const { id } = await params;
  const subject = await privacySubject(id);
  if (!subject) return NextResponse.json({ error: "notFound" }, { status: 404, headers: baseHeaders });
  const [sections, { t }] = await Promise.all([collectDisclosure(subject), getI18n()]);

  const body = {
    customerId: subject.id,
    generatedAt: new Date().toISOString(),
    sections: sections.map((section) => ({
      id: section.id,
      title: t(section.title),
      records: section.records.map((record) => Object.fromEntries(record.map((f) => [f.key, { label: t(f.label), value: f.value }]))),
    })),
  };
  await audit("customer.disclose", { target: `${subject.id} (JSON)`, entityId: subject.id });
  return new Response(JSON.stringify(body, null, 2), {
    headers: { ...baseHeaders, "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="auskunft-${dayKey(new Date())}.json"` },
  });
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { getI18n } from "@/i18n/server";
import { toDateInput } from "@/lib/dates";
import { customerContacts, customerDisplayName, customerNameSelect } from "@/modules/workshop/customers/public";
import { centsToInput } from "@/lib/money";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { InvoiceForm } from "@/modules/office/invoices/invoice-form";
import { versionOf } from "@/lib/concurrency";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("invoices.edit") };
}

export default async function EditInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("invoices.edit");
  const [{ t }, { id }] = await Promise.all([getI18n(), params]);
  const [inv, cats] = await Promise.all([
    db.invoice.findUnique({ where: { id }, include: { customer: { select: customerNameSelect }, file: { select: { name: true, size: true } } } }),
    db.invoice.findMany({ where: { category: { not: null } }, select: { category: true }, distinct: ["category"], take: 100 }),
  ]);
  if (!inv) notFound();
  // Ort des Kunden nur mit `customers.view` (D7); sonst wird er gar nicht gelesen
  const customerCity = (await customerContacts(session, inv.customerId ? [inv.customerId] : [])).get(inv.customerId ?? "")?.city;
  const direction = inv.direction === "outgoing" ? "outgoing" : "incoming";

  return (
    <>
      <PageHeader breadcrumbs={[{ href: "/invoices", label: t("nav.invoices") }, { href: `/invoices/${inv.id}`, label: inv.number }]} help="office.invoices" title={t("invoices.edit")} description={<span className="font-mono">{inv.number}</span>} />
      <InvoiceForm
        canPickCustomer={session.features.has("workshop.customers")}
        cancelHref={`/invoices/${inv.id}`}
        categories={cats.map((c) => c.category!).sort()}
        initial={{
          id: inv.id,
          version: versionOf(inv),
          direction,
          number: inv.number,
          partyName: inv.partyName,
          customer: inv.customer ? { id: inv.customer.id, label: customerDisplayName(inv.customer), sublabel: customerCity ?? undefined } : null,
          issueDate: toDateInput(inv.issueDate),
          dueDate: inv.dueDate ? toDateInput(inv.dueDate) : "",
          net: centsToInput(inv.netCents),
          vat: centsToInput(inv.vatCents),
          gross: centsToInput(inv.grossCents),
          status: inv.status,
          paidAt: inv.paidAt ? toDateInput(inv.paidAt) : "",
          category: inv.category ?? "",
          reference: inv.reference ?? "",
          notes: inv.notes ?? "",
          file: inv.file,
        }}
      />
    </>
  );
}

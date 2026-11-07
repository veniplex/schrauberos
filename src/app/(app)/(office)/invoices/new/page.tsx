import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { getI18n } from "@/i18n/server";
import { todayInput } from "@/lib/dates";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { InvoiceForm } from "@/modules/office/invoices/invoice-form";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("invoices.new") };
}

export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<{ dir?: string }> }) {
  const session = await requirePermission("invoices.edit");
  const [{ t }, sp] = await Promise.all([getI18n(), searchParams]);
  const direction = sp.dir === "outgoing" ? "outgoing" : "incoming";
  const cats = await db.invoice.findMany({ where: { category: { not: null } }, select: { category: true }, distinct: ["category"], take: 100 });

  return (
    <>
      <PageHeader back={{ href: `/invoices?dir=${direction}`, label: t("nav.invoices") }} help="office.invoices" title={direction === "incoming" ? t("invoices.newIncoming") : t("invoices.newOutgoing")} />
      <InvoiceForm
        canPickCustomer={session.features.has("workshop.customers")}
        cancelHref={`/invoices?dir=${direction}`}
        categories={cats.map((c) => c.category!).sort()}
        initial={{
          direction, number: "", partyName: "", customer: null, issueDate: todayInput(), dueDate: "", net: "", vat: "", gross: "",
          status: "open", paidAt: "", category: "", reference: "", notes: "", file: null,
        }}
      />
    </>
  );
}

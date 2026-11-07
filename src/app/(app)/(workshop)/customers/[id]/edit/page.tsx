import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { getI18n } from "@/i18n/server";
import { customerDisplayName } from "@/modules/workshop/customers/domain";
import { getCustomerForEdit } from "@/modules/workshop/customers/queries";
import { requirePermission } from "@/server/auth/session";
import { CustomerForm } from "@/modules/workshop/customers/forms";
import { versionOf } from "@/lib/concurrency";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("customers.edit") };
}

export default async function EditCustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("customers.edit");
  const [{ t }, { id }] = await Promise.all([getI18n(), params]);
  const c = await getCustomerForEdit(session, id);
  if (!c) notFound();

  return (
    <>
      <PageHeader breadcrumbs={[{ href: "/customers", label: t("nav.customers") }, { href: `/customers/${c.id}`, label: customerDisplayName(c) }]} help="workshop.customers" title={t("customers.edit")} />
      <div className="flex max-w-3xl flex-col gap-4">
        <CustomerForm
          cancelHref={`/customers/${c.id}`}
          initial={{
            id: c.id,
            version: versionOf(c),
            customerNumber: c.customerNumber ?? "",
            firstName: c.firstName ?? "",
            lastName: c.company && c.lastName === c.company ? "" : c.lastName,
            company: c.company ?? "",
            email: c.email ?? "",
            phone: c.phone ?? "",
            street: c.street ?? "",
            zip: c.zip ?? "",
            city: c.city ?? "",
            notes: c.notes ?? "",
          }}
        />
      </div>
    </>
  );
}

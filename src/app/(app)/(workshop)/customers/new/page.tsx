import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { getI18n } from "@/i18n/server";
import { requirePermission } from "@/server/auth/session";
import { CustomerForm } from "@/modules/workshop/customers/forms";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("customers.new") };
}

export default async function NewCustomerPage() {
  await requirePermission("customers.edit");
  const { t } = await getI18n();
  return (
    <>
      <PageHeader back={{ href: "/customers", label: t("nav.customers") }} help="workshop.customers" title={t("customers.new")} />
      <div className="max-w-3xl">
        <CustomerForm
          cancelHref="/customers"
          initial={{ customerNumber: "", firstName: "", lastName: "", company: "", email: "", phone: "", street: "", zip: "", city: "", notes: "" }}
        />
      </div>
    </>
  );
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Alert, PageHeader } from "@/components/ui/layout";
import { getI18n } from "@/i18n/server";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { CustomerForm } from "@/modules/workshop/customers/forms";
import { versionOf } from "@/lib/concurrency";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("customers.edit") };
}

export default async function EditCustomerPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("customers.edit");
  const [{ t }, { id }] = await Promise.all([getI18n(), params]);
  const c = await db.customer.findUnique({ where: { id } });
  if (!c) notFound();

  return (
    <>
      <PageHeader title={t("customers.edit")} />
      <div className="flex max-w-3xl flex-col gap-4">
        {c.externalSource ? <Alert tone="warning">{t("customers.externalNotice", { source: c.externalSource === "werbas" ? "Werbas" : c.externalSource })}</Alert> : null}
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

import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { getI18n } from "@/i18n/server";
import { customerContacts, customerDisplayName, customerTitle } from "@/modules/workshop/customers/public";
import { requirePermission } from "@/server/auth/session";
import { VehicleForm } from "@/modules/workshop/vehicles/forms";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("vehicles.new") };
}

export default async function NewVehiclePage({ searchParams }: { searchParams: Promise<{ customer?: string; plate?: string }> }) {
  const session = await requirePermission("vehicles.edit");
  const [{ t }, sp] = await Promise.all([getI18n(), searchParams]);
  // Vorbelegter Halter: Name immer, Ort nur mit `customers.view` (D7)
  const customer = sp.customer ? await customerTitle(sp.customer) : null;
  const city = customer ? (await customerContacts(session, [customer.id])).get(customer.id)?.city : undefined;

  return (
    <>
      <PageHeader back={{ href: "/vehicles", label: t("nav.vehicles") }} help="workshop.vehicles" title={t("vehicles.new")} />
      <div className="max-w-2xl">
        <VehicleForm
          cancelHref={customer ? `/customers/${customer.id}` : "/vehicles"}
          initial={{
            customer: customer ? { id: customer.id, label: customerDisplayName(customer), sublabel: city ?? undefined } : null,
            plate: (sp.plate ?? "").trim().slice(0, 14), make: "", model: "", vin: "", year: "", notes: "",
            mileage: "", fuel: "", hsn: "", tsn: "", firstRegistration: "", inspectionDue: "", extraKind: "", extraDue: "",
          }}
        />
      </div>
    </>
  );
}

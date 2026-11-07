import type { Metadata } from "next";
import { Alert } from "@/components/ui/layout";
import { PageHeader } from "@/components/ui/page-header";
import { getI18n } from "@/i18n/server";
import { StartForm } from "@/modules/workshop/checklists/start-form";
import { listTemplates } from "@/modules/workshop/checklists/queries";
import { canSeeOrders, canSeeVehicles } from "@/modules/workshop/checklists/access";
import { customerNameSelect } from "@/modules/workshop/customers/public";
import { orderRef } from "@/modules/workshop/orders/public";
import { toVehicleOption } from "@/modules/workshop/vehicles/public";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("checklists.new.title") };
}

/**
 * Checkliste beginnen. Vorbelegt aus dem Auftrag (`?order=`, das Fahrzeug ergibt sich daraus) oder dem Fahrzeug (`?vehicle=`); `?template=` wählt die Vorlage vor. Nur Fahrzeuge, die die Person sehen darf und die
 * nicht archiviert sind (das Auswahlfeld blendet Archiviertes aus), und nur offene Aufträge.
 */
export default async function NewChecklistPage({ searchParams }: { searchParams: Promise<{ vehicle?: string; order?: string; template?: string }> }) {
  const session = await requirePermission("checklists.fill");
  const [{ t }, sp] = await Promise.all([getI18n(), searchParams]);
  const templates = await listTemplates(session);

  const ref = sp.order && canSeeOrders(session) ? await orderRef(sp.order) : null;
  const order = ref && ref.open && !ref.restricted ? { id: ref.id, number: ref.number, plate: ref.plate } : null;
  const vehicleId = !order && sp.vehicle && canSeeVehicles(session) ? sp.vehicle : null;
  const vehicle = vehicleId
    ? await db.vehicle.findFirst({ where: { id: vehicleId, archivedAt: null, OR: [{ customerId: null }, { customer: { is: { processingRestrictedAt: null } } }] }, select: { id: true, plate: true, make: true, model: true, customer: { select: customerNameSelect } } })
    : null;

  return (
    <>
      <PageHeader back={{ href: "/checklists", label: t("nav.checklists") }} help="workshop.checklists" title={t("checklists.new.title")} description={order ? t("checklists.new.forOrder", { number: order.number, plate: order.plate }) : t("checklists.new.description")} />
      {templates.length === 0 ? (
        <Alert tone="info">{t("checklists.new.noTemplates")}</Alert>
      ) : (
        <StartForm
          templates={templates.map((tpl) => ({ id: tpl.id, name: tpl.name }))}
          selectedTemplate={sp.template && templates.some((tpl) => tpl.id === sp.template) ? sp.template : undefined}
          order={order}
          vehicle={vehicle ? toVehicleOption(vehicle) : null}
          canCreateVehicle={session.can("vehicles.edit")}
        />
      )}
    </>
  );
}

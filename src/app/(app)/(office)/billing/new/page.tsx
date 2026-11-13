import type { Metadata } from "next";
import { SubmitButton } from "@/components/ui/buttons";
import { Checkbox } from "@/components/ui/form";
import { Alert, Card, ChipLink } from "@/components/ui/layout";
import { PageHeader } from "@/components/ui/page-header";
import { getI18n } from "@/i18n/server";
import { INTL_LOCALE } from "@/i18n/config";
import { formatCents } from "@/lib/money";
import { invoiceFromOrder } from "@/modules/office/billing/actions";
import { CREATABLE_TYPES } from "@/modules/office/billing/constants";
import { DocumentForm, type DeductionCandidate } from "@/modules/office/billing/document-form";
import { deductionCandidates, documentsOfOrder } from "@/modules/office/billing/queries";
import { PageSections } from "@/modules/page-sections";
import { customerForDocument } from "@/modules/workshop/customers/public";
import { orderRef } from "@/modules/workshop/orders/public";
import { VehiclePicker } from "@/modules/workshop/vehicles/public";
import { requirePermission } from "@/server/auth/session";
import { getWorkshop } from "@/server/workshop";

/** Der Titel der Registerkarte folgt der Überschrift: „Rechnung aus Auftrag“ bei `?order=`, sonst „Neuer Beleg“ (Z6-5 N4). */
export async function generateMetadata({ searchParams }: { searchParams: Promise<{ order?: string }> }): Promise<Metadata> {
  const [{ t }, sp] = await Promise.all([getI18n(), searchParams]);
  return { title: sp.order ? t("billing.fromOrder.title") : t("billing.new.title") };
}

const TYPES = CREATABLE_TYPES.filter((type) => type !== "confirmation");

/**
 * Neuer Beleg. `?type=` wählt die Belegart (Angebot, Rechnung, Abschlags-, Schlussrechnung), `?customer=` belegt den Empfänger vor; `?order=` bietet „Rechnung aus Auftrag“ an (mit den Rückfragen
 * zu einem offenen oder schon abgerechneten Auftrag). Eine Auftragsbestätigung entsteht nur aus einem angenommenen Angebot, nie hier.
 */
export default async function NewBillingPage({ searchParams }: { searchParams: Promise<{ type?: string; customer?: string; order?: string }> }) {
  const session = await requirePermission("billing.edit");
  const [i18n, sp] = await Promise.all([getI18n(), searchParams]);
  const { t, td, locale } = i18n;

  if (sp.order) return <FromOrder session={session} orderId={sp.order} />;

  const type = (TYPES as readonly string[]).includes(sp.type ?? "") ? (sp.type as string) : "offer";
  const workshop = await getWorkshop();
  const canPickCustomer = session.features.has("workshop.customers");
  const customer = canPickCustomer && sp.customer ? await customerForDocument(sp.customer) : null;
  const candidates: DeductionCandidate[] = type === "final" ? (await deductionCandidates(customer?.id ?? null)).map((c) => ({ id: c.id, label: t("billing.deductions.line", { number: c.number, date: i18n.date(c.issueDate), amount: formatCents(c.grossCents, INTL_LOCALE[locale]) }), checked: true })) : [];

  return (
    <>
      <PageHeader back={{ href: "/billing", label: t("nav.billing") }} help="office.billing" title={td(`billing.new.${type}`, t("billing.new.title"))} description={t("billing.new.description")} />
      <nav aria-label={t("billing.new.typeLabel")} className="mb-5 flex flex-wrap gap-2">
        {TYPES.map((value) => (
          <ChipLink key={value} href={`/billing/new?type=${value}${customer ? `&customer=${customer.id}` : ""}`} active={type === value}>
            {td(`billing.types.${value}`, value)}
          </ChipLink>
        ))}
      </nav>
      <DocumentForm
        key={`${type}:${customer?.id ?? ""}`}
        initial={{
          docType: type,
          customer: customer ? { id: customer.id, label: customer.name, sublabel: customer.customerNumber ? `#${customer.customerNumber}` : undefined } : null,
          partyName: customer?.name ?? "",
          partyStreet: customer?.street ?? "",
          partyZip: customer?.zip ?? "",
          partyCity: customer?.city ?? "",
          buyerEmail: customer?.email ?? "",
          introText: "",
          footerText: "",
          serviceFrom: "",
          serviceTo: "",
          validUntil: "",
          paymentDays: String(workshop.paymentTermDays),
          paymentMethod: "transfer",
          buyerReference: "",
          taxNote: "",
          mileageKm: "",
          items: [],
        }}
        exempt={workshop.smallBusiness}
        canPickCustomer={canPickCustomer}
        vehicleField={session.features.has("workshop.vehicles") ? <VehiclePicker initial={null} canCreate={session.can("vehicles.edit")} /> : null}
        candidates={candidates}
        tools={<PageSections session={session} host="billing/items" entityId="new" />}
        cancelHref="/billing"
      />
    </>
  );
}

/** „Rechnung aus Auftrag“: Rückfragen und der Knopf, der den Entwurf anlegt. */
async function FromOrder({ session, orderId }: { session: Awaited<ReturnType<typeof requirePermission>>; orderId: string }) {
  const { t } = await getI18n();
  const allowed = session.features.has("workshop.orders") && session.can("orders.view") && session.can("orders.prices");
  const ref = allowed ? await orderRef(orderId) : null;
  const existing = ref ? (await documentsOfOrder(orderId)).filter((d) => (d.docType === "invoice" || d.docType === "final") && d.status !== "cancelled") : [];
  return (
    <>
      <PageHeader back={{ href: "/billing", label: t("nav.billing") }} help="office.billing" title={t("billing.fromOrder.title")} />
      {!allowed ? (
        <Alert tone="warning">{t("billing.fromOrder.noPermission")}</Alert>
      ) : !ref ? (
        <Alert tone="warning">{t("billing.fromOrder.noOrder")}</Alert>
      ) : ref.status === "cancelled" ? (
        <Alert tone="warning">{t("billing.errors.orderCancelled")}</Alert>
      ) : ref.restricted ? (
        <Alert tone="warning">{t("billing.errors.restricted")}</Alert>
      ) : (
        <Card title={ref.number}>
          <form action={invoiceFromOrder} className="flex max-w-xl flex-col gap-4">
            <input type="hidden" name="orderId" value={ref.id} />
            <p className="text-sm">{t("billing.fromOrder.intro", { number: ref.number })}</p>
            {ref.open ? (
              <Alert tone="warning">
                {t("billing.fromOrder.open")}
                <Checkbox name="confirmOpen" label={t("billing.fromOrder.openConfirm")} className="mt-2" />
              </Alert>
            ) : null}
            {existing.length > 0 ? (
              <Alert tone="warning">
                {t("billing.fromOrder.duplicate")}
                <Checkbox name="acknowledgeDuplicate" label={t("billing.fromOrder.duplicateConfirm")} className="mt-2" />
              </Alert>
            ) : null}
            <div>
              <SubmitButton variant="primary">{t("billing.fromOrder.create")}</SubmitButton>
            </div>
          </form>
        </Card>
      )}
    </>
  );
}

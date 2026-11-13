import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { getI18n } from "@/i18n/server";
import { INTL_LOCALE } from "@/i18n/config";
import { versionOf } from "@/lib/concurrency";
import { toDateInput } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { DocumentForm, type DeductionCandidate } from "@/modules/office/billing/document-form";
import { isDraft } from "@/modules/office/billing/domain";
import { billingReadAccess, deductionCandidates } from "@/modules/office/billing/queries";
import { PageSections } from "@/modules/page-sections";
import { customerDisplayName, customerNameSelect } from "@/modules/workshop/customers/public";
import { toVehicleOption, VehiclePicker } from "@/modules/workshop/vehicles/public";
import { requirePermission, sessionIfAllowed } from "@/server/auth/session";
import { db } from "@/server/db";
import { getWorkshop } from "@/server/workshop";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const { t } = await getI18n();
  const session = await sessionIfAllowed("billing.edit");
  if (!session) return {};
  const doc = await db.invoice.findFirst({ where: { id, source: "billing" }, select: { partyName: true, customerId: true, finalizedAt: true, docType: true } });
  // Art. 18: derselbe Zugang wie die Detailseite – bei eingeschränkten Kunden kein Titel mit Namen (nicht lesbar, oder ohne `customers.view`)
  if (!doc) return { title: t("billing.edit") };
  const access = await billingReadAccess(session, doc);
  return { title: access.allowed && (!access.restricted || session.can("customers.view")) ? `${t("billing.edit")} · ${doc.partyName}` : t("billing.edit") };
}

/** Entwurf bearbeiten. Festgeschriebene Belege sind unveränderlich: die Seite leitet auf die Ansicht um. */
export default async function EditBillingPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("billing.edit");
  const [{ id }, i18n] = await Promise.all([params, getI18n()]);
  const { t, date, locale } = i18n;
  const doc = await db.invoice.findFirst({ where: { id, source: "billing" }, include: { items: { orderBy: { position: "asc" } }, deductions: { select: { partialId: true } }, customer: { select: customerNameSelect } } });
  if (!doc) notFound();
  // Art. 18: Entwürfe und Angebote eingeschränkter Kunden sind nicht lesbar (also auch nicht zu bearbeiten) – dieselbe zentrale Prüfung wie Detailseite, PDF und XRechnung
  const access = await billingReadAccess(session, doc);
  if (!access.allowed) notFound();
  if (!isDraft(doc)) redirect(`/billing/${doc.id}`);
  const workshop = await getWorkshop();
  const vehicle = doc.vehicleId && session.features.has("workshop.vehicles") ? await db.vehicle.findUnique({ where: { id: doc.vehicleId }, select: { id: true, plate: true, make: true, model: true, customer: { select: customerNameSelect } } }) : null;
  const selected = new Set(doc.deductions.map((d) => d.partialId));
  const candidates: DeductionCandidate[] =
    doc.docType === "final"
      ? (await deductionCandidates(doc.customerId)).map((c) => ({ id: c.id, label: t("billing.deductions.line", { number: c.number, date: date(c.issueDate), amount: formatCents(c.grossCents, INTL_LOCALE[locale]) }), checked: selected.has(c.id) }))
      : [];
  const day = (d: Date | null) => (d ? toDateInput(d) : "");

  return (
    <>
      <PageHeader back={{ href: `/billing/${doc.id}`, label: doc.partyName }} help="office.billing" title={t("billing.edit")} description={t(`billing.types.${doc.docType as "offer"}`)} />
      <DocumentForm
        initial={{
          id: doc.id,
          version: versionOf(doc),
          docType: doc.docType,
          customer: doc.customer && doc.customerId ? { id: doc.customerId, label: customerDisplayName(doc.customer) } : null,
          partyName: doc.partyName,
          partyStreet: doc.partyStreet ?? "",
          partyZip: doc.partyZip ?? "",
          partyCity: doc.partyCity ?? "",
          buyerEmail: doc.buyerEmail ?? "",
          introText: doc.introText ?? "",
          footerText: doc.footerText ?? "",
          serviceFrom: day(doc.serviceFrom),
          serviceTo: day(doc.serviceTo),
          validUntil: day(doc.validUntil),
          paymentDays: doc.paymentDays == null ? "" : String(doc.paymentDays),
          paymentMethod: doc.paymentMethod ?? "transfer",
          buyerReference: doc.buyerReference ?? "",
          taxNote: doc.taxNote ?? "",
          mileageKm: doc.mileageKm == null ? "" : String(doc.mileageKm),
          items: doc.items,
        }}
        exempt={workshop.smallBusiness}
        canPickCustomer={session.features.has("workshop.customers")}
        vehicleField={session.features.has("workshop.vehicles") ? <VehiclePicker initial={vehicle ? toVehicleOption(vehicle) : null} canCreate={session.can("vehicles.edit")} /> : null}
        candidates={candidates}
        tools={<PageSections session={session} host="billing/items" entityId={doc.id} />}
        cancelHref={`/billing/${doc.id}`}
      />
    </>
  );
}

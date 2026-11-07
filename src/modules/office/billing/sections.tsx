import { LinkButton } from "@/components/ui/buttons";
import { Alert, Card, StatusBadge, TextLink } from "@/components/ui/layout";
import { getI18n } from "@/i18n/server";
import { INTL_LOCALE } from "@/i18n/config";
import { formatCents } from "@/lib/money";
import type { SectionDef, SectionProps } from "@/modules/types";
import { orderRef } from "@/modules/workshop/orders/public";
import { db } from "@/server/db";
import { documentsOfOrder } from "./queries";

/**
 * Beitrag zur Rechnungsseite des Archivs: Ein Beleg der Rechnungserstellung (Positionen, Schnappschuss, Zahlungen) wird dort geöffnet – das Archiv zeigt ihn nur an und storniert ihn.
 * Von Hand erfasste Rechnungen bekommen keinen Abschnitt.
 */
async function ArchiveLink({ entityId, session }: SectionProps) {
  const row = await db.invoice.findFirst({ where: { id: entityId, source: "billing" }, select: { id: true, docType: true } });
  if (!row) return null;
  const { t } = await getI18n();
  return (
    <Card title={t("billing.invoiceSection.title")}>
      <p className="mb-3 text-sm text-ink-muted">{t("billing.invoiceSection.hint")}</p>
      <LinkButton href={`/billing/${row.id}`} variant="secondary" size="sm">
        {t("billing.invoiceSection.open")}
      </LinkButton>
      {session.can("invoices.edit") ? <p className="mt-3 text-xs text-ink-muted">{t("billing.invoiceSection.payments")}</p> : null}
    </Card>
  );
}

/**
 * Beitrag zur Auftragsseite: Belege zu diesem Auftrag und „Rechnung aus Auftrag“ (mit `billing.edit` und – für die Preise – `orders.prices`). Der Auftrag kennt die Rechnungserstellung nicht;
 * sie hängt sich über den Erweiterungspunkt ein. Bei Kunden mit eingeschränkter Verarbeitung (Art. 18) erscheint nichts.
 */
async function OrderBilling({ entityId, session }: SectionProps) {
  const [{ t, td, locale }, ref, docs] = await Promise.all([getI18n(), orderRef(entityId), documentsOfOrder(entityId)]);
  if (!ref || ref.restricted || (ref.status === "cancelled" && docs.length === 0)) return null;
  const canCreate = ref.status !== "cancelled" && session.can("billing.edit") && session.can("orders.prices");
  if (docs.length === 0 && !canCreate) return null;
  const eur = (cents: number) => formatCents(cents, INTL_LOCALE[locale]);
  // Ruhiger Hinweis (keine Sperre): Eine festgeschriebene Rechnung bleibt bestehen, auch wenn der Auftrag danach wieder geöffnet oder storniert wird – sie folgt dem Auftrag nicht
  const issued = docs.filter((d) => d.finalizedAt && ["invoice", "partial", "final"].includes(d.docType) && d.status !== "cancelled");
  return (
    <Card title={t("billing.orderSection.title")}>
      {issued.length > 0 ? (
        <Alert tone="info" className="mb-3">
          {t("billing.orderSection.issuedHint", { numbers: issued.map((d) => d.number).join(", ") })}
        </Alert>
      ) : null}
      {docs.length === 0 ? (
        <p className="text-sm text-ink-muted">{t("billing.orderSection.none")}</p>
      ) : (
        <ul className="mb-3 flex flex-col divide-y divide-line text-sm">
          {docs.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2 first:pt-0 last:pb-0">
              <span>
                <TextLink href={`/billing/${d.id}`}>
                  {td(`billing.types.${d.docType}`, d.docType)} {d.number || t("billing.draftNumber")}
                </TextLink>
              </span>
              <span className="flex items-center gap-2">
                <span className="tabular">{eur(d.grossCents)}</span>
                {d.finalizedAt ? null : <StatusBadge tone="neutral">{t("billing.status.draft")}</StatusBadge>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {canCreate ? (
        <LinkButton href={`/billing/new?order=${ref.id}`} variant="secondary" size="sm">
          {t("billing.orderSection.create")}
        </LinkButton>
      ) : null}
    </Card>
  );
}

/**
 * Beitrag zur Kundenseite (`customers/detail`): neues Angebot bzw. neue Rechnung für diesen Kunden (der Empfänger ist vorbelegt, bei einer Schlussrechnung stehen seine Abschläge zur Wahl). Die Kundenseite
 * zeigt den Abschnitt nicht für archivierte, eingeschränkte (Art. 18) und anonymisierte Kunden – für sie gibt es keine neuen Belege.
 */
async function CustomerBilling({ entityId }: SectionProps) {
  const { t } = await getI18n();
  return (
    <Card title={t("billing.customerSection.title")}>
      <div className="flex flex-wrap gap-2">
        <LinkButton href={`/billing/new?type=offer&customer=${entityId}`} variant="secondary" size="sm">
          {t("billing.quick.newOffer")}
        </LinkButton>
        <LinkButton href={`/billing/new?type=invoice&customer=${entityId}`} variant="secondary" size="sm">
          {t("billing.quick.newInvoice")}
        </LinkButton>
      </div>
    </Card>
  );
}

export const sections: SectionDef[] = [
  { id: "billing-customer", feature: "office.billing", host: "customers/detail", permission: "billing.edit", order: 50, uses: ["workshop.customers"], Component: CustomerBilling },
  { id: "billing-archive", feature: "office.billing", host: "invoices/detail", permission: "billing.view", order: 10, Component: ArchiveLink },
  { id: "billing-order", feature: "office.billing", host: "orders/detail", permission: "billing.view", order: 60, uses: ["workshop.orders"], Component: OrderBilling },
];

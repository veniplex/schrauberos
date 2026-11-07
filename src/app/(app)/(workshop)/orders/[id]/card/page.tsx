import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Alert, Card, Plate, TextLink } from "@/components/ui/layout";
import { LinkButton } from "@/components/ui/buttons";
import { PageHeader } from "@/components/ui/page-header";
import { PdfPreview } from "@/components/ui/pdf-preview";
import { PrintCard } from "@/components/ui/print-card";
import { PrintLayout } from "@/components/ui/print-layout";
import { getI18n } from "@/i18n/server";
import { parseCardSize } from "@/lib/print-card";
import { printNotesFor } from "@/modules/registry";
import { orderCardModel } from "@/modules/workshop/orders/card";
import { orderCardData } from "@/modules/workshop/orders/queries";
import { requirePermission, sessionIfAllowed } from "@/server/auth/session";
import { getPublicUrl } from "@/server/public-url";
import { getWorkshop } from "@/server/workshop";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const [{ id }, { t }] = await Promise.all([params, getI18n()]);
  const session = await sessionIfAllowed("orders.view");
  const data = session ? await orderCardData(session, id) : null;
  return { title: data ? `${data.number} · ${t("orders.card.pageTitle")}` : t("orders.card.pageTitle") };
}

/**
 * Auftragskarte (F8): Werkstattlaufzettel **ohne Preise** als PDF (Öffnen/Teilen/Herunterladen) und als Druckansicht über den Druckdialog – A4 oder A5. Auftrag, Fahrzeug, Kunde (Anzeigename; Telefon nur mit
 * `customers.view`), Kundenwunsch, Positionen, Stand des Annahmeprotokolls (Beitrag der Checklisten über die Registry) und Platz für Notizen; der QR-Code öffnet den Auftrag. Aufträge eingeschränkt
 * verarbeiteter Kunden gibt es nicht (404).
 */
export default async function OrderCardPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ size?: string }> }) {
  const session = await requirePermission("orders.view");
  const [{ id }, sp, i18n] = await Promise.all([params, searchParams, getI18n()]);
  const data = await orderCardData(session, id);
  if (!data) notFound();
  const { t } = i18n;
  const size = parseCardSize(sp.size, ["a4", "a5"], "a4");
  const [workshop, base, extras] = await Promise.all([getWorkshop(), getPublicUrl(), printNotesFor(session, "orders/card", data.id, i18n)]);
  const model = orderCardModel(data, { i18n, workshop, base, extras });
  const pdfSrc = `/api/orders/${encodeURIComponent(id)}/card?size=${size}`;

  return (
    <>
      <div className="no-print">
        <PageHeader
          back={{ href: `/orders/${id}`, label: data.number }}
          help="workshop.orders"
          title={
            <span className="flex flex-wrap items-center gap-3">
              <Plate>{data.plate}</Plate>
              <span>{t("orders.card.pageTitle")}</span>
            </span>
          }
          description={t("orders.card.description")}
        />
        {base ? null : (
          <Alert tone="warning" className="mb-5">
            {t("orders.card.noQr")} {session.can("settings.manage") ? <TextLink href="/settings?tab=security">{t("orders.card.setAddress")}</TextLink> : t("orders.card.askAdmin")}
          </Alert>
        )}
        <Alert tone="info" className="mb-5">
          {t("orders.card.noPrices")}
        </Alert>
        <Card title={t("orders.card.pdfTitle")} padded={false} className="mb-5">
          <PdfPreview src={pdfSrc} title={model.documentTitle} fileName={`auftragskarte-${data.number}`} labels={{ show: t("ui.pdf.showPreview"), hide: t("ui.pdf.hidePreview"), mobile: t("ui.pdf.previewDesktopOnly") }} />
        </Card>
        <h2 className="mb-2 text-sm font-semibold text-ink-muted">{t("orders.card.previewTitle")}</h2>
      </div>
      <PrintLayout
        size={size}
        toolbar={(["a4", "a5"] as const).map((s) => (
          <LinkButton key={s} href={`/orders/${id}/card?size=${s}`} variant={s === size ? "primary" : "secondary"} aria-current={s === size ? "true" : undefined}>
            {t(`orders.card.sizes.${s}`)}
          </LinkButton>
        ))}
      >
        <Card className="print:border-0 print:p-0 print:shadow-none">
          <PrintCard model={model} qrLabel={t("ui.print.labelQr")} />
        </Card>
      </PrintLayout>
    </>
  );
}

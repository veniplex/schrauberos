import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LabelOptions } from "@/components/ui/label-options";
import { Alert, Card, Plate, TextLink } from "@/components/ui/layout";
import { PageHeader } from "@/components/ui/page-header";
import { PdfPreview } from "@/components/ui/pdf-preview";
import { PrintButton } from "@/components/ui/print-layout";
import { PrintLabels } from "@/components/ui/print-label";
import { getI18n } from "@/i18n/server";
import { MAX_LABEL_COPIES, labelsPerPage, parseClampedInt, parseLabelFormat } from "@/lib/labels";
import { tireLabelContent } from "@/modules/workshop/tires/label";
import { tireLabelData } from "@/modules/workshop/tires/queries";
import { requirePermission, sessionIfAllowed } from "@/server/auth/session";
import { getPublicUrl } from "@/server/public-url";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const [{ id }, { t }] = await Promise.all([params, getI18n()]);
  const session = await sessionIfAllowed("tires.view");
  const data = session ? await tireLabelData(session, id) : null;
  return { title: data ? `${data.plate} · ${t("tires.label.title")}` : t("tires.label.title") };
}

/**
 * Etikett eines Reifensatzes (F8): Auswahl von Format und Anzahl, **PDF** (Öffnen/Teilen/Herunterladen – der verlässliche Weg zum Etikettendrucker) und die **Druckansicht** über den Druckdialog des
 * Browsers. Den QR-Code (Link zur Seite des Satzes) zeichnet die Seite aus der Einstellung „Adresse der Anwendung“; ohne sie steht ein Hinweis da und das Etikett kommt ohne QR-Code.
 * Sätze von Fahrzeugen eingeschränkt verarbeiteter Kunden gibt es nicht (404).
 */
export default async function TireLabelPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ format?: string; copies?: string; skip?: string }> }) {
  const session = await requirePermission("tires.view");
  const [{ id }, sp, i18n] = await Promise.all([params, searchParams, getI18n()]);
  const data = await tireLabelData(session, id);
  if (!data) notFound();
  const { t } = i18n;

  const format = parseLabelFormat(sp.format);
  const copiesAsked = parseClampedInt(sp.copies, 1, MAX_LABEL_COPIES, 1);
  const skipAsked = parseClampedInt(sp.skip, 0, labelsPerPage("sheet-3x8") - 1, 0);
  const copies = copiesAsked.value;
  const skip = skipAsked.value;
  const base = await getPublicUrl();
  const content = tireLabelContent(data, i18n, base);
  const pdfSrc = `/api/tires/${encodeURIComponent(id)}/label?format=${format}&copies=${copies}&skip=${skip}`;

  return (
    <>
      <div className="no-print">
        <PageHeader
          back={{ href: `/tires/${id}`, label: data.plate }}
          help="workshop.tires"
          title={
            <span className="flex flex-wrap items-center gap-3">
              <Plate>{data.plate}</Plate>
              <span>{t("tires.label.title")}</span>
            </span>
          }
          description={t("tires.label.description")}
          actions={<PrintButton />}
        />
        {base ? null : (
          <Alert tone="warning" className="mb-5">
            {t("tires.label.noQr")}{" "}
            {session.can("settings.manage") ? <TextLink href="/settings?tab=security" className="inline! min-h-0! min-w-0!">{t("tires.label.setAddress")}</TextLink> : t("tires.label.askAdmin")}
          </Alert>
        )}
        {copiesAsked.clamped ? (
          <Alert tone="warning" className="mb-5">
            {t("tires.label.copiesClamped", { asked: String(copiesAsked.asked), max: String(MAX_LABEL_COPIES) })}
          </Alert>
        ) : null}
        {skipAsked.clamped && format === "sheet-3x8" ? (
          <Alert tone="warning" className="mb-5">
            {t("tires.label.skipClamped", { asked: String(skipAsked.asked), max: String(labelsPerPage("sheet-3x8") - 1) })}
          </Alert>
        ) : null}
        <div className="mb-5">
          <LabelOptions format={format} copies={copies} skip={skip} copiesHint={t("tires.label.copiesHint")} />
        </div>
        <Card title={t("tires.label.pdfTitle")} padded={false} className="mb-5">
          <PdfPreview src={pdfSrc} title={t("tires.label.documentTitle", { plate: data.plate })} fileName={t("tires.label.fileName", { plate: data.plate })} labels={{ show: t("ui.pdf.showPreview"), hide: t("ui.pdf.hidePreview"), mobile: t("ui.pdf.previewDesktopOnly") }} />
        </Card>
        <h2 className="mb-2 text-sm font-semibold text-ink-muted">{t("tires.label.previewTitle")}</h2>
        <p className="mb-3 text-sm text-ink-muted">{t("tires.label.printHint")}</p>
      </div>
      <PrintLabels format={format} labels={Array.from({ length: copies }, () => content)} skip={skip} qrLabel={t("ui.print.labelQr")} />
    </>
  );
}

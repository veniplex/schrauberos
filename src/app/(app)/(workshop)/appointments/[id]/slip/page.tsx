import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Button, LinkButton } from "@/components/ui/buttons";
import { Checkbox, Field, Select } from "@/components/ui/form";
import { Card, Plate } from "@/components/ui/layout";
import { PageHeader } from "@/components/ui/page-header";
import { PdfPreview } from "@/components/ui/pdf-preview";
import { PrintCard } from "@/components/ui/print-card";
import { PrintLayout } from "@/components/ui/print-layout";
import { getI18n } from "@/i18n/server";
import { parseCardSize } from "@/lib/print-card";
import { appointmentSlipData } from "@/modules/workshop/appointments/queries";
import { appointmentSlipModel } from "@/modules/workshop/appointments/slip";
import { requirePermission, sessionIfAllowed } from "@/server/auth/session";
import { getWorkshop } from "@/server/workshop";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const [{ id }, { t }] = await Promise.all([params, getI18n()]);
  const session = await sessionIfAllowed("appointments.view");
  const data = session ? await appointmentSlipData(session, id) : null;
  return { title: data ? `${data.title} · ${t("appointments.slip.pageTitle")}` : t("appointments.slip.pageTitle") };
}

/**
 * Terminzettel (F8): Datum, Uhrzeit, Anliegen, Fahrzeug, Kunde (Anzeigename; Telefon nur mit `customers.view`) und Reifensatz – als PDF (Öffnen/Teilen/Herunterladen) und als Druckansicht, A5 oder A6.
 * Die Notizen des Termins sind für die Werkstatt geschrieben und kommen nur auf ausdrücklichen Wunsch aufs Papier. Termine eingeschränkt verarbeiteter Kunden gibt es nicht (404).
 */
export default async function AppointmentSlipPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ size?: string; notes?: string }> }) {
  const session = await requirePermission("appointments.view");
  const [{ id }, sp, i18n] = await Promise.all([params, searchParams, getI18n()]);
  const withNotes = sp.notes === "1";
  const data = await appointmentSlipData(session, id, { withNotes });
  if (!data) notFound();
  const { t } = i18n;
  const size = parseCardSize(sp.size, ["a5", "a6"], "a5");
  const workshop = await getWorkshop();
  const model = appointmentSlipModel(data, { i18n, workshop, withNotes });
  const pdfSrc = `/api/appointments/${encodeURIComponent(id)}/slip?size=${size}${withNotes ? "&notes=1" : ""}`;

  return (
    <>
      <div className="no-print">
        <PageHeader
          back={{ href: "/appointments", label: t("nav.appointments") }}
          help="workshop.appointments"
          title={
            <span className="flex flex-wrap items-center gap-3">
              {data.plate ? <Plate>{data.plate}</Plate> : null}
              <span>{t("appointments.slip.pageTitle")}</span>
            </span>
          }
          description={t("appointments.slip.description")}
        />
        <Card className="mb-5">
          <form method="get" className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] sm:items-start">
            <Field label={t("appointments.slip.paper")} htmlFor="slip-size">
              <Select id="slip-size" name="size" defaultValue={size}>
                {(["a5", "a6"] as const).map((s) => (
                  <option key={s} value={s}>
                    {t(`appointments.slip.sizes.${s}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Checkbox name="notes" value="1" defaultChecked={withNotes} label={t("appointments.slip.withNotes")} hint={t("appointments.slip.withNotesHint")} />
            <Button type="submit" variant="secondary" className="sm:mt-6">
              {t("ui.print.apply")}
            </Button>
          </form>
        </Card>
        <Card title={t("appointments.slip.pdfTitle")} padded={false} className="mb-5">
          <PdfPreview src={pdfSrc} title={model.documentTitle} fileName={`terminzettel-${data.plate ?? id}`} labels={{ show: t("ui.pdf.showPreview"), hide: t("ui.pdf.hidePreview"), mobile: t("ui.pdf.previewDesktopOnly") }} />
        </Card>
        <h2 className="mb-2 text-sm font-semibold text-ink-muted">{t("appointments.slip.previewTitle")}</h2>
      </div>
      <PrintLayout
        size={size}
        toolbar={(["a5", "a6"] as const).map((s) => (
          <LinkButton key={s} href={`/appointments/${id}/slip?size=${s}${withNotes ? "&notes=1" : ""}`} variant={s === size ? "primary" : "secondary"} aria-current={s === size ? "true" : undefined}>
            {t(`appointments.slip.sizes.${s}`)}
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

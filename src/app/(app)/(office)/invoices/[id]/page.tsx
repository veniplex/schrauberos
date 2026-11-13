import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Download, ExternalLink, Lock, Pencil } from "lucide-react";
import { Alert, Badge, Card, DefinitionList, TextLink, DangerZone } from "@/components/ui/layout";
import { PageHeader } from "@/components/ui/page-header";
import { LinkButton, SubmitButton } from "@/components/ui/buttons";
import { ConfirmSubmitButton } from "@/components/ui/confirm-dialog";
import { PdfPreview } from "@/components/ui/pdf-preview";
import { getI18n } from "@/i18n/server";
import { INTL_LOCALE } from "@/i18n/config";
import { todayInput } from "@/lib/dates";
import { versionOf } from "@/lib/concurrency";
import { cancelBlock, finalizeBlock, isFinalized, ledgerWhere, outstandingCents, paymentState } from "@/modules/office/invoices/domain";
import { archiveReadableWhere } from "@/modules/office/invoices/queries";
import { PageSections } from "@/modules/page-sections";
import { customerDisplayName, customerNameSelect, restrictionSelect } from "@/modules/workshop/customers/public";
import { formatCents } from "@/lib/money";
import { requirePermission, sessionIfAllowed } from "@/server/auth/session";
import { db } from "@/server/db";
import { cancelInvoice, deleteInvoice, finalizeInvoice, markInvoicePaid, reopenInvoice } from "@/modules/office/invoices/actions";
import { PaymentBadge } from "@/modules/office/invoices/ui";
import { Field, Input, Textarea } from "@/components/ui/form";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  if (!(await sessionIfAllowed("invoices.view"))) return {};
  // wie die Seite: nur Belege der Ausgangsliste (kein Entwurf, kein Angebot) liefern einen Titel
  const session = await sessionIfAllowed("invoices.view");
  const inv = await db.invoice.findFirst({ where: { AND: [{ id }, ledgerWhere, archiveReadableWhere] }, select: { number: true, partyName: true, customer: { select: restrictionSelect } } });
  // Name eines eingeschränkten Kunden (Art. 18) nur mit `customers.view`
  const named = !inv?.customer?.processingRestrictedAt || session?.can("customers.view");
  return { title: inv ? (named ? `${inv.number} · ${inv.partyName}` : inv.number) : undefined };
}

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("invoices.view");
  const [{ id }, i18n] = await Promise.all([params, getI18n()]);
  const { t, date, number, locale } = i18n;
  const eur = (c: number) => formatCents(c, INTL_LOCALE[locale]);

  // Entwürfe, Angebote und Auftragsbestätigungen der Rechnungserstellung gehören nicht in die Ausgangsliste (`ledgerWhere`)
  const inv = await db.invoice.findFirst({
    // nicht festgeschriebene Rechnungen eingeschränkter Kunden (Art. 18) sind im Archiv nicht lesbar (`archiveReadableWhere`)
    where: { AND: [{ id }, ledgerWhere, archiveReadableWhere] },
    include: {
      customer: { select: { ...customerNameSelect, ...restrictionSelect } },
      file: { select: { name: true, mime: true, size: true, uploadedAt: true } },
      cancels: { select: { id: true, number: true } },
      cancelledBy: { select: { id: true, number: true } },
    },
  });
  if (!inv) notFound();

  const state = paymentState(inv);
  // Belege der Rechnungserstellung (Positionen, Schnappschuss, Zahlungen) werden dort bearbeitet: hier nur ansehen und stornieren
  const fromBilling = inv.source === "billing";
  const canEdit = session.can("invoices.edit") && !fromBilling;
  // Zahlstatus: bei Belegen der Rechnungserstellung dort (Teilzahlungen) – ist die Funktion ausgeschaltet, bleibt er hier erfassbar
  const canPay = session.can("invoices.edit") && (!fromBilling || !session.features.has("office.billing"));
  const finalized = isFinalized(inv);
  const canFinalize = session.can("invoices.finalize") && finalizeBlock(inv) === null;
  const deductedInFinal = (await db.invoiceDeduction.count({ where: { partialId: inv.id, finalKey: { not: null } } })) > 0;
  const canCancel = session.can("invoices.edit") && cancelBlock({ ...inv, hasCounterDocument: inv.cancelledBy !== null, deductedInFinal }) === null;
  const outgoing = inv.direction === "outgoing";
  const isImage = inv.file?.mime.startsWith("image/");
  // Kunde mit eingeschränkter Verarbeitung (Art. 18): lesbar wegen der Aufbewahrungspflicht, mit Hinweis; der Name nur mit `customers.view`
  const restricted = Boolean(inv.customer?.processingRestrictedAt);
  const partyName = restricted && !session.can("customers.view") ? t("invoices.restricted.hiddenName") : inv.partyName;

  return (
    <>
      <PageHeader
        back={{ href: "/invoices", label: t("nav.invoices") }} help="office.invoices"
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="font-mono">{inv.number}</span>
            {inv.docType !== "invoice" ? <Badge tone="neutral">{t(`invoices.docTypes.${inv.docType as "partial" | "final" | "credit"}`)}</Badge> : null}
            <PaymentBadge state={state} t={t} />
            {finalized ? (
              <Badge tone="neutral">
                <Lock className="mr-1 inline size-3" aria-hidden />
                {t("invoices.finalize.badge")}
              </Badge>
            ) : null}
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={outgoing ? "accent" : "neutral"}>{t(`invoices.tabs.${outgoing ? "outgoing" : "incoming"}`)}</Badge>
            <span>{partyName}</span>
            {inv.cancels ? <TextLink href={`/invoices/${inv.cancels.id}`}>{t("invoices.cancel.counterOf", { number: inv.cancels.number })}</TextLink> : null}
            {inv.cancelledBy ? <TextLink href={`/invoices/${inv.cancelledBy.id}`}>{t("invoices.cancel.cancelledBy", { number: inv.cancelledBy.number })}</TextLink> : null}
          </span>
        }
        actions={
          canPay ? (
            <>
              {state === "paid" ? (
                <form action={reopenInvoice}>
                  <input type="hidden" name="id" value={inv.id} />
                  <SubmitButton variant="secondary">{t("invoices.reopen")}</SubmitButton>
                </form>
              ) : state !== "cancelled" ? (
                <form action={markInvoicePaid} className="flex items-center gap-2">
                  <input type="hidden" name="id" value={inv.id} />
                  <Input type="date" name="paidAt" defaultValue={todayInput()} aria-label={t("invoices.fields.paidAt")}  className="w-40" />
                  <SubmitButton variant="primary">{t("invoices.markPaid")}</SubmitButton>
                </form>
              ) : null}
              {finalized || !canEdit ? null : (
                <LinkButton href={`/invoices/${inv.id}/edit`}>
                  <Pencil className="size-4" aria-hidden /> {t("common.edit")}
                </LinkButton>
              )}
            </>
          ) : null
        }
      />

      {restricted ? (
        <Alert tone="warning" className="mb-5">
          <strong>{t("invoices.restricted.notice")}.</strong> {t("invoices.restricted.detail")}
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
        <div className="min-w-0 md:col-span-2">
          <Card title={t("invoices.sections.file")} padded={false}>
            {inv.file ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3 text-sm">
                  <span>
                    <strong>{inv.file.name}</strong> <span className="text-ink-muted">({number(inv.file.size / 1024, { maximumFractionDigits: 0 })} KB)</span>
                  </span>
                  {/* PDF: Öffnen, Teilen und Herunterladen bringt der PDF-Baustein selbst mit (unten) */}
                  {inv.file.mime === "application/pdf" ? null : (
                    <span className="flex gap-2">
                      <LinkButton size="sm" external href={`/api/invoices/${inv.id}/file`} target="_blank" rel="noreferrer">
                        <ExternalLink className="size-3.5" aria-hidden /> {t("invoices.open")}
                      </LinkButton>
                      <LinkButton size="sm" external href={`/api/invoices/${inv.id}/file?download=1`}>
                        <Download className="size-3.5" aria-hidden /> {t("invoices.download")}
                      </LinkButton>
                    </span>
                  )}
                </div>
                {isImage ? (
                  // eslint-disable-next-line @next/next/no-img-element -- geschützte Datei aus der Datenbank
                  <img src={`/api/invoices/${inv.id}/file`} alt={inv.file.name} className="max-h-[70vh] w-full object-contain p-4" />
                ) : inv.file.mime === "application/pdf" ? (
                  <PdfPreview src={`/api/invoices/${inv.id}/file`} title={inv.file.name} fileName={inv.file.name} labels={{ show: t("invoices.showPreview"), hide: t("invoices.hidePreview"), mobile: t("invoices.previewDesktopOnly") }} />
                ) : (
                  <p className="p-5 text-sm text-ink-muted">{t("invoices.noPreview")}</p>
                )}
              </>
            ) : (
              <p className="px-5 py-8 text-center text-sm text-ink-muted">{t("invoices.noFile")}</p>
            )}
          </Card>
        </div>

        <div className="min-w-0 flex flex-col gap-5">
          <Card title={t("invoices.sections.amounts")}>
            <p className="text-3xl font-semibold tabular">{eur(inv.grossCents)}</p>
            {inv.deductedCents !== 0 || inv.paidCents !== 0 ? (
              <p className="mt-1 text-sm text-ink-muted tabular">{t("invoices.fields.outstanding")}: {eur(outstandingCents(inv))}</p>
            ) : null}
            <p className="mt-1 text-sm text-ink-muted tabular">
              {inv.netCents != null ? `${t("invoices.fields.net")} ${eur(inv.netCents)}` : ""}
              {inv.netCents != null && inv.vatCents != null ? " · " : ""}
              {inv.vatCents != null ? `${t("invoices.fields.vat")} ${eur(inv.vatCents)}` : ""}
            </p>
          </Card>

          <Card title={t("invoices.sections.details")}>
            <DefinitionList
              items={[
                {
                  label: outgoing ? t("invoices.fields.recipient") : t("invoices.fields.supplier"),
                  value: inv.customer && session.can("customers.view") ? (
                    <TextLink href={`/customers/${inv.customer.id}`}>
                      {customerDisplayName(inv.customer)}
                    </TextLink>
                  ) : (
                    partyName
                  ),
                },
                { label: t("invoices.fields.issueDate"), value: date(inv.issueDate) },
                { label: t("invoices.fields.dueDate"), value: inv.dueDate ? date(inv.dueDate) : null },
                { label: t("invoices.fields.paidAt"), value: inv.paidAt ? date(inv.paidAt) : null },
                { label: t("invoices.fields.category"), value: inv.category },
                { label: t("invoices.fields.reference"), value: inv.reference },
                { label: t("common.notes"), value: inv.notes },
              ]}
            />
          </Card>

          {finalized ? (
            <Card title={t("invoices.finalize.title")}>
              <p className="text-sm">{t("invoices.finalize.done", { date: inv.finalizedAt ? date(inv.finalizedAt) : "", name: inv.finalizedByName ?? "–" })}</p>
              <p className="mt-2 text-sm text-ink-muted">{t("invoices.finalize.locked")}</p>
            </Card>
          ) : null}

          {canFinalize ? (
            <Card title={t("invoices.finalize.title")}>
              <p className="mb-3 text-sm text-ink-muted">{t("invoices.finalize.hint")}</p>
              <form action={finalizeInvoice}>
                <input type="hidden" name="id" value={inv.id} />
                <input type="hidden" name="version" value={versionOf(inv)} />
                <ConfirmSubmitButton variant="primary" message={t("invoices.finalize.confirm", { number: inv.number })} confirmLabel={t("invoices.finalize.action")}>
                  {t("invoices.finalize.action")}
                </ConfirmSubmitButton>
              </form>
            </Card>
          ) : null}

          {canCancel ? (
            <Card title={t("invoices.cancel.title")}>
              <p className="mb-3 text-sm text-ink-muted">{t("invoices.cancel.hint")}</p>
              <form action={cancelInvoice} className="flex flex-col gap-3">
                <input type="hidden" name="id" value={inv.id} />
                <input type="hidden" name="version" value={versionOf(inv)} />
                {fromBilling ? (
                  <p className="text-sm text-ink-muted">{t("invoices.cancel.numberAuto")}</p>
                ) : (
                  <Field label={t("invoices.cancel.number")} htmlFor="cancelNumber" name="number" required>
                    <Input id="cancelNumber" name="number" maxLength={60} required autoComplete="off" className="font-mono" />
                  </Field>
                )}
                {fromBilling ? (
                  <p className="text-sm text-ink-muted">{t("invoices.cancel.issueDateToday")}</p>
                ) : (
                  <Field label={t("invoices.cancel.issueDate")} htmlFor="cancelDate" name="issueDate" hint={t("invoices.cancel.issueDateHint")}>
                    <Input id="cancelDate" name="issueDate" type="date" max={todayInput()} />
                  </Field>
                )}
                <Field label={t("invoices.cancel.reason")} htmlFor="cancelReason" name="reason">
                  <Textarea id="cancelReason" name="reason" maxLength={500} rows={2} />
                </Field>
                <ConfirmSubmitButton message={t("invoices.cancel.confirm", { original: inv.number })} confirmLabel={t("invoices.cancel.action")}>
                  {t("invoices.cancel.action")}
                </ConfirmSubmitButton>
              </form>
            </Card>
          ) : null}

          <PageSections session={session} host="invoices/detail" entityId={inv.id} />

          {session.can("invoices.delete") && !finalized ? (
            <DangerZone title={t("common.dangerZone")}>
              <form action={deleteInvoice}>
                <input type="hidden" name="id" value={inv.id} />
                <ConfirmSubmitButton message={t("invoices.confirmDelete", { number: inv.number })}>{t("invoices.delete")}</ConfirmSubmitButton>
              </form>
            </DangerZone>
          ) : null}
        </div>
      </div>
    </>
  );
}

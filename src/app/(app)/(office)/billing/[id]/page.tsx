import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Download, Lock, Pencil } from "lucide-react";
import { LinkButton, SubmitButton } from "@/components/ui/buttons";
import { ConfirmSubmitButton } from "@/components/ui/confirm-dialog";
import { Field, Textarea } from "@/components/ui/form";
import { Alert, Badge, Card, DangerZone, TextLink } from "@/components/ui/layout";
import { PageHeader } from "@/components/ui/page-header";
import { PdfPreview } from "@/components/ui/pdf-preview";
import { getI18n } from "@/i18n/server";
import { versionOf } from "@/lib/concurrency";
import { acceptOffer, createConfirmation, deleteDraft, finalizeDocument, issueDocument, orderFromOffer, rejectOffer } from "@/modules/office/billing/actions";
import { isInvoiceType } from "@/modules/office/billing/constants";
import { ChecklistCard, FactsCard, HistoryCard, ItemsCard, PartiesCard, PaymentsCard, SendCard } from "@/modules/office/billing/detail-parts";
import { originalStates } from "@/modules/office/billing/original-files";
import { docTitle, isDraft, isSmallAmount, offerState, todayKey } from "@/modules/office/billing/domain";
import { xrechnungProblems } from "@/modules/office/billing/xrechnung";
import { documentDetail } from "@/modules/office/billing/queries";
import { DocBadges } from "@/modules/office/billing/ui";
import { draftProblems } from "@/modules/office/billing/view";
import { cancelBlock, cancelInvoice } from "@/modules/office/invoices/public";
import { orderRef } from "@/modules/workshop/orders/public";
import { mailConfigured } from "@/server/mail";
import { requirePermission, sessionIfAllowed } from "@/server/auth/session";
import { db } from "@/server/db";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  if (!(await sessionIfAllowed("billing.view"))) return {};
  const doc = await db.invoice.findFirst({ where: { id, source: "billing" }, select: { number: true, docType: true, partyName: true } });
  return { title: doc ? `${doc.number || docTitle(doc.docType)} · ${doc.partyName}` : undefined };
}

export default async function BillingDocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("billing.view");
  const [{ id }, i18n] = await Promise.all([params, getI18n()]);
  const { t, td } = i18n;
  const detail = await documentDetail(id);
  if (!detail) notFound();
  const { view, row, payments, derived, counter, restricted, sendTo, originalId, deductedInFinal, invalidDeductions } = detail;

  const draft = isDraft(row);
  const invoiceLike = isInvoiceType(view.docType);
  const isOffer = view.docType === "offer";
  const quote = isOffer || view.docType === "confirmation";
  const canEdit = session.can("billing.edit");
  const typeName = td(`billing.types.${view.docType}`, view.docType);
  const title = draft ? `${typeName} (${t("billing.status.draft")})` : `${typeName} ${view.number}`;

  const problems = draft ? draftProblems(view, row, todayKey(), { restricted, invalidDeductions }) : [];
  const xmlProblems = invoiceLike ? xrechnungProblems(view) : [];
  // Originale (PDF, XRechnung) festgeschriebener Rechnungen: vorhanden und unverändert? (die Vorschau zeigt dann das Original, `?fresh=1` die neu erzeugte Ansicht)
  const originals = !draft && invoiceLike ? await originalStates(row.id) : null;
  const canFinalize = quote ? canEdit : session.can("invoices.finalize");
  const state = isOffer && !draft ? offerState(row) : null;
  const confirmation = derived.find((d) => d.docType === "confirmation");
  const mailReady = await mailConfigured();
  const ordersOn = session.features.has("workshop.orders") && session.can("orders.view");
  const order = row.orderId && ordersOn ? await orderRef(row.orderId) : null;
  const canCancel = !draft && invoiceLike && session.can("invoices.edit") && cancelBlock({ ...row, hasCounterDocument: counter !== null, deductedInFinal }) === null;
  const canPay = !draft && invoiceLike && view.docType !== "credit" && row.status !== "cancelled" && !counter;
  const version = versionOf(row);
  const ordersAllowed = session.features.has("workshop.orders") && session.can("orders.create") && session.can("orders.edit") && session.can("orders.prices");

  return (
    <>
      <PageHeader
        back={{ href: "/billing", label: t("nav.billing") }}
        help="office.billing"
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span>{title}</span>
            <DocBadges doc={row} t={t} />
            {!draft ? (
              <Badge tone="neutral">
                <Lock className="mr-1 inline size-3" aria-hidden />
                {t("billing.status.locked")}
              </Badge>
            ) : null}
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span>{view.recipient.name}</span>
            {row.customerId && session.can("customers.view") ? <TextLink href={`/customers/${row.customerId}`}>{t("billing.fields.customer")}</TextLink> : null}
            {originalId ? <TextLink href={`/billing/${originalId}`}>{t("billing.links.cancelOf", { number: view.cancels?.number ?? "" })}</TextLink> : null}
            {counter ? <TextLink href={`/billing/${counter.id}`}>{t("billing.links.cancelledBy", { number: counter.number })}</TextLink> : null}
            {!draft && invoiceLike && session.can("invoices.view") ? <TextLink href={`/invoices/${row.id}`}>{t("billing.links.archive")}</TextLink> : null}
          </span>
        }
        actions={
          draft && canEdit ? (
            <LinkButton href={`/billing/${row.id}/edit`}>
              <Pencil className="size-4" aria-hidden /> {t("common.edit")}
            </LinkButton>
          ) : null
        }
      />

      {restricted ? <Alert tone="warning" className="mb-5">{t("billing.errors.restricted")}</Alert> : null}
      {state === "expired" ? <Alert tone="warning" className="mb-5">{t("billing.offerExpired")}</Alert> : null}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-5 lg:col-span-2">
          <Card title={t("billing.sections.preview")} padded={false}>
            <PdfPreview
              src={`/api/billing/${row.id}/pdf`}
              title={title}
              fileName={`${typeName}${view.number ? `_${view.number}` : ""}`}
              labels={{ show: t("invoices.showPreview"), hide: t("invoices.hidePreview"), mobile: t("invoices.previewDesktopOnly") }}
            />
          </Card>
          <ItemsCard view={view} i18n={i18n} />
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          {draft ? (
            <>
              <ChecklistCard
                problems={problems}
                i18n={i18n}
                smallAmount={invoiceLike && view.docType !== "credit" && isSmallAmount(view.totals.grossCents)}
                links={{ docId: row.id, customerId: row.customerId, canEditDraft: canEdit, canEditCustomer: session.can("customers.edit") && session.features.has("workshop.customers"), canEditProfile: session.can("settings.manage") }}
                refresh={canEdit && row.customerId && !restricted ? { docId: row.id, version } : undefined}
              />
              {canFinalize || canEdit ? (
                <Card title={t("billing.sections.actions")}>
                  <div className="flex flex-col gap-3">
                    {canFinalize ? (
                      <form action={quote ? issueDocument : finalizeDocument}>
                        <input type="hidden" name="id" value={row.id} />
                        <input type="hidden" name="version" value={version} />
                        <ConfirmSubmitButton variant="primary" size="md" disabled={problems.length > 0} aria-describedby={problems.length > 0 ? "billing-checklist-intro" : undefined} message={t(quote ? "billing.confirm.issue" : "billing.confirm.finalize", { type: typeName })} confirmLabel={t(quote ? "billing.actions.issue" : "billing.actions.finalize")}>
                          {t(quote ? "billing.actions.issue" : "billing.actions.finalize")}
                        </ConfirmSubmitButton>
                      </form>
                    ) : (
                      <p className="text-sm text-ink-muted">{t("billing.needFinalizeRight")}</p>
                    )}
                  </div>
                </Card>
              ) : null}
            </>
          ) : (
            <>
              <PartiesCard view={view} i18n={i18n} snapshot />
              <FactsCard
                view={view}
                i18n={i18n}
                extra={[
                  ...(order ? [{ label: t("billing.fields.order"), value: <TextLink href={`/orders/${order.id}`}>{order.number}</TextLink> }] : []),
                  ...(view.sourceNumber ? [{ label: t("billing.fields.source"), value: row.sourceDocId ? <TextLink href={`/billing/${row.sourceDocId}`}>{view.sourceNumber}</TextLink> : view.sourceNumber }] : []),
                  ...derived.map((d) => ({ label: t("billing.links.derived"), value: <TextLink href={`/billing/${d.id}`}>{`${td(`billing.types.${d.docType}`, d.docType)} ${d.number || t("billing.draftNumber")}`}</TextLink> })),
                ]}
              />
            </>
          )}
          {draft ? <PartiesCard view={view} i18n={i18n} snapshot={false} /> : null}
          {draft ? <FactsCard view={view} i18n={i18n} /> : null}

          {!draft && (isOffer || invoiceLike || view.docType === "confirmation") ? (
            <SendCard docId={row.id} to={sendTo} mailReady={mailReady} canSend={session.can("billing.send") && session.can("mail.send")} sentCount={row.sentCount} sentAt={row.sentAt} xmlReady={xmlProblems.length === 0} invoiceLike={invoiceLike} i18n={i18n} />
          ) : null}

          {!draft && invoiceLike ? (
            <Card title={t("billing.sections.xrechnung")}>
              <p className="mb-2 text-sm text-ink-muted">{t("billing.xrechnung.hint")}</p>
              {xmlProblems.length === 0 ? (
                <LinkButton href={`/api/billing/${row.id}/xml`} external size="sm">
                  <Download className="size-3.5" aria-hidden /> {t("billing.actions.xml")}
                </LinkButton>
              ) : (
                <>
                  <p className="mb-1 text-sm">{t("billing.xrechnung.missingIntro")}</p>
                  <ul className="list-disc pl-5 text-sm">
                    {xmlProblems.map((code) => (
                      <li key={code}>{td(`billing.xrechnung.problems.${code}`, code)}</li>
                    ))}
                  </ul>
                </>
              )}
            </Card>
          ) : null}

          {canPay ? <PaymentsCard docId={row.id} payments={payments} view={view} canEdit={session.can("invoices.edit")} i18n={i18n} /> : null}

          {!draft && isOffer && state && state !== "rejected" ? (
            <Card title={t("billing.sections.actions")}>
              <div className="flex flex-col gap-3">
                {row.offerStatus === "open" && session.can("billing.accept") ? (
                  <div className="flex flex-wrap gap-2">
                    <form action={acceptOffer}>
                      <input type="hidden" name="id" value={row.id} />
                      <input type="hidden" name="version" value={version} />
                      <ConfirmSubmitButton variant="primary" size="md" message={t("billing.confirm.accept")} confirmLabel={t("billing.actions.accept")}>
                        {t("billing.actions.accept")}
                      </ConfirmSubmitButton>
                    </form>
                    <form action={rejectOffer}>
                      <input type="hidden" name="id" value={row.id} />
                      <input type="hidden" name="version" value={version} />
                      <ConfirmSubmitButton variant="secondary" size="md" message={t("billing.confirm.reject")} confirmLabel={t("billing.actions.reject")}>
                        {t("billing.actions.reject")}
                      </ConfirmSubmitButton>
                    </form>
                  </div>
                ) : null}
                {row.offerStatus === "accepted" && canEdit && !confirmation ? (
                  <form action={createConfirmation}>
                    <input type="hidden" name="id" value={row.id} />
                    <SubmitButton variant="secondary">{t("billing.actions.createConfirmation")}</SubmitButton>
                  </form>
                ) : null}
                {row.offerStatus === "accepted" && !row.orderId && row.vehicleId && ordersAllowed && session.can("billing.accept") ? (
                  <form action={orderFromOffer}>
                    <input type="hidden" name="id" value={row.id} />
                    <input type="hidden" name="version" value={version} />
                    <ConfirmSubmitButton variant="primary" size="md" message={t("billing.confirm.createOrder")} confirmLabel={t("billing.actions.createOrder")}>
                      {t("billing.actions.createOrder")}
                    </ConfirmSubmitButton>
                  </form>
                ) : null}
              </div>
            </Card>
          ) : null}

          {canCancel ? (
            <Card title={t("billing.actions.cancel")}>
              <form action={cancelInvoice} className="flex flex-col gap-3">
                <input type="hidden" name="id" value={row.id} />
                <input type="hidden" name="version" value={version} />
                <p className="text-sm text-ink-muted">{t("invoices.cancel.hint")}</p>
                <Field label={t("invoices.cancel.reason")} htmlFor="cancelReason" name="reason">
                  <Textarea id="cancelReason" name="reason" maxLength={500} rows={2} />
                </Field>
                <ConfirmSubmitButton message={t("billing.confirm.cancel", { number: view.number })} confirmLabel={t("billing.actions.cancel")}>
                  {t("billing.actions.cancel")}
                </ConfirmSubmitButton>
              </form>
            </Card>
          ) : null}

          <HistoryCard view={view} row={row} payments={payments} counter={counter} i18n={i18n} />

          {draft && canEdit ? (
            <DangerZone title={t("common.dangerZone")}>
              <form action={deleteDraft}>
                <input type="hidden" name="id" value={row.id} />
                <input type="hidden" name="version" value={version} />
                <ConfirmSubmitButton message={t("billing.confirm.delete")}>{t("billing.actions.delete")}</ConfirmSubmitButton>
              </form>
            </DangerZone>
          ) : null}
        </div>
      </div>
    </>
  );
}

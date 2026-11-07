import { DataTable } from "@/components/ui/data-table";
import { SubmitButton } from "@/components/ui/buttons";
import { ConfirmSubmitButton } from "@/components/ui/confirm-dialog";
import { Checkbox, Field, Input, Select } from "@/components/ui/form";
import { Alert, Card, DefinitionList } from "@/components/ui/layout";
import { Timeline, type TimelineItem } from "@/components/ui/timeline";
import { INTL_LOCALE, type Locale } from "@/i18n/config";
import type { getI18n } from "@/i18n/server";
import { noon } from "@/lib/dates";
import { QUANTITY_DECIMALS, lineResult, scaledToInput } from "@/lib/line-items";
import { formatCents } from "@/lib/money";
import { addPayment, removePayment, sendDocument } from "./actions";
import { PAYMENT_METHODS } from "./constants";
import { SMALL_BUSINESS_NOTE } from "@/lib/einvoice/ubl";
import { viewPayable, type DocView } from "./view";
import { todayKey } from "./domain";

/**
 * Bausteine der Detailseite eines Beleges (Server-Komponenten): Positionen mit Summen, Absender und Empfänger (Schnappschuss), Zahlungen, Versand, Prüfliste, Verlauf. Die Seite entscheidet, welche
 * Karten sie zeigt; die Rechte prüfen die Operationen hinter den Knöpfen.
 */
type I18n = Awaited<ReturnType<typeof getI18n>>;

const eurOf = (locale: Locale) => (cents: number) => formatCents(cents, INTL_LOCALE[locale]);
const dayText = (key: string | null, i18n: I18n): string => (key ? i18n.date(noon(key)) : "–");

export async function ItemsCard({ view, i18n }: { view: DocView; i18n: I18n }) {
  const { t, td, locale } = i18n;
  const eur = eurOf(locale);
  const anyDiscount = view.items.some((i) => i.discountBp !== 0);
  const rows = view.items.map((item, index) => ({ item, index, net: lineResult(item).netCents }));
  const tt = view.totals;
  return (
    <Card title={t("billing.sections.items")} padded={false}>
      <DataTable
        bare
        caption={t("billing.sections.items")}
        rows={rows}
        rowKey={(r) => String(r.index)}
        minWidth="40rem"
        empty={<p className="px-5 py-6 text-sm text-ink-muted">{t("billing.problems.noItems")}</p>}
        columns={[
          {
            id: "description",
            header: t("billing.columns.item"),
            priority: "primary",
            cell: (r) => (
              <div>
                <span className="break-words font-medium">{r.item.description}</span>
                <div className="text-xs text-ink-muted">{td(`billing.kinds.${r.item.kind}`, r.item.kind)}</div>
              </div>
            ),
          },
          { id: "qty", header: t("billing.columns.quantity"), align: "end", cell: (r) => <span className="whitespace-nowrap tabular">{scaledToInput(r.item.quantityMilli, QUANTITY_DECIMALS, locale)} {r.item.unit}</span> },
          { id: "unit", header: t("billing.columns.unitPrice"), align: "end", cell: (r) => <span className="whitespace-nowrap tabular">{eur(r.item.unitCents)}</span> },
          ...(anyDiscount ? [{ id: "discount", header: t("billing.columns.discount"), align: "end" as const, cell: (r: (typeof rows)[number]) => (r.item.discountBp ? `−${scaledToInput(r.item.discountBp, 2, locale)} %` : "") }] : []),
          ...(view.exempt ? [] : [{ id: "tax", header: t("billing.columns.tax"), align: "end" as const, cell: (r: (typeof rows)[number]) => <span className="whitespace-nowrap tabular">{scaledToInput(r.item.taxBp, 2, locale)} %</span> }]),
          { id: "net", header: t("billing.columns.net"), align: "end", cell: (r) => <span className="whitespace-nowrap font-medium tabular">{eur(r.net)}</span> },
        ]}
      />
      <dl className="ml-auto flex max-w-sm flex-col gap-1 border-t border-line px-5 py-4 text-sm">
        {view.exempt ? null : (
          <>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-muted">{t("billing.totals.net")}</dt>
              <dd className="tabular">{eur(tt.netCents)}</dd>
            </div>
            {tt.taxGroups.map((g) => (
              <div key={g.taxBp} className="flex justify-between gap-4">
                <dt className="text-ink-muted">
                  {t("billing.totals.tax")} {scaledToInput(g.taxBp, 2, locale)} %
                </dt>
                <dd className="tabular">{eur(g.taxCents)}</dd>
              </div>
            ))}
          </>
        )}
        <div className="flex justify-between gap-4 text-base font-semibold">
          <dt>{t("billing.totals.gross")}</dt>
          <dd className="tabular">{eur(tt.grossCents)}</dd>
        </div>
        {view.deductions.map((d) => (
          <div key={d.number} className="flex justify-between gap-4">
            <dt className="text-ink-muted">
              {t("billing.totals.deducted")} {d.number}
            </dt>
            <dd className="tabular">{eur(0 - d.grossCents)}</dd>
          </div>
        ))}
        {view.deductions.length > 0 ? (
          <div className="flex justify-between gap-4 text-base font-semibold">
            <dt>{t("billing.totals.payable")}</dt>
            <dd className="tabular">{eur(viewPayable(view))}</dd>
          </div>
        ) : null}
        {view.exempt ? <p className="mt-1 text-xs text-ink-muted">{SMALL_BUSINESS_NOTE}</p> : null}
      </dl>
    </Card>
  );
}

export function PartiesCard({ view, i18n, snapshot }: { view: DocView; i18n: I18n; snapshot: boolean }) {
  const { t } = i18n;
  const s = view.sender;
  const r = view.recipient;
  const lines = (parts: Array<string | null>) => parts.filter(Boolean).map((p, i) => <span key={i} className="block">{p}</span>);
  return (
    <Card title={snapshot ? t("billing.sections.snapshot") : t("billing.sections.recipient")}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="text-sm">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-muted">{t("billing.sections.recipient")}</p>
          <strong className="block">{r.name}</strong>
          {lines([r.street, [r.zip, r.city].filter(Boolean).join(" ") || null, r.email])}
          {r.customerNumber ? <span className="block text-ink-muted">{t("billing.fields.customerNumber")} {r.customerNumber}</span> : null}
        </div>
        <div className="text-sm">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-muted">{t("billing.sections.sender")}</p>
          <strong className="block">{s.name}</strong>
          {lines([s.street, [s.zip, s.city].filter(Boolean).join(" ") || null, s.taxNumber ? `${t("billing.fields.taxNumber")} ${s.taxNumber}` : null, s.vatId ? `${t("billing.fields.vatId")} ${s.vatId}` : null, s.iban ? `${t("billing.fields.iban")} ${s.iban}` : null])}
          {s.smallBusiness ? <span className="block text-ink-muted">{t("billing.fields.smallBusiness")}</span> : null}
        </div>
      </div>
      {snapshot ? <p className="mt-3 text-xs text-ink-muted">{t("billing.snapshotHint")}</p> : null}
    </Card>
  );
}

export function FactsCard({ view, i18n, extra }: { view: DocView; i18n: I18n; extra?: Array<{ label: string; value: React.ReactNode }> }) {
  const { t, td } = i18n;
  const methodLabel = view.paymentMethod ? td(`billing.payment.${view.paymentMethod}`, view.paymentMethod) : null;
  const invoiceLike = view.docType === "invoice" || view.docType === "partial" || view.docType === "final";
  return (
    <Card title={t("billing.sections.dates")}>
      <DefinitionList
        items={[
          { label: t("billing.fields.number"), value: view.number ? <span className="font-mono">{view.number}</span> : t("billing.draftNumber") },
          { label: t("billing.fields.issueDate"), value: view.draft ? null : dayText(view.issueDay, i18n) },
          ...(view.docType === "offer" ? [{ label: t("billing.fields.validUntil"), value: view.validUntil ? dayText(view.validUntil, i18n) : null }] : []),
          ...(invoiceLike ? [{ label: t("billing.fields.dueDate"), value: view.dueDay ? dayText(view.dueDay, i18n) : view.paymentDays != null ? t("billing.fields.paymentDays") + `: ${view.paymentDays}` : null }] : []),
          ...(invoiceLike
            ? [
                { label: t("billing.fields.serviceFrom"), value: view.serviceFrom ? (view.serviceTo && view.serviceTo !== view.serviceFrom ? `${dayText(view.serviceFrom, i18n)} – ${dayText(view.serviceTo, i18n)}` : dayText(view.serviceFrom, i18n)) : null },
                { label: t("billing.fields.paymentMethod"), value: methodLabel },
                { label: t("billing.fields.buyerReference"), value: view.buyerReference },
              ]
            : []),
          { label: t("billing.fields.vehicle"), value: view.vehicleLabel ? `${view.vehicleLabel}${view.mileageKm != null ? ` · ${i18n.number(view.mileageKm)} km` : ""}` : null },
          ...(extra ?? []),
        ]}
      />
      {view.introText ? <p className="mt-3 whitespace-pre-line text-sm">{view.introText}</p> : null}
      {view.footerText ? <p className="mt-3 whitespace-pre-line text-sm text-ink-muted">{view.footerText}</p> : null}
      {view.taxNote ? <p className="mt-3 text-sm text-ink-muted">{view.taxNote}</p> : null}
    </Card>
  );
}

export function ChecklistCard({ problems, i18n, smallAmount = false }: { problems: readonly string[]; i18n: I18n; smallAmount?: boolean }) {
  const { t, td } = i18n;
  return (
    <Card title={t("billing.sections.checklist")}>
      {problems.length === 0 ? (
        <p className="text-sm text-success-ink">{t("billing.checklistOk")}</p>
      ) : (
        <>
          <p className="mb-2 text-sm">{t("billing.problemsIntro")}</p>
          <ul className="list-disc pl-5 text-sm">
            {problems.map((code) => (
              <li key={code}>{td(`billing.problems.${code}`, code)}</li>
            ))}
          </ul>
        </>
      )}
      {smallAmount ? <p className="mt-3 text-xs text-ink-muted">{t("billing.smallAmountHint")}</p> : null}
    </Card>
  );
}

export function PaymentsCard({
  docId,
  payments,
  view,
  canEdit,
  i18n,
}: {
  docId: string;
  payments: Array<{ id: string; paidAt: Date; amountCents: number; method: string; note: string | null; recordedByName: string }>;
  view: DocView;
  canEdit: boolean;
  i18n: I18n;
}) {
  const { t, td, date, locale } = i18n;
  const eur = eurOf(locale);
  const payable = viewPayable(view);
  const open = Math.max(0, payable - view.paidCents);
  return (
    <Card title={t("billing.sections.payments")}>
      <dl className="mb-3 grid grid-cols-3 gap-2 text-sm">
        <div>
          <dt className="text-xs text-ink-muted">{t("billing.fields.payable")}</dt>
          <dd className="tabular font-medium">{eur(payable)}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-muted">{t("billing.fields.paid")}</dt>
          <dd className="tabular font-medium">{eur(view.paidCents)}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-muted">{t("billing.fields.remaining")}</dt>
          <dd className="tabular font-medium">{eur(open)}</dd>
        </div>
      </dl>
      {payments.length === 0 ? (
        <p className="mb-3 text-sm text-ink-muted">{t("billing.paymentsCard.empty")}</p>
      ) : (
        <ul className="mb-4 divide-y divide-line text-sm">
          {payments.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="min-w-0">
                <span className="tabular font-medium">{eur(p.amountCents)}</span> · {date(p.paidAt)} · {td(`billing.payment.${p.method}`, p.method)}
                {p.note ? <span className="block text-xs text-ink-muted">{p.note}</span> : null}
              </span>
              {canEdit ? (
                <form action={removePayment}>
                  <input type="hidden" name="id" value={p.id} />
                  <ConfirmSubmitButton message={t("billing.paymentsCard.confirmRemove")} label={t("billing.paymentsCard.remove")}>
                    {t("billing.paymentsCard.remove")}
                  </ConfirmSubmitButton>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canEdit && open > 0 ? (
        <form action={addPayment} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input type="hidden" name="id" value={docId} />
          <Field label={t("billing.paymentsCard.amount")} htmlFor="payAmount" name="amount" required>
            <Input id="payAmount" name="amount" inputMode="decimal" required placeholder="0,00" autoComplete="off" />
          </Field>
          <Field label={t("billing.paymentsCard.paidAt")} htmlFor="payDate" name="paidAt">
            <Input id="payDate" name="paidAt" type="date" defaultValue={todayKey()} max={todayKey()} />
          </Field>
          <Field label={t("billing.paymentsCard.method")} htmlFor="payMethod" name="method">
            <Select id="payMethod" name="method" defaultValue="transfer">
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {td(`billing.payment.${m}`, m)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("billing.paymentsCard.note")} htmlFor="payNote" name="note">
            <Input id="payNote" name="note" maxLength={200} autoComplete="off" />
          </Field>
          <div className="sm:col-span-2">
            <SubmitButton variant="primary">{t("billing.paymentsCard.add")}</SubmitButton>
          </div>
        </form>
      ) : null}
      <Alert tone="info" className="mt-4">
        {t("billing.paymentsCard.noCash")}
      </Alert>
    </Card>
  );
}

export function SendCard({
  docId,
  to,
  mailReady,
  canSend,
  sentCount,
  sentAt,
  xmlReady,
  invoiceLike,
  i18n,
}: {
  docId: string;
  to: string | null;
  mailReady: boolean;
  canSend: boolean;
  sentCount: number;
  sentAt: Date | null;
  xmlReady: boolean;
  invoiceLike: boolean;
  i18n: I18n;
}) {
  const { t, date } = i18n;
  return (
    <Card title={t("billing.sections.send")}>
      {!mailReady ? (
        <p className="text-sm text-ink-muted">{t("billing.send.notConfigured")}</p>
      ) : !to ? (
        <p className="text-sm text-ink-muted">{t("billing.send.noEmail")}</p>
      ) : !canSend ? (
        <p className="text-sm text-ink-muted">{t("billing.send.noPermission")}</p>
      ) : (
        <form action={sendDocument} className="flex flex-col gap-3">
          <input type="hidden" name="id" value={docId} />
          <p className="text-sm">
            {t("billing.send.to")}: <strong className="break-all">{to}</strong>
          </p>
          <p className="text-xs text-ink-muted">{t("billing.send.hint")}</p>
          {invoiceLike ? <Checkbox name="includeXml" label={t("billing.send.includeXml")} disabled={!xmlReady} hint={xmlReady ? undefined : t("billing.send.xmlMissing")} /> : null}
          {sentAt ? (
            <Alert tone="warning">
              {t("billing.send.resendWarning", { count: sentCount, date: date(sentAt) })}
              <input type="hidden" name="resend" value="on" />
            </Alert>
          ) : null}
          <div>
            {sentAt ? (
              <ConfirmSubmitButton variant="secondary" size="md" message={t("billing.send.resendWarning", { count: sentCount, date: date(sentAt) })} confirmLabel={t("billing.send.resendConfirm")}>
                {t("billing.actions.resend")}
              </ConfirmSubmitButton>
            ) : (
              <SubmitButton variant="primary">{t("billing.send.action")}</SubmitButton>
            )}
          </div>
        </form>
      )}
    </Card>
  );
}

export function HistoryCard({
  view,
  row,
  payments,
  counter,
  i18n,
}: {
  view: DocView;
  row: { createdAt: Date; createdByName: string | null; sentAt: Date | null; sentCount: number; acceptedAt: Date | null; acceptedByName: string | null; offerStatus: string | null };
  payments: Array<{ id: string; paidAt: Date; amountCents: number; recordedByName: string; createdAt: Date }>;
  counter: { number: string } | null;
  i18n: I18n;
}) {
  const { t, date, locale } = i18n;
  const eur = eurOf(locale);
  const stamp = (d: Date) => date(d, { dateStyle: "medium", timeStyle: "short" });
  const items: TimelineItem[] = [{ id: "created", title: t("billing.history.created"), description: row.createdByName, time: stamp(row.createdAt), tone: "neutral" }];
  if (view.finalizedAt) items.push({ id: "final", title: view.docType === "offer" || view.docType === "confirmation" ? t("billing.history.issued") : t("billing.history.finalized"), description: view.finalizedByName, time: stamp(view.finalizedAt), tone: "info" });
  if (row.offerStatus === "accepted" && row.acceptedAt) items.push({ id: "accepted", title: t("billing.history.accepted"), description: row.acceptedByName, time: date(row.acceptedAt), tone: "success" });
  if (row.offerStatus === "rejected") items.push({ id: "rejected", title: t("billing.history.rejected"), tone: "neutral" });
  for (const p of payments) items.push({ id: p.id, title: t("billing.history.payment", { amount: eur(p.amountCents) }), description: p.recordedByName, time: date(p.paidAt), tone: "success" });
  if (row.sentAt) items.push({ id: "sent", title: t("billing.history.sent", { count: row.sentCount }), time: stamp(row.sentAt), tone: "neutral" });
  if (counter) items.push({ id: "cancelled", title: `${t("billing.history.cancelled")} · ${counter.number}`, tone: "warning" });
  return (
    <Card title={t("billing.sections.history")}>
      <Timeline items={items} />
    </Card>
  );
}

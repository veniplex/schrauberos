import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Download, ExternalLink, Pencil } from "lucide-react";
import { Badge, Card, DefinitionList, TextLink } from "@/components/ui/layout";
import { PageHeader } from "@/components/ui/page-header";
import { LinkButton, SubmitButton } from "@/components/ui/buttons";
import { ConfirmSubmitButton } from "@/components/ui/confirm-dialog";
import { getI18n } from "@/i18n/server";
import { INTL_LOCALE } from "@/i18n/config";
import { todayInput } from "@/lib/dates";
import { paymentState } from "@/modules/office/invoices/domain";
import { customerDisplayName } from "@/modules/workshop/customers/public";
import { formatCents } from "@/lib/money";
import { requirePermission, sessionIfAllowed } from "@/server/auth/session";
import { db } from "@/server/db";
import { deleteInvoice, markInvoicePaid, reopenInvoice } from "@/modules/office/invoices/actions";
import { PaymentBadge } from "@/modules/office/invoices/ui";
import { Input } from "@/components/ui/form";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  if (!(await sessionIfAllowed("invoices.view"))) return {};
  const inv = await db.invoice.findUnique({ where: { id } });
  return { title: inv ? `${inv.number} · ${inv.partyName}` : undefined };
}

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("invoices.view");
  const [{ id }, i18n] = await Promise.all([params, getI18n()]);
  const { t, date, number, locale } = i18n;
  const eur = (c: number) => formatCents(c, INTL_LOCALE[locale]);

  const inv = await db.invoice.findUnique({
    where: { id },
    include: { customer: true, file: { select: { name: true, mime: true, size: true, uploadedAt: true } } },
  });
  if (!inv) notFound();

  const state = paymentState(inv);
  const canEdit = session.can("invoices.edit");
  const outgoing = inv.direction === "outgoing";
  const isImage = inv.file?.mime.startsWith("image/");

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="font-mono">{inv.number}</span>
            <PaymentBadge state={state} t={t} />
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={outgoing ? "accent" : "neutral"}>{t(`invoices.tabs.${outgoing ? "outgoing" : "incoming"}`)}</Badge>
            <span>{inv.partyName}</span>
          </span>
        }
        actions={
          canEdit ? (
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
              <LinkButton href={`/invoices/${inv.id}/edit`}>
                <Pencil className="size-4" aria-hidden /> {t("common.edit")}
              </LinkButton>
            </>
          ) : null
        }
      />

      <div className="grid gap-5 md:grid-cols-3">
        <div className="md:col-span-2">
          <Card title={t("invoices.sections.file")} padded={false}>
            {inv.file ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3 text-sm">
                  <span>
                    <strong>{inv.file.name}</strong> <span className="text-ink-muted">({number(inv.file.size / 1024, { maximumFractionDigits: 0 })} KB)</span>
                  </span>
                  <span className="flex gap-2">
                    <LinkButton size="sm" external href={`/api/invoices/${inv.id}/file`} target="_blank" rel="noreferrer">
                      <ExternalLink className="size-3.5" aria-hidden /> {t("invoices.open")}
                    </LinkButton>
                    <LinkButton size="sm" external href={`/api/invoices/${inv.id}/file?download=1`}>
                      <Download className="size-3.5" aria-hidden /> {t("invoices.download")}
                    </LinkButton>
                  </span>
                </div>
                {isImage ? (
                  // eslint-disable-next-line @next/next/no-img-element -- geschützte Datei aus der Datenbank
                  <img src={`/api/invoices/${inv.id}/file`} alt={inv.file.name} className="max-h-[70vh] w-full object-contain p-4" />
                ) : (
                  <object data={`/api/invoices/${inv.id}/file`} type="application/pdf" className="h-[70vh] w-full" aria-label={inv.file.name}>
                    <p className="p-5 text-sm text-ink-muted">{t("invoices.noPreview")}</p>
                  </object>
                )}
              </>
            ) : (
              <p className="px-5 py-8 text-center text-sm text-ink-muted">{t("invoices.noFile")}</p>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-5">
          <Card title={t("invoices.sections.amounts")}>
            <p className="text-3xl font-semibold tabular">{eur(inv.grossCents)}</p>
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
                    inv.partyName
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

          {session.can("invoices.delete") ? (
            <form action={deleteInvoice}>
              <input type="hidden" name="id" value={inv.id} />
              <ConfirmSubmitButton message={t("invoices.confirmDelete", { number: inv.number })}>{t("invoices.delete")}</ConfirmSubmitButton>
            </form>
          ) : null}
        </div>
      </div>
    </>
  );
}

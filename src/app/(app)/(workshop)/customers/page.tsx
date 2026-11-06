import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { Badge, Card, EmptyState, PageHeader, Plate, Table } from "@/components/ui/layout";
import { LinkButton } from "@/components/ui/buttons";
import { getI18n } from "@/i18n/server";
import { customerDisplayName } from "@/modules/workshop/customers/domain";
import { normalizePlate } from "@/lib/plate";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { contains } from "@/server/search";
import { Input } from "@/components/ui/form";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("nav.customers") };
}

const LIMIT = 100;

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const session = await requirePermission("customers.view");
  const [{ t, tp }, sp] = await Promise.all([getI18n(), searchParams]);
  const q = (sp.q ?? "").trim();
  const plate = normalizePlate(q);

  const where = q
    ? {
        OR: [
          { lastName: contains(q) },
          { firstName: contains(q) },
          { company: contains(q) },
          { customerNumber: contains(q) },
          { city: contains(q) },
          { phone: contains(q) },
          ...(plate ? [{ vehicles: { some: { plateNorm: { contains: plate } } } }] : []),
        ],
      }
    : {};

  const [customers, total] = await Promise.all([
    db.customer.findMany({ where, include: { vehicles: { orderBy: { plateNorm: "asc" } } }, orderBy: { lastName: "asc" }, take: LIMIT }),
    db.customer.count({ where }),
  ]);
  const canEdit = session.can("customers.edit");

  return (
    <>
      <PageHeader
        title={t("customers.title")}
        description={t("customers.description")}
        actions={
          canEdit ? (
            <LinkButton href="/customers/new" variant="primary">
              <Plus className="size-4" aria-hidden /> {t("customers.new")}
            </LinkButton>
          ) : null
        }
      />

      <form method="get" className="mb-5 max-w-lg">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" aria-hidden />
          <Input name="q" defaultValue={q} className="pl-9" placeholder={t("customers.searchPlaceholder")} aria-label={t("common.search")} />
        </div>
      </form>

      <Card padded={false} className="overflow-hidden">
        {customers.length === 0 ? (
          <EmptyState title={t("customers.empty")} hint={q ? t("common.noResults") : t("customers.emptyHint")} />
        ) : (
          <>
            <p className="border-b border-line px-4 py-2 text-sm text-ink-muted">
              {tp("customers.count", total)}
              {total > LIMIT ? ` · ${t("common.limited", { limit: LIMIT })}` : ""}
            </p>
            <Table className="min-w-[40rem]">
                <thead>
                  <tr>
                    <th>{t("customers.cols.name")}</th>
                    <th>{t("customers.cols.contact")}</th>
                    <th>{t("customers.cols.vehicles")}</th>
                  </tr>
                </thead>
                <tbody>
                  {customers.map((c) => (
                    <tr key={c.id} className="row-link">
                      <td>
                        <Link href={`/customers/${c.id}`} className="font-medium inline-flex min-h-(--tap-row) min-w-(--tap-row) items-center hover:underline">
                          {customerDisplayName(c)}
                        </Link>
                        <div className="flex items-center gap-2 text-xs text-ink-muted">
                          {c.customerNumber ? <span className="tabular">#{c.customerNumber}</span> : null}
                          {c.externalSource ? <Badge tone="info">{c.externalSource === "werbas" ? "Werbas" : c.externalSource}</Badge> : null}
                        </div>
                      </td>
                      <td className="text-sm">
                        <div>{c.phone}</div>
                        <div className="text-ink-muted">{[c.zip, c.city].filter(Boolean).join(" ")}</div>
                      </td>
                      <td>
                        <div className="flex flex-wrap gap-1.5">
                          {c.vehicles.length ? c.vehicles.map((v) => <Plate key={v.id}>{v.plate}</Plate>) : <span className="text-ink-muted">–</span>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
          </>
        )}
      </Card>
    </>
  );
}

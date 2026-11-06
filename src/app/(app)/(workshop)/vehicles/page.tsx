import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Badge, Card, EmptyState, FilterBar, PageHeader, Plate, Table } from "@/components/ui/layout";
import { LinkButton } from "@/components/ui/buttons";
import { getI18n } from "@/i18n/server";
import { customerDisplayName } from "@/modules/workshop/customers/public";
import { normalizePlate } from "@/lib/plate";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { contains } from "@/server/search";
import { SearchInput, Select } from "@/components/ui/form";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("nav.vehicles") };
}

const LIMIT = 100;

export default async function VehiclesPage({ searchParams }: { searchParams: Promise<{ q?: string; owner?: string }> }) {
  const session = await requirePermission("vehicles.view");
  const [{ t, tp }, sp] = await Promise.all([getI18n(), searchParams]);
  const q = (sp.q ?? "").trim();
  const plate = normalizePlate(q);
  const noOwnerOnly = sp.owner === "none";

  const where = {
    ...(noOwnerOnly ? { customerId: null } : {}),
    ...(q
      ? {
          OR: [
            ...(plate ? [{ plateNorm: { contains: plate } }] : []),
            { vin: contains(q) },
            { make: contains(q) },
            { model: contains(q) },
            { customer: { is: { OR: [{ lastName: contains(q) }, { firstName: contains(q) }, { company: contains(q) }] } } },
          ],
        }
      : {}),
  };

  const [vehicles, total] = await Promise.all([
    db.vehicle.findMany({ where, include: { customer: true, _count: { select: { tireSets: true, appointments: true } } }, orderBy: { plateNorm: "asc" }, take: LIMIT }),
    db.vehicle.count({ where }),
  ]);
  const canEdit = session.can("vehicles.edit");

  return (
    <>
      <PageHeader
        title={t("vehicles.title")}
        description={t("vehicles.description")}
        actions={
          canEdit ? (
            <LinkButton href="/vehicles/new" variant="primary">
              <Plus className="size-4" aria-hidden /> {t("vehicles.new")}
            </LinkButton>
          ) : null
        }
      />

      <FilterBar columns="sm:grid-cols-[minmax(0,1fr)_12rem_auto]" submitLabel={t("common.filter")}>
        <SearchInput name="q" defaultValue={q} placeholder={t("vehicles.searchList")} aria-label={t("common.search")} />
        <Select name="owner" defaultValue={noOwnerOnly ? "none" : ""} aria-label={t("vehicles.fields.owner")}>
          <option value="">{t("vehicles.filters.anyOwner")}</option>
          <option value="none">{t("vehicles.filters.noOwner")}</option>
        </Select>
      </FilterBar>

      <Card padded={false} className="overflow-hidden">
        {vehicles.length === 0 ? (
          <EmptyState title={t("vehicles.listEmpty")} hint={q ? t("common.noResults") : t("vehicles.listEmptyHint")} />
        ) : (
          <>
            <p className="border-b border-line px-4 py-2 text-sm text-ink-muted">
              {tp("vehicles.count", total)}
              {total > LIMIT ? ` · ${t("common.limited", { limit: LIMIT })}` : ""}
            </p>
            <Table className="min-w-[44rem]">
                <thead>
                  <tr>
                    <th>{t("vehicles.fields.plate")}</th>
                    <th>{t("vehicles.cols.vehicle")}</th>
                    <th>{t("vehicles.fields.owner")}</th>
                    <th className="text-right">{t("nav.tires")}</th>
                    <th className="text-right">{t("nav.appointments")}</th>
                  </tr>
                </thead>
                <tbody>
                  {vehicles.map((v) => (
                    <tr key={v.id} className="row-link">
                      <td>
                        <Link href={`/vehicles/${v.id}`}>
                          <Plate>{v.plate}</Plate>
                        </Link>
                      </td>
                      <td className="text-sm">
                        {[v.make, v.model, v.year].filter(Boolean).join(" ") || <span className="text-ink-muted">–</span>}
                        {v.vin ? <div className="font-mono text-xs text-ink-muted">{v.vin}</div> : null}
                      </td>
                      <td className="text-sm">
                        {v.customer ? (
                          <Link href={`/customers/${v.customer.id}`} className="inline-flex min-h-(--tap-row) min-w-(--tap-row) items-center hover:underline">
                            {customerDisplayName(v.customer)}
                          </Link>
                        ) : (
                          <Badge>{t("vehicles.noOwner")}</Badge>
                        )}
                      </td>
                      <td className="text-right tabular">{v._count.tireSets}</td>
                      <td className="text-right tabular">{v._count.appointments}</td>
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

import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { Badge, EmptyState, PageHeader, Plate } from "@/components/ui/layout";
import { LinkButton } from "@/components/ui/buttons";
import { getI18n } from "@/i18n/server";
import { customerDisplayName } from "@/modules/workshop/customers/public";
import { normalizePlate } from "@/lib/plate";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { contains } from "@/server/search";

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

      <form method="get" className="mb-5 flex max-w-2xl flex-wrap gap-3">
        <div className="relative min-w-60 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" aria-hidden />
          <input name="q" defaultValue={q} className="input pl-9" placeholder={t("vehicles.searchList")} aria-label={t("common.search")} />
        </div>
        <select name="owner" defaultValue={noOwnerOnly ? "none" : ""} className="input w-48" aria-label={t("vehicles.fields.owner")}>
          <option value="">{t("vehicles.filters.anyOwner")}</option>
          <option value="none">{t("vehicles.filters.noOwner")}</option>
        </select>
        <button type="submit" className="btn btn-secondary">
          {t("common.filter")}
        </button>
      </form>

      <section className="card overflow-hidden">
        {vehicles.length === 0 ? (
          <EmptyState title={t("vehicles.listEmpty")} hint={q ? t("common.noResults") : t("vehicles.listEmptyHint")} />
        ) : (
          <>
            <p className="border-b border-line px-4 py-2 text-sm text-ink-muted">
              {tp("vehicles.count", total)}
              {total > LIMIT ? ` · ${t("common.limited", { limit: LIMIT })}` : ""}
            </p>
            <div className="overflow-x-auto">
              <table className="table min-w-[44rem]">
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
                          <Link href={`/customers/${v.customer.id}`} className="hover:underline">
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
              </table>
            </div>
          </>
        )}
      </section>
    </>
  );
}

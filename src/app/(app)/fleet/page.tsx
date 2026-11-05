import type { Metadata } from "next";
import clsx from "clsx";
import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { Badge, EmptyState, PageHeader, Plate } from "@/components/ui/layout";
import { LinkButton } from "@/components/ui/buttons";
import { getI18n } from "@/i18n/server";
import { employeeName } from "@/lib/domain/employees";
import { FLEET_STATUSES } from "@/lib/domain/fleet";
import { requirePermission } from "@/server/auth/session";
import { contains } from "@/server/search";
import { listFleet } from "@/modules/fleet/queries";
import { DueBadge } from "@/modules/fleet/ui";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("nav.fleet") };
}

const STATUS_TONE = { active: "success", in_service: "warning", reserve: "neutral", sold: "neutral" } as const;

export default async function FleetPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; due?: string }> }) {
  const session = await requirePermission("fleet.view");
  const [i18n, sp] = await Promise.all([getI18n(), searchParams]);
  const { t, tp, td, number } = i18n;
  const q = (sp.q ?? "").trim();
  const status = sp.status === "all" || (FLEET_STATUSES as readonly string[]).includes(sp.status ?? "") ? sp.status! : "current";

  let vehicles = await listFleet({
    ...(status === "current" ? { status: { not: "sold" } } : status !== "all" ? { status } : {}),
    ...(q ? { OR: [{ plate: contains(q) }, { make: contains(q) }, { model: contains(q) }, { vin: contains(q) }, { driver: { is: { OR: [{ lastName: contains(q) }, { firstName: contains(q) }] } } }] } : {}),
  });
  const dueCount = vehicles.filter((v) => v.dues.length > 0).length;
  if (sp.due) vehicles = vehicles.filter((v) => v.dues.length > 0);
  const canEdit = session.can("fleet.edit");

  const tab = (href: string, label: string, active: boolean) => (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={clsx("-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium", active ? "border-accent text-accent-text" : "border-transparent text-ink-muted hover:text-ink")}
    >
      {label}
    </Link>
  );

  return (
    <>
      <PageHeader
        title={t("fleet.title")}
        description={t("fleet.description")}
        actions={
          canEdit ? (
            <LinkButton href="/fleet/new" variant="primary">
              <Plus className="size-4" aria-hidden /> {t("fleet.new")}
            </LinkButton>
          ) : null
        }
      />
      <nav className="mb-5 flex gap-1 overflow-x-auto overflow-y-hidden border-b border-line" aria-label={t("fleet.title")}>
        {tab("/fleet", t("fleet.tabs.vehicles"), true)}
        {tab("/fleet/licenses", t("fleet.tabs.licenses"), false)}
      </nav>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link href="/fleet" className={clsx("badge px-3 py-1 text-sm", !sp.due ? "badge-accent" : "badge-neutral hover:bg-surface-hover")}>
          {t("fleet.filters.all")}
        </Link>
        <Link href="/fleet?due=1" className={clsx("badge px-3 py-1 text-sm", sp.due ? "badge-accent" : "badge-neutral hover:bg-surface-hover")}>
          {t("fleet.filters.due")} ({dueCount})
        </Link>
      </div>

      <form method="get" className="card card-pad mb-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_11rem_auto]">
        {sp.due ? <input type="hidden" name="due" value="1" /> : null}
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" aria-hidden />
          <input name="q" defaultValue={q} className="input pl-9" placeholder={t("fleet.searchPlaceholder")} aria-label={t("common.search")} />
        </div>
        <select name="status" defaultValue={status} className="input" aria-label={t("common.status")}>
          <option value="current">{t("fleet.filters.current")}</option>
          <option value="all">{t("fleet.filters.anyStatus")}</option>
          {FLEET_STATUSES.map((x) => (
            <option key={x} value={x}>
              {td(`fleet.statuses.${x}`, x)}
            </option>
          ))}
        </select>
        <button type="submit" className="btn btn-secondary">
          {t("common.filter")}
        </button>
      </form>

      <section className="card overflow-hidden">
        {vehicles.length === 0 ? (
          <EmptyState title={t("fleet.empty")} hint={t("fleet.emptyHint")} />
        ) : (
          <>
            <p className="border-b border-line px-4 py-2 text-sm text-ink-muted">{tp("fleet.count", vehicles.length)}</p>
            <div className="overflow-x-auto">
              <table className="table min-w-[52rem]">
                <thead>
                  <tr>
                    <th>{t("vehicles.fields.plate")}</th>
                    <th>{t("vehicles.cols.vehicle")}</th>
                    <th>{t("fleet.fields.driver")}</th>
                    <th className="text-right">{t("fleet.fields.km")}</th>
                    <th>{t("fleet.cols.dues")}</th>
                  </tr>
                </thead>
                <tbody>
                  {vehicles.map((v) => (
                    <tr key={v.id} className="row-link">
                      <td>
                        <Link href={`/fleet/${v.id}`}>
                          <Plate>{v.plate}</Plate>
                        </Link>
                        {v.status !== "active" ? <div className="mt-1"><Badge tone={STATUS_TONE[v.status as keyof typeof STATUS_TONE]}>{td(`fleet.statuses.${v.status}`, v.status)}</Badge></div> : null}
                      </td>
                      <td className="text-sm">{[v.make, v.model].filter(Boolean).join(" ") || <span className="text-ink-muted">–</span>}</td>
                      <td className="text-sm">
                        {v.driver ? (
                          <Link href={`/employees/${v.driver.id}`} className="hover:underline">
                            {employeeName(v.driver)}
                          </Link>
                        ) : (
                          <span className="text-ink-muted">{t("fleet.noDriver")}</span>
                        )}
                      </td>
                      <td className="text-right tabular text-sm">{v.currentKm != null ? `${number(v.currentKm)} km` : "–"}</td>
                      <td>
                        <div className="flex flex-wrap gap-1.5">
                          {v.dues.length ? v.dues.map((d) => <DueBadge key={d.kind} due={d} i18n={i18n} />) : <span className="text-ink-muted">–</span>}
                        </div>
                      </td>
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

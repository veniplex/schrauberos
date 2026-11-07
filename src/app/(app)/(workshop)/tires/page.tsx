import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { Badge, EmptyState, Plate, TextLink } from "@/components/ui/layout";
import { PageHeader } from "@/components/ui/page-header";
import { FilterBar } from "@/components/ui/filter-bar";
import { LinkButton } from "@/components/ui/buttons";
import { DataTable } from "@/components/ui/data-table";
import { Pagination } from "@/components/ui/pagination";
import { SegmentedLinks } from "@/components/ui/segmented";
import { getI18n } from "@/i18n/server";
import { clampPage, listLinks, parseListParams, sortFields } from "@/lib/list-params";
import { customerDisplayName } from "@/modules/workshop/customers/public";
import { TIRE_SEASONS, TIRE_SET_STATUSES } from "@/modules/workshop/tires/constants";
import { formatTireSize } from "@/modules/workshop/tires/domain";
import { requirePermission } from "@/server/auth/session";
import { bySeverity, listTireSets, type TireSetRow } from "@/modules/workshop/tires/queries";
import { HealthBadge, SeasonBadge } from "@/modules/workshop/tires/ui";
import { SearchInput, Select } from "@/components/ui/form";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("nav.tires") };
}

type SearchParams = { q?: string; status?: string; season?: string; attention?: string; swap?: string; sort?: string; dir?: string; page?: string };

/** Durchsuchbar sind Kennzeichen, Anzeigename des Halters (Richtlinie D7), Fahrzeug, Marke/Modell und Lagerort – nichts davon braucht ein Recht über `tires.view` hinaus. */
function haystack(s: TireSetRow) {
  const c = s.vehicle.customer;
  return [s.vehicle.plate, s.vehicle.plateNorm, c?.firstName, c?.lastName, c?.company, s.brand, s.model, s.storageLocation, s.vehicle.make, s.vehicle.model]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

const SORTS = ["plate", "tread", "age"] as const;
type SortKey = (typeof SORTS)[number];
const DEFAULT = { sort: "plate", dir: "asc" } as const;

export default async function TiresPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await requirePermission("tires.view");
  const sp = await searchParams;
  const i18n = await getI18n();
  const { t, tp, td, date } = i18n;

  const status = sp.status && (sp.status === "all" || (TIRE_SET_STATUSES as readonly string[]).includes(sp.status)) ? sp.status : "stored";
  const season = sp.season && (TIRE_SEASONS as readonly string[]).includes(sp.season) ? sp.season : "";
  const q = (sp.q ?? "").trim().toLowerCase();
  const list = parseListParams(sp, { sorts: SORTS, ...DEFAULT });

  const all = await listTireSets(status === "all" ? {} : { status });
  const attentionCount = all.filter((s) => s.status === "stored" && (s.health.health === "warn" || s.health.health === "replace")).length;
  const swapCount = all.filter((s) => s.swapDue).length;

  let rows = all.filter((s) => (!season || s.season === season) && (!q || haystack(s).includes(q)));
  if (sp.attention) rows = rows.filter((s) => s.health.health === "warn" || s.health.health === "replace");
  if (sp.swap) rows = rows.filter((s) => s.swapDue);
  const sign = list.dir === "asc" ? 1 : -1;
  const byPlate = (a: TireSetRow, b: TireSetRow) => a.vehicle.plateNorm.localeCompare(b.vehicle.plateNorm) || a.season.localeCompare(b.season);
  const sorters: Record<SortKey, (a: TireSetRow, b: TireSetRow) => number> = {
    plate: (a, b) => sign * byPlate(a, b),
    tread: (a, b) => sign * ((a.minTreadMm ?? 99) - (b.minTreadMm ?? 99)) || byPlate(a, b),
    age: (a, b) => sign * ((a.health.ageYears ?? 99) - (b.health.ageYears ?? 99)) || byPlate(a, b),
  };
  // „Handlungsbedarf“ ordnet nach Dringlichkeit, solange keine Spalte gewählt ist
  rows = rows.sort(sp.attention && !sp.sort ? bySeverity : sorters[list.sort as SortKey]);

  const total = rows.length;
  const page = clampPage(list.page, total, list.pageSize);
  const pageRows = rows.slice((page - 1) * list.pageSize, page * list.pageSize);

  const canCreate = session.can("tires.create");
  const canPlan = session.can("appointments.create");
  const filters = {
    q: sp.q?.trim() || undefined,
    status: sp.status && status !== "stored" ? status : undefined,
    season: season || undefined,
    attention: sp.attention ? "1" : undefined,
    swap: sp.swap ? "1" : undefined,
  };
  const links = listLinks("/tires", filters, list, DEFAULT);
  const hasFilter = Boolean(filters.q || filters.status || filters.season);

  return (
    <>
      <PageHeader
        title={t("tires.title")}
        description={t("tires.description")}
        help="workshop.tires"
        actions={
          canCreate ? (
            <LinkButton href="/tires/new" variant="primary">
              <Plus className="size-4" aria-hidden /> {t("tires.new")}
            </LinkButton>
          ) : null
        }
      />

      <SegmentedLinks
        label={t("tires.title")}
        className="mb-4"
        options={[
          { href: "/tires", active: !sp.attention && !sp.swap, label: t("tires.filters.all") },
          { href: "/tires?attention=1", active: !!sp.attention, label: `${t("tires.filters.attention")} (${attentionCount})` },
          { href: "/tires?swap=1", active: !!sp.swap, label: `${t("tires.filters.swap")} (${swapCount})` },
        ]}
      />

      <FilterBar
        keep={sortFields(list, DEFAULT)}
        columns="sm:grid-cols-[minmax(0,1fr)_10rem_10rem_auto]"
        active={hasFilter}
        extrasOpen={Boolean(filters.status || filters.season)}
        resetHref={listLinks("/tires", { attention: filters.attention, swap: filters.swap }, list, DEFAULT).pageHref(1)}
        search={<SearchInput name="q" defaultValue={sp.q ?? ""} placeholder={t("tires.searchPlaceholder")} aria-label={t("common.search")} />}
      >
        {sp.attention ? <input type="hidden" name="attention" value="1" /> : null}
        {sp.swap ? <input type="hidden" name="swap" value="1" /> : null}
        <Select name="status" defaultValue={status} aria-label={t("common.status")}>
          <option value="all">{t("tires.filters.anyStatus")}</option>
          {TIRE_SET_STATUSES.map((s) => (
            <option key={s} value={s}>
              {td(`enums.tireSetStatus.${s}`, s)}
            </option>
          ))}
        </Select>
        <Select name="season" defaultValue={season} aria-label={t("tires.fields.season")}>
          <option value="">{t("tires.filters.anySeason")}</option>
          {TIRE_SEASONS.map((s) => (
            <option key={s} value={s}>
              {td(`enums.season.${s}`, s)}
            </option>
          ))}
        </Select>
      </FilterBar>

      <DataTable
        caption={t("tires.title")}
        rows={pageRows}
        rowKey={(s) => s.id}
        rowHref={(s) => `/tires/${s.id}`}
        sort={{ key: list.sort, dir: list.dir }}
        sortHref={links.sortHref}
        minWidth="56rem"
        summary={tp("tires.count", total)}
        footer={<Pagination page={page} pageSize={list.pageSize} total={total} hrefFor={links.pageHref} />}
        empty={
          <EmptyState
            title={t("tires.empty")}
            hint={t("tires.emptyHint")}
            action={
              canCreate ? (
                <LinkButton href="/tires/new" variant="primary">
                  {t("tires.new")}
                </LinkButton>
              ) : undefined
            }
          />
        }
        columns={[
          {
            id: "vehicle",
            header: t("tires.cols.vehicle"),
            priority: "primary",
            sort: "plate",
            cell: (s) => <Plate>{s.vehicle.plate}</Plate>,
            sub: (s) => customerDisplayName(s.vehicle.customer),
          },
          {
            id: "set",
            header: t("tires.cols.set"),
            cell: (s) => (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <SeasonBadge season={s.season} td={td} />
                  {s.status !== "stored" ? <Badge>{td(`enums.tireSetStatus.${s.status}`, s.status)}</Badge> : null}
                </div>
                <p className="mt-1 text-sm">{[s.brand, s.model].filter(Boolean).join(" ") || "–"}</p>
                <p className="text-xs text-ink-muted tabular">{formatTireSize(s)}</p>
              </>
            ),
          },
          { id: "location", header: t("tires.cols.location"), cell: (s) => s.storageLocation || <span className="text-ink-muted">–</span> },
          { id: "tread", header: t("tires.cols.tread"), align: "end", sort: "tread", cell: (s) => (s.minTreadMm != null ? `${i18n.number(s.minTreadMm, { maximumFractionDigits: 1 })} mm` : "–") },
          {
            id: "age",
            header: t("tires.cols.age"),
            align: "end",
            sort: "age",
            cell: (s) => (s.health.ageYears != null ? t("tires.ageYears", { years: i18n.number(s.health.ageYears, { maximumFractionDigits: 1 }) }) : "–"),
          },
          { id: "condition", header: t("tires.cols.condition"), cell: (s) => <HealthBadge health={s.health.health} t={t} /> },
          {
            id: "appointment",
            header: t("tires.cols.appointment"),
            cell: (s) =>
              s.nextAppointment ? (
                <TextLink href={`/appointments?date=${s.nextAppointment.startsAt.toISOString().slice(0, 10)}`}>
                  {date(s.nextAppointment.startsAt, { dateStyle: "medium", timeStyle: "short" })}
                </TextLink>
              ) : s.swapDue && canPlan ? (
                <LinkButton size="sm" href={`/appointments?new=1&tireSet=${s.id}`}>
                  {t("tires.planChange")}
                </LinkButton>
              ) : (
                <span className="text-ink-muted">–</span>
              ),
          },
        ]}
      />
    </>
  );
}

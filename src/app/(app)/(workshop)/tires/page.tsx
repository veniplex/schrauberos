import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Badge, Card, ChipLink, EmptyState, FilterBar, PageHeader, Plate, Table } from "@/components/ui/layout";
import { LinkButton } from "@/components/ui/buttons";
import { getI18n } from "@/i18n/server";
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

type SearchParams = { q?: string; status?: string; season?: string; attention?: string; swap?: string };

function haystack(s: TireSetRow) {
  const c = s.vehicle.customer;
  return [s.vehicle.plate, s.vehicle.plateNorm, c?.firstName, c?.lastName, c?.company, s.brand, s.model, s.storageLocation, s.vehicle.make, s.vehicle.model]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export default async function TiresPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await requirePermission("tires.view");
  const sp = await searchParams;
  const i18n = await getI18n();
  const { t, tp, td, date } = i18n;

  const status = sp.status && (sp.status === "all" || (TIRE_SET_STATUSES as readonly string[]).includes(sp.status)) ? sp.status : "stored";
  const season = sp.season && (TIRE_SEASONS as readonly string[]).includes(sp.season) ? sp.season : "";
  const q = (sp.q ?? "").trim().toLowerCase();

  const all = await listTireSets(status === "all" ? {} : { status });
  const attentionCount = all.filter((s) => s.status === "stored" && (s.health.health === "warn" || s.health.health === "replace")).length;
  const swapCount = all.filter((s) => s.swapDue).length;

  let rows = all.filter((s) => (!season || s.season === season) && (!q || haystack(s).includes(q)));
  if (sp.attention) rows = rows.filter((s) => s.health.health === "warn" || s.health.health === "replace");
  if (sp.swap) rows = rows.filter((s) => s.swapDue);
  rows = rows.sort(
    sp.attention ? bySeverity : (a, b) => a.vehicle.plateNorm.localeCompare(b.vehicle.plateNorm) || a.season.localeCompare(b.season),
  );

  const canCreate = session.can("tires.create");
  const canPlan = session.can("appointments.create");
  const quick = (href: string, active: boolean, label: string) => (
    <ChipLink href={href} active={active}>
      {label}
    </ChipLink>
  );

  return (
    <>
      <PageHeader
        title={t("tires.title")}
        description={t("tires.description")}
        actions={
          canCreate ? (
            <LinkButton href="/tires/new" variant="primary">
              <Plus className="size-4" aria-hidden /> {t("tires.new")}
            </LinkButton>
          ) : null
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {quick("/tires", !sp.attention && !sp.swap, t("tires.filters.all"))}
        {quick("/tires?attention=1", !!sp.attention, `${t("tires.filters.attention")} (${attentionCount})`)}
        {quick("/tires?swap=1", !!sp.swap, `${t("tires.filters.swap")} (${swapCount})`)}
      </div>

      <FilterBar columns="sm:grid-cols-[minmax(0,1fr)_10rem_10rem_auto]" submitLabel={t("common.filter")}>
        {sp.attention ? <input type="hidden" name="attention" value="1" /> : null}
        {sp.swap ? <input type="hidden" name="swap" value="1" /> : null}
        <SearchInput name="q" defaultValue={sp.q ?? ""} placeholder={t("tires.searchPlaceholder")} aria-label={t("common.search")} />
        <Select name="status" defaultValue={status}  aria-label={t("common.status")}>
          <option value="all">{t("tires.filters.anyStatus")}</option>
          {TIRE_SET_STATUSES.map((s) => (
            <option key={s} value={s}>
              {td(`enums.tireSetStatus.${s}`, s)}
            </option>
          ))}
        </Select>
        <Select name="season" defaultValue={season}  aria-label={t("tires.fields.season")}>
          <option value="">{t("tires.filters.anySeason")}</option>
          {TIRE_SEASONS.map((s) => (
            <option key={s} value={s}>
              {td(`enums.season.${s}`, s)}
            </option>
          ))}
        </Select>
</FilterBar>

      <Card padded={false} className="overflow-hidden" aria-label={t("tires.title")}>
        {rows.length === 0 ? (
          <EmptyState
            title={t("tires.empty")}
            hint={t("tires.emptyHint")}
            action={canCreate ? <LinkButton href="/tires/new" variant="primary">{t("tires.new")}</LinkButton> : undefined}
          />
        ) : (
          <>
            <p className="border-b border-line px-4 py-2 text-sm text-ink-muted">{tp("tires.count", rows.length)}</p>
            <Table className="min-w-[56rem]">
                <thead>
                  <tr>
                    <th>{t("tires.cols.vehicle")}</th>
                    <th>{t("tires.cols.set")}</th>
                    <th>{t("tires.cols.location")}</th>
                    <th className="text-right">{t("tires.cols.tread")}</th>
                    <th className="text-right">{t("tires.cols.age")}</th>
                    <th>{t("tires.cols.condition")}</th>
                    <th>{t("tires.cols.appointment")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s) => (
                    <tr key={s.id} className="row-link">
                      <td>
                        <Link href={`/tires/${s.id}`} className="block">
                          <Plate>{s.vehicle.plate}</Plate>
                          <span className="mt-1 block text-sm text-ink-muted">{customerDisplayName(s.vehicle.customer)}</span>
                        </Link>
                      </td>
                      <td>
                        <div className="flex flex-wrap items-center gap-2">
                          <SeasonBadge season={s.season} td={td} />
                          {s.status !== "stored" ? <Badge>{td(`enums.tireSetStatus.${s.status}`, s.status)}</Badge> : null}
                        </div>
                        <p className="mt-1 text-sm">{[s.brand, s.model].filter(Boolean).join(" ") || "–"}</p>
                        <p className="text-xs text-ink-muted tabular">{formatTireSize(s)}</p>
                      </td>
                      <td className="text-sm">{s.storageLocation || <span className="text-ink-muted">–</span>}</td>
                      <td className="text-right tabular">{s.minTreadMm != null ? `${i18n.number(s.minTreadMm, { maximumFractionDigits: 1 })} mm` : "–"}</td>
                      <td className="text-right tabular">
                        {s.health.ageYears != null ? t("tires.ageYears", { years: i18n.number(s.health.ageYears, { maximumFractionDigits: 1 }) }) : "–"}
                      </td>
                      <td>
                        <HealthBadge health={s.health.health} t={t} />
                      </td>
                      <td className="text-sm">
                        {s.nextAppointment ? (
                          <Link href={`/appointments?date=${s.nextAppointment.startsAt.toISOString().slice(0, 10)}`} className="text-accent-text hover:underline">
                            {date(s.nextAppointment.startsAt, { dateStyle: "medium", timeStyle: "short" })}
                          </Link>
                        ) : s.swapDue && canPlan ? (
                          <LinkButton size="sm" href={`/appointments?new=1&tireSet=${s.id}`}>
                            {t("tires.planChange")}
                          </LinkButton>
                        ) : (
                          <span className="text-ink-muted">–</span>
                        )}
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

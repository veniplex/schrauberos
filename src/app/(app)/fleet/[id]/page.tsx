import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import { Badge, Card, DefinitionList, EmptyState, PageHeader, Plate } from "@/components/ui/layout";
import { ConfirmSubmitButton, LinkButton } from "@/components/ui/buttons";
import { getI18n } from "@/i18n/server";
import { todayInput } from "@/lib/dates";
import { DUE_TONE, dueState } from "@/lib/domain/due";
import { employeeName } from "@/lib/domain/employees";
import { COST_CATEGORIES, costPerKm, currentMileage, fleetDues } from "@/lib/domain/fleet";
import { formatCents } from "@/lib/money";
import { INTL_LOCALE } from "@/i18n/config";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { deleteCost, deleteFleetVehicle, deleteMileage } from "@/modules/fleet/actions";
import { CostForm, MileageForm } from "@/modules/fleet/forms";
import { DueBadge } from "@/modules/fleet/ui";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const v = await db.fleetVehicle.findUnique({ where: { id } });
  return { title: v?.plate };
}

export default async function FleetVehiclePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("fleet.view");
  const [{ id }, i18n] = await Promise.all([params, getI18n()]);
  const { t, td, date, number, locale } = i18n;
  const eur = (cents: number) => formatCents(cents, INTL_LOCALE[locale]);
  const canEdit = session.can("fleet.edit");

  const v = await db.fleetVehicle.findUnique({
    where: { id },
    include: {
      driver: { include: { licenseChecks: { orderBy: { checkedAt: "desc" }, take: 1 } } },
      mileage: { orderBy: [{ date: "desc" }, { km: "desc" }], take: 30 },
      costs: { orderBy: { date: "desc" }, take: 50 },
    },
  });
  if (!v) notFound();

  const km = currentMileage(v.mileage);
  const dues = fleetDues(v, km);
  const total = v.costs.reduce((n, c) => n + c.amountCents, 0);
  const perKm = costPerKm(total, v.mileage);
  const byCategory = COST_CATEGORIES.map((c) => ({ c, sum: v.costs.filter((x) => x.category === c).reduce((n, x) => n + x.amountCents, 0) })).filter((x) => x.sum > 0);
  const license = v.driver?.licenseChecks[0];
  const licenseState = license ? dueState(license.nextDue, 60) : null;
  const today = todayInput();

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            <Plate>{v.plate}</Plate>
            <span>{[v.make, v.model].filter(Boolean).join(" ") || t("fleet.title")}</span>
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={v.status === "active" ? "success" : "neutral"}>{td(`fleet.statuses.${v.status}`, v.status)}</Badge>
            {km != null ? <span className="tabular">{number(km)} km</span> : null}
          </span>
        }
        actions={
          canEdit ? (
            <LinkButton href={`/fleet/${v.id}/edit`}>
              <Pencil className="size-4" aria-hidden /> {t("common.edit")}
            </LinkButton>
          ) : null
        }
      />

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="flex flex-col gap-5 xl:col-span-2">
          <Card title={t("fleet.sections.duesNow")}>
            {dues.length === 0 ? (
              <p className="text-sm text-ink-muted">{t("fleet.noDues")}</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {dues.map((d) => (
                  <DueBadge key={d.kind} due={d} i18n={i18n} />
                ))}
              </div>
            )}
          </Card>

          <Card title={t("fleet.sections.mileage")} padded={false}>
            {v.mileage.length === 0 ? (
              <EmptyState title={t("fleet.noMileage")} />
            ) : (
              <div className="max-h-72 overflow-auto">
                <table className="table">
                  <tbody>
                    {v.mileage.map((m) => (
                      <tr key={m.id}>
                        <td className="tabular">{date(m.date)}</td>
                        <td className="text-right tabular font-medium">{number(m.km)} km</td>
                        <td className="text-sm text-ink-muted">{m.note}</td>
                        {canEdit ? (
                          <td className="w-12">
                            <form action={deleteMileage}>
                              <input type="hidden" name="id" value={m.id} />
                              <ConfirmSubmitButton message={t("fleet.deleteConfirm")} aria-label={t("common.delete")}>
                                <Trash2 className="size-3.5" aria-hidden />
                              </ConfirmSubmitButton>
                            </form>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {canEdit ? (
              <div className="border-t border-line px-5 py-4">
                <MileageForm fleetVehicleId={v.id} today={today} />
              </div>
            ) : null}
          </Card>

          <Card title={t("fleet.sections.costs")} padded={false}>
            {v.costs.length === 0 ? (
              <EmptyState title={t("fleet.noCosts")} />
            ) : (
              <>
                <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 border-b border-line px-5 py-3 text-sm">
                  <span>
                    {t("fleet.costTotal")}: <strong className="tabular">{eur(total)}</strong>
                  </span>
                  {perKm != null ? (
                    <span>
                      {t("fleet.costPerKm")}: <strong className="tabular">{eur(Math.round(perKm))}</strong>
                    </span>
                  ) : null}
                  <span className="flex flex-wrap gap-1.5">
                    {byCategory.map(({ c, sum }) => (
                      <Badge key={c}>
                        {td(`fleet.costCategories.${c}`, c)} {eur(sum)}
                      </Badge>
                    ))}
                  </span>
                </div>
                <div className="max-h-72 overflow-auto">
                  <table className="table">
                    <tbody>
                      {v.costs.map((c) => (
                        <tr key={c.id}>
                          <td className="tabular">{date(c.date)}</td>
                          <td className="text-sm">{td(`fleet.costCategories.${c.category}`, c.category)}</td>
                          <td className="text-right tabular font-medium">{eur(c.amountCents)}</td>
                          <td className="text-sm text-ink-muted">{[c.km != null ? `${number(c.km)} km` : "", c.note ?? ""].filter(Boolean).join(" · ")}</td>
                          {canEdit ? (
                            <td className="w-12">
                              <form action={deleteCost}>
                                <input type="hidden" name="id" value={c.id} />
                                <ConfirmSubmitButton message={t("fleet.deleteConfirm")} aria-label={t("common.delete")}>
                                  <Trash2 className="size-3.5" aria-hidden />
                                </ConfirmSubmitButton>
                              </form>
                            </td>
                          ) : null}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            {canEdit ? (
              <div className="border-t border-line px-5 py-4">
                <CostForm fleetVehicleId={v.id} today={today} />
              </div>
            ) : null}
          </Card>
        </div>

        <div className="flex flex-col gap-5">
          <Card title={t("fleet.sections.vehicle")}>
            <DefinitionList
              items={[
                {
                  label: t("fleet.fields.driver"),
                  value: v.driver ? (
                    <Link href={`/employees/${v.driver.id}`} className="text-accent-text hover:underline">
                      {employeeName(v.driver)}
                    </Link>
                  ) : null,
                },
                {
                  label: t("fleet.tabs.licenses"),
                  value: v.driver ? (
                    license ? (
                      <Badge tone={licenseState ? DUE_TONE[licenseState] : "neutral"}>
                        {t("fleet.nextCheck")} {date(license.nextDue)}
                      </Badge>
                    ) : (
                      <Badge tone="danger">{t("fleet.neverChecked")}</Badge>
                    )
                  ) : null,
                },
                { label: t("fleet.fields.location"), value: v.location },
                { label: t("vehicles.fields.vin"), value: v.vin ? <span className="font-mono">{v.vin}</span> : null },
                { label: t("vehicles.fields.year"), value: v.year },
                { label: t("fleet.fields.fuelType"), value: v.fuelType ? td(`fleet.fuelTypes.${v.fuelType}`, v.fuelType) : null },
                { label: t("fleet.fields.fuelCardNo"), value: v.fuelCardNo ? <span className="font-mono">{v.fuelCardNo}</span> : null },
              ]}
            />
          </Card>

          <Card title={t("fleet.sections.contracts")}>
            <DefinitionList
              items={[
                { label: t("fleet.fields.huDue"), value: v.huDue ? date(v.huDue) : null },
                { label: t("fleet.fields.serviceDue"), value: v.serviceDue ? date(v.serviceDue) : null },
                { label: t("fleet.fields.serviceDueKm"), value: v.serviceDueKm != null ? `${number(v.serviceDueKm)} km` : null },
                { label: t("fleet.fields.insuranceCompany"), value: [v.insuranceCompany, v.insurancePolicy].filter(Boolean).join(" · ") },
                { label: t("fleet.fields.insuranceUntil"), value: v.insuranceUntil ? date(v.insuranceUntil) : null },
                { label: t("fleet.fields.leasingProvider"), value: [v.leasingProvider, v.leasingRateCents != null ? `${eur(v.leasingRateCents)} ${t("fleet.fields.perMonth")}` : ""].filter(Boolean).join(" · ") },
                { label: t("fleet.fields.leasingUntil"), value: v.leasingUntil ? date(v.leasingUntil) : null },
                { label: t("common.notes"), value: v.notes },
              ]}
            />
          </Card>

          {session.can("fleet.delete") ? (
            <form action={deleteFleetVehicle}>
              <input type="hidden" name="id" value={v.id} />
              <ConfirmSubmitButton message={t("fleet.confirmDelete", { plate: v.plate })}>{t("fleet.delete")}</ConfirmSubmitButton>
            </form>
          ) : null}
        </div>
      </div>
    </>
  );
}

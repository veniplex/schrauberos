import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import { Badge, Card, DefinitionList, EmptyState, Plate, Table, TextLink, StatusBadge, DangerZone } from "@/components/ui/layout";
import { PageHeader } from "@/components/ui/page-header";
import { LinkButton } from "@/components/ui/buttons";
import { ConfirmSubmitButton } from "@/components/ui/confirm-dialog";
import { getI18n } from "@/i18n/server";
import { endOfDayIn, startOfDayIn, todayInput } from "@/lib/dates";
import { dayKey } from "@/lib/zone";
import { DUE_TONE, dueState } from "@/lib/due";
import { FLEET_STATUS_TONE } from "@/modules/office/fleet/status-tone";
import type { FleetStatus } from "@/modules/office/fleet/domain";
import { employeeName } from "@/modules/office/employees/public";
import { COST_CATEGORIES, costPeriod, currentMileage, fleetDues } from "@/modules/office/fleet/domain";
import { formatCents } from "@/lib/money";
import { INTL_LOCALE } from "@/i18n/config";
import { requirePermission, sessionIfAllowed } from "@/server/auth/session";
import { db } from "@/server/db";
import { fleetPlate, getFleetVehicleDetail } from "@/modules/office/fleet/queries";
import { deleteCost, deleteFleetVehicle, deleteMileage } from "@/modules/office/fleet/actions";
import { CostForm, MileageForm } from "@/modules/office/fleet/forms";
import { DueBadge } from "@/modules/office/fleet/ui";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  if (!(await sessionIfAllowed("fleet.view"))) return {};
  return { title: (await fleetPlate(id)) ?? undefined };
}

export default async function FleetVehiclePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("fleet.view");
  const [{ id }, i18n] = await Promise.all([params, getI18n()]);
  const { t, td, date, number, locale } = i18n;
  const eur = (cents: number) => formatCents(cents, INTL_LOCALE[locale]);
  const canEdit = session.can("fleet.edit");

  const v = await getFleetVehicleDetail(id);
  if (!v) notFound();

  // Summen und Kilometerspanne über ALLE Einträge des Fahrzeugs (von der Datenbank gerechnet) – die Listen darunter zeigen nur die neuesten
  const [costSum, costGroups, kmRange, firstKm, lastKm] = await Promise.all([
    db.fleetCost.aggregate({ where: { fleetVehicleId: id }, _sum: { amountCents: true } }),
    db.fleetCost.groupBy({ by: ["category"], where: { fleetVehicleId: id }, _sum: { amountCents: true } }),
    db.fleetMileage.aggregate({ where: { fleetVehicleId: id }, _max: { km: true } }),
    db.fleetMileage.findFirst({ where: { fleetVehicleId: id }, orderBy: [{ date: "asc" }, { km: "asc" }], select: { date: true, km: true } }),
    db.fleetMileage.findFirst({ where: { fleetVehicleId: id }, orderBy: [{ date: "desc" }, { km: "desc" }], select: { date: true, km: true } }),
  ]);
  const km = kmRange._max.km ?? currentMileage(v.mileage);
  const dues = fleetDues(v, km);
  const total = costSum._sum.amountCents ?? 0;
  // Kosten pro Kilometer nur über den Kostenzeitraum (erster bis letzter Kilometerstand): Kosten im Zeitraum / Kilometer im Zeitraum
  const period = firstKm && lastKm ? costPeriod([firstKm, lastKm]) : null;
  const periodCosts = period
    ? (await db.fleetCost.aggregate({ where: { fleetVehicleId: id, date: { gte: startOfDayIn(dayKey(period.from)), lte: endOfDayIn(dayKey(period.to)) } }, _sum: { amountCents: true } }))._sum.amountCents ?? 0
    : 0;
  const perKm = period ? periodCosts / period.km : null;
  const byCategory = COST_CATEGORIES.map((c) => ({ c, sum: costGroups.find((g) => g.category === c)?._sum.amountCents ?? 0 })).filter((x) => x.sum > 0);
  const license = v.driver?.licenseChecks[0];
  const licenseState = license ? dueState(license.nextDue, 60) : null;
  const today = todayInput();

  return (
    <>
      <PageHeader
        back={{ href: "/fleet", label: t("nav.fleet") }} help="office.fleet"
        title={
          <span className="flex flex-wrap items-center gap-3">
            <Plate>{v.plate}</Plate>
            <span>{[v.make, v.model].filter(Boolean).join(" ") || t("fleet.title")}</span>
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={FLEET_STATUS_TONE[v.status as FleetStatus] ?? "neutral"}>{td(`fleet.statuses.${v.status}`, v.status)}</StatusBadge>
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

      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
        <div className="min-w-0 flex flex-col gap-5 md:col-span-2">
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
              <Table caption={t("fleet.sections.mileage")} scrollClassName="max-h-72 overflow-auto">
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
                              <ConfirmSubmitButton message={t("fleet.deleteConfirm")} target={`${date(m.date)}, ${number(m.km)} km`} label={t("common.delete")}>
                                <Trash2 className="size-3.5" aria-hidden />
                              </ConfirmSubmitButton>
                            </form>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </Table>
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
                      {t("fleet.costPerKm")}: <strong className="tabular">{eur(Math.round(perKm))}</strong>{" "}
                      {period ? <span className="text-ink-muted">({t("fleet.costPerKmPeriod", { from: date(period.from, { dateStyle: "medium" }), to: date(period.to, { dateStyle: "medium" }), km: number(period.km) })})</span> : null}
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
                <Table caption={t("fleet.sections.costs")} scrollClassName="max-h-72 overflow-auto">
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
                                <ConfirmSubmitButton message={t("fleet.deleteConfirm")} target={`${date(c.date)}, ${eur(c.amountCents)}`} label={t("common.delete")}>
                                  <Trash2 className="size-3.5" aria-hidden />
                                </ConfirmSubmitButton>
                              </form>
                            </td>
                          ) : null}
                        </tr>
                      ))}
                    </tbody>
                  </Table>
              </>
            )}
            {canEdit ? (
              <div className="border-t border-line px-5 py-4">
                <CostForm fleetVehicleId={v.id} today={today} />
              </div>
            ) : null}
          </Card>
        </div>

        <div className="min-w-0 flex flex-col gap-5">
          <Card title={t("fleet.sections.vehicle")}>
            <DefinitionList
              items={[
                {
                  label: t("fleet.fields.driver"),
                  value: v.driver ? (
                    <TextLink href={`/employees/${v.driver.id}`}>
                      {employeeName(v.driver)}
                    </TextLink>
                  ) : null,
                },
                {
                  label: t("fleet.tabs.licenses"),
                  value: v.driver ? (
                    license ? (
                      <StatusBadge tone={licenseState ? DUE_TONE[licenseState] : "neutral"}>
                        {t("fleet.nextCheck")} {date(license.nextDue)}
                      </StatusBadge>
                    ) : (
                      <StatusBadge tone="danger">{t("fleet.neverChecked")}</StatusBadge>
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
            <DangerZone title={t("common.dangerZone")}>
              <form action={deleteFleetVehicle}>
                <input type="hidden" name="id" value={v.id} />
                <ConfirmSubmitButton message={t("fleet.confirmDelete", { plate: v.plate })}>{t("fleet.delete")}</ConfirmSubmitButton>
              </form>
            </DangerZone>
          ) : null}
        </div>
      </div>
    </>
  );
}

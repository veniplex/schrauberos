import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarPlus, Disc3, Pencil, Repeat } from "lucide-react";
import { Badge, Card, DefinitionList, EmptyState, Plate, TextLink, StatusBadge } from "@/components/ui/layout";
import { ArchivePanel } from "@/components/archive/archive-panel";
import { PageHeader } from "@/components/ui/page-header";
import { LinkButton } from "@/components/ui/buttons";
import { UrlModal } from "@/components/ui/modal";
import { getI18n } from "@/i18n/server";
import { nowDate, toDateInput, todayInput } from "@/lib/dates";
import { monthStart } from "@/lib/month";
import { customerDisplayName } from "@/modules/workshop/customers/public";
import { getVehicleDetail } from "@/modules/workshop/vehicles/queries";
import { requirePermission, sessionIfAllowed } from "@/server/auth/session";
import { db } from "@/server/db";
import { STATUS_TONE } from "@/modules/workshop/appointments/public";
import { HealthBadge, SeasonBadge, formatTireSize, getTireRules, setHealth } from "@/modules/workshop/tires/public";
import { archiveVehicle, deleteVehicle, unarchiveVehicle } from "@/modules/workshop/vehicles/actions";
import { TransferForm } from "@/modules/workshop/vehicles/forms";
import { extraInspectionState, inspectionState, monthOf, ownershipTransfers, vehicleDeletable, type InspectionState } from "@/modules/workshop/vehicles/domain";
import { INSPECTION_TONE } from "@/modules/workshop/vehicles/status-tone";
import { formatMileage } from "@/modules/workshop/vehicles/format";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  if (!(await sessionIfAllowed("vehicles.view"))) return {};
  const v = await db.vehicle.findUnique({ where: { id } });
  return { title: v?.plate };
}

export default async function VehiclePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ transfer?: string }>;
}) {
  const session = await requirePermission("vehicles.view");
  const [{ id }, sp, i18n, tireRules] = await Promise.all([params, searchParams, getI18n(), getTireRules()]);
  const { t, td, date } = i18n;

  const vehicle = await getVehicleDetail(session, id);
  if (!vehicle) notFound();

  const canEdit = session.can("vehicles.edit");
  const transfers = ownershipTransfers(vehicle.ownerships);
  const base = `/vehicles/${vehicle.id}`;
  const thisMonth = monthOf(nowDate());
  const monthLabel = (month: string) => date(monthStart(month), { month: "long", year: "numeric" });
  const inspectionBadge = (state: InspectionState | null, month: string) =>
    state ? <StatusBadge tone={INSPECTION_TONE[state]}>{t(`vehicles.inspection.${state}`, { month: monthLabel(month) })}</StatusBadge> : null;
  const dueState = inspectionState(vehicle.inspectionDue, thisMonth);
  const extraState = extraInspectionState(vehicle.extraInspectionDue, thisMonth);

  return (
    <>
      <PageHeader
        back={{ href: "/vehicles", label: t("nav.vehicles") }} help="workshop.vehicles"
        title={
          <span className="flex flex-wrap items-center gap-3">
            <Plate>{vehicle.plate}</Plate>
            <span>{[vehicle.make, vehicle.model].filter(Boolean).join(" ") || t("vehicles.title")}</span>
          </span>
        }
        description={[vehicle.year, vehicle.vin].filter(Boolean).join(" · ") || undefined}
        actions={
          canEdit ? (
            <>
              <LinkButton href={`${base}?transfer=1`}>
                <Repeat className="size-4" aria-hidden /> {t("vehicles.transfer")}
              </LinkButton>
              <LinkButton href={`${base}/edit`}>
                <Pencil className="size-4" aria-hidden /> {t("common.edit")}
              </LinkButton>
            </>
          ) : null
        }
      />

      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
        <div className="min-w-0 flex flex-col gap-5 md:col-span-2">
          {session.can("tires.view") ? (
            <Card
              title={t("nav.tires")}
              padded={false}
              actions={
                session.can("tires.create") ? (
                  <LinkButton size="sm" href={`/tires/new?vehicle=${vehicle.id}`}>
                    <Disc3 className="size-3.5" aria-hidden /> {t("tires.new")}
                  </LinkButton>
                ) : null
              }
            >
              {vehicle.tireSets.length === 0 ? (
                <EmptyState title={t("vehicles.noTireSets")} />
              ) : (
                <ul className="divide-y divide-line">
                  {vehicle.tireSets.map((s) => (
                    <li key={s.id}>
                      <Link href={`/tires/${s.id}`} className="flex flex-wrap items-center gap-2 px-5 py-3 text-sm hover:bg-surface-hover">
                        <SeasonBadge season={s.season} td={td} />
                        <span>{[s.brand, s.model, formatTireSize(s)].filter(Boolean).join(" · ")}</span>
                        <span className="text-ink-muted">{s.storageLocation}</span>
                        <span className="ml-auto flex items-center gap-2">
                          {s.status !== "stored" ? <Badge>{td(`enums.tireSetStatus.${s.status}`, s.status)}</Badge> : null}
                          <HealthBadge health={setHealth(s.tires, tireRules).health} t={t} />
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ) : null}

          {session.can("appointments.view") ? (
            <Card
              title={t("nav.appointments")}
              padded={false}
              actions={
                session.can("appointments.create") ? (
                  <LinkButton size="sm" href={`/appointments?new=1&vehicle=${vehicle.id}`}>
                    <CalendarPlus className="size-3.5" aria-hidden /> {t("appointments.new")}
                  </LinkButton>
                ) : null
              }
            >
              {vehicle.appointments.length === 0 ? (
                <EmptyState title={t("customers.noAppointments")} />
              ) : (
                <ul className="divide-y divide-line">
                  {vehicle.appointments.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                      <Link href={`/appointments?date=${toDateInput(a.startsAt)}`} className="inline-flex min-h-(--tap-row) min-w-(--tap-row) items-center hover:underline">
                        <span className="tabular font-medium">{date(a.startsAt, { dateStyle: "medium", timeStyle: "short" })}</span>
                        <span className="ml-2">{a.title}</span>
                      </Link>
                      <StatusBadge tone={STATUS_TONE[a.status as keyof typeof STATUS_TONE] ?? "neutral"}>{td(`enums.appointmentStatus.${a.status}`, a.status)}</StatusBadge>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ) : null}
        </div>

        <div className="min-w-0 flex flex-col gap-5">
          <Card title={t("vehicles.fields.owner")}>
            <p className="font-medium">
              {vehicle.customer ? (
                <TextLink href={`/customers/${vehicle.customer.id}`}>
                  {customerDisplayName(vehicle.customer)}
                </TextLink>
              ) : (
                <span className="text-ink-muted">{t("vehicles.noOwner")}</span>
              )}
            </p>
            {vehicle.ownerPhone ? <p className="mt-1 text-sm">{vehicle.ownerPhone}</p> : null}
            <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-ink-muted">{t("vehicles.ownerHistory")}</h3>
            {vehicle.ownerships.length === 0 ? (
              <p className="text-sm text-ink-muted">{t("vehicles.noHistory")}</p>
            ) : (
              <ol className="flex flex-col gap-3 border-l border-line pl-4">
                {vehicle.ownerships.map((o) => (
                  <li key={o.id} className="relative text-sm">
                    <span aria-hidden className={`absolute -left-[1.3rem] top-1.5 size-2.5 rounded-full ${o.toDate ? "bg-line-strong" : "bg-accent"}`} />
                    <Link href={`/customers/${o.customer.id}`} className="font-medium inline-flex min-h-(--tap-row) min-w-(--tap-row) items-center hover:underline">
                      {customerDisplayName(o.customer)}
                    </Link>
                    <p className="text-xs text-ink-muted tabular">
                      {date(o.fromDate)} – {o.toDate ? date(o.toDate) : t("vehicles.today")}
                    </p>
                    {o.note ? <p className="text-xs text-ink-muted">{o.note}</p> : null}
                  </li>
                ))}
              </ol>
            )}
          </Card>

          <Card title={t("vehicles.sections.inspections")}>
            <DefinitionList
              items={[
                {
                  label: t("vehicles.fields.inspectionDue"),
                  value: vehicle.inspectionDue ? inspectionBadge(dueState, vehicle.inspectionDue) : <span className="text-ink-muted">{t("vehicles.inspection.none")}</span>,
                },
                ...(vehicle.extraInspectionKind && vehicle.extraInspectionDue
                  ? [
                      {
                        label: td(`vehicles.extraKinds.${vehicle.extraInspectionKind}`, vehicle.extraInspectionKind),
                        value: (
                          <span className="inline-flex flex-wrap items-center gap-2">
                            <span className="tabular">{date(vehicle.extraInspectionDue)}</span>
                            {extraState && extraState !== "ok" ? <StatusBadge tone={INSPECTION_TONE[extraState]}>{t(`vehicles.inspection.${extraState}`, { month: monthLabel(monthOf(vehicle.extraInspectionDue)) })}</StatusBadge> : null}
                          </span>
                        ),
                      },
                    ]
                  : []),
              ]}
            />
          </Card>

          <Card title={t("vehicles.details")}>
            <DefinitionList
              items={[
                { label: t("vehicles.fields.vin"), value: vehicle.vin ? <span className="font-mono">{vehicle.vin}</span> : null },
                { label: t("vehicles.fields.year"), value: vehicle.year },
                { label: t("vehicles.fields.firstRegistration"), value: vehicle.firstRegistration ? date(vehicle.firstRegistration) : null },
                { label: t("vehicles.fields.fuel"), value: vehicle.fuel ? td(`vehicles.fuelTypes.${vehicle.fuel}`, vehicle.fuel) : null },
                { label: t("vehicles.fields.mileage"), value: vehicle.mileageKm != null ? <span className="tabular">{formatMileage(vehicle.mileageKm, i18n.number)}</span> : null },
                { label: `${t("vehicles.fields.hsn")} / ${t("vehicles.fields.tsn")}`, value: vehicle.hsn || vehicle.tsn ? <span className="font-mono">{[vehicle.hsn, vehicle.tsn].filter(Boolean).join(" / ")}</span> : null },
                { label: t("common.notes"), value: vehicle.notes },
              ]}
            />
          </Card>

          <ArchivePanel
            id={vehicle.id}
            archived={Boolean(vehicle.archivedAt)}
            deps={[
              { kind: "appointments", count: vehicle._count.appointments },
              { kind: "tireSets", count: vehicle._count.tireSets },
              { kind: "orders", count: vehicle._count.orders },
              { kind: "transfers", count: transfers },
            ]}
            canArchive={canEdit}
            canDelete={session.can("vehicles.delete")}
            deletable={vehicleDeletable({ appointments: vehicle._count.appointments, tireSets: vehicle._count.tireSets, orders: vehicle._count.orders, transfers })}
            archive={archiveVehicle}
            unarchive={unarchiveVehicle}
            remove={deleteVehicle}
            deleteLabel={t("vehicles.delete")}
            confirmDelete={t("vehicles.confirmDelete")}
          />
        </div>
      </div>

      {canEdit && sp.transfer ? (
        <UrlModal title={t("vehicles.transfer")} closeHref={base}>
          <TransferForm vehicleId={vehicle.id} today={todayInput()} closeHref={base} />
        </UrlModal>
      ) : null}
    </>
  );
}

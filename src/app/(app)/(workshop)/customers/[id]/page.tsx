import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarPlus, Disc3, Pencil, Plus } from "lucide-react";
import { Badge, Card, DefinitionList, EmptyState, PageHeader, Plate } from "@/components/ui/layout";
import { ConfirmSubmitButton, LinkButton } from "@/components/ui/buttons";
import { getI18n } from "@/i18n/server";
import { customerDisplayName } from "@/modules/workshop/customers/domain";
import { toDateInput } from "@/lib/dates";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { deleteCustomer } from "@/modules/workshop/customers/actions";
import { HealthBadge, SeasonBadge, formatTireSize, getTireRules, setHealth } from "@/modules/workshop/tires/public";
import { STATUS_TONE } from "@/modules/workshop/appointments/public";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const c = await db.customer.findUnique({ where: { id } });
  return { title: c ? customerDisplayName(c) : undefined };
}

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("customers.view");
  const canTires = session.can("tires.view");
  const [{ id }, i18n, tireRules] = await Promise.all([params, getI18n(), canTires ? getTireRules() : null]);
  const { t, tp, td, date } = i18n;

  const customer = await db.customer.findUnique({
    where: { id },
    include: {
      vehicles: { orderBy: { plateNorm: "asc" }, include: { tireSets: { include: { tires: true } } } },
      appointments: { orderBy: { startsAt: "desc" }, take: 8, include: { vehicle: true } },
      _count: { select: { appointments: true } },
    },
  });
  if (!customer) notFound();

  const canEdit = session.can("customers.edit");
  const canDelete = session.can("customers.delete");
  const canVehicles = session.can("vehicles.view");
  const canEditVehicles = session.can("vehicles.edit");
  const address = [customer.street, [customer.zip, customer.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");

  return (
    <>
      <PageHeader
        title={customerDisplayName(customer)}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {customer.customerNumber ? <span className="tabular">#{customer.customerNumber}</span> : null}
            {customer.externalSource ? <Badge tone="info">{customer.externalSource === "werbas" ? "Werbas" : customer.externalSource}</Badge> : null}
          </span>
        }
        actions={
          canEdit ? (
            <LinkButton href={`/customers/${customer.id}/edit`}>
              <Pencil className="size-4" aria-hidden /> {t("common.edit")}
            </LinkButton>
          ) : null
        }
      />

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="flex flex-col gap-5 xl:col-span-2">
          {canVehicles ? (
          <Card
            title={t("customers.vehicles")}
            padded={false}
            actions={
              canEditVehicles ? (
                <LinkButton size="sm" href={`/vehicles/new?customer=${customer.id}`}>
                  <Plus className="size-3.5" aria-hidden /> {t("vehicles.new")}
                </LinkButton>
              ) : null
            }
          >
            {customer.vehicles.length === 0 ? (
              <EmptyState title={t("vehicles.empty")} />
            ) : (
              <ul className="divide-y divide-line">
                {customer.vehicles.map((v) => (
                  <li key={v.id} className="px-5 py-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <Link href={`/vehicles/${v.id}`}><Plate>{v.plate}</Plate></Link>
                        <p className="mt-1 text-sm">{[v.make, v.model, v.year].filter(Boolean).join(" ") || "–"}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {session.can("appointments.create") ? (
                          <LinkButton size="sm" href={`/appointments?new=1&vehicle=${v.id}`}>
                            <CalendarPlus className="size-3.5" aria-hidden /> {t("appointments.new")}
                          </LinkButton>
                        ) : null}
                        {session.can("tires.create") ? (
                          <LinkButton size="sm" href={`/tires/new?vehicle=${v.id}`}>
                            <Disc3 className="size-3.5" aria-hidden /> {t("tires.new")}
                          </LinkButton>
                        ) : null}
                        {canEditVehicles ? (
                          <LinkButton variant="ghost" size="sm" href={`/vehicles/${v.id}/edit`}>
                            {t("common.edit")}
                          </LinkButton>
                        ) : null}
                      </div>
                    </div>
                    {canTires && tireRules && v.tireSets.length ? (
                      <ul className="mt-3 flex flex-col gap-1.5">
                        {v.tireSets.map((s) => (
                          <li key={s.id}>
                            <Link href={`/tires/${s.id}`} className="flex flex-wrap items-center gap-2 rounded-md bg-surface-2 px-3 py-1.5 text-sm hover:bg-surface-hover">
                              <SeasonBadge season={s.season} td={td} />
                              <span>{[s.brand, formatTireSize(s)].filter(Boolean).join(" · ")}</span>
                              <span className="text-ink-muted">{s.storageLocation}</span>
                              <span className="ml-auto flex items-center gap-2">
                                {s.status !== "stored" ? <Badge>{td(`enums.tireSetStatus.${s.status}`, s.status)}</Badge> : null}
                                <HealthBadge health={setHealth(s.tires, tireRules).health} t={t} />
                              </span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          ) : null}

          {session.can("appointments.view") ? (
            <Card title={t("customers.appointments")} padded={false}>
              {customer.appointments.length === 0 ? (
                <EmptyState title={t("customers.noAppointments")} />
              ) : (
                <ul className="divide-y divide-line">
                  {customer.appointments.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                      <Link href={`/appointments?date=${toDateInput(a.startsAt)}`} className="hover:underline">
                        <span className="tabular font-medium">{date(a.startsAt, { dateStyle: "medium", timeStyle: "short" })}</span>
                        <span className="ml-2">{a.title}</span>
                        {a.vehicle ? <span className="ml-2 font-mono text-ink-muted">{a.vehicle.plate}</span> : null}
                      </Link>
                      <Badge tone={STATUS_TONE[a.status as keyof typeof STATUS_TONE] ?? "neutral"}>{td(`enums.appointmentStatus.${a.status}`, a.status)}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ) : null}
        </div>

        <div className="flex flex-col gap-5">
          <Card title={t("customers.contact")}>
            <DefinitionList
              items={[
                { label: t("customers.fields.phone"), value: customer.phone },
                { label: t("customers.fields.email"), value: customer.email ? <a className="text-accent-text hover:underline" href={`mailto:${customer.email}`}>{customer.email}</a> : null },
                { label: t("customers.fields.address"), value: address },
                { label: t("common.notes"), value: customer.notes },
              ]}
            />
          </Card>
          {canDelete ? (
            <form action={deleteCustomer}>
              <input type="hidden" name="id" value={customer.id} />
              <ConfirmSubmitButton message={`${t("customers.confirmDelete")}${customer._count.appointments > 0 ? ` ${tp("customers.confirmDeleteAppointments", customer._count.appointments)}` : ""}`}>{t("customers.delete")}</ConfirmSubmitButton>
            </form>
          ) : null}
        </div>
      </div>
    </>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarPlus, Pencil } from "lucide-react";
import { Card, DefinitionList, EmptyState, Plate, TextLink, StatusBadge, DangerZone } from "@/components/ui/layout";
import { PageHeader } from "@/components/ui/page-header";
import { LinkButton, SubmitButton } from "@/components/ui/buttons";
import { ConfirmSubmitButton } from "@/components/ui/confirm-dialog";
import { getI18n } from "@/i18n/server";
import { customerDisplayName } from "@/modules/workshop/customers/public";
import { formatTireSize, setHealth, tireHealth } from "@/modules/workshop/tires/domain";
import { getTireRules } from "@/modules/workshop/tires/settings";
import { requirePermission, sessionIfAllowed } from "@/server/auth/session";
import { db } from "@/server/db";
import { deleteTireSet, setTireSetStatus } from "@/modules/workshop/tires/actions";
import { HealthBadge, SeasonBadge } from "@/modules/workshop/tires/ui";
import { STATUS_TONE } from "@/modules/workshop/appointments/public";
import { TIRE_SET_STATUS_TONE } from "@/modules/workshop/tires/status-tone";
import type { TireSetStatus } from "@/modules/workshop/tires/constants";
import { toDateInput } from "@/lib/dates";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const [{ id }, { t }] = await Promise.all([params, getI18n()]);
  if (!(await sessionIfAllowed("tires.view"))) return {};
  const set = await db.tireSet.findUnique({ where: { id }, include: { vehicle: true } });
  return { title: set ? `${set.vehicle.plate} · ${t("tires.title")}` : t("tires.title") };
}

const GRID: Array<"FL" | "FR" | "RL" | "RR"> = ["FL", "FR", "RL", "RR"];

const daysSince = (d: Date) => Math.floor((Date.now() - d.getTime()) / 86_400_000);

export default async function TireSetPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("tires.view");
  const { id } = await params;
  const i18n = await getI18n();
  const { t, td, date } = i18n;

  const [set, tireRules] = await Promise.all([
    db.tireSet.findUnique({
      where: { id },
      include: {
        tires: true,
        vehicle: { include: { customer: true } },
        appointments: { orderBy: { startsAt: "desc" }, take: 10, include: { type: true } },
      },
    }),
    getTireRules(),
  ]);
  if (!set) notFound();

  const overall = setHealth(set.tires, tireRules);
  const byPos = new Map(set.tires.map((x) => [x.position, x]));
  const spare = byPos.get("SPARE");
  const canEdit = session.can("tires.edit");
  const storedDays = daysSince(set.storedAt);

  const tile = (pos: string) => {
    const tire = byPos.get(pos);
    const h = tire ? tireHealth(tire, tireRules) : null;
    return (
      <div key={pos} className="rounded-lg border border-line bg-surface-2 p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-sm font-semibold">{td(`enums.position.${pos}`, pos)}</span>
          {h ? <HealthBadge health={h.health} t={t} /> : null}
        </div>
        {tire ? (
          <dl className="grid grid-cols-2 gap-y-1 text-sm">
            <dt className="text-ink-muted">{t("tires.fields.tread")}</dt>
            <dd className="text-right tabular">{tire.treadDepthMm != null ? `${i18n.number(tire.treadDepthMm, { maximumFractionDigits: 1 })} mm` : "–"}</dd>
            <dt className="text-ink-muted">{t("tires.fields.dot")}</dt>
            <dd className="text-right font-mono tabular">{tire.dot ?? "–"}</dd>
            <dt className="text-ink-muted">{t("tires.cols.age")}</dt>
            <dd className="text-right tabular">
              {h?.ageYears != null ? t("tires.ageYears", { years: i18n.number(h.ageYears, { maximumFractionDigits: 1 }) }) : "–"}
            </dd>
            <dt className="text-ink-muted">{t("tires.fields.condition")}</dt>
            <dd className="text-right">{td(`enums.condition.${tire.condition}`, tire.condition)}</dd>
          </dl>
        ) : (
          <p className="text-sm text-ink-muted">–</p>
        )}
      </div>
    );
  };

  return (
    <>
      <PageHeader
        back={{ href: "/tires", label: t("nav.tires") }} help="workshop.tires"
        title={
          <span className="flex flex-wrap items-center gap-3">
            <Plate>{set.vehicle.plate}</Plate>
            <span>{[set.brand, set.model].filter(Boolean).join(" ") || t("tires.title")}</span>
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-2">
            <SeasonBadge season={set.season} td={td} />
            <span className="tabular">{formatTireSize(set)}</span>
            <StatusBadge tone={TIRE_SET_STATUS_TONE[set.status as TireSetStatus] ?? "neutral"}>{td(`enums.tireSetStatus.${set.status}`, set.status)}</StatusBadge>
            <HealthBadge health={overall.health} t={t} />
          </span>
        }
        actions={
          <>
            {session.can("appointments.create") ? (
              <LinkButton href={`/appointments?new=1&tireSet=${set.id}`} variant="secondary">
                <CalendarPlus className="size-4" aria-hidden /> {t("tires.planChange")}
              </LinkButton>
            ) : null}
            {canEdit ? (
              <LinkButton href={`/tires/${set.id}/edit`} variant="secondary">
                <Pencil className="size-4" aria-hidden /> {t("common.edit")}
              </LinkButton>
            ) : null}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
        <div className="flex flex-col gap-5 md:col-span-2">
          <Card title={t("tires.sections.tires")}>
            <div className="grid grid-cols-2 gap-3">{GRID.map(tile)}</div>
            {spare ? <div className="mt-3">{tile("SPARE")}</div> : null}
            {overall.reasons.length ? (
              <p className="mt-4 text-sm text-ink-muted">
                {t("tires.reasonsLabel")} {overall.reasons.map((r) => t(`tires.reasons.${r}`)).join(", ")}
              </p>
            ) : null}
          </Card>

          <Card title={t("tires.sections.appointments")} padded={false}>
            {set.appointments.length === 0 ? (
              <EmptyState title={t("tires.noAppointments")} />
            ) : (
              <ul className="divide-y divide-line">
                {set.appointments.map((a) => (
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
        </div>

        <div className="flex flex-col gap-5">
          <Card title={t("tires.sections.storage")}>
            <DefinitionList
              items={[
                { label: t("tires.fields.location"), value: set.storageLocation },
                { label: t("tires.fields.storedAt"), value: `${date(set.storedAt)} (${t("tires.storedDays", { days: storedDays })})` },
                { label: t("tires.fields.rimType"), value: td(`enums.rimType.${set.rimType}`, set.rimType) },
                { label: t("common.notes"), value: set.notes },
              ]}
            />
          </Card>

          <Card title={t("tires.sections.owner")}>
            <p className="font-medium">
              {!set.vehicle.customer ? (
                <span className="text-ink-muted">{t("vehicles.noOwner")}</span>
              ) : session.can("customers.view") ? (
                <TextLink href={`/customers/${set.vehicle.customer.id}`}>
                  {customerDisplayName(set.vehicle.customer)}
                </TextLink>
              ) : (
                customerDisplayName(set.vehicle.customer)
              )}
            </p>
            <p className="mt-1 text-sm">
              {session.can("vehicles.view") ? (
                <TextLink href={`/vehicles/${set.vehicle.id}`}>
                  {[set.vehicle.make, set.vehicle.model].filter(Boolean).join(" ") || set.vehicle.plate}
                </TextLink>
              ) : (
                <span className="text-ink-muted">{[set.vehicle.make, set.vehicle.model].filter(Boolean).join(" ")}</span>
              )}
            </p>
            {set.vehicle.customer?.phone ? <p className="mt-1 text-sm">{set.vehicle.customer.phone}</p> : null}
          </Card>

          {canEdit ? (
            <Card title={t("common.actions")}>
              <div className="flex flex-wrap gap-2">
                {canEdit && set.status === "stored" ? (
                  <form action={setTireSetStatus}>
                    <input type="hidden" name="id" value={set.id} />
                    <input type="hidden" name="status" value="mounted" />
                    <SubmitButton variant="secondary" size="sm">{t("tires.actions.handOut")}</SubmitButton>
                  </form>
                ) : null}
                {canEdit && set.status === "mounted" ? (
                  <form action={setTireSetStatus}>
                    <input type="hidden" name="id" value={set.id} />
                    <input type="hidden" name="status" value="stored" />
                    <SubmitButton variant="secondary" size="sm">{t("tires.actions.store")}</SubmitButton>
                  </form>
                ) : null}
                {canEdit && set.status !== "disposed" ? (
                  <form action={setTireSetStatus}>
                    <input type="hidden" name="id" value={set.id} />
                    <input type="hidden" name="status" value="disposed" />
                    <ConfirmSubmitButton message={t("tires.actions.disposeConfirm")} variant="secondary">{t("tires.actions.dispose")}</ConfirmSubmitButton>
                  </form>
                ) : null}
              </div>
            </Card>
          ) : null}

          {session.can("tires.delete") ? (
            <DangerZone title={t("common.dangerZone")}>
              <form action={deleteTireSet}>
                <input type="hidden" name="id" value={set.id} />
                <ConfirmSubmitButton message={t("tires.actions.deleteConfirm")}>{t("common.delete")}</ConfirmSubmitButton>
              </form>
            </DangerZone>
          ) : null}
        </div>
      </div>
    </>
  );
}

import Link from "next/link";
import { Card, EmptyState, Plate, TextLink, StatusBadge } from "@/components/ui/layout";
import { getI18n } from "@/i18n/server";
import { DUE_TONE, dueState } from "@/lib/due";
import { employeeName } from "@/modules/office/employees/public";
import { FLEET_WARN_DAYS } from "@/modules/office/fleet/domain";
import { listDrivers, listFleet } from "./queries";
import { DueBadge } from "./ui";
import type { WidgetDef } from "@/modules/types";

/** Anstehende Fälligkeiten im Fuhrpark (HU, Service, Versicherung, Leasing) und Führerscheinkontrollen. */
export async function FleetWidget() {
  const i18n = await getI18n();
  const { t, date } = i18n;

  const [vehicles, drivers] = await Promise.all([
    listFleet({ status: { not: "sold" } }),
    listDrivers(1),
  ]);
  const dueVehicles = vehicles.filter((v) => v.dues.length > 0).slice(0, 6);
  const dueDrivers = drivers
    .map((d) => ({ d, last: d.licenseChecks[0], state: d.licenseChecks[0] ? dueState(d.licenseChecks[0].nextDue, FLEET_WARN_DAYS) : ("expired" as const) }))
    .filter((x) => x.state === "expired" || x.state === "soon")
    .slice(0, 4);

  return (
    <Card headingLevel={3} title={t("fleet.widgets.title")} actions={<TextLink href="/fleet?due=1" className="text-sm">{t("common.showAll")}</TextLink>} padded={false}>
      {dueVehicles.length === 0 && dueDrivers.length === 0 ? (
        <EmptyState title={t("fleet.widgets.allFine")} />
      ) : (
        <>
          <ul className="divide-y divide-line">
            {dueVehicles.map((v) => (
              <li key={v.id}>
                <Link href={`/fleet/${v.id}`} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 hover:bg-surface-hover">
                  <Plate>{v.plate}</Plate>
                  <span className="flex flex-wrap justify-end gap-1.5">
                    {v.dues.slice(0, 2).map((d) => (
                      <DueBadge key={d.kind} due={d} i18n={i18n} />
                    ))}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {dueDrivers.length ? (
            <>
              <h3 className="border-t border-line px-5 pt-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">{t("fleet.widgets.licenses")}</h3>
              <ul className="divide-y divide-line">
                {dueDrivers.map(({ d, last, state }) => (
                  <li key={d.id}>
                    <Link href="/fleet/licenses" className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm hover:bg-surface-hover">
                      <span className="font-medium">{employeeName(d)}</span>
                      {last ? <StatusBadge tone={state ? DUE_TONE[state] : "neutral"}>{date(last.nextDue)}</StatusBadge> : <StatusBadge tone="danger">{t("fleet.neverChecked")}</StatusBadge>}
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </>
      )}
    </Card>
  );
}

/** Dashboard-Bausteine dieser Funktion (von der Registry eingesammelt). */
export const widgets: WidgetDef[] = [
  { id: "fleet-dues", feature: "office.fleet", permission: "fleet.view", span: 1, order: 41, Component: FleetWidget },
];

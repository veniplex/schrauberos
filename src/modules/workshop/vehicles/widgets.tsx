import Link from "next/link";
import { LinkButton } from "@/components/ui/buttons";
import { Card, EmptyState, Plate, StatusBadge, TextLink } from "@/components/ui/layout";
import { getI18n } from "@/i18n/server";
import { nowDate } from "@/lib/dates";
import { monthStart } from "@/lib/month";
import type { WidgetDef } from "@/modules/types";
import { customerDisplayName, customerNameSelect } from "@/modules/workshop/customers/public";
import { getSession } from "@/server/auth/session";
import { db } from "@/server/db";
import { inspectionState, monthOf } from "./domain";
import { attentionWhere } from "./queries";
import { INSPECTION_TONE } from "./status-tone";

const LIMIT = 6;

/** Fahrzeuge, deren Hauptuntersuchung/Prüfung überfällig oder in den nächsten Monaten fällig ist – mit „Termin planen“ (Termin-Formular mit vorbelegtem Fahrzeug). */
export async function InspectionDueWidget() {
  const [{ t, tp, date }, session] = await Promise.all([getI18n(), getSession()]);
  const thisMonth = monthOf(nowDate());
  const where = attentionWhere(thisMonth);
  const [total, vehicles] = await Promise.all([
    db.vehicle.count({ where }),
    db.vehicle.findMany({ where, include: { customer: { select: customerNameSelect } }, orderBy: [{ inspectionDue: "asc" }, { plateNorm: "asc" }], take: LIMIT }),
  ]);
  // Weiche Abhängigkeit (`uses` in feature.ts): „Termin planen“ nur, wenn Termine aktiv sind und die Person welche anlegen darf
  const canPlan = !!session && session.features.has("workshop.appointments") && session.can("appointments.create");
  const monthLabel = (value: string) => date(monthStart(value), { month: "long", year: "numeric" });

  return (
    <Card
      headingLevel={3}
      title={t("vehicles.widgets.title")}
      actions={
        <TextLink href="/vehicles?inspection=soon&sort=inspection" className="text-sm">
          {t("common.showAll")}
        </TextLink>
      }
      padded={false}
    >
      {vehicles.length === 0 ? (
        <EmptyState title={t("vehicles.widgets.empty")} />
      ) : (
        <>
          <p className="px-5 pt-3 text-sm text-ink-muted">{tp("vehicles.widgets.count", total)}</p>
          <ul className="divide-y divide-line">
            {vehicles.map((v) => {
              const state = inspectionState(v.inspectionDue, thisMonth);
              return (
                <li key={v.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <Link href={`/vehicles/${v.id}`} className="block min-h-(--tap-row) min-w-0 flex-1 hover:underline">
                    <div className="flex items-center gap-2">
                      <Plate>{v.plate}</Plate>
                      <span className="truncate text-sm">{customerDisplayName(v.customer)}</span>
                    </div>
                    <p className="mt-0.5 flex items-center gap-2 text-xs">
                      {v.inspectionDue && state ? <StatusBadge tone={INSPECTION_TONE[state]}>{t(`vehicles.inspection.${state}`, { month: monthLabel(v.inspectionDue) })}</StatusBadge> : null}
                    </p>
                  </Link>
                  {canPlan ? (
                    <LinkButton size="sm" href={`/appointments?new=1&vehicle=${v.id}`} aria-label={t("vehicles.widgets.planFor", { plate: v.plate })}>
                      {t("vehicles.widgets.plan")}
                    </LinkButton>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Card>
  );
}

/** Dashboard-Bausteine dieser Funktion (von der Registry eingesammelt). */
export const widgets: WidgetDef[] = [{ id: "inspection-due", feature: "workshop.vehicles", permission: "vehicles.view", span: 1, order: 19, Component: InspectionDueWidget }];

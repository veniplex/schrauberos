import Link from "next/link";
import { Card, EmptyState, Plate } from "@/components/ui/layout";
import { getI18n } from "@/i18n/server";
import { getSession } from "@/server/auth/session";
import { customerDisplayName } from "@/modules/workshop/customers/public";
import { formatTireSize } from "@/modules/workshop/tires/domain";
import { bySeverity, listTireSets } from "./queries";
import { HealthBadge, SeasonBadge } from "./ui";
import type { WidgetDef } from "@/modules/types";
import { LinkButton } from "@/components/ui/buttons";

const LIMIT = 6;

/** Gelagerte Sätze, bei denen Profil, Alter oder Zustand Handlungsbedarf anzeigen. */
export async function TireAttentionWidget() {
  const { t, tp, td } = await getI18n();
  const sets = (await listTireSets({ status: "stored" }))
    .filter((s) => s.health.health === "warn" || s.health.health === "replace")
    .sort(bySeverity);

  return (
    <Card
      title={t("tires.widgets.attentionTitle")}
      actions={
        <Link href="/tires?attention=1" className="text-sm text-accent-text hover:underline">
          {t("common.showAll")}
        </Link>
      }
      padded={false}
    >
      {sets.length === 0 ? (
        <EmptyState title={t("tires.widgets.attentionEmpty")} />
      ) : (
        <>
          <p className="px-5 pt-3 text-sm text-ink-muted">{tp("tires.widgets.attentionCount", sets.length)}</p>
          <ul className="divide-y divide-line">
            {sets.slice(0, LIMIT).map((s) => (
              <li key={s.id}>
                <Link href={`/tires/${s.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-surface-hover">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Plate>{s.vehicle.plate}</Plate>
                      <span className="truncate text-sm">{customerDisplayName(s.vehicle.customer)}</span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-ink-muted">
                      {[s.brand, formatTireSize(s), td(`enums.season.${s.season}`)].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <HealthBadge health={s.health.health} t={t} />
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

/** Sätze, die zur aktuellen Saison montiert werden sollten und noch keinen Termin haben. */
export async function TireSwapWidget() {
  const [{ t, tp, td }, session] = await Promise.all([getI18n(), getSession()]);
  const canPlan = session?.can("appointments.create") ?? false;
  const sets = (await listTireSets({ status: "stored" })).filter((s) => s.swapDue);

  return (
    <Card
      title={t("tires.widgets.swapTitle")}
      actions={
        <Link href="/tires?swap=1" className="text-sm text-accent-text hover:underline">
          {t("common.showAll")}
        </Link>
      }
      padded={false}
    >
      {sets.length === 0 ? (
        <EmptyState title={t("tires.widgets.swapEmpty")} />
      ) : (
        <>
          <p className="px-5 pt-3 text-sm text-ink-muted">{tp("tires.widgets.swapCount", sets.length)}</p>
          <ul className="divide-y divide-line">
            {sets.slice(0, LIMIT).map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Plate>{s.vehicle.plate}</Plate>
                    <span className="truncate text-sm">{customerDisplayName(s.vehicle.customer)}</span>
                  </div>
                  <p className="mt-0.5 flex items-center gap-2 text-xs text-ink-muted">
                    <SeasonBadge season={s.season} td={td} />
                    <span className="truncate">{s.storageLocation}</span>
                  </p>
                </div>
                {canPlan ? (
                  <LinkButton size="sm" href={`/appointments?new=1&tireSet=${s.id}`}>
                    {t("tires.planChange")}
                  </LinkButton>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

/** Dashboard-Bausteine dieser Funktion (von der Registry eingesammelt). */
export const widgets: WidgetDef[] = [
  { id: "tire-attention", feature: "workshop.tires", permission: "tires.view", span: 1, order: 20, Component: TireAttentionWidget },
  { id: "tire-swap", feature: "workshop.tires", permission: "tires.view", span: 1, order: 21, Component: TireSwapWidget },
];

import { StatusBadge } from "@/components/ui/layout";
import { DUE_TONE } from "@/lib/due";
import type { FleetDue } from "@/modules/office/fleet/domain";
import type { Translator } from "@/i18n/translate";

/** Fälligkeits-Badge: "TÜV/HU · 12.12.2026" bzw. "Wartung · noch 800 km". */
export function DueBadge({ due, i18n }: { due: FleetDue; i18n: Translator }) {
  const { t, date, number } = i18n;
  const label = t(`fleet.dueKinds.${due.kind}`);
  const detail =
    due.kind === "serviceKm"
      ? due.kmLeft != null && due.kmLeft < 0
        ? t("fleet.kmOver", { km: number(-due.kmLeft) })
        : t("fleet.kmLeft", { km: number(due.kmLeft ?? 0) })
      : due.date
        ? date(due.date)
        : "";
  return (
    <StatusBadge tone={DUE_TONE[due.state]}>
      {label} · {detail}
    </StatusBadge>
  );
}

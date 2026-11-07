import { Alert, StatusBadge } from "@/components/ui/layout";
import type { Translator } from "@/i18n/translate";
import type { DeviceCheck, LinkState } from "./monitoring";
import { DEVICE_STATUS_TONE, LINK_STATE_TONE } from "./status-tone";
import type { DeviceStatus } from "./constants";

export function LinkStateBadge({ check, i18n }: { check: DeviceCheck | undefined; i18n: Translator }) {
  const state: LinkState = check?.state ?? "unknown";
  const label = i18n.t(`enums.linkState.${state}`);
  return (
    <StatusBadge tone={LINK_STATE_TONE[state]}>
      {label}
      {check?.latencyMs != null ? <span className="tabular opacity-80">· {check.latencyMs} ms</span> : null}
    </StatusBadge>
  );
}

export function DeviceStatusBadge({ status, td }: { status: string; td: Translator["td"] }) {
  return <StatusBadge tone={DEVICE_STATUS_TONE[status as DeviceStatus] ?? "neutral"}>{td(`enums.deviceStatus.${status}`, status)}</StatusBadge>;
}

/** Hinweis, dass die Anwendung die Erreichbarkeit (noch) nicht prüft: Der Status bleibt „unbekannt“. */
export function MonitoringNotice({ t }: { t: Translator["t"] }) {
  return <Alert tone="info">{t("network.monitoringNotice")}</Alert>;
}

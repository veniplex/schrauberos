import Link from "next/link";
import { Alert, StatusBadge } from "@/components/ui/layout";
import type { Translator } from "@/i18n/translate";
import type { TargetState } from "@/lib/monitor/model";
import type { DeviceCheck, LinkState } from "./monitoring";
import { DEVICE_STATUS_TONE, LINK_STATE_TONE, TARGET_STATE_TONE } from "./status-tone";
import type { DeviceStatus } from "./constants";

/** Gerätestatus: nur Gemessenes. Ohne Messung „unbekannt“, bei einer zu alten Messung „veraltet“ (nie grün aus alten Werten). */
export function LinkStateBadge({ check, i18n }: { check: DeviceCheck | undefined; i18n: Translator }) {
  const state: LinkState = check?.state ?? "unknown";
  const label = check?.stale ? i18n.t("network.monitor.stale") : i18n.t(`enums.linkState.${state}`);
  return (
    <StatusBadge tone={LINK_STATE_TONE[state]}>
      {label}
      {check?.latencyMs != null ? <span className="tabular opacity-80">· {check.latencyMs} ms</span> : null}
    </StatusBadge>
  );
}

/** Zustand eines Überwachungsziels (`stale`: die letzte Messung ist zu alt, der Zustand deshalb unbekannt) */
export function TargetStateBadge({ state, stale, t }: { state: TargetState; stale?: boolean; t: Translator["t"] }) {
  return <StatusBadge tone={TARGET_STATE_TONE[state]}>{stale ? t("network.monitor.stale") : t(`network.monitor.state.${state}`)}</StatusBadge>;
}

export function DeviceStatusBadge({ status, td }: { status: string; td: Translator["td"] }) {
  return <StatusBadge tone={DEVICE_STATUS_TONE[status as DeviceStatus] ?? "neutral"}>{td(`enums.deviceStatus.${status}`, status)}</StatusBadge>;
}

/**
 * Hinweis auf Geräteseiten, wenn Geräte zur Überwachung vorgemerkt sind, die Anwendung aber nichts misst (Überwachung ausgeschaltet): Der Status bleibt „unbekannt“.
 * `canOpen`: wer die Überwachung ansehen darf, bekommt den Verweis zur Seite.
 */
export function MonitoringNotice({ t, monitoring, canOpen }: { t: Translator["t"]; monitoring: boolean; canOpen: boolean }) {
  if (monitoring) return null;
  return (
    <Alert tone="info">
      {t("network.monitor.offNotice")}{" "}
      {canOpen ? (
        <Link href="/network/monitoring" className="font-medium underline underline-offset-2">
          {t("network.monitor.openPage")}
        </Link>
      ) : null}
    </Alert>
  );
}

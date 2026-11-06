import { Alert, Badge } from "@/components/ui/layout";
import type { Translator } from "@/i18n/translate";
import type { DeviceCheck, LinkState } from "./monitoring";

const STATE_TONE = { online: "success", degraded: "warning", offline: "danger", unknown: "neutral" } as const;

export function LinkStateBadge({ check, i18n }: { check: DeviceCheck | undefined; i18n: Translator }) {
  const state: LinkState = check?.state ?? "unknown";
  const label = i18n.t(`enums.linkState.${state}`);
  return (
    <Badge tone={STATE_TONE[state]}>
      <span aria-hidden className="inline-block size-1.5 rounded-full bg-current" />
      {label}
      {check?.latencyMs != null ? <span className="tabular opacity-80">· {check.latencyMs} ms</span> : null}
    </Badge>
  );
}

const STATUS_TONE = { active: "success", planned: "info", spare: "neutral", retired: "neutral" } as const;

export function DeviceStatusBadge({ status, td }: { status: string; td: Translator["td"] }) {
  return <Badge tone={STATUS_TONE[status as keyof typeof STATUS_TONE] ?? "neutral"}>{td(`enums.deviceStatus.${status}`, status)}</Badge>;
}

/** Hinweis, dass Status-Werte simuliert sind (kein echter Netzwerkzugriff). */
export function DemoNotice({ t }: { t: Translator["t"] }) {
  return <Alert tone="info">{t("network.demoNotice")}</Alert>;
}

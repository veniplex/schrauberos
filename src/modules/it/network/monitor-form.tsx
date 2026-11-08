"use client";

import { useState } from "react";
import { Checkbox, Field, Form, FormActions, Input, Select } from "@/components/ui/form";
import { Alert, Card } from "@/components/ui/layout";
import { useI18n } from "@/i18n/client";
import { INTERVAL_CHOICES, MONITOR_KINDS, MONITOR_METHODS, type MonitorKind } from "@/lib/monitor/model";
import { saveMonitorTarget } from "./monitor-actions";
import { intervalText } from "./monitor-format";

export type MonitorFormInitial = {
  id?: string;
  /** Version der Zeile beim Öffnen (optimistische Sperre) */
  version?: string;
  name: string;
  kind: MonitorKind;
  host: string;
  port: string;
  path: string;
  method: string;
  ignoreTlsErrors: boolean;
  intervalSec: number;
  enabled: boolean;
  deviceId: string;
};

export type MonitorIpOption = { id: string; address: string; deviceId: string | null; label: string };

/**
 * Formular für ein Überwachungsziel (Recht `network.monitor`). Die Eingabe wird auf dem Server geprüft (Zielsperre, Port, Pfad, Intervall); hier entscheidet nur die Art der Prüfung, welche Felder
 * sichtbar sind. Eine Adresse aus der IP-Verwaltung lässt sich übernehmen (füllt Host und Gerät).
 */
export function MonitorForm({ initial, devices, ips, cancelHref }: { initial: MonitorFormInitial; devices: Array<{ id: string; name: string }>; ips: MonitorIpOption[]; cancelHref: string }) {
  const i18n = useI18n();
  const { t } = i18n;
  const [kind, setKind] = useState<MonitorKind>(initial.kind);
  const [host, setHost] = useState(initial.host);
  const [deviceId, setDeviceId] = useState(initial.deviceId);
  const web = kind !== "tcp";
  const choices = INTERVAL_CHOICES.includes(initial.intervalSec as (typeof INTERVAL_CHOICES)[number]) ? [...INTERVAL_CHOICES] : [...INTERVAL_CHOICES, initial.intervalSec].sort((a, b) => a - b);

  return (
    <Form action={saveMonitorTarget} className="flex max-w-3xl flex-col gap-5">
      {initial.id ? (
        <>
          <input type="hidden" name="id" value={initial.id} />
          <input type="hidden" name="version" value={initial.version ?? ""} />
        </>
      ) : null}

      <Card title={t("network.monitor.sections.form")}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t("network.monitor.fields.name")} htmlFor="name" name="name" required hint={t("network.monitor.fields.nameHint")}>
            <Input id="name" name="name" defaultValue={initial.name} maxLength={80} required autoComplete="off" />
          </Field>
          <Field label={t("network.monitor.fields.kind")} htmlFor="kind" name="kind" required>
            <Select id="kind" name="kind" value={kind} onChange={(event) => setKind(event.target.value as MonitorKind)}>
              {MONITOR_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`network.monitor.kind.${k}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("network.monitor.fields.device")} htmlFor="deviceId" name="deviceId" hint={t("network.monitor.fields.deviceHint")}>
            <Select id="deviceId" name="deviceId" value={deviceId} onChange={(event) => setDeviceId(event.target.value)}>
              <option value="">{t("common.none")}</option>
              {devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
          {ips.length > 0 ? (
            <Field label={t("network.monitor.fields.fromIp")} htmlFor="fromIp">
              <Select
                id="fromIp"
                defaultValue=""
                data-no-draft
                onChange={(event) => {
                  const ip = ips.find((x) => x.id === event.target.value);
                  if (!ip) return;
                  setHost(ip.address);
                  if (ip.deviceId) setDeviceId(ip.deviceId);
                }}
              >
                <option value="">{t("network.monitor.fields.fromIpNone")}</option>
                {ips.map((ip) => (
                  <option key={ip.id} value={ip.id}>
                    {ip.label}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <Field label={t("network.monitor.fields.host")} htmlFor="host" name="host" required hint={t("network.monitor.fields.hostHint")}>
            <Input id="host" name="host" value={host} onChange={(event) => setHost(event.target.value)} maxLength={300} required autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} className="font-mono" />
          </Field>
          <Field label={t("network.monitor.fields.port")} htmlFor="port" name="port" hint={t("network.monitor.fields.portHint")}>
            <Input id="port" name="port" type="number" min={1} max={65535} defaultValue={initial.port} inputMode="numeric" />
          </Field>
          {web ? (
            <>
              <Field label={t("network.monitor.fields.path")} htmlFor="path" name="path" hint={t("network.monitor.fields.pathHint")}>
                <Input id="path" name="path" defaultValue={initial.path} maxLength={300} placeholder="/" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} className="font-mono" />
              </Field>
              <Field label={t("network.monitor.fields.method")} htmlFor="method" name="method" hint={t("network.monitor.fields.methodHint")}>
                <Select id="method" name="method" defaultValue={initial.method}>
                  {MONITOR_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </Select>
              </Field>
            </>
          ) : null}
        </div>
        {kind === "https" ? <Checkbox name="ignoreTlsErrors" defaultChecked={initial.ignoreTlsErrors} label={t("network.monitor.fields.ignoreTlsErrors")} hint={t("network.monitor.fields.ignoreTlsHint")} className="mt-4" /> : null}
      </Card>

      <Card title={t("network.monitor.sections.check")}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t("network.monitor.fields.interval")} htmlFor="intervalSec" name="intervalSec" required>
            <Select id="intervalSec" name="intervalSec" defaultValue={String(initial.intervalSec)}>
              {choices.map((seconds) => (
                <option key={seconds} value={seconds}>
                  {intervalText(i18n, seconds)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Checkbox name="enabled" defaultChecked={initial.enabled} label={t("network.monitor.fields.enabled")} className="mt-4" />
        <Alert tone="info" className="mt-4">
          {t("network.monitor.detail.privacy")}
        </Alert>
      </Card>

      <FormActions cancelHref={cancelHref} />
    </Form>
  );
}

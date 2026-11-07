"use client";

import { DuplicateNotice } from "@/components/ui/duplicate-notice";
import { Field, Form, FormActions, FormCard, FormMessage, Input, Select, Textarea } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/buttons";
import { IP_KINDS } from "@/modules/it/network/constants";
import { useI18n } from "@/i18n/client";
import { saveConnection, saveIp, saveLocation, saveSubnet, saveVlan } from "./actions";

/* ───────────── VLAN (eine Zeile) ───────────── */

export function VlanForm({ initial }: { initial?: { id: string; vlanId: number; name: string; description: string } }) {
  const { t } = useI18n();
  return (
    <Form action={saveVlan} className="flex flex-wrap items-start gap-3">
      {initial ? <input type="hidden" name="id" value={initial.id} /> : null}
      <Input name="vlanId" type="number" min={1} max={4094} defaultValue={initial?.vlanId} placeholder="VLAN-ID" aria-label={t("network.fields.vlanId")} className="w-28" required />
      <Input name="name" defaultValue={initial?.name} placeholder={t("network.fields.vlanName")} aria-label={t("network.fields.vlanName")} className="min-w-36 flex-1" maxLength={60} required />
      <Input name="description" defaultValue={initial?.description} placeholder={t("network.fields.description")} aria-label={t("network.fields.description")} className="min-w-40 flex-[2]" maxLength={200} />
      <SubmitButton variant={initial ? "secondary" : "primary"} size="sm" className="mt-0.5">
        {initial ? t("common.save") : t("common.add")}
      </SubmitButton>
    </Form>
  );
}

/* ───────────── Standort/Raum (eine Zeile) ───────────── */

export function LocationForm({ initial }: { initial?: { id: string; name: string; description: string; sortOrder: number } }) {
  const { t } = useI18n();
  return (
    <Form action={saveLocation} className="flex flex-wrap items-start gap-3">
      {initial ? <input type="hidden" name="id" value={initial.id} /> : null}
      <Input name="name" defaultValue={initial?.name} placeholder={t("network.fields.locationName")} aria-label={t("network.fields.locationName")} className="min-w-40 flex-1" maxLength={80} required />
      <Input name="description" defaultValue={initial?.description} placeholder={t("network.fields.description")} aria-label={t("network.fields.description")} className="min-w-48 flex-[2]" maxLength={200} />
      <Input name="sortOrder" type="number" min={0} defaultValue={initial?.sortOrder ?? 0} aria-label={t("common.sortOrder")} className="w-20" />
      <SubmitButton variant={initial ? "secondary" : "primary"} size="sm" className="mt-0.5">
        {initial ? t("common.save") : t("common.add")}
      </SubmitButton>
      <FormMessage />
    </Form>
  );
}

/* ───────────── Verbindung (Kabel) ───────────── */

export function ConnectionForm({ devices }: { devices: Array<{ id: string; name: string }> }) {
  const { t } = useI18n();
  const deviceSelect = (name: string, label: string) => (
    <Field label={label} htmlFor={name} name={name} required>
      <Select id={name} name={name} defaultValue="" required>
        <option value="" disabled>
          {t("network.fields.chooseDevice")}
        </option>
        {devices.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </Select>
    </Field>
  );
  return (
    <Form action={saveConnection} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_8rem_minmax(0,1fr)_8rem]">
        {deviceSelect("fromDeviceId", t("network.fields.fromDevice"))}
        <Field label={t("network.fields.port")} htmlFor="fromPort" name="fromPort">
          <Input id="fromPort" name="fromPort" placeholder="24" maxLength={30} className="font-mono" />
        </Field>
        {deviceSelect("toDeviceId", t("network.fields.toDevice"))}
        <Field label={t("network.fields.port")} htmlFor="toPort" name="toPort">
          <Input id="toPort" name="toPort" placeholder="1" maxLength={30} className="font-mono" />
        </Field>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t("network.fields.cableLabel")} htmlFor="cableLabel">
          <Input id="cableLabel" name="cableLabel" maxLength={60} placeholder="K-0142" />
        </Field>
        <Field label={t("common.notes")} htmlFor="notes">
          <Input id="notes" name="notes" maxLength={200} />
        </Field>
      </div>
      <FormActions submitLabel={t("network.connectionAdd")} />
    </Form>
  );
}

/* ───────────── Subnetz ───────────── */

export type SubnetFormInitial = {
  id?: string;
  name: string;
  cidr: string;
  vlanId: string;
  gateway: string;
  dnsServers: string;
  dhcpStart: string;
  dhcpEnd: string;
  description: string;
};

export function SubnetForm({
  initial,
  vlans,
  cancelHref,
}: {
  initial: SubnetFormInitial;
  vlans: Array<{ id: string; vlanId: number; name: string }>;
  cancelHref: string;
}) {
  const { t } = useI18n();
  return (
    <FormCard action={saveSubnet} className="max-w-3xl">
      {initial.id ? <input type="hidden" name="id" value={initial.id} /> : null}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t("network.fields.subnetName")} htmlFor="name" name="name" required>
          <Input id="name" name="name" defaultValue={initial.name} maxLength={80} required autoComplete="off" />
        </Field>
        <Field label={t("network.fields.cidr")} htmlFor="cidr" name="cidr" hint={t("network.fields.cidrHint")} required>
          <Input id="cidr" name="cidr" defaultValue={initial.cidr} placeholder="192.168.10.0/24" className="font-mono" required autoComplete="off" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
        </Field>
        <DuplicateNotice
          title={t("network.overlap.title")}
          message={(data) => t("network.overlap.message", { name: data.duplicateName ?? "", cidr: data.duplicateCidr ?? "" })}
          openLabel={t("network.overlap.open")}
          openHref={(id) => `/network/ip/${id}`}
          anywayLabel={t("network.overlap.anyway")}
        />
        <Field label="VLAN" htmlFor="vlanId">
          <Select id="vlanId" name="vlanId" defaultValue={initial.vlanId}>
            <option value="">{t("common.none")}</option>
            {vlans.map((v) => (
              <option key={v.id} value={v.id}>
                VLAN {v.vlanId} · {v.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("network.fields.gateway")} htmlFor="gateway" name="gateway">
          <Input id="gateway" name="gateway" defaultValue={initial.gateway} className="font-mono" placeholder="192.168.10.1" autoComplete="off" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
        </Field>
        <Field label={t("network.fields.dhcpStart")} htmlFor="dhcpStart" name="dhcpStart">
          <Input id="dhcpStart" name="dhcpStart" defaultValue={initial.dhcpStart} className="font-mono" placeholder="192.168.10.100" autoComplete="off" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
        </Field>
        <Field label={t("network.fields.dhcpEnd")} htmlFor="dhcpEnd" name="dhcpEnd">
          <Input id="dhcpEnd" name="dhcpEnd" defaultValue={initial.dhcpEnd} className="font-mono" placeholder="192.168.10.200" autoComplete="off" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
        </Field>
        <Field label={t("network.fields.dns")} htmlFor="dnsServers" name="dnsServers" hint={t("network.fields.dnsHint")} className="sm:col-span-2">
          <Input id="dnsServers" name="dnsServers" defaultValue={initial.dnsServers} className="font-mono" placeholder="192.168.10.2, 1.1.1.1" autoComplete="off" inputMode="text" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
        </Field>
      </div>
      <Field label={t("network.fields.description")} htmlFor="description">
        <Textarea id="description" name="description" defaultValue={initial.description} maxLength={300} />
      </Field>
      <FormActions cancelHref={cancelHref} />
    </FormCard>
  );
}

/* ───────────── IP-Adresse (im Modal) ───────────── */

export type IpFormInitial = {
  id?: string;
  /** Version der Zeile beim Öffnen (optimistische Sperre) */
  version?: string;
  subnetId: string;
  address: string;
  deviceId: string;
  hostname: string;
  kind: string;
  mac: string;
  notes: string;
};

export function IpForm({
  initial,
  devices,
  returnTo,
  closeHref,
  cidr,
}: {
  initial: IpFormInitial;
  devices: Array<{ id: string; name: string }>;
  returnTo: string;
  closeHref: string;
  cidr: string;
}) {
  const { t, td } = useI18n();
  return (
    <Form action={saveIp} className="flex flex-col gap-4">
      {initial.id ? <input type="hidden" name="id" value={initial.id} /> : null}
      {initial.id ? <input type="hidden" name="version" value={initial.version ?? ""} /> : null}
      <input type="hidden" name="subnetId" value={initial.subnetId} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t("network.cols.address")} htmlFor="address" name="address" hint={cidr} required>
          <Input id="address" name="address" defaultValue={initial.address} className="font-mono" autoComplete="off" required inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
        </Field>
        <Field label={t("network.fields.ipKind")} htmlFor="kind">
          <Select id="kind" name="kind" defaultValue={initial.kind}>
            {IP_KINDS.map((k) => (
              <option key={k} value={k}>
                {td(`enums.ipKind.${k}`, k)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("network.fields.device")} htmlFor="deviceId">
          <Select id="deviceId" name="deviceId" defaultValue={initial.deviceId}>
            <option value="">{t("common.none")}</option>
            {devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("network.cols.hostname")} htmlFor="hostname">
          <Input id="hostname" name="hostname" defaultValue={initial.hostname} maxLength={100} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
        </Field>
        <Field label={t("network.cols.mac")} htmlFor="mac" name="mac" className="sm:col-span-2">
          <Input id="mac" name="mac" defaultValue={initial.mac} className="font-mono" placeholder="AA:BB:CC:DD:EE:FF" autoComplete="off" autoCapitalize="characters" autoCorrect="off" spellCheck={false} />
        </Field>
      </div>
      <Field label={t("common.notes")} htmlFor="notes">
        <Input id="notes" name="notes" defaultValue={initial.notes} maxLength={300} />
      </Field>
      <FormActions cancelHref={closeHref} />
    </Form>
  );
}

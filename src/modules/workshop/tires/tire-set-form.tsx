"use client";

import { useState } from "react";
import { Copy } from "lucide-react";
import { Checkbox, Field, FieldLabel, Form, FormActions, Input, Select, Textarea } from "@/components/ui/form";
import { Button } from "@/components/ui/buttons";
import { Card, Plate } from "@/components/ui/layout";
import { VehiclePicker, type VehicleOption } from "@/modules/workshop/vehicles/public";
import { RIM_TYPES, TIRE_CONDITIONS, TIRE_POSITIONS, TIRE_SEASONS, TIRE_SET_STATUSES, type TirePosition } from "@/modules/workshop/tires/constants";
import { useI18n } from "@/i18n/client";
import { createTireSet, updateTireSet } from "./actions";

export type TireRowInitial = { dot: string; tread: string; condition: string };

export type TireSetFormInitial = {
  id?: string;
  /** Version der Zeile beim Öffnen (optimistische Sperre) */
  version?: string;
  vehicle: VehicleOption | null;
  season: string;
  status: string;
  brand: string;
  model: string;
  width: string;
  aspect: string;
  rim: string;
  loadIndex: string;
  speedIndex: string;
  rimType: string;
  storageLocation: string;
  storedAt: string;
  notes: string;
  spare: boolean;
  tires: Record<TirePosition, TireRowInitial>;
};

export function TireSetForm({
  initial,
  locations,
  cancelHref,
  canCreateVehicle = false,
}: {
  initial: TireSetFormInitial;
  /** bereits genutzte Lagerorte als Vorschlagsliste */
  locations: string[];
  cancelHref: string;
  /** Bei keinem Treffer in der Fahrzeugsuche „Fahrzeug neu anlegen“ anbieten */
  canCreateVehicle?: boolean;
}) {
  const { t, td } = useI18n();
  const [spare, setSpare] = useState(initial.spare);
  const [rows, setRows] = useState(initial.tires);
  const positions = TIRE_POSITIONS.filter((p) => spare || p !== "SPARE");

  const setRow = (pos: TirePosition, patch: Partial<TireRowInitial>) =>
    setRows((r) => ({ ...r, [pos]: { ...r[pos], ...patch } }));

  function copyFirstToAll() {
    const first = rows.FL;
    setRows((r) => {
      const next = { ...r };
      for (const p of TIRE_POSITIONS) next[p] = { ...first };
      return next;
    });
  }

  return (
    <Form action={initial.id ? updateTireSet : createTireSet} draftKey={`tireset:${initial.id ?? "new"}`} className="flex flex-col gap-5">
      {initial.id ? (
        <>
          <input type="hidden" name="id" value={initial.id} />
          <input type="hidden" name="version" value={initial.version ?? ""} />
        </>
      ) : null}

      <Card title={t("tires.sections.vehicle")}>
        <Field label={t("tires.fields.vehicle")} name="vehicleId" required>
          {initial.id && initial.vehicle ? (
            <>
              <input type="hidden" name="vehicleId" value={initial.vehicle.id} />
              <p className="text-sm">
                <Plate>{initial.vehicle.plate}</Plate>{" "}
                <span className="ml-2 text-ink-muted">{[initial.vehicle.description, initial.vehicle.customer].filter(Boolean).join(" · ")}</span>
              </p>
            </>
          ) : (
            <VehiclePicker initial={initial.vehicle} canCreate={canCreateVehicle} required />
          )}
        </Field>
      </Card>

      <Card title={t("tires.sections.set")}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={t("tires.fields.season")} htmlFor="season" required>
            <Select id="season" name="season" defaultValue={initial.season}>
              {TIRE_SEASONS.map((s) => (
                <option key={s} value={s}>
                  {td(`enums.season.${s}`, s)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("tires.fields.brand")} htmlFor="brand" name="brand">
            <Input id="brand" name="brand" defaultValue={initial.brand} maxLength={60} placeholder="Continental" />
          </Field>
          <Field label={t("tires.fields.model")} htmlFor="model" name="model" className="sm:col-span-2 lg:col-span-1">
            <Input id="model" name="model" defaultValue={initial.model} maxLength={60} placeholder="WinterContact TS 870" />
          </Field>
          <Field label={t("tires.fields.rimType")} htmlFor="rimType">
            <Select id="rimType" name="rimType" defaultValue={initial.rimType}>
              {RIM_TYPES.map((r) => (
                <option key={r} value={r}>
                  {td(`enums.rimType.${r}`, r)}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <fieldset className="mt-4">
          <FieldLabel as="legend">{t("tires.fields.size")}</FieldLabel>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Field label={t("tires.fields.width")} htmlFor="width" name="width">
              <Input id="width" name="width" type="number" inputMode="numeric" defaultValue={initial.width} placeholder="205" />
            </Field>
            <Field label={t("tires.fields.aspect")} htmlFor="aspect" name="aspect">
              <Input id="aspect" name="aspect" type="number" inputMode="numeric" defaultValue={initial.aspect} placeholder="55" />
            </Field>
            <Field label={t("tires.fields.rim")} htmlFor="rim" name="rim">
              <Input id="rim" name="rim" type="number" inputMode="numeric" defaultValue={initial.rim} placeholder="16" />
            </Field>
            <Field label={t("tires.fields.loadIndex")} htmlFor="loadIndex">
              <Input id="loadIndex" name="loadIndex" defaultValue={initial.loadIndex} placeholder="91" maxLength={5} />
            </Field>
            <Field label={t("tires.fields.speedIndex")} htmlFor="speedIndex">
              <Input id="speedIndex" name="speedIndex" defaultValue={initial.speedIndex} placeholder="H" maxLength={3} />
            </Field>
          </div>
        </fieldset>
      </Card>

      <Card
        title={t("tires.sections.tires")}
        actions={
          <Button variant="ghost" size="sm" onClick={copyFirstToAll}>
            <Copy className="size-3.5" aria-hidden /> {t("tires.copyFirst")}
          </Button>
        }
      >
        <p className="mb-3 text-sm text-ink-muted">{t("tires.dotHint")}</p>
        {/* Eine Gruppe je Position: ab md eine Zeile unter gemeinsamer Kopfzeile (die Beschriftungen entfallen dort optisch), darunter Karten mit beschrifteten Feldern – kein Seitwärtsscrollen am Handy */}
        <div role="group" aria-label={t("tires.sections.tires")}>
          <div aria-hidden className="hidden gap-3 border-b border-line pb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted md:grid md:grid-cols-[7rem_8rem_8rem_minmax(0,1fr)]">
            <span>{t("tires.fields.position")}</span>
            <span>{t("tires.fields.dot")}</span>
            <span>{t("tires.fields.tread")}</span>
            <span>{t("tires.fields.condition")}</span>
          </div>
          <div className="flex flex-col gap-3 md:gap-0">
            {positions.map((pos) => (
              <div
                key={pos}
                role="group"
                aria-label={td(`enums.position.${pos}`, pos)}
                className="grid grid-cols-2 gap-3 rounded-md border border-line p-3 md:grid-cols-[7rem_8rem_8rem_minmax(0,1fr)] md:items-start md:rounded-none md:border-0 md:border-b md:px-0 md:py-2"
              >
                <p className="col-span-2 font-medium md:col-span-1 md:pt-2">{td(`enums.position.${pos}`, pos)}</p>
                <Field label={t("tires.fields.dot")} htmlFor={`tire-${pos}-dot`} name={`tire.${pos}.dot`} labelClassName="md:sr-only">
                  <Input
                    id={`tire-${pos}-dot`}
                    name={`tire.${pos}.dot`}
                    value={rows[pos].dot}
                    onChange={(e) => setRow(pos, { dot: e.target.value.replace(/\D/g, "").slice(0, 4) })}
                    inputMode="numeric"
                    placeholder="2321"
                    maxLength={4}
                  />
                </Field>
                <Field label={t("tires.fields.tread")} htmlFor={`tire-${pos}-tread`} name={`tire.${pos}.tread`} labelClassName="md:sr-only">
                  <Input
                    id={`tire-${pos}-tread`}
                    name={`tire.${pos}.tread`}
                    type="number"
                    step="0.1"
                    min="0"
                    max="15"
                    inputMode="decimal"
                    value={rows[pos].tread}
                    onChange={(e) => setRow(pos, { tread: e.target.value })}
                    placeholder="6.5"
                  />
                </Field>
                <Field label={t("tires.fields.condition")} htmlFor={`tire-${pos}-condition`} name={`tire.${pos}.condition`} className="col-span-2 md:col-span-1" labelClassName="md:sr-only">
                  <Select id={`tire-${pos}-condition`} name={`tire.${pos}.condition`} value={rows[pos].condition} onChange={(e) => setRow(pos, { condition: e.target.value })}>
                    {TIRE_CONDITIONS.map((c) => (
                      <option key={c} value={c}>
                        {td(`enums.condition.${c}`, c)}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
            ))}
          </div>
        </div>
        <Checkbox name="spare" checked={spare} onChange={(e) => setSpare(e.target.checked)} label={t("tires.fields.spare")} className="mt-3" />
      </Card>

      <Card title={t("tires.sections.storage")}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label={t("common.status")} htmlFor="status">
            <Select id="status" name="status" defaultValue={initial.status}>
              {TIRE_SET_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {td(`enums.tireSetStatus.${s}`, s)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("tires.fields.location")} htmlFor="storageLocation" hint={t("tires.fields.locationHint")}>
            <Input id="storageLocation" name="storageLocation" list="tire-locations" defaultValue={initial.storageLocation} maxLength={120} placeholder={t("tires.fields.locationPlaceholder")} />
            <datalist id="tire-locations">
              {locations.map((l) => (
                <option key={l} value={l} />
              ))}
            </datalist>
          </Field>
          <Field label={t("tires.fields.storedAt")} htmlFor="storedAt">
            <Input id="storedAt" name="storedAt" type="date" defaultValue={initial.storedAt} />
          </Field>
        </div>
        <Field label={t("common.notes")} htmlFor="notes" className="mt-4">
          <Textarea id="notes" name="notes" defaultValue={initial.notes} maxLength={2000} />
        </Field>
      </Card>

      <FormActions cancelHref={cancelHref} />
    </Form>
  );
}

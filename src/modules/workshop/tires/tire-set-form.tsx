"use client";

import { useActionState, useState } from "react";
import { Copy } from "lucide-react";
import { type ActionState, Checkbox, Field, FieldError, FieldLabel, FormMessage, Input, Select, Textarea } from "@/components/ui/form";
import { Button, LinkButton, SubmitButton } from "@/components/ui/buttons";
import { Card, Plate, Table } from "@/components/ui/layout";
import { VehicleCombobox, type VehicleOption } from "@/modules/workshop/vehicles/public";
import { RIM_TYPES, TIRE_CONDITIONS, TIRE_POSITIONS, TIRE_SEASONS, TIRE_SET_STATUSES, type TirePosition } from "@/modules/workshop/tires/constants";
import { useI18n } from "@/i18n/client";
import { saveTireSet } from "./actions";

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
}: {
  initial: TireSetFormInitial;
  /** bereits genutzte Lagerorte als Vorschlagsliste */
  locations: string[];
  cancelHref: string;
}) {
  const { t, td } = useI18n();
  const [state, action] = useActionState<ActionState, FormData>(saveTireSet, {});
  const [spare, setSpare] = useState(initial.spare);
  const [rows, setRows] = useState(initial.tires);
  const err = state.fieldErrors ?? {};
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
    <form action={action} className="flex flex-col gap-5">
      {initial.id ? (
        <>
          <input type="hidden" name="id" value={initial.id} />
          <input type="hidden" name="version" value={initial.version ?? ""} />
        </>
      ) : null}

      <Card title={t("tires.sections.vehicle")}>
        <Field label={t("tires.fields.vehicle")} error={err.vehicleId} required>
          {initial.id && initial.vehicle ? (
            <>
              <input type="hidden" name="vehicleId" value={initial.vehicle.id} />
              <p className="text-sm">
                <Plate>{initial.vehicle.plate}</Plate>{" "}
                <span className="ml-2 text-ink-muted">{[initial.vehicle.description, initial.vehicle.customer].filter(Boolean).join(" · ")}</span>
              </p>
            </>
          ) : (
            <VehicleCombobox initial={initial.vehicle} invalid={!!err.vehicleId} required />
          )}
        </Field>
      </Card>

      <Card title={t("tires.sections.set")}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={t("tires.fields.season")} htmlFor="season" required>
            <Select id="season" name="season" defaultValue={initial.season}>
              {TIRE_SEASONS.map((s) => (
                <option key={s} value={s}>
                  {td(`enums.season.${s}`, s)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("tires.fields.brand")} htmlFor="brand" error={err.brand}>
            <Input id="brand" name="brand" defaultValue={initial.brand} maxLength={60} placeholder="Continental" />
          </Field>
          <Field label={t("tires.fields.model")} htmlFor="model" error={err.model} className="sm:col-span-2 lg:col-span-1">
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
            <Field label={t("tires.fields.width")} htmlFor="width" error={err.width}>
              <Input id="width" name="width" type="number" inputMode="numeric" defaultValue={initial.width} placeholder="205" invalid={!!err.width} />
            </Field>
            <Field label={t("tires.fields.aspect")} htmlFor="aspect" error={err.aspect}>
              <Input id="aspect" name="aspect" type="number" inputMode="numeric" defaultValue={initial.aspect} placeholder="55" invalid={!!err.aspect} />
            </Field>
            <Field label={t("tires.fields.rim")} htmlFor="rim" error={err.rim}>
              <Input id="rim" name="rim" type="number" inputMode="numeric" defaultValue={initial.rim} placeholder="16" invalid={!!err.rim} />
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
        <Table className="min-w-[34rem]">
            <thead>
              <tr>
                <th>{t("tires.fields.position")}</th>
                <th>{t("tires.fields.dot")}</th>
                <th>{t("tires.fields.tread")}</th>
                <th>{t("tires.fields.condition")}</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((pos) => (
                <tr key={pos}>
                  <td className="whitespace-nowrap font-medium">{td(`enums.position.${pos}`, pos)}</td>
                  <td className="w-32">
                    <Input
                      name={`tire.${pos}.dot`}
                      aria-label={`${td(`enums.position.${pos}`, pos)} – ${t("tires.fields.dot")}`}
                      value={rows[pos].dot}
                      onChange={(e) => setRow(pos, { dot: e.target.value.replace(/\D/g, "").slice(0, 4) })}
                      inputMode="numeric"
                      placeholder="2321"
                      maxLength={4}
                      invalid={!!err[`tire.${pos}.dot`]}
                    />
                    {err[`tire.${pos}.dot`] ? <FieldError>{err[`tire.${pos}.dot`]}</FieldError> : null}
                  </td>
                  <td className="w-32">
                    <Input
                      name={`tire.${pos}.tread`}
                      aria-label={`${td(`enums.position.${pos}`, pos)} – ${t("tires.fields.tread")}`}
                      type="number"
                      step="0.1"
                      min="0"
                      max="15"
                      inputMode="decimal"
                      value={rows[pos].tread}
                      onChange={(e) => setRow(pos, { tread: e.target.value })}
                      placeholder="6.5"
                      invalid={!!err[`tire.${pos}.tread`]}
                    />
                    {err[`tire.${pos}.tread`] ? <FieldError>{err[`tire.${pos}.tread`]}</FieldError> : null}
                  </td>
                  <td>
                    <Select
                      name={`tire.${pos}.condition`}
                      aria-label={`${td(`enums.position.${pos}`, pos)} – ${t("tires.fields.condition")}`}
                      value={rows[pos].condition}
                      onChange={(e) => setRow(pos, { condition: e.target.value })}
                    >
                      {TIRE_CONDITIONS.map((c) => (
                        <option key={c} value={c}>
                          {td(`enums.condition.${c}`, c)}
                        </option>
                      ))}
                    </Select>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        <Checkbox name="spare" checked={spare} onChange={(e) => setSpare(e.target.checked)} label={t("tires.fields.spare")} className="mt-3" />
      </Card>

      <Card title={t("tires.sections.storage")}>
        <div className="grid gap-4 sm:grid-cols-3">
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
            <Input id="storageLocation" name="storageLocation" list="tire-locations" defaultValue={initial.storageLocation} maxLength={120} placeholder="Halle A / Regal 3 / Fach 2" />
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

      <FormMessage state={state} />
      <div className="flex justify-end gap-2">
        <LinkButton href={cancelHref}>
          {t("common.cancel")}
        </LinkButton>
        <SubmitButton>{t("common.save")}</SubmitButton>
      </div>
    </form>
  );
}

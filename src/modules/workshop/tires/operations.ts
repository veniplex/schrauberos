import { z } from "zod";
import { dateText } from "@/lib/zod-fields";
import { claimRow } from "@/lib/concurrency";
import { RIM_TYPES, TIRE_SEASONS, TIRE_SET_STATUSES, type TirePosition } from "@/modules/workshop/tires/constants";
import { isValidSeasonWindow, parseTireRows, type RawTireRow } from "@/modules/workshop/tires/domain";
import { defineOperation, fail, failFields, type RunContext } from "@/server/operations";

const optInt = (min: number, max: number) => z.coerce.number().int().min(min).max(max).optional();

const tireRows = z.record(z.string(), z.object({ dot: z.string().optional(), tread: z.string().optional(), condition: z.string().optional() }));

const tireSetInput = z
  .object({
    id: z.string().optional(),
    version: z.string().optional(),
    vehicleId: z.string(),
    season: z.enum(TIRE_SEASONS),
    status: z.enum(TIRE_SET_STATUSES).default("stored"),
    brand: z.string().max(60).optional(),
    model: z.string().max(60).optional(),
    width: optInt(100, 400),
    aspect: optInt(20, 100),
    rim: optInt(10, 30),
    loadIndex: z.string().max(5).optional(),
    speedIndex: z.string().max(3).optional(),
    rimType: z.enum(RIM_TYPES).default("none"),
    storageLocation: z.string().max(120).optional(),
    storedAt: dateText().optional(),
    notes: z.string().max(2000).optional(),
    spare: z.boolean(),
    /** Einzelreifen je Position (aus den Formularfeldern `tire.<POS>.dot|tread|condition`) */
    tires: tireRows,
  })
  .superRefine((d, ctx) => {
    // Fehler je Reifenfeld (`tire.<POS>.dot` / `.tread`)
    const { errors } = parseTireRows(d.tires as Partial<Record<TirePosition, RawTireRow>>, d.spare);
    for (const [field, kind] of Object.entries(errors)) ctx.addIssue({ code: "custom", message: kind === "dot" ? "tires.errors.dot" : "tires.errors.tread", path: [field] });
  });

type TireSetInput = z.output<typeof tireSetInput>;

/** Gemeinsamer Ablauf von Anlegen und Ändern (je ein eigenes Recht, daher zwei Operationen). */
async function saveTireSetRun({ input: d, tx, audit }: RunContext<TireSetInput, undefined>): Promise<{ id: string }> {
  const { tires } = parseTireRows(d.tires as Partial<Record<TirePosition, RawTireRow>>, d.spare);
  const vehicle = await tx.vehicle.findUnique({ where: { id: d.vehicleId }, select: { id: true, plate: true } });
  if (!vehicle) failFields({ vehicleId: { key: "validation.required" } });

  const data = {
    vehicleId: vehicle.id,
    season: d.season,
    status: d.status,
    brand: d.brand ?? null,
    model: d.model ?? null,
    width: d.width ?? null,
    aspect: d.aspect ?? null,
    rim: d.rim ?? null,
    loadIndex: d.loadIndex ?? null,
    speedIndex: d.speedIndex ?? null,
    rimType: d.rimType,
    storageLocation: d.storageLocation ?? null,
    ...(d.storedAt ? { storedAt: new Date(`${d.storedAt}T12:00:00`) } : {}),
    notes: d.notes ?? null,
  };

  let id: string;
  if (d.id) {
    if (!(await claimRow(tx.tireSet, d.id, d.version))) fail("conflict");
    await tx.tireSet.update({ where: { id: d.id }, data });
    await tx.tire.deleteMany({ where: { tireSetId: d.id } });
    await tx.tire.createMany({ data: tires.map((x) => ({ ...x, tireSetId: d.id! })) });
    id = d.id;
  } else {
    id = (await tx.tireSet.create({ data })).id;
    await tx.tire.createMany({ data: tires.map((x) => ({ ...x, tireSetId: id })) });
  }
  audit({ target: vehicle.plate, entityId: id });
  return { id };
}

export const createTireSetOperation = defineOperation({
  name: "tires.create",
  permission: "tires.create",
  input: tireSetInput.refine((d) => !d.id, { message: "validation.invalid", path: ["id"] }),
  audit: "tires.create",
  run: saveTireSetRun,
});

export const updateTireSetOperation = defineOperation({
  name: "tires.update",
  permission: "tires.edit",
  input: tireSetInput.refine((d) => !!d.id, { message: "validation.invalid", path: ["id"] }),
  audit: "tires.update",
  run: saveTireSetRun,
});

/** Die beiden Buchungen des Lagers: `stored` = wieder einbuchen, `mounted` = ausbuchen (geht beim Kunden ans Fahrzeug). Entsorgen ist ein eigener Vorgang. */
export const STOCK_STATUSES = ["stored", "mounted"] as const;

/**
 * Satz ein-/ausbuchen (Lager ↔ beim Kunden montiert). Eigenes Recht `tires.stock` – **bewusst nicht** `tires.edit`: Die Werkstatt bucht Sätze am Fahrzeug um (Mechaniker
 * in den Standardrollen), ohne den Satz selbst (Größe, Zustand, Lagerort, Löschen) bearbeiten zu dürfen. `version` ist Pflicht (Konfliktprüfung): Wer eine Buchung
 * bestätigt, die ein anderer inzwischen schon vorgenommen hat, bekommt den Konflikt statt einer stillen Doppelbuchung. Ein entsorgter Satz lässt sich nicht buchen
 * (nur über das vollständige Bearbeiten, `tires.edit`), ebenso wenig wie in den Zustand zu buchen, in dem er schon ist.
 */
export const setStatusOperation = defineOperation({
  name: "tires.setStatus",
  permission: "tires.stock",
  input: z.object({ id: z.string().min(1), version: z.string().min(1), status: z.enum(STOCK_STATUSES) }),
  audit: "tires.stock",
  run: async ({ input, tx, audit }) => {
    const set = await tx.tireSet.findUnique({ where: { id: input.id }, select: { status: true, vehicle: { select: { plate: true } } } });
    if (!set) fail("notFound");
    if (set.status === "disposed") fail("invalid", "tires.errors.disposed");
    if (set.status === input.status) fail("conflict");
    if (!(await claimRow(tx.tireSet, input.id, input.version))) fail("conflict");
    // Beim erneuten Einlagern beginnt die Lagerzeit neu
    await tx.tireSet.update({ where: { id: input.id }, data: { status: input.status, ...(input.status === "stored" ? { storedAt: new Date() } : {}) } });
    audit({ target: `${set.vehicle.plate}: ${input.status}`, entityId: input.id });
    return { id: input.id, status: input.status };
  },
});

/** Satz als entsorgt markieren: wie das Bearbeiten ein Recht `tires.edit` (nicht das Ein-/Ausbuchen) und mit Versionsprüfung. */
export const disposeOperation = defineOperation({
  name: "tires.dispose",
  permission: "tires.edit",
  input: z.object({ id: z.string().min(1), version: z.string().min(1) }),
  audit: "tires.dispose",
  run: async ({ input, tx, audit }) => {
    const set = await tx.tireSet.findUnique({ where: { id: input.id }, select: { status: true, vehicle: { select: { plate: true } } } });
    if (!set) fail("notFound");
    if (set.status === "disposed") fail("conflict");
    if (!(await claimRow(tx.tireSet, input.id, input.version))) fail("conflict");
    await tx.tireSet.update({ where: { id: input.id }, data: { status: "disposed" } });
    audit({ target: set.vehicle.plate, entityId: input.id });
    return { id: input.id };
  },
});

export const deleteTireSetOperation = defineOperation({
  name: "tires.delete",
  permission: "tires.delete",
  input: z.object({ id: z.string().min(1) }),
  audit: "tires.delete",
  run: async ({ input, tx, audit }) => {
    const set = await tx.tireSet.findUnique({ where: { id: input.id }, select: { vehicle: { select: { plate: true } } } });
    if (!set) fail("notFound");
    await tx.tireSet.delete({ where: { id: input.id } });
    audit({ target: set.vehicle.plate, entityId: input.id });
    return { id: input.id };
  },
});

/* ───────────── Einstellungen (Reifen-Ampel) ───────────── */

const settingsInput = z
  .object({
    treadWarnMm: z.coerce.number().min(1).max(10),
    treadReplaceMm: z.coerce.number().min(1).max(10),
    tireAgeWarnYears: z.coerce.number().int().min(1).max(20),
    tireAgeReplaceYears: z.coerce.number().int().min(1).max(25),
    winterStartMonth: z.coerce.number().int().min(1).max(12),
    winterEndMonth: z.coerce.number().int().min(1).max(12),
  })
  .superRefine((d, ctx) => {
    if (!isValidSeasonWindow(d)) ctx.addIssue({ code: "custom", message: "tires.settings.errors.seasonWindow", path: ["winterEndMonth"] });
    if (d.treadReplaceMm > d.treadWarnMm) ctx.addIssue({ code: "custom", message: "tires.settings.errors.treadOrder", path: ["treadReplaceMm"] });
    if (d.tireAgeWarnYears > d.tireAgeReplaceYears) ctx.addIssue({ code: "custom", message: "tires.settings.errors.ageOrder", path: ["tireAgeWarnYears"] });
  });

export const saveSettingsOperation = defineOperation({
  name: "tires.saveSettings",
  permission: "settings.manage",
  input: settingsInput,
  audit: "settings.tires",
  run: async ({ input: d, tx, audit }) => {
    await tx.tireSettings.upsert({ where: { id: "default" }, update: d, create: { id: "default", ...d } });
    audit({ target: `${d.treadWarnMm}/${d.treadReplaceMm} mm, ${d.tireAgeWarnYears}/${d.tireAgeReplaceYears} a, Winter ${d.winterStartMonth}–${d.winterEndMonth}`, entityId: "default" });
    return {};
  },
});


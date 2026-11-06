import { z } from "zod";
import { dateText } from "@/lib/zod-fields";
import { claimRow } from "@/lib/concurrency";
import { RIM_TYPES, TIRE_SEASONS, TIRE_SET_STATUSES, type TirePosition } from "@/modules/workshop/tires/constants";
import { parseTireRows, type RawTireRow } from "@/modules/workshop/tires/domain";
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

export const setStatusOperation = defineOperation({
  name: "tires.setStatus",
  permission: "tires.edit",
  input: z.object({ id: z.string().min(1), status: z.enum(TIRE_SET_STATUSES) }),
  audit: "tires.update",
  run: async ({ input, tx, audit }) => {
    const set = await tx.tireSet.findUnique({ where: { id: input.id }, select: { vehicle: { select: { plate: true } } } });
    if (!set) fail("notFound");
    await tx.tireSet.update({
      where: { id: input.id },
      // Beim erneuten Einlagern beginnt die Lagerzeit neu
      data: { status: input.status, ...(input.status === "stored" ? { storedAt: new Date() } : {}) },
    });
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
  })
  .superRefine((d, ctx) => {
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
    audit({ target: `${d.treadWarnMm}/${d.treadReplaceMm} mm, ${d.tireAgeWarnYears}/${d.tireAgeReplaceYears} a`, entityId: "default" });
    return {};
  },
});


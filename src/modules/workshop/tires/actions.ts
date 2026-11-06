"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { requirePermission } from "@/server/auth/session";
import { getI18n } from "@/i18n/server";
import type { ActionState } from "@/components/ui/form";
import { RIM_TYPES, TIRE_CONDITIONS, TIRE_POSITIONS, TIRE_SEASONS, TIRE_SET_STATUSES, type TirePosition } from "@/modules/workshop/tires/constants";
import { parseDot } from "@/modules/workshop/tires/domain";
import { fieldErrors, formObject } from "@/lib/forms";
import { audit } from "@/server/audit";

const optInt = (min: number, max: number) => z.coerce.number().int().min(min).max(max).optional();

const schema = z.object({
  id: z.string().optional(),
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
  storedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes: z.string().max(2000).optional(),
  spare: z.string().optional(),
});

function revalidateAll(id?: string) {
  revalidatePath("/tires");
  revalidatePath("/");
  if (id) revalidatePath(`/tires/${id}`);
}

export async function saveTireSet(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const raw = formObject(formData);
  await requirePermission(raw.id ? "tires.edit" : "tires.create");
  const { t } = await getI18n();

  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error, t) };
  const d = parsed.data;

  // Einzelne Reifen: Felder heißen tire.<POS>.dot | tread | condition
  const errors: Record<string, string> = {};
  const positions: TirePosition[] = d.spare ? [...TIRE_POSITIONS] : TIRE_POSITIONS.filter((p) => p !== "SPARE");
  const tires = positions.map((position) => {
    const dotRaw = raw[`tire.${position}.dot`];
    const treadRaw = raw[`tire.${position}.tread`]?.replace(",", ".");
    const conditionRaw = raw[`tire.${position}.condition`] ?? "good";

    const dot = dotRaw ? parseDot(dotRaw) : null;
    // Ungültig oder in der Zukunft (z. B. 1234 = Woche 12/2034) -> vermutlich vertippt
    if (dotRaw && (!dot || dot.year > new Date().getFullYear())) errors[`tire.${position}.dot`] = t("tires.errors.dot");
    const tread = treadRaw !== undefined ? Number(treadRaw) : null;
    if (tread !== null && (!Number.isFinite(tread) || tread < 0 || tread > 15)) errors[`tire.${position}.tread`] = t("tires.errors.tread");
    const condition = (TIRE_CONDITIONS as readonly string[]).includes(conditionRaw) ? conditionRaw : "good";

    return {
      position,
      dot: dotRaw && dot ? dotRaw : null,
      producedWeek: dot?.week ?? null,
      producedYear: dot?.year ?? null,
      treadDepthMm: tread,
      condition,
      measuredAt: tread !== null ? new Date() : null,
    };
  });
  if (Object.keys(errors).length) return { fieldErrors: errors };

  const vehicle = await db.vehicle.findUnique({ where: { id: d.vehicleId }, select: { id: true } });
  if (!vehicle) return { fieldErrors: { vehicleId: t("validation.required") } };

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

  const id = await db.$transaction(async (tx) => {
    if (d.id) {
      await tx.tireSet.update({ where: { id: d.id }, data });
      await tx.tire.deleteMany({ where: { tireSetId: d.id } });
      await tx.tire.createMany({ data: tires.map((x) => ({ ...x, tireSetId: d.id! })) });
      return d.id;
    }
    const created = await tx.tireSet.create({ data });
    await tx.tire.createMany({ data: tires.map((x) => ({ ...x, tireSetId: created.id })) });
    return created.id;
  });

  revalidateAll(id);
  redirect(`/tires/${id}`);
}

export async function setTireSetStatus(formData: FormData) {
  await requirePermission("tires.edit");
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!id || !(TIRE_SET_STATUSES as readonly string[]).includes(status)) return;
  await db.tireSet.update({
    where: { id },
    // Beim erneuten Einlagern beginnt die Lagerzeit neu
    data: { status, ...(status === "stored" ? { storedAt: new Date() } : {}) },
  });
  revalidateAll(id);
}

export async function deleteTireSet(formData: FormData) {
  await requirePermission("tires.delete");
  const id = String(formData.get("id") ?? "");
  const set = id ? await db.tireSet.findUnique({ where: { id }, select: { vehicle: { select: { plate: true } } } }) : null;
  if (id) await db.tireSet.deleteMany({ where: { id } });
  if (set) await audit("tires.delete", { target: set.vehicle.plate, entityId: id });
  revalidateAll();
  redirect("/tires");
}

/* ───────────── Einstellungen (Reifen-Ampel) ───────────── */

const settingsSchema = z.object({
  treadWarnMm: z.coerce.number().min(1).max(10),
  treadReplaceMm: z.coerce.number().min(1).max(10),
  tireAgeWarnYears: z.coerce.number().int().min(1).max(20),
  tireAgeReplaceYears: z.coerce.number().int().min(1).max(25),
});

export async function saveTireSettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission("settings.manage");
  const { t } = await getI18n();
  const parsed = settingsSchema.safeParse(formObject(formData));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error, t) };
  const d = parsed.data;
  if (d.treadReplaceMm > d.treadWarnMm) return { fieldErrors: { treadReplaceMm: t("tires.settings.errors.treadOrder") } };
  if (d.tireAgeWarnYears > d.tireAgeReplaceYears) return { fieldErrors: { tireAgeWarnYears: t("tires.settings.errors.ageOrder") } };

  await db.tireSettings.upsert({ where: { id: "default" }, update: d, create: { id: "default", ...d } });
  await audit("settings.tires");
  revalidatePath("/", "layout");
  return { ok: true, message: t("common.saved") };
}

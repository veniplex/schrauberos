"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { requirePermission } from "@/server/auth/session";
import { getI18n } from "@/i18n/server";
import type { ActionState } from "@/components/ui/form";
import { isHexColor } from "@/lib/color";
import { WEEKDAYS } from "@/lib/constants";
import { isValidTime } from "@/lib/opening-hours";
import { fieldErrors, formObject } from "@/lib/forms";
import { audit } from "@/server/audit";

const MAX_LOGO_BYTES = 200 * 1024;
const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];

const workshopSchema = z.object({
  name: z.string().trim().min(1).max(80),
  tagline: z.string().max(120).optional(),
  street: z.string().max(120).optional(),
  zip: z.string().max(12).optional(),
  city: z.string().max(80).optional(),
  phone: z.string().max(60).optional(),
  email: z.string().email().max(200).optional(),
  website: z.string().max(200).optional(),
  accentColor: z.string().refine(isHexColor),
});

export async function saveWorkshop(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission("settings.manage");
  const { t } = await getI18n();
  const parsed = workshopSchema.safeParse(formObject(formData));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error, t) };
  const d = parsed.data;

  // Öffnungszeiten
  const hours: Record<string, [string, string] | null> = {};
  const errors: Record<string, string> = {};
  for (const day of WEEKDAYS) {
    if (formData.get(`hours.${day}.closed`) === "on") {
      hours[day] = null;
      continue;
    }
    const from = String(formData.get(`hours.${day}.from`) ?? "");
    const to = String(formData.get(`hours.${day}.to`) ?? "");
    if (!isValidTime(from) || !isValidTime(to) || to <= from) {
      errors[`hours.${day}`] = t("settings.errors.hoursInvalid");
      continue;
    }
    hours[day] = [from, to];
  }
  if (Object.keys(errors).length) return { fieldErrors: errors };

  // Logo
  let logoDataUrl: string | null | undefined; // undefined = unverändert
  if (formData.get("removeLogo") === "on") logoDataUrl = null;
  const file = formData.get("logo");
  if (file instanceof File && file.size > 0) {
    if (!LOGO_TYPES.includes(file.type)) return { fieldErrors: { logo: t("settings.errors.logoType") } };
    if (file.size > MAX_LOGO_BYTES) return { fieldErrors: { logo: t("settings.errors.logoSize") } };
    const buf = Buffer.from(await file.arrayBuffer());
    logoDataUrl = `data:${file.type};base64,${buf.toString("base64")}`;
  }

  const data = {
    name: d.name,
    tagline: d.tagline ?? null,
    street: d.street ?? null,
    zip: d.zip ?? null,
    city: d.city ?? null,
    phone: d.phone ?? null,
    email: d.email ?? null,
    website: d.website ?? null,
    accentColor: d.accentColor.toLowerCase(),
    openingHours: JSON.stringify(hours),
    ...(logoDataUrl !== undefined ? { logoDataUrl } : {}),
  };
  await db.workshop.upsert({ where: { id: "default" }, update: data, create: { id: "default", ...data } });

  await audit("settings.workshop", { target: d.name });
  revalidatePath("/", "layout");
  return { ok: true, message: t("common.saved") };
}

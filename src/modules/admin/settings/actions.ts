"use server";

import { z } from "zod";
import { isHexColor } from "@/lib/color";
import { WEEKDAYS } from "@/lib/constants";
import { formObject } from "@/lib/forms";
import { isValidTime } from "@/lib/opening-hours";
import { AUDIT_RETENTION_KEY, AUDIT_RETENTION_MAX_DAYS } from "@/server/audit-retention";
import { BEHIND_PROXY_KEY } from "@/server/auth/network";
import { defineAction, defineOperation, failField } from "@/server/operations";
import { setSetting } from "@/server/settings";
import { applyTimezone, isValidTimezone } from "@/server/startup";

const MAX_LOGO_BYTES = 200 * 1024;
const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];

const dayHours = z.object({ closed: z.boolean(), from: z.string(), to: z.string() });

const workshopInput = z
  .object({
    name: z.string().trim().min(1).max(80),
    tagline: z.string().max(120).optional(),
    street: z.string().max(120).optional(),
    zip: z.string().max(12).optional(),
    city: z.string().max(80).optional(),
    phone: z.string().max(60).optional(),
    email: z.string().email().max(200).optional(),
    website: z.string().max(200).optional(),
    accentColor: z.string().refine(isHexColor),
    timezone: z.string().max(60).refine(isValidTimezone, { error: "validation.invalid" }),
    hours: z.record(z.string(), dayHours),
    removeLogo: z.boolean(),
    logo: z.custom<File>((value) => value instanceof File).optional(),
  })
  .superRefine((d, ctx) => {
    // Öffnungszeiten: Fehler je Wochentag (Feldname `hours.<tag>`)
    for (const day of WEEKDAYS) {
      const h = d.hours[day];
      if (!h || h.closed) continue;
      if (!isValidTime(h.from) || !isValidTime(h.to) || h.to <= h.from) ctx.addIssue({ code: "custom", message: "settings.errors.hoursInvalid", path: [`hours.${day}`] });
    }
  });

const saveWorkshopOperation = defineOperation({
  name: "admin.settings.saveWorkshop",
  permission: "settings.manage",
  input: workshopInput,
  audit: "settings.workshop",
  // Logo prüfen und einlesen (Datei), bevor die Transaktion beginnt
  prepare: async ({ input }) => {
    let logoDataUrl: string | null | undefined; // undefined = unverändert
    if (input.removeLogo) logoDataUrl = null;
    const file = input.logo;
    if (file && file.size > 0) {
      if (!LOGO_TYPES.includes(file.type)) failField("logo", "settings.errors.logoType");
      if (file.size > MAX_LOGO_BYTES) failField("logo", "settings.errors.logoSize");
      logoDataUrl = `data:${file.type};base64,${Buffer.from(await file.arrayBuffer()).toString("base64")}`;
    }
    return { logoDataUrl };
  },
  run: async ({ input: d, prepared, tx, audit, afterCommit }) => {
    const hours: Record<string, [string, string] | null> = {};
    for (const day of WEEKDAYS) {
      const h = d.hours[day]!;
      hours[day] = h.closed ? null : [h.from, h.to];
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
      timezone: d.timezone,
      openingHours: JSON.stringify(hours),
      ...(prepared.logoDataUrl !== undefined ? { logoDataUrl: prepared.logoDataUrl } : {}),
    };
    await tx.workshop.upsert({ where: { id: "default" }, update: data, create: { id: "default", ...data } });
    afterCommit(() => applyTimezone(d.timezone)); // erst nach dem Speichern, nie bei einem abgebrochenen Vorgang
    audit({ target: d.name });
    return { saved: true };
  },
});

export const saveWorkshop = defineAction(saveWorkshopOperation, {
  form: (fd) => ({
    ...formObject(fd),
    hours: Object.fromEntries(
      WEEKDAYS.map((day) => [day, { closed: fd.get(`hours.${day}.closed`) === "on", from: String(fd.get(`hours.${day}.from`) ?? ""), to: String(fd.get(`hours.${day}.to`) ?? "") }]),
    ),
    removeLogo: fd.get("removeLogo") === "on",
    logo: fd.get("logo") instanceof File ? fd.get("logo") : undefined,
  }),
  revalidate: [["/", "layout"]],
  message: "common.saved",
});

const securityInput = z.object({
  behindProxy: z.boolean(),
  /** Tage, 0 = unbegrenzt aufbewahren; ohne Angabe bleibt die Einstellung unverändert */
  auditRetentionDays: z.coerce.number().int().min(0).max(AUDIT_RETENTION_MAX_DAYS).optional(),
});

/** Sicherheit: Läuft die Anwendung hinter einem Reverse-Proxy? Nur dann wird die Client-Adresse aus X-Forwarded-For ausgewertet. Dazu die Aufbewahrung des Audit-Logs. */
const saveSecurityOperation = defineOperation({
  name: "admin.settings.saveSecurity",
  permission: "settings.manage",
  input: securityInput,
  audit: "settings.security",
  run: async ({ input, tx }) => {
    await setSetting(BEHIND_PROXY_KEY, input.behindProxy ? "true" : "false", tx);
    if (input.auditRetentionDays !== undefined) await setSetting(AUDIT_RETENTION_KEY, String(input.auditRetentionDays), tx);
    return { saved: true };
  },
});

export const saveSecurity = defineAction(saveSecurityOperation, {
  form: (fd) => ({ ...formObject(fd), behindProxy: fd.get("behindProxy") === "on" }),
  revalidate: ["/settings"],
  message: "common.saved",
});

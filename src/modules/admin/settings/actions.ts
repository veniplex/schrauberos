"use server";

import { MAX_LOGO_BYTES } from "./limits";
import { z } from "zod";
import { isValidBic, isValidIban, isValidTaxNumber, isValidVatId, normalizeBic, normalizeIban, normalizeVatId } from "@/lib/bank-tax";
import { isHexColor } from "@/lib/color";
import { WEEKDAYS } from "@/lib/constants";
import { formObject } from "@/lib/forms";
import { isValidTime } from "@/lib/opening-hours";
import { DEFAULT_INVOICE_NUMBER_FORMAT, parseInvoiceNumberFormat } from "@/lib/invoice-number-format";
import { LOGO_TYPES } from "@/lib/logo";
import { checkUpload } from "@/lib/upload-sniff";
import { moneyCents } from "@/lib/zod-fields";
import { AUDIT_RETENTION_KEY, AUDIT_RETENTION_MAX_DAYS, AUDIT_RETENTION_MIN_DAYS, parseRetentionDays } from "@/server/audit-retention";
import { CSP_MODE_KEY, parseCspMode, setCspModeInProcess } from "@/lib/csp-mode";
import { BEHIND_PROXY_KEY } from "@/server/auth/network";
import { IDLE_TIMEOUT_KEY, IDLE_TIMEOUT_MAX_HOURS, parseIdleHours, REQUIRE_2FA_ADMINS_KEY } from "@/server/auth/policy";
import { jobRunner } from "@/server/jobs";
import { defineAction, defineOperation, fail, failField } from "@/server/operations";
import { setSetting } from "@/server/settings";
import { applyTimezone, isValidTimezone } from "@/server/startup";
import { deleteHolidayCustomOperation, saveHolidayCustomOperation, saveHolidayRegionOperation, saveHolidayRulesOperation } from "./holiday-operations";

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
    // Werkstattprofil für Rechnungen (P4b-7): alles optional
    taxNumber: z.string().trim().max(30).refine(isValidTaxNumber, { error: "settings.errors.taxNumber" }).optional(),
    vatId: z.string().trim().max(30).refine(isValidVatId, { error: "settings.errors.vatId" }).optional(),
    smallBusiness: z.boolean(),
    bankName: z.string().trim().max(80).optional(),
    iban: z.string().trim().max(42).refine(isValidIban, { error: "settings.errors.iban" }).optional(),
    bic: z.string().trim().max(14).refine(isValidBic, { error: "settings.errors.bic" }).optional(),
    paymentTermDays: z.coerce.number().int().min(0).max(365).default(14),
    managingDirector: z.string().trim().max(120).optional(),
    registerCourt: z.string().trim().max(120).optional(),
    registerNumber: z.string().trim().max(60).optional(),
    hourlyRate: moneyCents("settings.errors.hourlyRate")
      .refine((cents) => cents >= 0 && cents <= 1_000_000, { error: "settings.errors.hourlyRate" })
      .optional(),
    workUnitMinutes: z.coerce.number().int().min(1).max(60).default(5),
    invoiceNumberFormat: z.string().trim().max(60).default(DEFAULT_INVOICE_NUMBER_FORMAT),
    hours: z.record(z.string(), dayHours),
    removeLogo: z.boolean(),
    logo: z.custom<File>((value) => value instanceof File).optional(),
  })
  .superRefine((d, ctx) => {
    const format = parseInvoiceNumberFormat(d.invoiceNumberFormat);
    if (!format.ok) ctx.addIssue({ code: "custom", message: `settings.errors.numberFormat.${format.error}`, path: ["invoiceNumberFormat"] });
    // Öffnungszeiten: Fehler je Wochentag (Feldname `hours.<tag>`)
    for (const day of WEEKDAYS) {
      const h = d.hours[day];
      if (!h || h.closed) continue;
      if (!isValidTime(h.from) || !isValidTime(h.to) || h.to <= h.from) ctx.addIssue({ code: "custom", message: "settings.errors.hoursInvalid", path: [`hours.${day}`] });
    }
  });

/** Felder des Werkstattprofils für Rechnungen: ihre Änderung steht (ohne Werte) im Audit-Log. */
const PROFILE_FIELDS = ["taxNumber", "vatId", "smallBusiness", "bankName", "iban", "bic", "paymentTermDays", "managingDirector", "registerCourt", "registerNumber", "hourlyRateCents", "workUnitMinutes", "invoiceNumberFormat"] as const;

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
      if (file.size > MAX_LOGO_BYTES) failField("logo", "settings.errors.logoSize");
      // Der Inhalt entscheidet (Magic Bytes), nicht der gemeldete Typ; in die Daten-URL kommt der erkannte Typ
      const data = new Uint8Array(await file.arrayBuffer());
      const checked = checkUpload(data, file.type, LOGO_TYPES);
      if (!checked.ok) failField("logo", "settings.errors.logoType");
      logoDataUrl = `data:${checked.mime};base64,${Buffer.from(data).toString("base64")}`;
    }
    return { logoDataUrl };
  },
  run: async ({ input: d, prepared, tx, audit, afterCommit }) => {
    const before = await tx.workshop.findUnique({ where: { id: "default" } });
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
      taxNumber: d.taxNumber ?? null,
      vatId: d.vatId ? normalizeVatId(d.vatId) : null,
      smallBusiness: d.smallBusiness,
      bankName: d.bankName ?? null,
      iban: d.iban ? normalizeIban(d.iban) : null,
      bic: d.bic ? normalizeBic(d.bic) : null,
      paymentTermDays: d.paymentTermDays,
      managingDirector: d.managingDirector ?? null,
      registerCourt: d.registerCourt ?? null,
      registerNumber: d.registerNumber ?? null,
      hourlyRateCents: d.hourlyRate ?? null,
      workUnitMinutes: d.workUnitMinutes,
      invoiceNumberFormat: d.invoiceNumberFormat,
      ...(prepared.logoDataUrl !== undefined ? { logoDataUrl: prepared.logoDataUrl } : {}),
    };
    await tx.workshop.upsert({ where: { id: "default" }, update: data, create: { id: "default", ...data } });
    // erst nach dem Speichern, nie bei einem abgebrochenen Vorgang; die Termine der Cron-Jobs gelten danach in der neuen Zeitzone
    // (Der Aktions-Rahmen wartet auf afterCommit-Aufgaben und protokolliert Fehler darin.)
    afterCommit(async () => {
      if (applyTimezone(d.timezone)) await jobRunner().reschedule();
    });
    // Im Audit-Log stehen die geänderten Rechnungsangaben (nur die Namen der Felder, nie IBAN oder Steuernummer selbst)
    const changed = before ? PROFILE_FIELDS.filter((field) => before[field] !== data[field]) : [];
    audit({ target: changed.length > 0 ? `${d.name} (${changed.join(", ")})` : d.name });
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
    smallBusiness: fd.get("smallBusiness") === "on",
    logo: fd.get("logo") instanceof File ? fd.get("logo") : undefined,
  }),
  revalidate: [["/", "layout"]],
  message: "common.saved",
});

const securityInput = z.object({
  behindProxy: z.boolean(),
  /** Tage, 0 = unbegrenzt aufbewahren, sonst mindestens 30; ohne Angabe bleibt die Einstellung unverändert */
  auditRetentionDays: z.coerce
    .number()
    .int()
    .min(0)
    .max(AUDIT_RETENTION_MAX_DAYS)
    .refine((days) => days === 0 || days >= AUDIT_RETENTION_MIN_DAYS, { message: "settings.errors.auditRetentionMin", params: { min: AUDIT_RETENTION_MIN_DAYS } } as never)
    .optional(),
  /** Stunden ohne Anfrage bis zur Abmeldung, 0 = aus; ohne Angabe bleibt die Einstellung unverändert */
  idleTimeoutHours: z.coerce.number().int().min(0).max(IDLE_TIMEOUT_MAX_HOURS).optional(),
  /** Zwei-Faktor-Anmeldung für Administratoren verpflichtend */
  requireTwoFactorAdmins: z.boolean(),
});

/** Sicherheit: Läuft die Anwendung hinter einem Reverse-Proxy? Nur dann wird die Client-Adresse aus X-Forwarded-For ausgewertet. Dazu die Aufbewahrung des Audit-Logs. */
const saveSecurityOperation = defineOperation({
  name: "admin.settings.saveSecurity",
  permission: "settings.manage",
  input: securityInput,
  audit: "settings.security",
  run: async ({ input, principal, tx, audit }) => {
    // Schutz vor Selbstaussperrung: Die Pflicht schaltet nur ein, wer als Administrator selbst schon einen zweiten Faktor hat (sonst gälte sie sofort auch für die eigene Sitzung)
    if (input.requireTwoFactorAdmins && principal.user.isAdmin && !principal.user.twoFactor) fail("conflict", "settings.errors.requireTwoFactorOwn");
    // Alter und neuer Wert stehen im Audit-Log (die Frist des Audit-Logs selbst zu verkürzen ist eine Änderung, die man später nachvollziehen können muss)
    const [oldProxy, oldRetention, oldIdle, oldRequire] = await Promise.all([
      tx.appSetting.findUnique({ where: { key: BEHIND_PROXY_KEY } }),
      tx.appSetting.findUnique({ where: { key: AUDIT_RETENTION_KEY } }),
      tx.appSetting.findUnique({ where: { key: IDLE_TIMEOUT_KEY } }),
      tx.appSetting.findUnique({ where: { key: REQUIRE_2FA_ADMINS_KEY } }),
    ]);
    const idleBefore = parseIdleHours(oldIdle?.value);
    const idleAfter = input.idleTimeoutHours ?? idleBefore;
    await setSetting(IDLE_TIMEOUT_KEY, String(idleAfter), tx);
    await setSetting(REQUIRE_2FA_ADMINS_KEY, input.requireTwoFactorAdmins ? "true" : "false", tx);
    const retentionBefore = parseRetentionDays(oldRetention?.value ?? null);
    const retentionAfter = input.auditRetentionDays ?? retentionBefore;
    await setSetting(BEHIND_PROXY_KEY, input.behindProxy ? "true" : "false", tx);
    if (input.auditRetentionDays !== undefined) await setSetting(AUDIT_RETENTION_KEY, String(input.auditRetentionDays), tx);
    const days = (n: number) => (n === 0 ? "unbegrenzt" : `${n} d`);
    audit({
      target: `Audit-Aufbewahrung ${days(retentionBefore)} → ${days(retentionAfter)}; Reverse-Proxy ${oldProxy?.value === "true" ? "an" : "aus"} → ${input.behindProxy ? "an" : "aus"}; Leerlauf-Abmeldung ${idleBefore === 0 ? "aus" : `${idleBefore} h`} → ${idleAfter === 0 ? "aus" : `${idleAfter} h`}; 2FA für Administratoren ${oldRequire?.value === "true" ? "Pflicht" : "freiwillig"} → ${input.requireTwoFactorAdmins ? "Pflicht" : "freiwillig"}`,
    });
    return { saved: true };
  },
});

export const saveSecurity = defineAction(saveSecurityOperation, {
  form: (fd) => ({ ...formObject(fd), behindProxy: fd.get("behindProxy") === "on", requireTwoFactorAdmins: fd.get("requireTwoFactorAdmins") === "on" }),
  revalidate: ["/settings"],
  message: "common.saved",
});

/**
 * Notschalter der Content-Security-Policy: „nur melden“ statt erzwingen. Der Proxy liest den Zustand aus dem Prozess (`lib/csp-mode.ts`), nicht aus der Datenbank –
 * deshalb wird er nach dem Speichern (nach dem Commit, nie bei einem Fehlschlag) im Prozess gesetzt; beim nächsten Start liest `startApp` ihn aus der Datenbank.
 */
const saveCspModeOperation = defineOperation({
  name: "admin.settings.saveCspMode",
  permission: "settings.manage",
  input: z.object({ reportOnly: z.boolean() }),
  audit: "settings.csp",
  run: async ({ input, tx, audit, afterCommit }) => {
    const before = parseCspMode((await tx.appSetting.findUnique({ where: { key: CSP_MODE_KEY } }))?.value);
    const after = input.reportOnly ? "report-only" : "enforce";
    await setSetting(CSP_MODE_KEY, after, tx);
    audit({ target: `${before} → ${after}` });
    afterCommit(() => setCspModeInProcess(after));
    return { mode: after };
  },
});

export const saveCspMode = defineAction(saveCspModeOperation, {
  form: (fd) => ({ reportOnly: fd.get("reportOnly") === "on" }),
  revalidate: ["/settings"],
  message: "common.saved",
});

/* ───────────── Feiertage (P4b-0) ───────────── */

export const saveHolidayRegion = defineAction(saveHolidayRegionOperation, { form: (fd) => ({ region: String(fd.get("region") ?? "") }), revalidate: [["/", "layout"]], message: "common.saved" });

/** Die Auswahlfelder `rule.<Kennung>` der Pflegeliste → `{ <Kennung>: Modus }`. */
export const saveHolidayRules = defineAction(saveHolidayRulesOperation, {
  form: (fd) => ({ rules: Object.fromEntries([...fd.entries()].filter(([k]) => k.startsWith("rule.")).map(([k, v]) => [k.slice(5), String(v)])) }),
  revalidate: [["/", "layout"]],
  message: "common.saved",
});

export const saveHolidayCustom = defineAction(saveHolidayCustomOperation, {
  form: (fd) => ({ ...formObject(fd), yearly: fd.get("yearly") === "on", half: fd.get("half") === "on" }),
  revalidate: [["/", "layout"]],
  message: "common.saved",
});

export const deleteHolidayCustom = defineAction(deleteHolidayCustomOperation, { form: formObject, revalidate: [["/", "layout"]], message: "common.deleted" });

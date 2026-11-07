import { z } from "zod";
import { claimRow } from "@/lib/concurrency";
import { isHolidayRegion, RULE_MODES, statutoryDays } from "@/lib/holidays";
import { dateText } from "@/lib/zod-fields";
import { defineOperation, fail, failField } from "@/server/operations";

/**
 * Feiertage pflegen (P4b-0): Region wählen, gesetzliche Tage der Region streichen/halbieren/einschalten und eigene Tage führen. Recht `settings.manage`, Audit `settings.holidays`.
 * Die Berechnung der Tage steht in `src/lib/holidays.ts`, das Lesen für die Funktionen in `src/server/holidays.ts`.
 */

export const saveHolidayRegionOperation = defineOperation({
  name: "admin.settings.saveHolidayRegion",
  permission: "settings.manage",
  input: z.object({ region: z.string().max(10).refine((r) => r === "" || isHolidayRegion(r), { error: "validation.invalid" }) }),
  audit: "settings.holidays",
  run: async ({ input, tx, audit }) => {
    const before = (await tx.holidaySettings.findUnique({ where: { id: "default" } }))?.region ?? "";
    await tx.holidaySettings.upsert({ where: { id: "default" }, update: { region: input.region }, create: { id: "default", region: input.region } });
    // Die Änderungen an den gesetzlichen Tagen gehören zur Region: Wer das Land oder Bundesland wechselt, beginnt mit den Vorgaben der neuen Region (eigene Tage bleiben)
    if (before !== input.region) await tx.holidayDay.deleteMany({ where: { kind: "rule" } });
    audit({ target: `${before || "–"} → ${input.region || "–"}`, entityId: "default" });
    return { region: input.region };
  },
});

const rulesInput = z.object({ rules: z.record(z.string().max(60), z.enum(["", ...RULE_MODES])) });

export const saveHolidayRulesOperation = defineOperation({
  name: "admin.settings.saveHolidayRules",
  permission: "settings.manage",
  input: rulesInput,
  audit: "settings.holidays",
  run: async ({ input, tx, audit }) => {
    const region = (await tx.holidaySettings.findUnique({ where: { id: "default" } }))?.region ?? "";
    const known = new Set(statutoryDays(2026, region).map((s) => s.id));
    const optional = new Set(statutoryDays(2026, region).filter((s) => s.optional).map((s) => s.id));
    const changes = Object.entries(input.rules).filter(([, mode]) => mode !== "");
    for (const [id, mode] of changes) {
      if (!known.has(id)) failField(`rule.${id}`, "validation.invalid");
      // Gesetzliche Tage gelten von selbst („einschalten“ gibt es nur für die Vorschläge), Vorschläge sind aus („streichen“ ist dort sinnlos)
      if ((mode === "on") !== optional.has(id) && mode !== "half") failField(`rule.${id}`, "validation.invalid");
    }
    await tx.holidayDay.deleteMany({ where: { kind: "rule" } });
    for (const [id, mode] of changes) await tx.holidayDay.create({ data: { kind: "rule", ruleKey: id, mode } });
    audit({ target: `${region || "–"}: ${changes.length}`, entityId: "default" });
    return { changed: changes.length };
  },
});

const customInput = z.object({
  id: z.string().optional(),
  version: z.string().optional(),
  name: z.string().trim().min(1).max(80),
  /** Tag des Jahres; bei „jedes Jahr“ zählen nur Monat und Tag */
  date: dateText(),
  yearly: z.boolean(),
  half: z.boolean(),
});

export const saveHolidayCustomOperation = defineOperation({
  name: "admin.settings.saveHolidayCustom",
  permission: "settings.manage",
  input: customInput,
  audit: "settings.holidays",
  run: async ({ input: d, tx, audit }) => {
    const [year, month, day] = d.date.split("-").map(Number);
    // „Jedes Jahr“ am 29. Februar gäbe es nur in Schaltjahren: lieber ablehnen als still auslassen
    if (d.yearly && month === 2 && day === 29) failField("date", "holidays.settings.errors.leapDay");
    const data = { kind: "custom", name: d.name, month, day, year: d.yearly ? null : year, half: d.half };
    let id: string;
    if (d.id) {
      if (!(await claimRow(tx.holidayDay, d.id, d.version))) fail("conflict");
      await tx.holidayDay.update({ where: { id: d.id }, data });
      id = d.id;
    } else {
      id = (await tx.holidayDay.create({ data })).id;
    }
    audit({ target: `${d.name} (${d.date}${d.yearly ? ", jährlich" : ""}${d.half ? ", halber Tag" : ""})`, entityId: id });
    return { id };
  },
});

export const deleteHolidayCustomOperation = defineOperation({
  name: "admin.settings.deleteHolidayCustom",
  permission: "settings.manage",
  input: z.object({ id: z.string().min(1) }),
  audit: "settings.holidays",
  run: async ({ input, tx, audit }) => {
    const row = await tx.holidayDay.findFirst({ where: { id: input.id, kind: "custom" } });
    if (!row) fail("notFound");
    await tx.holidayDay.delete({ where: { id: input.id } });
    audit({ target: row.name, entityId: input.id });
    return { id: input.id };
  },
});

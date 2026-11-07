import "server-only";
import { cache } from "react";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { FEATURES, MODULES, featureById } from "./catalog";
import { effectiveFeatureIds, type Overrides } from "./catalog-logic";
import { PRESETS, planPreset, type PresetPlan } from "./presets";

/** Gespeicherte Schalter (nur Abweichungen vom Standard der Funktion, `defaultEnabled`), pro Request gecacht. */
export const getOverrides = cache(async (): Promise<Overrides> => {
  const rows = await db.featureSetting.findMany();
  return Object.fromEntries(rows.map((r) => [r.key, r.enabled]));
});

/** IDs aller tatsächlich nutzbaren Funktionen (Schalter + Abhängigkeiten aufgelöst), pro Request gecacht. */
export const getActiveFeatureIds = cache(async (): Promise<Set<string>> => effectiveFeatureIds(MODULES, FEATURES, await getOverrides()));

/**
 * Wendet ein Preset der Einrichtung an (`presets.ts`): setzt die Schalter der genannten Funktionen samt Abhängigkeiten und Modulen. `null` bei unbekanntem Preset; sonst der Plan
 * (`skipped` nennt übersprungene IDs – unbekannte stoppen nichts). Läuft in der Transaktion des Aufrufers.
 */
export async function applyPreset(presetId: string, updatedByName: string, client: Pick<PrismaClient | Prisma.TransactionClient, "featureSetting"> = db): Promise<PresetPlan | null> {
  const preset = PRESETS.find((p) => p.id === presetId);
  if (!preset) return null;
  const plan = planPreset(preset, MODULES, FEATURES);
  for (const key of Object.keys(plan.overrides)) await setFeatureOverride(key, true, updatedByName, client);
  return plan;
}

export type SetResult = "ok" | "unknown" | "required";

/**
 * Schaltet ein Modul ("office") oder eine Funktion ("office.fleet") ein oder aus.
 * Pflichtmodule/-funktionen lassen sich nicht ausschalten. Daten bleiben immer erhalten.
 */
export async function setFeatureOverride(key: string, enabled: boolean, updatedByName: string, client: Pick<PrismaClient | Prisma.TransactionClient, "featureSetting"> = db): Promise<SetResult> {
  const mod = MODULES.find((m) => m.id === key);
  const feature = mod ? undefined : featureById(key);
  if (!mod && !feature) return "unknown";
  const required = mod ? ("required" in mod && mod.required) : ("required" in feature! && feature.required);
  if (required && !enabled) return "required";

  await client.featureSetting.upsert({
    where: { key },
    update: { enabled, updatedByName },
    create: { key, enabled, updatedByName },
  });
  return "ok";
}

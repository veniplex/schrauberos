import "server-only";
import { cache } from "react";
import { db } from "@/server/db";
import { FEATURES, MODULES, featureById } from "./catalog";
import { effectiveFeatureIds, type Overrides } from "./catalog-logic";

/** Gespeicherte Schalter (nur Abweichungen vom Standard "an"), pro Request gecacht. */
export const getOverrides = cache(async (): Promise<Overrides> => {
  const rows = await db.featureSetting.findMany();
  return Object.fromEntries(rows.map((r) => [r.key, r.enabled]));
});

/** IDs aller tatsächlich nutzbaren Funktionen (Schalter + Abhängigkeiten aufgelöst), pro Request gecacht. */
export const getActiveFeatureIds = cache(async (): Promise<Set<string>> => effectiveFeatureIds(MODULES, FEATURES, await getOverrides()));

export type SetResult = "ok" | "unknown" | "required";

/**
 * Schaltet ein Modul ("office") oder eine Funktion ("office.fleet") ein oder aus.
 * Pflichtmodule/-funktionen lassen sich nicht ausschalten. Daten bleiben immer erhalten.
 */
export async function setFeatureOverride(key: string, enabled: boolean, updatedByName: string): Promise<SetResult> {
  const mod = MODULES.find((m) => m.id === key);
  const feature = mod ? undefined : featureById(key);
  if (!mod && !feature) return "unknown";
  const required = mod ? ("required" in mod && mod.required) : ("required" in feature! && feature.required);
  if (required && !enabled) return "required";

  await db.featureSetting.upsert({
    where: { key },
    update: { enabled, updatedByName },
    create: { key, enabled, updatedByName },
  });
  return "ok";
}

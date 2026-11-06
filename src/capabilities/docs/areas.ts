import { DOC_FEATURES, type DocFeature, type Permission } from "@/modules/catalog";

/**
 * Dokumentations-Bereiche kommen aus dem Katalog: jede Funktion mit `docsArea` (z. B. workshop.docs) nutzt
 * diesen Baustein und bringt Rechte-Gruppe, Navigation und Aktivierung selbst mit.
 */
export type DocArea = DocFeature["docsArea"];

export const DOC_AREAS = DOC_FEATURES.map((f) => f.docsArea) as DocArea[];

export function isDocArea(value: string): value is DocArea {
  return (DOC_AREAS as string[]).includes(value);
}

/** Rechte je Dokumentationsbereich (Konvention: <gruppe>.view / <gruppe>.edit). */
export const DOC_PERMISSIONS = Object.fromEntries(
  DOC_FEATURES.map((f) => [f.docsArea, { view: `${f.permissions.group}.view`, edit: `${f.permissions.group}.edit` }]),
) as Record<DocArea, { view: Permission; edit: Permission }>;

/** Bereiche, in deren Editor ein Hinweis „Keine Passwörter in die Dokumentation“ steht (IT-Dokumentation). */
export const DOC_AREAS_WITH_PASSWORD_HINT = ["it"] as const satisfies readonly DocArea[];

export const DOC_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export const DOC_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
/** Älteste Versionen werden ab dieser Anzahl je Seite gelöscht. */
export const DOC_MAX_VERSIONS = 30;

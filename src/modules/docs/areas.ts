import type { Permission } from "../permissions";

export const DOC_AREAS = ["workshop", "it", "office"] as const;
export type DocArea = (typeof DOC_AREAS)[number];

export function isDocArea(value: string): value is DocArea {
  return (DOC_AREAS as readonly string[]).includes(value);
}

/** Rechte je Dokumentationsbereich. */
export const DOC_PERMISSIONS: Record<DocArea, { view: Permission; edit: Permission }> = {
  workshop: { view: "docsWorkshop.view", edit: "docsWorkshop.edit" },
  it: { view: "docsIt.view", edit: "docsIt.edit" },
  office: { view: "docsOffice.view", edit: "docsOffice.edit" },
};

export const DOC_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export const DOC_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
/** Älteste Versionen werden ab dieser Anzahl je Seite gelöscht. */
export const DOC_MAX_VERSIONS = 30;

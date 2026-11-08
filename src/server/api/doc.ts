import "server-only";
import { isApiForbidden } from "@/lib/api/scope";
import { apiEndpoints } from "@/modules/api";
import { buildOpenApi } from "./openapi";

/**
 * Beschreibung der Programmierschnittstelle für die Oberfläche (Doku-Seite, Rechte-Auswahl der Token-Seite). Kein eigener Zugang: Wer sie liest, hat die Sitzung mit `api.manage`
 * (Seite, `/admin/api/openapi.json`) bzw. ein gültiges Token (`/api/v1/openapi.json`). Dieselbe Quelle wie die Pipeline: die `api.ts` der Funktionen.
 */
export const apiDocument = (activeFeatures: ReadonlySet<string>) => buildOpenApi(apiEndpoints, activeFeatures);

/** Rechte, die ein Endpunkt aktiver Funktionen verlangt und die ein Token tragen darf – die Auswahl bei der Token-Erzeugung (nur, was die Schnittstelle auch nutzt). */
export function apiGrantablePermissions(activeFeatures: ReadonlySet<string>): string[] {
  return [...new Set(apiEndpoints.filter((e) => activeFeatures.has(e.feature)).flatMap((e) => [e.permission as string, ...((e.alsoRequires ?? []) as readonly string[])]))].filter((p) => !isApiForbidden(p));
}

/** Pfade der Ressourcen (erstes Segment, z. B. `orders`) – für Prüfungen, dass Webhook-Ereignisse auf eine echte Ressource zeigen. */
export const apiResourceRoots = (): ReadonlySet<string> => new Set(apiEndpoints.map((e) => e.path.split("/")[1]));

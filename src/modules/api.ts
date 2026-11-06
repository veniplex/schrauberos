import type { ApiEndpoint } from "@/server/api/types";
import { endpoints as customers } from "./workshop/customers/api";

/**
 * Composition Root der API-Ressourcen (wird von `registry.ts` wieder ausgegeben): Jede Funktion bringt ihre Endpunkte in einer `api.ts` mit
 * (`export const endpoints`, gebaut mit `defineResource` aus `@/server/api/resource`) und trägt sie hier ein. Nur Endpunkte **aktiver** Funktionen mit
 * Recht sind erreichbar (ausgeschaltet = 404). Plattform-/Verwaltungsfunktionen (Benutzer, Rollen, Einstellungen, Module, Backups, Updates, Audit,
 * API selbst) sind nie API-Ressourcen – `src/modules/api.test.ts` erzwingt das.
 */
export const apiEndpoints: readonly ApiEndpoint[] = [...customers];

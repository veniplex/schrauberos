import type { ApiEndpoint } from "@/server/api/types";
import { endpoints as network } from "./it/network/api";
import { endpoints as employees } from "./office/employees/api";
import { endpoints as fleet } from "./office/fleet/api";
import { endpoints as invoices } from "./office/invoices/api";
import { endpoints as billing } from "./office/billing/api";
import { endpoints as reports } from "./office/reports/api";
import { endpoints as time } from "./office/time/api";
import { endpoints as appointments } from "./workshop/appointments/api";
import { endpoints as customers } from "./workshop/customers/api";
import { endpoints as tires } from "./workshop/tires/api";
import { endpoints as orders } from "./workshop/orders/api";
import { endpoints as parts } from "./workshop/parts/api";
import { endpoints as files } from "./workshop/files/api";
import { endpoints as checklists } from "./workshop/checklists/api";
import { endpoints as vehicles } from "./workshop/vehicles/api";

/**
 * Composition Root der API-Ressourcen (wird nur von der API-Pipeline `src/server/api/router.ts` importiert – nicht über `registry.ts`, das jede Seite lädt): Jede Funktion bringt ihre Endpunkte in einer `api.ts` mit
 * (`export const endpoints`, gebaut mit `defineResource` aus `@/server/api/resource`) und trägt sie hier ein. Nur Endpunkte **aktiver** Funktionen mit
 * Recht sind erreichbar (ausgeschaltet = 404). Plattform-/Verwaltungsfunktionen (Benutzer, Rollen, Einstellungen, Module, Backups, Updates, Audit,
 * API selbst) sind nie API-Ressourcen – `src/modules/api.test.ts` erzwingt das.
 */
export const apiEndpoints: readonly ApiEndpoint[] = [...customers, ...vehicles, ...appointments, ...orders, ...parts, ...files, ...checklists, ...tires, ...invoices, ...billing, ...reports, ...employees, ...time, ...fleet, ...network];

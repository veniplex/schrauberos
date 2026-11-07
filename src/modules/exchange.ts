import type { ExportDef, ImportDef } from "@/server/csv/types";

import { accountantExport, invoicesExport, invoicesImport } from "./office/invoices/exchange";
import { customersExport, customersImport } from "./workshop/customers/exchange";
import { tiresExport, tiresImport } from "./workshop/tires/exchange";
import { vehiclesExport, vehiclesImport } from "./workshop/vehicles/exchange";

/**
 * Composition Root des Datenaustauschs (CSV): hier werden Exporte und Importe der Funktionen eingesammelt, die die Routen `/api/exchange/<art>` bedienen. Jede Funktion
 * bringt ihre Beschreibung in einer `exchange.ts` mit (Spalten, Auswahl, Prüfung, Anlegen) und trägt sich hier ein. Export und Import sind **keine API-Ressourcen**
 * (`/api/v1`): Sie laufen nur mit Sitzung, eigenem Recht je Datenart (`<funktion>.export` / `<funktion>.import`, in keiner Standardrolle) und Audit mit Anzahl.
 */
export const EXPORTS: readonly ExportDef[] = [customersExport, vehiclesExport, tiresExport, invoicesExport, accountantExport];
export const IMPORTS: readonly ImportDef[] = [customersImport, vehiclesImport, tiresImport, invoicesImport];

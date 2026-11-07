import type { SeedDef } from "./types";

import { seeds as appointments } from "./workshop/appointments/seed";
import { seeds as tires } from "./workshop/tires/seed";
import { seeds as orders } from "./workshop/orders/seed";
import { seeds as parts } from "./workshop/parts/seed";
import { seeds as files } from "./workshop/files/seed";
import { seeds as checklists } from "./workshop/checklists/seed";
import { seeds as customers } from "./workshop/customers/seed";
import { seeds as vehicles } from "./workshop/vehicles/seed";
import { seeds as invoices } from "./office/invoices/seed";
import { seeds as employees } from "./office/employees/seed";
import { seeds as time } from "./office/time/seed";
import { seeds as fleet } from "./office/fleet/seed";
import { seeds as network } from "./it/network/seed";
import { seeds as itDocs } from "./it/docs/seed";
import { seeds as manual } from "./handbook/manual/seed";

/**
 * Composition Root der Start- und Beispieldaten: Jede Funktion mit Grunddaten oder Demo-Daten meldet sie in ihrer `seed.ts` (`seeds`) an, hier werden sie eingesammelt
 * (`src/server/seed` führt sie aus, ohne eine Funktion zu kennen). Neue Funktion mit Seeds: `seed.ts` anlegen, Zeile ergänzen – `seed.test.ts` schlägt fehl, wenn es fehlt.
 */
export const ALL_SEEDS: readonly SeedDef[] = [
  ...appointments,
  ...tires,
  ...orders,
  ...parts,
  ...files,
  ...checklists,
  ...customers,
  ...vehicles,
  ...invoices,
  ...employees,
  ...time,
  ...fleet,
  ...network,
  ...itDocs,
  ...manual,
].sort((a, b) => a.order - b.order);

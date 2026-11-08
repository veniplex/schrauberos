import { searchKeyJob } from "@/server/search-key-rebuild";
import type { JobDef } from "@/server/jobs/types";
import { rebuildCustomerKeys } from "./key-rebuild";

/** Suchspalten nachziehen, wenn sich der Algorithmus geändert hat (`SEARCH_KEY_VERSION`); sonst läuft nichts. */
export const jobs: JobDef[] = [searchKeyJob({ id: "customers.search-keys", feature: "workshop.customers", table: "customers", step: rebuildCustomerKeys })];

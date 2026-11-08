import { searchKeyJob } from "@/server/search-key-rebuild";
import type { JobDef } from "@/server/jobs/types";
import { rebuildVehicleKeys } from "./key-rebuild";

/** Suchspalten nachziehen, wenn sich der Algorithmus geändert hat (`SEARCH_KEY_VERSION`); sonst läuft nichts. */
export const jobs: JobDef[] = [searchKeyJob({ id: "vehicles.search-keys", feature: "workshop.vehicles", table: "vehicles", step: rebuildVehicleKeys })];

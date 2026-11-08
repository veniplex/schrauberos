import { searchKeyJob } from "@/server/search-key-rebuild";
import type { JobDef } from "@/server/jobs/types";
import { rebuildArticleKeys } from "./key-rebuild";

/** Suchspalte nachziehen, wenn sich der Algorithmus geändert hat (`SEARCH_KEY_VERSION`); sonst läuft nichts. */
export const jobs: JobDef[] = [searchKeyJob({ id: "parts.search-keys", feature: "workshop.parts", table: "articles", step: rebuildArticleKeys })];

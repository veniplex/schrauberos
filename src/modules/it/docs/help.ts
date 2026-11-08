import type { HelpTopicDef } from "@/modules/types";

export const help: HelpTopicDef[] = [
  { id: "it.docs", feature: "it.docs", permission: "docsIt.view", doc: "it/docs" },
  // IT-Tresor: nur für Personen, die das Recht ausdrücklich haben
  { id: "it.vault", feature: "it.docs", permission: "docsIt.vault", doc: "it/vault" },
];

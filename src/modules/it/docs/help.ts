import type { HelpTopicDef } from "@/modules/types";

export const help: HelpTopicDef[] = [
  { id: "it.docs", feature: "it.docs", permission: "docs.view", doc: "it/docs" },
  // IT-Tresor: die Bedienung nur für Personen, die das Recht ausdrücklich haben …
  { id: "it.vault", feature: "it.docs", permission: "docs.vault", doc: "it/vault" },
  // … der Überblick (wie bekomme ich Zugriff, was schützt er, was nicht) für alle, die die IT-Dokumentation sehen – darunter die Administration, die das Recht erst vergeben muss
  { id: "it.vault-overview", feature: "it.docs", permission: "docs.view", doc: "it/vault-overview" },
];

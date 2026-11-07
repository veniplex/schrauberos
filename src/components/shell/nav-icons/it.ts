import { Cable, FileText, Globe, Network, Server, type LucideIcon } from "lucide-react";
import type { IconName } from "@/modules/define";

/** Navigationssymbole der Gruppe „it“ – wird nur geladen, wenn die Gruppe in der Navigation vorkommt (siehe `index.ts`). */
export const icons: Partial<Record<IconName, LucideIcon>> = {
  network: Network,
  server: Server,
  ip: Globe,
  cabling: Cable,
  docs: FileText,
};

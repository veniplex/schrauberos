import { CircleHelp, LayoutDashboard, type LucideIcon } from "lucide-react";
import type { IconName } from "@/modules/define";

/** Navigationssymbole der Gruppe „platform“ – wird nur geladen, wenn die Gruppe in der Navigation vorkommt (siehe `index.ts`). */
export const icons: Partial<Record<IconName, LucideIcon>> = {
  dashboard: LayoutDashboard,
  help: CircleHelp,
};

import { Activity, Blocks, Download, HardDriveDownload, Plug, ScrollText, Settings, ShieldCheck, UserCog, type LucideIcon } from "lucide-react";
import type { IconName } from "@/modules/define";

/** Navigationssymbole der Gruppe „admin“ – wird nur geladen, wenn die Gruppe in der Navigation vorkommt (siehe `index.ts`). */
export const icons: Partial<Record<IconName, LucideIcon>> = {
  users: UserCog,
  roles: ShieldCheck,
  settings: Settings,
  modules: Blocks,
  audit: ScrollText,
  updates: Download,
  backup: HardDriveDownload,
  system: Activity,
  api: Plug,
};

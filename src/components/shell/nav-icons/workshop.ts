import { CalendarDays, Car, ClipboardCheck, ClipboardList, Disc3, Images, Package, Users, type LucideIcon } from "lucide-react";
import type { IconName } from "@/modules/define";

/** Navigationssymbole der Gruppe „workshop“ – wird nur geladen, wenn die Gruppe in der Navigation vorkommt (siehe `index.ts`). */
export const icons: Partial<Record<IconName, LucideIcon>> = {
  calendar: CalendarDays,
  tires: Disc3,
  orders: ClipboardList,
  parts: Package,
  files: Images,
  checklists: ClipboardCheck,
  customers: Users,
  vehicles: Car,
};

import { CalendarDays, Car, Disc3, Users, type LucideIcon } from "lucide-react";
import type { IconName } from "@/modules/define";

/** Navigationssymbole der Gruppe „workshop“ – wird nur geladen, wenn die Gruppe in der Navigation vorkommt (siehe `index.ts`). */
export const icons: Partial<Record<IconName, LucideIcon>> = {
  calendar: CalendarDays,
  tires: Disc3,
  customers: Users,
  vehicles: Car,
};

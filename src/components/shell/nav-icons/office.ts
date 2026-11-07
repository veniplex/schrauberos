import { CalendarOff, Contact, Receipt, Truck, type LucideIcon } from "lucide-react";
import type { IconName } from "@/modules/define";

/** Navigationssymbole der Gruppe „office“ – wird nur geladen, wenn die Gruppe in der Navigation vorkommt (siehe `index.ts`). */
export const icons: Partial<Record<IconName, LucideIcon>> = {
  invoices: Receipt,
  employees: Contact,
  absences: CalendarOff,
  fleet: Truck,
};

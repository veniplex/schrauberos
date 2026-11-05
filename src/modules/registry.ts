import type { AppSession } from "@/server/auth/session";
import { appointmentsModule } from "./appointments/manifest";
import { coreModule } from "./core/manifest";
import { customersModule } from "./customers/manifest";
import { networkModule } from "./network/manifest";
import { tiresModule } from "./tires/manifest";
import type { ModuleManifest, NavItem, WidgetDef } from "./types";

/** Alle aktiven Module. Neues Feature: Manifest anlegen und hier eintragen. */
export const modules: ModuleManifest[] = [appointmentsModule, tiresModule, customersModule, networkModule, coreModule];

export function navFor(session: AppSession): NavItem[] {
  return modules
    .flatMap((m) => m.nav)
    .filter((n) => !n.permission || session.can(n.permission))
    .sort((a, b) => a.order - b.order);
}

export function widgetsFor(session: AppSession): WidgetDef[] {
  return modules
    .flatMap((m) => m.widgets)
    .filter((w) => session.can(w.permission))
    .sort((a, b) => a.order - b.order);
}

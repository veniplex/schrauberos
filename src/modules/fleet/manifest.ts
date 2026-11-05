import type { ModuleManifest } from "../types";
import { FleetWidget } from "./widgets";

/** Büro: Firmenfahrzeuge, Fälligkeiten, Kosten, Führerscheinkontrolle. */
export const fleetModule: ModuleManifest = {
  id: "fleet",
  nav: [{ id: "fleet", href: "/fleet", labelKey: "nav.fleet", icon: "fleet", permission: "fleet.view", section: "office", order: 50 }],
  widgets: [{ id: "fleet-dues", permission: "fleet.view", area: "office", span: 1, order: 41, Component: FleetWidget }],
};

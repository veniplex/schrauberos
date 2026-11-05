import type { ModuleManifest } from "../types";

export const customersModule: ModuleManifest = {
  id: "customers",
  nav: [
    {
      id: "customers",
      href: "/customers",
      labelKey: "nav.customers",
      icon: "customers",
      permission: "customers.view",
      section: "workshop",
      order: 30,
    },
    {
      id: "vehicles",
      href: "/vehicles",
      labelKey: "nav.vehicles",
      icon: "vehicles",
      permission: "customers.view",
      section: "workshop",
      order: 31,
    },
  ],
  widgets: [],
};

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
      section: "main",
      order: 30,
    },
  ],
  widgets: [],
};

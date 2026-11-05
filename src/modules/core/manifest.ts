import type { ModuleManifest } from "../types";

/** Verwaltung: Benutzer, Rollen, Werkstatt-Einstellungen. */
export const coreModule: ModuleManifest = {
  id: "core",
  nav: [
    { id: "users", href: "/admin/users", labelKey: "nav.users", icon: "users", permission: "users.view", section: "admin", order: 100 },
    { id: "roles", href: "/admin/roles", labelKey: "nav.roles", icon: "roles", permission: "roles.manage", section: "admin", order: 110 },
    { id: "settings", href: "/settings", labelKey: "nav.settings", icon: "settings", permission: "settings.manage", section: "admin", order: 120 },
  ],
  widgets: [],
};

import type { auditDe } from "./audit.de";

export const auditEn: typeof auditDe = {
  feature: {
    name: "Audit log",
    description: "Record of security- and administration-relevant actions: who did what and when.",
  },
  title: "Audit log",
  description: "Who did what and when? Sign-ins, changes to users, roles and settings, and deletions.",
  cols: { time: "Time", actor: "User", action: "Action", target: "Affected" },
  searchPlaceholder: "User or object …",
  allActions: "All actions",
  empty: "No entries found.",
  count_one: "{count} entry",
  count_other: "{count} entries",
  page: "Page {page} of {pages}",
  groups: {
    backup: "Backups",
    setup: "Setup",
    system: "System",
    auth: "Sign-in",
    account: "Account",
    user: "Users",
    role: "Roles",
    module: "Modules & features",
    settings: "Settings",
    appointment: "Appointments",
    customer: "Customers",
    vehicle: "Vehicles",
    tires: "Tyre storage",
    invoice: "Invoices",
    employee: "Employees",
    fleet: "Fleet",
    network: "Network",
    docs: "Documentation",
  },
  actions: {
    backup: {
      create: "Backup created",
      delete: "Backup deleted",
      download: "Backup downloaded",
      restore: "Backup restored",
      upload: "Backup uploaded",
    },
    setup: {
      complete: "Initial setup completed",
    },
    system: {
      update: "Update installed",
      updateFailed: "Update failed",
    },
    auth: {
      login: "Signed in",
      loginFailed: "Sign-in failed",
      loginThrottled: "Sign-in throttled (too many failed attempts)",
      logout: "Signed out",
    },
    account: {
      password: "Password changed",
      profile: "Profile changed",
    },
    user: {
      create: "User created",
      update: "User changed",
      delete: "User deleted",
      unlock: "Sign-in delay lifted",
    },
    role: {
      create: "Role created",
      update: "Role changed",
      delete: "Role deleted",
    },
    module: {
      enable: "Module/feature switched on",
      disable: "Module/feature switched off",
    },
    settings: {
      workshop: "Workshop profile changed",
      appointments: "Appointment settings changed",
      tires: "Tyre settings changed",
      security: "Security settings changed",
    },
    appointment: {
      delete: "Appointment deleted",
    },
    customer: {
      delete: "Customer deleted",
    },
    vehicle: {
      delete: "Vehicle deleted",
      transfer: "Vehicle transferred",
    },
    tires: {
      delete: "Tyre set deleted",
    },
    invoice: {
      delete: "Invoice deleted",
    },
    employee: {
      delete: "Employee deleted",
    },
    fleet: {
      delete: "Fleet entry deleted",
    },
    network: {
      delete: "Network entry deleted",
    },
    docs: {
      delete: "Documentation deleted",
    },
  },
};

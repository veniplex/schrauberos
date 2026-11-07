import type { permissionHintsDe } from "./permission-hints.de";

export const permissionHintsEn: typeof permissionHintsDe = {
  appointments: {
    view: "View the calendar and appointments without changing anything.",
    create: "Enter new appointments.",
    edit: "Change and move appointments and set their status (start, done).",
    delete: "Delete appointments permanently.",
    configure: "Define workstations, appointment types and the calendar grid.",
  },
  tires: {
    view: "View tire sets and their storage location.",
    create: "Store new tire sets.",
    edit: "Change tire set details and dispose of sets.",
    stock: "Check sets in and out (stored, handed out) – without being able to change them otherwise.",
    delete: "Delete tire sets permanently.",
    export: "Download all tire sets as a CSV file.",
    import: "Create tire sets from a CSV file.",
  },
  customers: {
    view: "View customers with address, phone and email.",
    edit: "Create and change customers.",
    delete: "Delete customers as long as nothing is linked to them.",
    disclose: "Export all data stored on a customer as access information (CSV/JSON, with free texts). Never granted automatically.",
    privacy: "Restrict the processing of a customer and anonymize the master record once the retention period has ended. Never granted automatically.",
    export: "Download all customers with contact details as a CSV file (personal data).",
    import: "Create customers from a CSV file.",
  },
  vehicles: {
    view: "View vehicles, inspection dates and owners.",
    edit: "Create and change vehicles, record owner changes.",
    delete: "Delete vehicles permanently.",
    export: "Download vehicles and inspection dates as a CSV file.",
    import: "Create vehicles from a CSV file.",
  },
  network: {
    view: "View devices, IP addresses, cabling and sites.",
    edit: "Create and change network entries.",
    delete: "Delete network entries.",
  },
  invoices: {
    view: "View invoices and their documents.",
    edit: "Record and change invoices and mark them as paid.",
    delete: "Delete invoices permanently (never finalized ones).",
    finalize: "Finalize outgoing invoices: immutable and undeletable afterwards, cannot be undone. Never granted automatically.",
    export: "Download invoices as a CSV file, also for the tax accountant.",
    import: "Create invoices from a CSV file.",
  },
  employees: {
    view: "View employees, absences (sickness only as “absent”) and qualifications.",
    edit: "Enter and change employees, absences and qualifications.",
    delete: "Delete employees permanently.",
    sensitive: "See and change the emergency contact and the type of absences (sickness).",
  },
  fleet: {
    view: "View company vehicles, deadlines and costs.",
    edit: "Enter and change company vehicles, deadlines and costs.",
    delete: "Delete fleet entries.",
  },
  handbook: {
    view: "Read chapters and pages of the handbook (as far as the chapters are open to the role).",
    edit: "Write and change handbook pages and chapters.",
  },
  docsIt: {
    view: "Read the IT documentation.",
    edit: "Write and change the IT documentation.",
  },
  users: {
    view: "View the user list.",
    manage: "Create, change and lock users and set their roles.",
  },
  roles: {
    manage: "Create, change and delete roles – only permissions one has oneself.",
  },
  settings: {
    manage: "Change the workshop profile, opening hours, security and the settings of the features.",
  },
  audit: {
    view: "Read the audit log: who changed what and when.",
  },
  updates: {
    manage: "Install and roll back updates of the application.",
  },
  system: {
    view: "View the system status (disk space, version, jobs, log).",
  },
  backup: {
    manage: "Create, download and restore backups, set up off-site backup.",
    keys: "Generate and confirm the recovery key.",
  },
  modules: {
    manage: "Switch modules and features on and off.",
  },
};

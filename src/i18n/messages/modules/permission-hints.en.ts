import type { permissionHintsDe } from "./permission-hints.de";

export const permissionHintsEn: typeof permissionHintsDe = {
  appointments: {
    view: "View the calendar and appointments without changing anything.",
    create: "Enter new appointments.",
    edit: "Change and move appointments and set their status (start, done).",
    delete: "Delete appointments permanently.",
    configure: "Define workstations, appointment types and the calendar grid.",
  },
  orders: {
    view: "View workshop orders with positions (without prices), findings and history.",
    create: "Accept orders, also from an appointment.",
    edit: "Set the status, enter findings and positions, record customer approvals.",
    close: "Close orders (“picked up”); other functions book out as a result, e.g. stock.",
    reopen: "Reopen a closed order: reverses bookings and is recorded in the audit log. Never granted automatically.",
    prices: "See and enter prices, tax rates, discounts and totals of orders. Without it they stay hidden (default for mechanics).",
  },
  parts: {
    view: "View articles, stock levels and movements (without prices).",
    edit: "Create, change and archive articles.",
    stock: "Record goods receipts and book stocktaking.",
    prices: "See and change purchase and sales prices of articles. Without it they are not read (default for mechanics).",
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
    monitor: "Set up monitoring targets: the server then regularly opens connections to the addresses entered on your own network and shows whether they answer. Only give this to trusted people.",
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
  billing: {
    view: "View quotes, order confirmations and invoice drafts. Finalized invoices are in the invoice archive.",
    edit: "Create, change and delete quotes, order confirmations and invoice drafts; issue quotes; prepare invoices from orders. Finalizing invoices needs the permission “Finalize outgoing invoices”.",
    accept: "Mark quotes as accepted or rejected and create a workshop order from them.",
    send: "Send quotes and invoices to customers by e-mail (the permission “Send e-mails” is needed as well). Never assigned automatically.",
  },
  reports: {
    view: "Open reports: revenue, open items, utilization, tire storage, deadlines. Every report shows only what the person may also read at the source (invoices, appointments, tires, vehicles, fleet).",
    export: "Download reports as a CSV file (revenue, open items with business partners). Never granted automatically.",
  },
  checklists: {
    view: "View checklists on vehicles and orders – only where the person may also see the vehicle or order.",
    fill: "Start checklists, tick items, record measurements, have the customer sign and complete them.",
    manage: "Create and change templates (every change becomes a new version).",
    reopen: "Reopen completed (possibly customer-signed) checklists with a reason. Lifts their immutability; never assigned automatically.",
  },
  files: {
    view: "View documents and photos on vehicles and orders – only where the person may also see the vehicle or order.",
    upload: "Upload and caption photos (JPEG, PNG) and PDF documents. Location data is removed from photos.",
    delete: "Remove the files of everyone (management). Whoever may upload also removes their own files.",
  },
  time: {
    view: "View your own times: clock, entries, weekly overview with actual, target and balance.",
    stamp: "Clock in and out, start and stop an order.",
    correct: "Correct, void or add your own times – always with a reason in the correction history.",
    viewAll: "View the times of all employees (team overview). Personal data, never granted automatically.",
    correctAll: "Correct, void and add the times of all employees (in addition to “correct”). Never granted automatically.",
  },
  fleet: {
    view: "View company vehicles, deadlines and costs.",
    edit: "Enter and change company vehicles, deadlines and costs.",
    delete: "Delete fleet entries.",
  },
  manual: {
    view: "Read chapters and pages of the handbook (as far as the chapters are open to the role).",
    edit: "Write and change handbook pages and chapters.",
  },
  docs: {
    view: "Read the IT documentation.",
    edit: "Write and change the IT documentation.",
    vault: "IT vault: view entries and show credentials after entering the password again. Explicit only – administrators do not get it automatically.",
    vaultManage: "IT vault: create, change and delete entries (together with “view vault”). Explicit only – administrators do not get it automatically.",
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
  mail: {
    manage: "Set up the email server, test it, and view the send log.",
    send: "Send email from the application (e.g. an invoice to a customer). Never assigned automatically.",
  },
  api: {
    manage: "Create and revoke API tokens, set up webhooks, read the API documentation. Opens data to the outside – administrators only.",
  },
  modules: {
    manage: "Switch modules and features on and off.",
  },
};

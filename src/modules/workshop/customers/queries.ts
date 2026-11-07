import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { Viewer } from "@/modules/types";
import { db } from "@/server/db";
import { contains, keyContains, phoneContains, type SearchField } from "@/server/search";
import { customerDisplayName } from "./domain";

/**
 * Lesezugriffe der Funktion „Kunden“. Richtlinie (D7): Der **Anzeigename** eines Kunden ist in Termin-, Fahrzeug-, Reifen- und Rechnungskontext sichtbar, Kontaktdaten
 * (Telefon, Anschrift, E-Mail, Notizen) nur mit `customers.view`. Darum holen andere Funktionen Kunden nur über `customerNameSelect` (`public.ts`) und Kontaktdaten nur über
 * `customerContacts` – ein `include: { customer: true }` lädt den ganzen Kunden und ist verboten (Architekturtest). Jede Abfrage hat ein explizites `select`; Fahrzeuge, Reifen und
 * Termine am Kunden werden nur gelesen, wenn der Betrachter sie auch sehen darf. Test: `queries.test.ts`.
 */

/** Was für den Anzeigennamen nötig ist (`customerDisplayName`) – mehr nicht. */
export const customerNameSelect = { id: true, firstName: true, lastName: true, company: true } as const satisfies Prisma.CustomerSelect;

/** Stammdaten und Kontakt – nur für Betrachter mit `customers.view` (Seiten der Kunden). */
const CUSTOMER = {
  id: true,
  customerNumber: true,
  firstName: true,
  lastName: true,
  company: true,
  email: true,
  phone: true,
  street: true,
  zip: true,
  city: true,
  notes: true,
  archivedAt: true,
  processingRestrictedAt: true,
  restrictionNote: true,
  anonymizedAt: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.CustomerSelect;

/**
 * **Die eine Bedingung für „Kunde ist verwendbar“** (P4b-5): nicht archiviert und die Verarbeitung nicht eingeschränkt. Sie gilt für alles, was Kunden zur Auswahl oder Suche anbietet –
 * Auswahlfelder (`/api/customers/search`), Schnellsuche, Standardliste, die API-Ressource und später Webhooks und iCal (sie erben die Bedingung hier, statt eine eigene zu bauen). Ein
 * eingeschränkter Kunde bleibt im Detail sichtbar (mit Hinweis) und über den Listenfilter „Eingeschränkt“ auffindbar.
 */
export const searchableCustomerWhere = { archivedAt: null, processingRestrictedAt: null } as const satisfies Prisma.CustomerWhereInput;

/** Nur Verarbeitung nicht eingeschränkt (für Stellen, die archivierte Kunden weiter zeigen, aber nie eingeschränkte). */
export const unrestrictedCustomerWhere = { processingRestrictedAt: null } as const satisfies Prisma.CustomerWhereInput;

/**
 * **Die eine Auslegung von „eingeschränkt“ (Art. 18 DSGVO) für alles, was an einem Kunden und/oder Fahrzeug hängt** – Aufträge, Belege, Termine, Dateien, Checklisten, Reifensätze, Fahrzeuge:
 * Eine Sache gilt als eingeschränkt, wenn ihr **Kunde oder der Halter ihres Fahrzeugs** eingeschränkt verarbeitet wird. API (`scope`), Webhooks, Suche und Oberfläche bauen keine eigene Bedingung,
 * sondern nehmen eine dieser (der Typ des Fremdschlüssels entscheidet, welche):
 *  - `unrestrictedByCustomer`: die Sache hat einen optionalen Kunden (Fahrzeug, Auftrag, Beleg, Termin) – ohne Kunden oder Kunde nicht eingeschränkt;
 *  - `unrestrictedByVehicle` / `unrestrictedByOptionalVehicle`: der Halter des (immer vorhandenen bzw. optionalen) Fahrzeugs ist nicht eingeschränkt (Reifensatz, Checkliste / Datei, Beleg);
 *  - `unrestrictedOrder` (Kunde und Fahrzeug, Fahrzeug Pflicht) und `unrestrictedDocument` (Kunde und optionales Fahrzeug): beides zusammen.
 */
export const unrestrictedByCustomer = { OR: [{ customerId: null }, { customer: { is: unrestrictedCustomerWhere } }] };
export const unrestrictedByVehicle = { vehicle: { is: unrestrictedByCustomer } };
export const unrestrictedByOptionalVehicle = { OR: [{ vehicleId: null }, { vehicle: { is: unrestrictedByCustomer } }] };
export const unrestrictedOrder = { AND: [unrestrictedByCustomer, unrestrictedByVehicle] };
export const unrestrictedDocument = { AND: [unrestrictedByCustomer, unrestrictedByOptionalVehicle] };

/**
 * Suchfelder der Kundenliste, der Schnellsuche und der API (Wörterbuch pro Berechtigung, `searchWhere`): Name und Firma über die normalisierte Spalte `nameKey`, Kundennummer,
 * Ort (`cityKey`), Telefon (`phoneKey`, nur Ziffern) und E-Mail. Alle Felder sind Kontaktdaten und gehören zu `customers.view`; wer nur den Namen sehen darf, nimmt `customerNameSearch`.
 */
export const customerNameSearch: SearchField<Prisma.CustomerWhereInput> = { where: (term) => keyContains("nameKey", term) };
export const customerSearchFields: ReadonlyArray<SearchField<Prisma.CustomerWhereInput>> = [
  customerNameSearch,
  { where: (term) => ({ customerNumber: contains(term) }) },
  { where: (term) => keyContains("cityKey", term) },
  { where: (term) => phoneContains("phoneKey", term) },
  { where: (term) => ({ email: contains(term) }) },
];

export type CustomerContact = { phone: string | null; city: string | null };

/**
 * Name und Anschrift eines Kunden **für einen neuen Beleg** (Angebot, Rechnung): Der Beleg trägt Anschrift und E-Mail des Empfängers, sie gehören zum Beleg und nicht zu den Kontaktdaten der Kundenseite
 * (die nur mit `customers.view` erscheinen). Der Aufrufer prüft sein eigenes Recht (`billing.edit`). Nur Kunden, die man neu verknüpfen darf (nicht archiviert, nicht eingeschränkt – `searchableCustomerWhere`).
 */
export async function customerForDocument(id: string) {
  const c = await db.customer.findFirst({
    where: { id, ...searchableCustomerWhere },
    select: { id: true, firstName: true, lastName: true, company: true, email: true, street: true, zip: true, city: true, customerNumber: true },
  });
  return c ? { id: c.id, name: customerDisplayName(c), street: c.street, zip: c.zip, city: c.city, email: c.email, customerNumber: c.customerNumber } : null;
}

/**
 * Kontaktdaten (Telefon, Ort) zu Kunden-Ids für Seiten anderer Funktionen: **leer ohne `customers.view`** – dann werden sie gar nicht gelesen. Der Anzeigename kommt aus
 * `customerNameSelect`.
 */
export async function customerContacts(viewer: Viewer, ids: readonly string[]): Promise<Map<string, CustomerContact>> {
  const out = new Map<string, CustomerContact>();
  if (!viewer.can("customers.view") || ids.length === 0) return out;
  const rows = await db.customer.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, phone: true, city: true } });
  for (const r of rows) out.set(r.id, { phone: r.phone, city: r.city });
  return out;
}

export async function countCustomers(viewer: Viewer, where: Prisma.CustomerWhereInput): Promise<number> {
  requireView(viewer);
  return db.customer.count({ where });
}

/** Liste: Stammdaten und – nur mit `vehicles.view` – die Kennzeichen der Fahrzeuge. */
export async function listCustomers(viewer: Viewer, args: { where: Prisma.CustomerWhereInput; orderBy: Prisma.CustomerOrderByWithRelationInput[]; skip?: number; take?: number }) {
  requireView(viewer);
  const customers = await db.customer.findMany({ ...args, select: CUSTOMER });
  const vehicles = viewer.can("vehicles.view") && customers.length > 0
    ? await db.vehicle.findMany({ where: { customerId: { in: customers.map((c) => c.id) } }, orderBy: { plateNorm: "asc" }, select: { id: true, plate: true, customerId: true } })
    : [];
  return customers.map((c) => ({ ...c, vehicles: vehicles.filter((v) => v.customerId === c.id) }));
}

/** Kunde zum Bearbeiten und für den Seitentitel. */
export async function getCustomerForEdit(viewer: Viewer, id: string) {
  requireView(viewer);
  return db.customer.findUnique({ where: { id }, select: CUSTOMER });
}

/** Nur für den Seitentitel (Aufruf nach der Rechteprüfung). */
export async function customerTitle(id: string) {
  return db.customer.findUnique({ where: { id }, select: customerNameSelect });
}

/**
 * Detailseite: Stammdaten, Zähler und – je nach Recht des Betrachters – Fahrzeuge (`vehicles.view`), deren Reifensätze samt Reifen (`tires.view`) und die letzten Termine
 * (`appointments.view`). Was der Betrachter nicht sehen darf, wird nicht gelesen.
 */
export async function getCustomerDetail(viewer: Viewer, id: string) {
  requireView(viewer);
  const customer = await db.customer.findUnique({
    where: { id },
    select: { ...CUSTOMER, _count: { select: { appointments: true, ownerships: true, invoices: true, vehicles: true, orders: true } } },
  });
  if (!customer) return null;
  const [vehicles, appointments] = await Promise.all([
    viewer.can("vehicles.view")
      ? db.vehicle.findMany({ where: { customerId: id }, orderBy: { plateNorm: "asc" }, select: { id: true, plate: true, make: true, model: true, year: true } })
      : [],
    viewer.can("appointments.view")
      ? db.appointment.findMany({
          where: { customerId: id },
          orderBy: { startsAt: "desc" },
          take: 8,
          select: { id: true, title: true, startsAt: true, status: true, vehicle: { select: { plate: true } } },
        })
      : [],
  ]);
  const tireSets =
    viewer.can("tires.view") && vehicles.length > 0
      ? await db.tireSet.findMany({
          where: { vehicleId: { in: vehicles.map((v) => v.id) } },
          select: { id: true, vehicleId: true, season: true, brand: true, width: true, aspect: true, rim: true, storageLocation: true, status: true, tires: true },
        })
      : [];
  return { ...customer, vehicles: vehicles.map((v) => ({ ...v, tireSets: tireSets.filter((s) => s.vehicleId === v.id) })), appointments };
}

function requireView(viewer: Viewer): void {
  if (!viewer.can("customers.view") && !viewer.can("customers.edit")) throw new Error("customers.view fehlt");
}

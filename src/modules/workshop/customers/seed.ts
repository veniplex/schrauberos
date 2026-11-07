import type { PrismaClient } from "@/generated/prisma/client";
import type { SeedDef } from "@/modules/types";

/** Beispielkunden. Die Kundennummern beginnen bei 10001; Fahrzeuge, Reifen und Termine legen die jeweiligen Funktionen an (sie finden die Kunden über den Nachnamen). */
const CUSTOMERS = [
  { firstName: "Anna", lastName: "Becker", phone: "0170 1234567", email: "anna.becker@example.com", street: "Lindenstr. 12", zip: "10115", city: "Berlin" },
  { firstName: "Markus", lastName: "Schulz", phone: "0171 2345678", street: "Hauptstr. 5", zip: "10243", city: "Berlin" },
  { firstName: "Elif", lastName: "Yilmaz", phone: "0172 3456789", street: "Parkallee 3", zip: "10317", city: "Berlin" },
  { lastName: "Autohaus Nord GmbH", company: "Autohaus Nord GmbH", phone: "030 555010", street: "Industrieweg 8", zip: "13353", city: "Berlin" },
  { firstName: "Jürgen", lastName: "Krause", phone: "0173 4567890", street: "Dorfstr. 21", zip: "14612", city: "Falkensee" },
  { firstName: "Sabine", lastName: "Neumann", phone: "0174 5678901", street: "Seestr. 9", zip: "13086", city: "Berlin" },
];

async function demo(db: PrismaClient) {
  if ((await db.customer.count()) > 0) return;
  console.log("Demo-Daten (Kunden) werden angelegt …");
  let nr = 10001;
  for (const c of CUSTOMERS) await db.customer.create({ data: { ...c, customerNumber: String(nr++) } });
}

export const seeds: SeedDef[] = [{ id: "customers", feature: "workshop.customers", order: 30, demo }];

import { z } from "zod";
import { personRef } from "@/lib/audit-ref";
import { claimRow } from "@/lib/concurrency";
import { anonymizeBlock, type RetentionItem } from "@/lib/privacy";
import { collectRetention, privacySubject } from "@/modules/privacy";
import { defineOperation, fail, failFields } from "@/server/operations";
import { customerDisplayName, customerHasLinks, customerSearchKeys, formerOwnerships } from "./domain";
import { numberKey } from "./lookup";

const flag = z.preprocess((v) => v === true || v === "1" || v === "on" || v === "true", z.boolean());

/** Eingabe eines Kunden – auch die Prüfung der Zeilen des CSV-Imports (`exchange.ts`). */
export const customerInput = z
  .object({
    id: z.string().optional(),
    version: z.string().optional(),
    customerNumber: z.string().max(40).optional(),
    firstName: z.string().max(80).optional(),
    lastName: z.string().max(120).optional(),
    company: z.string().max(120).optional(),
    email: z.string().email().max(200).optional(),
    phone: z.string().max(60).optional(),
    street: z.string().max(120).optional(),
    zip: z.string().max(12).optional(),
    city: z.string().max(80).optional(),
    notes: z.string().max(2000).optional(),
    /** Kundennummer trotz vorhandener Dublette speichern (Warnung bestätigt) */
    allowDuplicate: flag.optional(),
  })
  .superRefine((d, ctx) => {
    if (!d.lastName && !d.company) ctx.addIssue({ code: "custom", message: "customers.errors.nameRequired", path: ["lastName"] });
  });

export type CustomerFields = z.output<typeof customerInput>;

/** Die Felder der Tabelle zu einer geprüften Eingabe (Anlegen, Ändern und CSV-Import gleich). */
export function customerRecord(d: CustomerFields) {
  // Bei reinen Firmenkunden dient der Firmenname als Nachname (Sortierung/Suche)
  const lastName = d.lastName ?? d.company!;
  return {
    customerNumber: d.customerNumber ?? null,
    firstName: d.firstName ?? null,
    lastName,
    company: d.company ?? null,
    email: d.email ?? null,
    phone: d.phone ?? null,
    street: d.street ?? null,
    zip: d.zip ?? null,
    city: d.city ?? null,
    notes: d.notes ?? null,
    ...customerSearchKeys({ ...d, lastName }),
  };
}

export const saveCustomerOperation = defineOperation({
  name: "customers.save",
  permission: "customers.edit",
  input: customerInput,
  audit: (input) => (input.id ? "customer.update" : "customer.create"),
  run: async ({ input: { id, version, allowDuplicate, ...d }, principal, tx, audit }) => {
    const data = customerRecord(d);
    // Kundennummer doppelt vergeben: eine Warnung mit Bestätigung, keine Sperre (wie beim Kennzeichen). Verglichen wird ohne Leerraum und Groß-/Kleinschreibung.
    if (d.customerNumber && !allowDuplicate) {
      const key = numberKey(d.customerNumber);
      const candidates = await tx.customer.findMany({
        where: { customerNumber: { contains: d.customerNumber.trim() }, ...(id ? { id: { not: id } } : {}) },
        select: { id: true, customerNumber: true, processingRestrictedAt: true },
      });
      const twin = candidates.find((c) => numberKey(c.customerNumber ?? "") === key);
      if (twin) {
        // Name und Kennung nur für Personen mit `customers.view` und nie von einem Kunden mit eingeschränkter Verarbeitung (Art. 18): sonst nur „vergeben“ – gleiche Antwort für jeden Kunden,
        // damit sich die Kundennummern nicht durchzählen lassen
        if (twin.processingRestrictedAt || !principal.can("customers.view")) failFields({ customerNumber: { key: "customers.errors.numberExistsHidden" } }, {});
        const named = await tx.customer.findUniqueOrThrow({ where: { id: twin.id }, select: { firstName: true, lastName: true, company: true } });
        failFields({ customerNumber: { key: "customers.errors.numberExists", params: { name: customerDisplayName(named) } } }, { duplicateId: twin.id, duplicateName: customerDisplayName(named), duplicateNumber: d.customerNumber });
      }
    }
    if (id && !(await claimRow(tx.customer, id, version))) fail("conflict");
    const saved = id ? await tx.customer.update({ where: { id }, data }) : await tx.customer.create({ data });
    audit({ target: personRef("Kunde", { id: saved.id, number: saved.customerNumber }), entityId: saved.id });
    return { id: saved.id };
  },
});

/**
 * Archivieren (P4b-2): Der Kunde bleibt mit allen Fahrzeugen, Terminen und Rechnungen erhalten, verschwindet aber aus Auswahlfeldern, Suche und Neu-Formularen und erscheint nur noch im
 * Listenfilter „Archiviert“. Wer Fahrzeuge oder Rechnungen hat, kann nicht gelöscht werden – archiviert wird er trotzdem. Keine Anonymisierung (kommt mit der Aufbewahrungsfrist).
 */
export const archiveCustomerOperation = defineOperation({
  name: "customers.archive",
  permission: "customers.edit",
  input: z.object({ id: z.string().min(1) }),
  audit: "customer.archive",
  run: async ({ input, tx, audit }) => {
    const customer = await tx.customer.findUnique({ where: { id: input.id } });
    if (!customer) fail("notFound");
    if (customer.archivedAt) fail("conflict", "archive.errors.alreadyArchived");
    await tx.customer.update({ where: { id: input.id }, data: { archivedAt: new Date() } });
    audit({ target: personRef("Kunde", { id: customer.id, number: customer.customerNumber }), entityId: input.id });
    return { id: input.id };
  },
});

export const unarchiveCustomerOperation = defineOperation({
  name: "customers.unarchive",
  permission: "customers.edit",
  input: z.object({ id: z.string().min(1) }),
  audit: "customer.unarchive",
  run: async ({ input, tx, audit }) => {
    const customer = await tx.customer.findUnique({ where: { id: input.id } });
    if (!customer) fail("notFound");
    if (!customer.archivedAt) fail("conflict", "archive.errors.notArchived");
    await tx.customer.update({ where: { id: input.id }, data: { archivedAt: null } });
    audit({ target: personRef("Kunde", { id: customer.id, number: customer.customerNumber }), entityId: input.id });
    return { id: input.id };
  },
});

export const deleteCustomerOperation = defineOperation({
  name: "customers.delete",
  permission: "customers.delete",
  input: z.object({ id: z.string().min(1) }),
  audit: "customer.delete",
  run: async ({ input, tx, audit }) => {
    const customer = await tx.customer.findUnique({ where: { id: input.id }, include: { _count: { select: { vehicles: true, ownerships: true, invoices: true, orders: true } } } });
    if (!customer) fail("notFound");
    // Kunden mit Fahrzeugen, Halter-Historie oder Rechnungen bleiben erhalten (Nachvollziehbarkeit); im Schema zusätzlich per Restrict gesichert
    const links = customer._count;
    if (customerHasLinks(links)) fail("inUse", "customers.errors.inUse", { vehicles: links.vehicles, former: formerOwnerships(links), invoices: links.invoices, orders: links.orders });
    await tx.customer.delete({ where: { id: input.id } });
    audit({ target: personRef("Kunde", { id: customer.id, number: customer.customerNumber }), entityId: input.id });
    return { id: input.id };
  },
});


/* ───────────── Datenschutz (P4b-5) ───────────── */

/**
 * Verarbeitung einschränken (Art. 18 DSGVO, `customers.privacy`): Der Kunde bleibt mit allen Daten erhalten, verschwindet aber aus Suche, Auswahl, Schnellsuche, API/Webhooks, Exporten und
 * iCal (`searchableCustomerWhere` in `queries.ts` ist die eine Bedingung dafür) und lässt sich nicht neu verknüpfen. Im Detail bleibt er mit Hinweis sichtbar.
 */
export const restrictCustomerOperation = defineOperation({
  name: "customers.restrict",
  permission: "customers.privacy",
  input: z.object({ id: z.string().min(1), note: z.string().trim().max(300).optional() }),
  audit: "customer.restrict",
  run: async ({ input, tx, audit }) => {
    const customer = await tx.customer.findUnique({ where: { id: input.id } });
    if (!customer) fail("notFound");
    if (customer.processingRestrictedAt) fail("conflict", "privacy.errors.alreadyRestricted");
    await tx.customer.update({ where: { id: input.id }, data: { processingRestrictedAt: new Date(), restrictionNote: input.note ?? null } });
    // Das Audit-Log nennt den Kunden, nie die Notiz zum Anlass
    audit({ target: personRef("Kunde", { id: customer.id, number: customer.customerNumber }), entityId: input.id });
    return { id: input.id };
  },
});

export const unrestrictCustomerOperation = defineOperation({
  name: "customers.unrestrict",
  permission: "customers.privacy",
  input: z.object({ id: z.string().min(1) }),
  audit: "customer.unrestrict",
  run: async ({ input, tx, audit }) => {
    const customer = await tx.customer.findUnique({ where: { id: input.id } });
    if (!customer) fail("notFound");
    if (!customer.processingRestrictedAt) fail("conflict", "privacy.errors.notRestricted");
    await tx.customer.update({ where: { id: input.id }, data: { processingRestrictedAt: null, restrictionNote: null } });
    audit({ target: personRef("Kunde", { id: customer.id, number: customer.customerNumber }), entityId: input.id });
    return { id: input.id };
  },
});

/**
 * Stammsatz anonymisieren (`customers.privacy`): nur nach Bestätigung der Aufbewahrungsfristen durch einen Administrator **und** erst, wenn die Fristen aller Rechnungen des Kunden abgelaufen
 * sind (`anonymizeBlock`, `src/lib/privacy.ts`). Der Stammsatz wird geleert (Name, Firma, Kontakt, Anschrift, Notizen, Kundennummer, Suchspalten); die Verknüpfungen zu Rechnungen
 * bleiben (der Empfänger steht weiter auf der Rechnung). Fahrzeuge, Termine und Reifen bereinigen transaktionale Hooks anderer Funktionen (`operation-hooks.ts`), in derselben Transaktion.
 * Backups enthalten die Daten weiterhin. Die Belege mit Aufbewahrungsfrist werden vorab gelesen (`prepare`): Innerhalb der Transaktion gibt es nur `tx`.
 */
export const anonymizeCustomerOperation = defineOperation({
  name: "customers.anonymize",
  permission: "customers.privacy",
  input: z.object({ id: z.string().min(1) }),
  audit: "customer.anonymize",
  prepare: async ({ input }) => {
    const subject = await privacySubject(input.id);
    const items: RetentionItem[] = subject ? await collectRetention(subject) : [];
    return { items };
  },
  run: async ({ input, prepared, tx, audit }) => {
    const customer = await tx.customer.findUnique({ where: { id: input.id } });
    if (!customer) fail("notFound");
    const settings = await tx.privacySettings.findUnique({ where: { id: "default" } });
    const block = anonymizeBlock({
      anonymizedAt: customer.anonymizedAt,
      confirmed: Boolean(settings?.retentionConfirmedAt),
      items: prepared.items,
      rules: { invoiceYears: settings?.retentionInvoiceYears ?? 8, booksYears: settings?.retentionBooksYears ?? 10 },
    });
    if (block?.reason === "already") fail("conflict", "privacy.errors.anonymizeAlready");
    if (block?.reason === "unconfirmed") fail("inUse", "privacy.errors.anonymizeUnconfirmed");
    if (block?.reason === "running") fail("inUse", "privacy.errors.anonymizeRunning", { date: block.until });
    const now = new Date();
    await tx.customer.update({
      where: { id: input.id },
      data: {
        customerNumber: null,
        firstName: null,
        lastName: "Anonymisiert",
        company: null,
        email: null,
        phone: null,
        street: null,
        zip: null,
        city: null,
        notes: null,
        nameKey: "",
        cityKey: "",
        phoneKey: "",
        restrictionNote: null,
        anonymizedAt: now,
        archivedAt: customer.archivedAt ?? now,
      },
    });
    // Das Audit-Log wird **nie verändert**: Einträge nennen Kunden seit jeher nur mit Art und Kundennummer/Kennung (`personRef`), nie mit dem Namen – es gibt nichts zu maskieren. Einträge aus früheren Fassungen
    // (Namen in der Bezeichnung) bleiben unverändert bis zur Audit-Aufbewahrungsfrist (Einstellung, Standard 730 Tage, 0 = dauerhaft); wer das nicht will, wählt eine kürzere Frist (Hilfe „Datenschutz bei Kunden“).
    // Namen in Mail-Vermerken und in Backups bleiben bis zu deren Fristen.
    audit({ target: personRef("Kunde", { id: input.id, number: customer.customerNumber }), entityId: input.id });
    return { id: input.id };
  },
});

/* ───────────── Aufbewahrungsfristen (Einstellungen) ───────────── */

const years = z.coerce.number({ error: "privacy.errors.years" }).int({ error: "privacy.errors.years" }).min(1, { error: "privacy.errors.years" }).max(30, { error: "privacy.errors.years" });

/** Fristen in Jahren je Belegart (`settings.manage`, nur Administratoren). Eine Änderung nimmt die Bestätigung zurück. */
export const savePrivacySettingsOperation = defineOperation({
  name: "customers.savePrivacySettings",
  permission: "settings.manage",
  input: z.object({ retentionInvoiceYears: years, retentionBooksYears: years }),
  audit: "settings.privacy",
  run: async ({ input: d, tx, audit }) => {
    const data = { ...d, retentionConfirmedAt: null, retentionConfirmedByName: null };
    await tx.privacySettings.upsert({ where: { id: "default" }, update: data, create: { id: "default", ...data } });
    audit({ target: `${d.retentionInvoiceYears}/${d.retentionBooksYears} Jahre`, entityId: "default" });
    return {};
  },
});

/** Bestätigung der Fristen durch einen Administrator (`confirmed=true`) bzw. Rücknahme; erst mit Bestätigung lässt sich ein Kunde anonymisieren. */
export const confirmRetentionOperation = defineOperation({
  name: "customers.confirmRetention",
  permission: "settings.manage",
  input: z.object({ confirmed: flag }),
  audit: "settings.privacyConfirm",
  run: async ({ input, principal, tx, audit }) => {
    const data = input.confirmed ? { retentionConfirmedAt: new Date(), retentionConfirmedByName: principal.user.name.slice(0, 120) } : { retentionConfirmedAt: null, retentionConfirmedByName: null };
    await tx.privacySettings.upsert({ where: { id: "default" }, update: data, create: { id: "default", ...data } });
    audit({ target: input.confirmed ? "bestätigt" : "Bestätigung zurückgenommen", entityId: "default" });
    return {};
  },
});

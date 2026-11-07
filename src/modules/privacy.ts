import "server-only";
import type { PrivacySection, PrivacySubject, RetentionItem } from "@/lib/privacy";
import { db } from "@/server/db";
import type { FeatureId } from "./catalog";
import type { PrivacyProviderDef } from "./types";

import { privacyProviders as handbook } from "./handbook/manual/privacy";
import { privacyProviders as invoices } from "./office/invoices/privacy";
import { privacyProviders as itDocs } from "./it/docs/privacy";
import { privacyProviders as appointments } from "./workshop/appointments/privacy";
import { privacyProviders as customers } from "./workshop/customers/privacy";
import { customerDisplayName } from "./workshop/customers/domain";
import { privacyProviders as tires } from "./workshop/tires/privacy";
import { privacyProviders as orders } from "./workshop/orders/privacy";
import { privacyProviders as files } from "./workshop/files/privacy";
import { privacyProviders as checklists } from "./workshop/checklists/privacy";
import { privacyProviders as vehicles } from "./workshop/vehicles/privacy";

/**
 * Composition Root des Datenschutzes (P4b-5): Jede Funktion meldet in ihrer `privacy.ts` (`privacyProviders`), welche Daten sie zu einem Kunden führt; hier werden die Beiträge
 * eingesammelt – für die Auskunft (`collectDisclosure`) und die Aufbewahrungsfristen (`collectRetention`). Nur Beiträge **aktiver** Funktionen zählen. Die Anonymisierung läuft über
 * transaktionale Hooks (`operation-hooks.ts`) auf der Operation `customers.anonymize`, nicht über diese Anbieter.
 * Neue Funktion mit personenbezogenen Daten zum Kunden: `privacy.ts` anlegen, hier eintragen, bei Freitext/Verknüpfungen einen Hook für `customers.anonymize` ergänzen.
 */
export const PRIVACY_PROVIDERS: readonly PrivacyProviderDef[] = [...customers, ...vehicles, ...appointments, ...tires, ...orders, ...files, ...checklists, ...invoices, ...handbook, ...itDocs].sort((a, b) => a.order - b.order);

/** Begriffe, unter denen ein Kunde in Freitexten vorkommen kann: mindestens vier Zeichen (kürzere würden zu viel finden). */
function termsOf(c: { firstName: string | null; lastName: string; company: string | null; customerNumber: string | null; email: string | null }): string[] {
  const full = [c.firstName, c.lastName].filter(Boolean).join(" ");
  return [...new Set([customerDisplayName(c), full, c.company ?? "", c.customerNumber ?? "", c.email ?? ""].map((t) => t.trim()).filter((t) => t.length >= 4))];
}

/** Der Kunde als Gegenstand der Anbieter (`null`, wenn es ihn nicht gibt). */
export async function privacySubject(customerId: string): Promise<PrivacySubject | null> {
  const c = await db.customer.findUnique({ where: { id: customerId }, select: { id: true, firstName: true, lastName: true, company: true, customerNumber: true, email: true } });
  return c ? { id: c.id, terms: termsOf(c) } : null;
}

const active = (features: ReadonlySet<string>) => PRIVACY_PROVIDERS.filter((p) => features.has(p.feature as FeatureId));

/** Alle Daten zum Kunden aus den aktiven Funktionen, in der Reihenfolge der Anbieter. */
export async function collectDisclosure(features: ReadonlySet<string>, subject: PrivacySubject): Promise<PrivacySection[]> {
  const out: PrivacySection[] = [];
  for (const provider of active(features)) out.push(...(await provider.collect(subject)));
  return out;
}

/** Belege mit Aufbewahrungsfrist aus den aktiven Funktionen. */
export async function collectRetention(features: ReadonlySet<string>, subject: PrivacySubject): Promise<RetentionItem[]> {
  const out: RetentionItem[] = [];
  for (const provider of active(features)) if (provider.retention) out.push(...(await provider.retention(subject)));
  return out;
}

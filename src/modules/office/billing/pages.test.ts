import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import { createElement, type ReactNode } from "react";
import { installDom, mount, type MountedView, type TestDom } from "@/test/dom";
import { createTestEnv, isNotFound, redirectOf, type TestEnv } from "@/test/harness";
import { resolveServerTree } from "@/test/server-tree";
import { plain } from "@/test/ui";

/**
 * Die Seiten der Rechnungserstellung wirklich gerendert (Server-Komponenten werden aufgelöst, das Ergebnis im DOM gezeigt) mit den Beispieldaten der Funktion: Liste, Detail (Entwurf, Angebot offen/angenommen,
 * Rechnung offen/teilweise bezahlt/storniert, Schlussrechnung), Neu (je Belegart, aus Auftrag), Bearbeiten. Ersetzt keinen Browserlauf, fängt Laufzeitfehler und falsche Rechte-Anzeige ab.
 */
let dom: TestDom;
let env: TestEnv;
let view: MountedView | null = null;
const ids: Record<string, string> = {};

const ALL = ["billing.view", "billing.edit", "billing.accept", "billing.send", "invoices.view", "invoices.edit", "invoices.finalize", "customers.view", "vehicles.view", "vehicles.edit", "orders.view", "orders.prices", "orders.create", "orders.edit", "mail.send"];

async function login(permissions: readonly string[]) {
  const role = await env.role({ permissions });
  env.signOut();
  await env.signIn(await env.user({ username: `p-${Math.random().toString(36).slice(2)}`, roles: [role] }));
}

async function render(node: ReactNode) {
  const { I18nProvider } = await import("@/i18n/client");
  const { ToastProvider } = await import("@/components/ui/toast");
  const { de } = await import("@/i18n/messages/de");
  const resolved = await resolveServerTree(node);
  view = await mount(createElement(I18nProvider, { locale: "de", messages: de } as never, createElement(ToastProvider, null, resolved)));
  return view.container;
}

before(async () => {
  dom = installDom();
  env = await createTestEnv();
  for (const key of ["office.billing", "workshop.orders"]) await env.db.featureSetting.create({ data: { key, enabled: true, updatedByName: "test" } });
  for (const [i, name] of ["Becker", "Schulz", "Yilmaz"].entries()) await env.db.customer.create({ data: { lastName: name, firstName: "Anna", customerNumber: `K-${i}`, nameKey: name.toLowerCase(), street: "Weg 1", zip: "10115", city: "Berlin", email: `${name.toLowerCase()}@example.com` } });
  await env.db.workshop.upsert({ where: { id: "default" }, update: {}, create: { id: "default" } });
  const { seeds } = await import("./seed");
  for (const seed of seeds) await seed.demo?.(env.db);
  const pick = async (where: Record<string, unknown>) => (await env.db.invoice.findFirstOrThrow({ where: { source: "billing", ...where } })).id;
  ids.draftInvoice = await pick({ docType: "invoice", finalizedAt: null });
  ids.draftFinal = await pick({ docType: "final", finalizedAt: null });
  ids.draftConfirmation = await pick({ docType: "confirmation" });
  ids.offerOpen = await pick({ docType: "offer", offerStatus: "open", number: "AN-" + new Date().getFullYear() + "-0001" });
  ids.offerAccepted = await pick({ docType: "offer", offerStatus: "accepted" });
  ids.invoiceOpen = await pick({ docType: "invoice", paidCents: 0, status: "open", finalizedAt: { not: null } });
  ids.invoicePartial = await pick({ docType: "invoice", paidCents: { gt: 0 }, status: "open" });
  ids.cancelled = await pick({ docType: "invoice", status: "cancelled", cancelsInvoiceId: null });
  ids.credit = await pick({ docType: "credit" });
  ids.partial = await pick({ docType: "partial" });
});
after(async () => {
  await dom.close();
  await env.cleanup();
});
afterEach(async () => {
  await view?.unmount();
  view = null;
});

describe("Liste", () => {
  it("zeigt Belege aller Arten mit Status, die Kennzahlen und die Filter; Entwürfe tragen „Entwurf“ statt einer Nummer", async () => {
    await login(ALL);
    const { default: Page } = await import("@/app/(app)/(office)/billing/page");
    const root = await render(await Page({ searchParams: Promise.resolve({}) }));
    const text = plain(root.textContent);
    for (const word of ["Angebote & Rechnungen", "Entwürfe", "Offene Angebote", "Offene Rechnungen", "Teilweise bezahlt", "Überfällig", "Storniert", "Angenommen", "Abgelehnt", "Abgelaufen", "Entwurf", "Stornorechnung", "Abschlagsrechnung", "Schlussrechnung"]) assert.match(text, new RegExp(word), word);
    assert.ok(root.querySelector("select[name='type']") && root.querySelector("select[name='status']"));
    assert.match(text, /Neues Angebot/);
  });

  it("Filter nach Belegart und Status; ohne billing.edit keine Anlegen-Knöpfe", async () => {
    await login(["billing.view"]);
    const { default: Page } = await import("@/app/(app)/(office)/billing/page");
    let root = await render(await Page({ searchParams: Promise.resolve({ type: "offer", status: "accepted" }) }));
    let text = plain(root.textContent);
    assert.match(text, /1 Beleg/);
    assert.match(text, /Angenommen/);
    assert.doesNotMatch(text, /Neues Angebot/);
    await view!.unmount();
    root = await render(await Page({ searchParams: Promise.resolve({ status: "draft" }) }));
    text = plain(root.textContent);
    assert.match(text, /3 Belege/);
    assert.doesNotMatch(text, /AN-\d{4}-\d{4}/, "keine Angebote unter den Entwürfen");
  });

  it("ohne Recht: Weiterleitung auf „Kein Zugriff“", async () => {
    await login(["invoices.view"]);
    const { default: Page } = await import("@/app/(app)/(office)/billing/page");
    assert.equal(await redirectOf(() => Page({ searchParams: Promise.resolve({}) })), "/forbidden");
  });
});

describe("Detail", () => {
  async function detail(id: string) {
    const { default: Page } = await import("@/app/(app)/(office)/billing/[id]/page");
    return plain((await render(await Page({ params: Promise.resolve({ id }) }))).textContent);
  }

  it("Entwurf: Prüfliste, Festschreiben (mit Recht), Löschen; keine Zahlungen", async () => {
    await login(ALL);
    const text = await detail(ids.draftInvoice);
    assert.match(text, /Rechnung \(Entwurf\)/);
    assert.match(text, /Prüfliste vor dem Festschreiben/);
    assert.match(text, /Festschreiben/);
    assert.match(text, /Entwurf löschen/);
    assert.doesNotMatch(text, /Zahlung erfassen/);
    await view!.unmount();
    await login(["billing.view", "billing.edit"]);
    assert.match(await detail(ids.draftInvoice), /Ausgangsrechnungen festschreiben“ nötig/);
  });

  it("Rechnung: Schnappschuss, Zahlungen mit Restbetrag, XRechnung-Hinweis, Storno; Gegenbeleg verweist auf das Original", async () => {
    await login(ALL);
    let text = await detail(ids.invoicePartial);
    assert.match(text, /Schnappschuss/);
    assert.match(text, /Teilweise bezahlt/);
    assert.match(text, /Zahlung erfassen/);
    assert.match(text, /Noch offen/);
    assert.match(text, /Für die XRechnung fehlt noch/);
    assert.match(text, /Stornorechnung anlegen/);
    assert.match(text, /Kassensicherungsverordnung/);
    await view!.unmount();
    text = await detail(ids.credit);
    assert.match(text, /Storno zu /);
    assert.doesNotMatch(text, /Zahlung erfassen/);
    await view!.unmount();
    text = await detail(ids.cancelled);
    assert.match(text, /Storniert durch/);
    assert.doesNotMatch(text, /Stornorechnung anlegen/, "nur einmal");
  });

  it("Schlussrechnung: angerechnete Abschläge und zu zahlender Betrag; Abschlag", async () => {
    await login(ALL);
    const text = await detail(ids.draftFinal);
    assert.match(text, /abzgl\. Abschläge/);
    assert.match(text, /Zu zahlender Betrag/);
    await view!.unmount();
    assert.match(await detail(ids.partial), /Abschlagsrechnung/);
  });

  it("Angebot: offen → annehmen/ablehnen; angenommen → Auftragsbestätigung und (mit Fahrzeug) Auftrag", async () => {
    await login(ALL);
    let text = await detail(ids.offerOpen);
    assert.match(text, /Als angenommen vermerken/);
    assert.match(text, /Als abgelehnt vermerken/);
    assert.doesNotMatch(text, /Auftragsbestätigung erstellen/);
    await view!.unmount();
    text = await detail(ids.offerAccepted);
    assert.doesNotMatch(text, /Als angenommen vermerken/);
    assert.match(text, /Auftragsbestätigung/, "die Auftragsbestätigung ist schon da (Verweis) oder wird angeboten");
    await view!.unmount();
    await login(["billing.view", "billing.edit"]);
    assert.doesNotMatch(await detail(ids.offerOpen), /Als angenommen vermerken/, "ohne billing.accept nicht");
  });

  it("Versand: ohne eingerichtetes E-Mail-Postfach der Hinweis, nie ein Formular; unbekannter Beleg: 404; fremde IDs (Archiv) gibt es nicht", async () => {
    await login(ALL);
    assert.match(await detail(ids.invoiceOpen), /E-Mail-Versand ist nicht eingerichtet/);
    await view!.unmount();
    const { default: Page } = await import("@/app/(app)/(office)/billing/[id]/page");
    assert.equal(await isNotFound(() => Page({ params: Promise.resolve({ id: "gibtsnicht" }) })), true);
    const manual = await env.db.invoice.create({ data: { direction: "outgoing", number: "M-1", outgoingKey: "M-1", partyName: "Alt", partyKey: "alt", issueDate: new Date(), grossCents: 100 } });
    assert.equal(await isNotFound(() => Page({ params: Promise.resolve({ id: manual.id }) })), true);
  });
});

describe("Neu und Bearbeiten", () => {
  it("Neu: je Belegart das passende Formular; ohne billing.edit keine Seite", async () => {
    await login(ALL);
    const { default: Page } = await import("@/app/(app)/(office)/billing/new/page");
    for (const [type, field] of [["offer", "validUntil"], ["invoice", "serviceFrom"], ["partial", "serviceFrom"], ["final", "deductPartialIds"]] as const) {
      const root = await render(await Page({ searchParams: Promise.resolve({ type }) }));
      if (type === "final") assert.match(plain(root.textContent), /Anrechnung von Abschlägen/);
      else assert.ok(root.querySelector(`[name='${field}']`), `${type}: ${field}`);
      await view!.unmount();
    }
    await login(["billing.view"]);
    assert.equal(await redirectOf(() => Page({ searchParams: Promise.resolve({}) })), "/forbidden");
  });

  it("Rechnung aus Auftrag: Rückfragen zu offenem Auftrag; unbekannter Auftrag und fehlende Rechte werden freundlich gemeldet", async () => {
    await login(ALL);
    const { default: Page } = await import("@/app/(app)/(office)/billing/new/page");
    let root = await render(await Page({ searchParams: Promise.resolve({ order: "gibtsnicht" }) }));
    assert.match(plain(root.textContent), /Der Auftrag wurde nicht gefunden/);
    await view!.unmount();
    await login(["billing.edit", "billing.view"]);
    root = await render(await Page({ searchParams: Promise.resolve({ order: "x" }) }));
    assert.match(plain(root.textContent), /Rechte Aufträge ansehen/);
  });

  it("Bearbeiten: Entwurf mit den gespeicherten Werten; festgeschriebene Belege leiten zur Ansicht um", async () => {
    await login(ALL);
    const { default: Page } = await import("@/app/(app)/(office)/billing/[id]/edit/page");
    const root = await render(await Page({ params: Promise.resolve({ id: ids.draftInvoice }) }));
    assert.ok((root.querySelector("input[name='partyName']") as HTMLInputElement).value.length > 0);
    assert.ok(root.querySelector("input[name='version']"));
    await view!.unmount();
    assert.equal(await redirectOf(() => Page({ params: Promise.resolve({ id: ids.invoiceOpen }) })), `/billing/${ids.invoiceOpen}`);
  });
});

describe("Kundenseite und Neu-Formular (Fix-Runde 12d)", () => {
  it("die Kundenseite bietet neues Angebot und neue Rechnung mit vorbelegtem Kunden; nicht für eingeschränkte Kunden und nicht ohne billing.edit", async () => {
    const customer = await env.db.customer.findFirstOrThrow({ where: { lastName: "Becker" } });
    const { default: Page } = await import("@/app/(app)/(workshop)/customers/[id]/page");
    await login(ALL);
    let root = await render(await Page({ params: Promise.resolve({ id: customer.id }) }));
    const links = [...root.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    assert.ok(links.includes(`/billing/new?type=offer&customer=${customer.id}`), "Angebot");
    assert.ok(links.includes(`/billing/new?type=invoice&customer=${customer.id}`), "Rechnung");
    await view!.unmount();
    await login(["customers.view", "billing.view"]);
    root = await render(await Page({ params: Promise.resolve({ id: customer.id }) }));
    assert.ok(![...root.querySelectorAll("a")].some((a) => (a.getAttribute("href") ?? "").startsWith("/billing/new")));
    await view!.unmount();
    await env.db.customer.update({ where: { id: customer.id }, data: { processingRestrictedAt: new Date() } });
    try {
      await login(ALL);
      root = await render(await Page({ params: Promise.resolve({ id: customer.id }) }));
      assert.ok(![...root.querySelectorAll("a")].some((a) => (a.getAttribute("href") ?? "").startsWith("/billing/new")));
    } finally {
      await env.db.customer.update({ where: { id: customer.id }, data: { processingRestrictedAt: null } });
    }
  });

  it("die Schlussrechnung im Neu-Formular zeigt die Karte der Abschläge; mit ?customer= stehen die anrechenbaren Abschläge zur Wahl", async () => {
    await login(ALL);
    const partial = await env.db.invoice.findUniqueOrThrow({ where: { id: ids.partial } });
    const { default: Page } = await import("@/app/(app)/(office)/billing/new/page");
    let text = plain((await render(await Page({ searchParams: Promise.resolve({ type: "final" }) }))).textContent);
    assert.match(text, /Anrechnung von Abschlägen/);
    assert.match(text, /wird ein Kunde gewählt/);
    await view!.unmount();
    if (partial.customerId) {
      const root = await render(await Page({ searchParams: Promise.resolve({ type: "final", customer: partial.customerId }) }));
      text = plain(root.textContent);
      assert.doesNotMatch(text, /wird ein Kunde gewählt/);
    }
  });
});

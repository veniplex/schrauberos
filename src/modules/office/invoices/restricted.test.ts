import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { createElement, type ReactNode } from "react";
import { dayKey } from "@/lib/zone";
import { installDom, mount, type MountedView, type TestDom } from "@/test/dom";
import { createTestEnv, isNotFound, type TestEnv } from "@/test/harness";
import { resolveServerTree } from "@/test/server-tree";
import { plain } from "@/test/ui";

/**
 * Archiv-Lesen und Art. 18 (Entscheid des Besitzers): Festgeschriebene Rechnungen eingeschränkter Kunden bleiben im Archiv lesbar (Aufbewahrungspflicht) – nur mit `invoices.view`, mit dem Hinweis
 * „Verarbeitung eingeschränkt (Aufbewahrungspflicht)“, der Name nur mit `customers.view`; nicht festgeschriebene sind dort nicht lesbar. Schnellsuche, API, Auswahl und Exporte schließen eingeschränkte Kunden aus.
 * Belege der Rechnungserstellung: Seite, PDF, XRechnung und Original nur zusätzlich mit `invoices.view`.
 */
let dom: TestDom;
let env: TestEnv;
let view: MountedView | null = null;
const ids = { finalized: "", draft: "", free: "", billing: "", billingDraft: "" };

async function login(permissions: readonly string[]) {
  const role = await env.role({ permissions });
  env.signOut();
  await env.signIn(await env.user({ username: `r-${Math.random().toString(36).slice(2)}`, roles: [role] }));
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
  env = await createTestEnv();
  // pdfkit lädt seine Dateien über `import.meta.url`: vor dem DOM-Ersatz laden (Seiten und Routen, die das PDF erzeugen)
  await import("@/app/api/billing/[id]/pdf/route");
  await import("@/app/api/billing/[id]/xml/route");
  await import("@/app/(app)/(office)/billing/[id]/page");
  await import("@/app/(app)/(office)/billing/[id]/edit/page");
  dom = installDom();
  await env.db.featureSetting.create({ data: { key: "office.billing", enabled: true, updatedByName: "test" } });
});
after(async () => {
  await dom.close();
  await env.cleanup();
});
afterEach(async () => {
  await view?.unmount();
  view = null;
});
beforeEach(async () => {
  await env.db.invoiceOriginal.deleteMany();
  await env.db.invoiceFile.deleteMany();
  await env.db.invoice.deleteMany();
  await env.db.customer.deleteMany();
  const restricted = await env.db.customer.create({ data: { lastName: "Eingeschränkt", firstName: "Erika", nameKey: "eingeschraenkt erika", customerNumber: "K-9", processingRestrictedAt: new Date() } });
  const free = await env.db.customer.create({ data: { lastName: "Frei", firstName: "Fritz", nameKey: "frei fritz", customerNumber: "K-1" } });
  const base = { direction: "outgoing", docType: "invoice", issueDate: new Date(), grossCents: 11900, netCents: 10000, vatCents: 1900, status: "open" };
  const mk = (extra: Record<string, unknown>) => env.db.invoice.create({ data: { ...base, ...extra } as never });
  ids.finalized = (await mk({ number: "2026-0001", outgoingKey: "2026-0001", partyName: "Erika Eingeschränkt", partyKey: "erika eingeschraenkt", customerId: restricted.id, finalizedAt: new Date(), finalizedByName: "t" })).id;
  ids.draft = (await mk({ number: "ENTWURF-1", outgoingKey: "entwurf-1", partyName: "Erika Eingeschränkt", partyKey: "erika eingeschraenkt", customerId: restricted.id })).id;
  ids.free = (await mk({ number: "2026-0002", outgoingKey: "2026-0002", partyName: "Fritz Frei", partyKey: "fritz frei", customerId: free.id, finalizedAt: new Date(), finalizedByName: "t" })).id;
  ids.billing = (await mk({ number: "2026-0003", outgoingKey: "2026-0003", source: "billing", partyName: "Erika Eingeschränkt", partyKey: "erika eingeschraenkt", customerId: restricted.id, finalizedAt: new Date(), finalizedByName: "t" })).id;
  ids.billingDraft = (await mk({ number: "", source: "billing", partyName: "Erika Eingeschränkt", partyKey: "erika eingeschraenkt", customerId: restricted.id })).id;
});

const LIST = (extra: Record<string, string> = {}) => ({ searchParams: Promise.resolve({ dir: "outgoing", year: "all", ...extra }) });

describe("Archiv: Liste", () => {
  it("zeigt festgeschriebene Rechnungen eingeschränkter Kunden mit Hinweis, den Namen nur mit customers.view; nicht festgeschriebene fehlen", async () => {
    await login(["invoices.view"]);
    const { default: Page } = await import("@/app/(app)/(office)/invoices/page");
    const root = await render(await Page(LIST()));
    const text = plain(root.textContent);
    assert.match(text, /2026-0001/, "festgeschrieben: lesbar");
    assert.match(text, /Verarbeitung eingeschränkt \(Aufbewahrungspflicht\)/);
    assert.doesNotMatch(text, /Erika Eingeschränkt/, "Name nur mit customers.view");
    assert.match(text, /Kunde eingeschränkt/);
    assert.doesNotMatch(text, /ENTWURF-1/, "nicht festgeschrieben: nicht lesbar");
    assert.match(text, /Fritz Frei/, "andere Kunden unverändert");
    await view!.unmount();

    await login(["invoices.view", "customers.view"]);
    const withNames = plain((await render(await Page(LIST()))).textContent);
    assert.match(withNames, /Erika Eingeschränkt/);
    assert.match(withNames, /Verarbeitung eingeschränkt/);
  });

  it("die Suche nach dem Namen findet eingeschränkte Kunden nur mit customers.view (Nummern und Referenzen immer)", async () => {
    const { default: Page } = await import("@/app/(app)/(office)/invoices/page");
    await login(["invoices.view"]);
    assert.doesNotMatch(plain((await render(await Page(LIST({ q: "Erika" })))).textContent), /2026-0001/);
    await view!.unmount();
    assert.match(plain((await render(await Page(LIST({ q: "2026-0001" })))).textContent), /2026-0001/);
    await view!.unmount();
    await login(["invoices.view", "customers.view"]);
    assert.match(plain((await render(await Page(LIST({ q: "Erika" })))).textContent), /2026-0001/);
  });
});

describe("Archiv: Detail, Datei, Schnellsuche, API", () => {
  it("Detail: festgeschrieben mit Hinweis und verborgenem Namen, nicht festgeschrieben 404", async () => {
    await login(["invoices.view"]);
    const { default: Page } = await import("@/app/(app)/(office)/invoices/[id]/page");
    const root = await render(await Page({ params: Promise.resolve({ id: ids.finalized }) }));
    const text = plain(root.textContent);
    assert.match(text, /Verarbeitung eingeschränkt \(Aufbewahrungspflicht\)/);
    assert.doesNotMatch(text, /Erika Eingeschränkt/);
    assert.equal(await isNotFound(async () => Page({ params: Promise.resolve({ id: ids.draft }) })), true);
    assert.equal(await isNotFound(async () => Page({ params: Promise.resolve({ id: ids.free }) })), false);
  });

  it("die Datei einer nicht festgeschriebenen Rechnung eines eingeschränkten Kunden wird nicht ausgeliefert, die einer festgeschriebenen schon", async () => {
    const { storeFile } = await import("@/server/files");
    const path = await storeFile("rechnungen/test", "r.pdf", new TextEncoder().encode("%PDF-1.4"));
    const other = await storeFile("rechnungen/test", "d.pdf", new TextEncoder().encode("%PDF-1.4"));
    await env.db.invoiceFile.create({ data: { invoiceId: ids.finalized, name: "r.pdf", mime: "application/pdf", size: 8, path } });
    await env.db.invoiceFile.create({ data: { invoiceId: ids.draft, name: "d.pdf", mime: "application/pdf", size: 8, path: other } });
    await login(["invoices.view"]);
    const { GET } = await import("@/app/api/invoices/[id]/file/route");
    const call = (id: string) => GET({ nextUrl: new URL(`http://localhost/api/invoices/${id}/file`) } as never, { params: Promise.resolve({ id }) });
    assert.equal((await call(ids.finalized)).status, 200);
    assert.equal((await call(ids.draft)).status, 404);
  });

  it("Schnellsuche und API schließen eingeschränkte Kunden ganz aus", async () => {
    await login(["invoices.view"]);
    const { searchProviders } = await import("./search");
    const { getSession } = await import("@/server/auth/session");
    const hits = await searchProviders[0].search("2026", { session: (await getSession())!, limit: 20 });
    assert.deepEqual(hits.map((h) => h.title).sort(), ["2026-0002"], "nur der nicht eingeschränkte Kunde");
    await env.db.featureSetting.upsert({ where: { key: "office.invoices" }, update: { enabled: true }, create: { key: "office.invoices", enabled: true, updatedByName: "test" } });
    const { apiRequest, makeToken } = await import("@/test/api-helpers");
    const router = await import("@/server/api/router");
    const role = await env.role({ permissions: ["invoices.view"] });
    const user = await env.user({ username: `api-${Math.random().toString(36).slice(2)}`, roles: [role] });
    const { token } = await makeToken(env, { ownerId: user.id, scope: ["invoices.view"], rateLimitPerMinute: 6000 });
    const list = await router.handleApiRequest(apiRequest("GET", "/invoices?direction=outgoing", { token }));
    const body = (await list.json()) as { data: Array<{ number: string }> };
    assert.deepEqual(body.data.map((i) => i.number), ["2026-0002"], "API: eingeschränkte Kunden fehlen");
    for (const id of [ids.finalized, ids.draft]) assert.equal((await router.handleApiRequest(apiRequest("GET", `/invoices/${id}`, { token }))).status, 404);
  });
});

describe("Rechnungserstellung (billing)", () => {
  it("Seite, PDF und XRechnung eines eingeschränkten Kunden nur mit invoices.view zusätzlich; sonst 404 – die Liste zeigt sie dann nicht", async () => {
    const page = await import("@/app/(app)/(office)/billing/[id]/page");
    const pdf = await import("@/app/api/billing/[id]/pdf/route");
    const xml = await import("@/app/api/billing/[id]/xml/route");
    const call = (route: typeof pdf, id: string) => route.GET({ nextUrl: new URL(`http://localhost/api/billing/${id}/pdf`) } as never, { params: Promise.resolve({ id }) });

    await login(["billing.view"]);
    assert.equal((await call(pdf, ids.billing)).status, 404);
    assert.equal((await call(xml as never, ids.billing)).status, 404);
    assert.equal(await isNotFound(async () => page.default({ params: Promise.resolve({ id: ids.billing }) })), true);
    const { default: List } = await import("@/app/(app)/(office)/billing/page");
    const listText = plain((await render(await List({ searchParams: Promise.resolve({}) }))).textContent);
    assert.doesNotMatch(listText, /2026-0003/, "nicht in der Liste");
    assert.equal((await page.generateMetadata({ params: Promise.resolve({ id: ids.billing }) })).title, undefined, "kein Titel mit Namen");
    await view!.unmount();

    await login(["billing.view", "invoices.view"]);
    assert.notEqual((await call(pdf, ids.billing)).status, 404, "mit invoices.view lesbar");
    assert.equal(await isNotFound(async () => page.default({ params: Promise.resolve({ id: ids.billing }) })), false);
  });
});

describe("Zentrale Bedingung", () => {
  it("archiveReadableWhere: nicht eingeschränkt oder festgeschrieben", async () => {
    const { archiveReadableWhere, archiveListedWhere } = await import("./queries");
    const readable = (await env.db.invoice.findMany({ where: archiveReadableWhere, select: { id: true } })).map((r) => r.id);
    assert.ok(readable.includes(ids.finalized) && readable.includes(ids.free) && readable.includes(ids.billing));
    assert.ok(!readable.includes(ids.draft) && !readable.includes(ids.billingDraft));
    const listed = (await env.db.invoice.findMany({ where: archiveListedWhere, select: { id: true } })).map((r) => r.id);
    assert.deepEqual(listed, [ids.free], "API, Exporte, Feeds: eingeschränkte Kunden fehlen ganz");
    assert.equal(dayKey(new Date()).length, 10);
  });
});

describe("Exporte (Art. 18, Entscheid des Besitzers Block 15)", () => {
  async function rowsOf(def: import("@/server/csv/types").ExportDef, query: string) {
    const { getSession } = await import("@/server/auth/session");
    const { getI18n } = await import("@/i18n/server");
    const { t } = await getI18n();
    const session = (await getSession())!;
    const out = (await def.open({ session, query: new URLSearchParams(query), format: { locale: "de" } as never, t } as never)) as { count: number; rows: AsyncIterable<unknown[]> };
    const rows: unknown[][] = [];
    for await (const row of out.rows) rows.push(row);
    return { count: out.count, rows };
  }

  it("der allgemeine Rechnungs-Export lässt eingeschränkte Kunden ganz aus (kein Name, keine Nummer)", async () => {
    await env.db.featureSetting.upsert({ where: { key: "office.invoices" }, update: { enabled: true }, create: { key: "office.invoices", enabled: true, updatedByName: "test" } });
    await login(["invoices.view", "invoices.export"]);
    const { invoicesExport } = await import("./exchange");
    const { count, rows } = await rowsOf(invoicesExport, "");
    const text = JSON.stringify(rows);
    assert.ok(text.includes("2026-0002"), "andere Kunden unverändert");
    assert.ok(!text.includes("Erika") && !text.includes("2026-0001") && !text.includes("ENTWURF-1"), "eingeschränkter Kunde fehlt ganz");
    assert.equal(count, rows.length, "die Zählung stimmt mit den Zeilen überein");
  });

  it("der Steuerberater-Export enthält die festgeschriebenen Rechnungen eingeschränkter Kunden (Aufbewahrungspflicht) – ohne Namen, mit Kundennummer und Hinweis; Entwürfe nie", async () => {
    await login(["invoices.view", "invoices.export"]);
    const { accountantExport } = await import("./exchange");
    const { count, rows } = await rowsOf(accountantExport, "from=2000-01-01&to=2099-12-31");
    const text = JSON.stringify(rows);
    assert.ok(text.includes("2026-0001"), "festgeschrieben: gehört in die Übergabe an den Steuerberater");
    assert.ok(text.includes("K-9") && text.includes("Verarbeitung eingeschränkt (Aufbewahrungspflicht)"), "Kundennummer und Hinweis statt Namen");
    assert.ok(!text.includes("Erika") && !text.includes("Eingeschränkt"), "kein Name");
    assert.ok(!text.includes("ENTWURF-1"), "nicht festgeschrieben: nie");
    assert.ok(text.includes("Fritz Frei"), "nicht eingeschränkte Kunden mit Namen");
    assert.equal(count, rows.length);
  });
});

describe("Rechnungserstellung: Art. 18 durchgängig (B2, B3)", () => {
  const offerOf = async () => {
    const restricted = await env.db.customer.findFirstOrThrow({ where: { customerNumber: "K-9" } });
    return (await env.db.invoice.create({ data: { direction: "outgoing", docType: "offer", source: "billing", number: "AN-1", issueDate: new Date(), grossCents: 11900, netCents: 10000, vatCents: 1900, status: "open", partyName: "Erika Eingeschränkt", partyKey: "erika eingeschraenkt", customerId: restricted.id, finalizedAt: new Date(), finalizedByName: "t", offerStatus: "open" } as never })).id;
  };
  const pdfCall = async (id: string, query = "") => (await import("@/app/api/billing/[id]/pdf/route")).GET({ nextUrl: new URL(`http://localhost/api/billing/${id}/pdf${query}`) } as never, { params: Promise.resolve({ id }) });

  it("nur festgeschriebene RECHNUNGEN eingeschränkter Kunden sind lesbar (mit invoices.view): Entwürfe, Angebote und Auftragsbestätigungen nicht – Seite und PDF", async () => {
    const page = await import("@/app/(app)/(office)/billing/[id]/page");
    const offer = await offerOf();
    await login(["billing.view", "invoices.view", "customers.view"]);
    assert.equal(await isNotFound(async () => page.default({ params: Promise.resolve({ id: ids.billing }) })), false, "festgeschriebene Rechnung: lesbar");
    assert.equal((await pdfCall(ids.billing)).status, 200);
    for (const id of [ids.billingDraft, offer]) {
      assert.equal(await isNotFound(async () => page.default({ params: Promise.resolve({ id }) })), true, id);
      assert.equal((await pdfCall(id)).status, 404, id);
      assert.deepEqual(await page.generateMetadata({ params: Promise.resolve({ id }) }), {}, "kein Titel mit Namen");
    }
  });

  it("Seite, Titel und Liste: Name nur mit customers.view, dazu der Hinweis „Verarbeitung eingeschränkt“; Entwürfe und Angebote stehen nicht in der Liste", async () => {
    const page = await import("@/app/(app)/(office)/billing/[id]/page");
    const { default: List } = await import("@/app/(app)/(office)/billing/page");
    const offer = await offerOf();
    void offer;
    await login(["billing.view", "invoices.view"]);
    const detail = plain((await render(await page.default({ params: Promise.resolve({ id: ids.billing }) }))).textContent);
    assert.match(detail, /Verarbeitung eingeschränkt \(Aufbewahrungspflicht\)/);
    assert.doesNotMatch(detail, /Erika Eingeschränkt/, "ohne customers.view kein Name auf der Seite");
    assert.match(detail, /Kunde eingeschränkt/);
    const title = (await page.generateMetadata({ params: Promise.resolve({ id: ids.billing }) })).title;
    assert.equal(String(title).includes("Erika"), false, "und nicht im Titel");
    await view!.unmount();
    const list = plain((await render(await List({ searchParams: Promise.resolve({}) }))).textContent);
    assert.match(list, /2026-0003/, "festgeschriebene Rechnung in der Liste");
    assert.doesNotMatch(list, /Erika Eingeschränkt/);
    assert.doesNotMatch(list, /AN-1/, "ein Angebot eines eingeschränkten Kunden steht nicht in der Liste");
    assert.match(list, /Verarbeitung eingeschränkt/);
    const search = plain((await render(await List({ searchParams: Promise.resolve({ q: "Erika" }) }))).textContent);
    assert.doesNotMatch(search, /2026-0003/, "die Suche nach dem Namen findet sie ohne customers.view nicht");
    await view!.unmount();
    await login(["billing.view", "invoices.view", "customers.view"]);
    assert.match(plain((await render(await page.default({ params: Promise.resolve({ id: ids.billing }) }))).textContent), /Erika Eingeschränkt/);
    assert.match(String((await page.generateMetadata({ params: Promise.resolve({ id: ids.billing }) })).title), /Erika/);
  });

  it("beide Bearbeiten-Seiten prüfen dieselbe Bedingung: ein Entwurf eines eingeschränkten Kunden öffnet sich nicht", async () => {
    const billingEdit = await import("@/app/(app)/(office)/billing/[id]/edit/page");
    const invoiceEdit = await import("@/app/(app)/(office)/invoices/[id]/edit/page");
    await login(["billing.edit"]);
    assert.equal(await isNotFound(async () => billingEdit.default({ params: Promise.resolve({ id: ids.billingDraft }) })), true);
    assert.equal(String((await billingEdit.generateMetadata({ params: Promise.resolve({ id: ids.billingDraft }) })).title).includes("Erika"), false, "kein Name im Titel");
    await login(["invoices.edit"]);
    assert.equal(await isNotFound(async () => invoiceEdit.default({ params: Promise.resolve({ id: ids.draft }) })), true, "nicht festgeschriebene Rechnung eines eingeschränkten Kunden");
    assert.equal(await isNotFound(async () => invoiceEdit.default({ params: Promise.resolve({ id: ids.free }) })), false, "andere Kunden unverändert");
    // ein nicht eingeschränkter Entwurf lässt sich weiterhin bearbeiten
    const free = await env.db.customer.findFirstOrThrow({ where: { customerNumber: "K-1" } });
    const open = await env.db.invoice.create({ data: { direction: "outgoing", docType: "invoice", source: "billing", number: "", issueDate: new Date(), grossCents: 1, status: "open", partyName: "Fritz Frei", partyKey: "fritz frei", customerId: free.id } as never });
    await login(["billing.edit"]);
    assert.equal(await isNotFound(async () => billingEdit.default({ params: Promise.resolve({ id: open.id }) })), false);
  });

  it("Startseiten-Baustein „Offene Rechnungen“: der Name eines eingeschränkten Kunden nur mit customers.view; nicht lesbare Rechnungen fehlen", async () => {
    await env.db.featureSetting.upsert({ where: { key: "office.invoices" }, update: { enabled: true }, create: { key: "office.invoices", enabled: true, updatedByName: "test" } });
    const yesterday = new Date(Date.now() - 3 * 86_400_000);
    await env.db.invoice.update({ where: { id: ids.finalized }, data: { dueDate: yesterday } });
    await env.db.invoice.update({ where: { id: ids.draft }, data: { dueDate: yesterday } });
    const { InvoicesWidget } = await import("./widgets");
    await login(["invoices.view"]);
    const text = plain((await render(await InvoicesWidget())).textContent);
    assert.match(text, /2026-0001/, "die überfällige festgeschriebene Rechnung steht da");
    assert.doesNotMatch(text, /Erika Eingeschränkt/, "ohne Namen");
    assert.match(text, /Kunde eingeschränkt/);
    assert.doesNotMatch(text, /ENTWURF-1/, "nicht lesbar (Entwurf eines eingeschränkten Kunden)");
    await view!.unmount();
    await login(["invoices.view", "customers.view"]);
    assert.match(plain((await render(await InvoicesWidget())).textContent), /Erika Eingeschränkt/);
  });
});

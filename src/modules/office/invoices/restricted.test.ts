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

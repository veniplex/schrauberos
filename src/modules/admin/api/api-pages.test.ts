import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createElement, type ReactNode } from "react";
import { installDom, mount, type MountedView, type TestDom } from "@/test/dom";
import { createTestEnv, form, redirectOf, type TestEnv } from "@/test/harness";
import { resolveServerTree } from "@/test/server-tree";
import { plain } from "@/test/ui";

/**
 * Die Seiten von „API & Webhooks“ im echten Renderer und die Aktionen dahinter: Token anlegen (Antwort mit einmaligem Klartext, Passwortabfrage, gekennzeichnete Rechte), Webhooks anlegen/ändern/löschen,
 * Rechte der Seiten, die Doku-Seite (Platzhalter statt Token, eine Ressource je Seite) und das JSON der Beschreibung (nur Sitzung mit `api.manage`; ein Token gilt hier nie).
 */
let env: TestEnv;
let dom: TestDom;
let view: MountedView | null = null;
let actions: typeof import("./actions");

const PASSWORD = "geheim-passwort-123";
async function login(roleInput: { isAdmin?: boolean; permissions?: readonly string[] }, username = `p-${Math.random().toString(36).slice(2)}`) {
  const role = await env.role(roleInput);
  env.signOut();
  const user = await env.user({ username, password: PASSWORD, roles: [role] });
  await env.signIn(user);
  return user;
}
const admin = () => login({ isAdmin: true });
async function unmountView() {
  const current = view;
  view = null;
  await current?.unmount();
}
async function render(node: ReactNode) {
  const { I18nProvider } = await import("@/i18n/client");
  const { ToastProvider } = await import("@/components/ui/toast");
  const { de } = await import("@/i18n/messages/de");
  view = await mount(createElement(I18nProvider, { locale: "de", messages: de } as never, createElement(ToastProvider, null, await resolveServerTree(node))));
  return view.container;
}

before(async () => {
  env = await createTestEnv();
  // Die Beschreibung der API zieht alle api.ts (auch das PDF der Rechnungserstellung): vor der DOM-Umgebung laden, sie verwirrt das Laden von pdfkit
  await import("@/server/api/doc");
  await import("@/server/api/router");
  dom = installDom();
  actions = await import("./actions");
});
after(async () => {
  await view?.unmount();
  await dom.close();
  await env.cleanup();
});

describe("Aktionen", () => {
  it("createApiToken: die Antwort trägt den Klartext einmal; falsches Passwort ist ein Feldfehler und legt nichts an; ohne Recht Weiterleitung", async () => {
    await admin();
    const wrong = await actions.createApiToken({}, form({ name: "Import", scope: ["customers.view"], password: "falsch" }));
    assert.ok(wrong && "fieldErrors" in wrong && wrong.fieldErrors?.password, "Passwort wird als Feld bemängelt");
    assert.equal(await env.db.apiToken.count(), 0);

    const ok = (await actions.createApiToken({}, form({ name: "Import", scope: ["customers.view", "vehicles.view"], expiresInDays: "30", rateLimitPerMinute: "60", password: PASSWORD }))) as {
      ok?: boolean;
      token?: { value: string; hint: string; expiresOn: string };
      message?: string;
    };
    assert.equal(ok.ok, true);
    assert.match(ok.token?.value ?? "", /^sos_[A-Za-z0-9_-]{43}$/);
    assert.equal(ok.message, "Token angelegt");
    const row = await env.db.apiToken.findFirstOrThrow({ include: { scope: true } });
    assert.deepEqual(row.scope.map((s) => s.permission).sort(), ["customers.view", "vehicles.view"]);
    assert.equal(row.rateLimitPerMinute, 60);
    assert.ok(!JSON.stringify(await env.db.auditLog.findMany()).includes(ok.token?.value ?? "?"));

    // gekennzeichnete Rechte nur mit Bestätigung (Häkchen „on“)
    const marked = await actions.createApiToken({}, form({ name: "Sperre", scope: ["invoices.finalize"], password: PASSWORD }));
    assert.ok(marked && "fieldErrors" in marked && marked.fieldErrors?.acknowledgeMarked);
    const confirmed = (await actions.createApiToken({}, form({ name: "Sperre", scope: ["invoices.finalize"], acknowledgeMarked: "on", password: PASSWORD }))) as { ok?: boolean };
    assert.equal(confirmed.ok, true);

    await login({ permissions: ["customers.view"] });
    assert.equal(await redirectOf(() => actions.createApiToken({}, form({ name: "x", scope: ["customers.view"], password: PASSWORD }))), "/forbidden");
  });

  it("revokeApiToken: widerruft (ohne Passwort); ohne Recht Weiterleitung", async () => {
    await admin();
    const created = (await actions.createApiToken({}, form({ name: "Weg", scope: ["customers.view"], password: PASSWORD }))) as { ok?: boolean };
    assert.equal(created.ok, true);
    const row = await env.db.apiToken.findFirstOrThrow({ where: { name: "Weg" } });
    await login({ permissions: ["customers.view"] });
    assert.equal(await redirectOf(() => actions.revokeApiToken(form({ id: row.id }))), "/forbidden");
    assert.equal((await env.db.apiToken.findUniqueOrThrow({ where: { id: row.id } })).revokedAt, null);
    await admin();
    await actions.revokeApiToken(form({ id: row.id }));
    assert.ok((await env.db.apiToken.findUniqueOrThrow({ where: { id: row.id } })).revokedAt);
  });

  it("saveWebhook: Anlegen liefert das Geheimnis einmal im Zustand (ausgeschaltet); Ändern mit Version; Fehler als Feldfehler; löschen leitet zur Liste", async () => {
    await admin();
    const bad = await actions.saveWebhook({}, form({ name: "Ziel", url: "http://127.0.0.1/x", events: ["order.closed"], password: PASSWORD }));
    assert.ok(bad && "fieldErrors" in bad && bad.fieldErrors?.url);
    const noEvents = await actions.saveWebhook({}, form({ name: "Ziel", url: "https://hook.example.org/x", password: PASSWORD }));
    assert.ok(noEvents && "fieldErrors" in noEvents);
    assert.equal(await env.db.webhook.count(), 0);

    const created = (await actions.saveWebhook({}, form({ name: "Ziel", url: "https://hook.example.org/x", events: ["order.closed", "billing.paid"], password: PASSWORD }))) as { ok?: boolean; created?: { id: string; secret: string } };
    assert.equal(created.ok, true);
    assert.match(created.created?.secret ?? "", /^whsec_/);
    const row = await env.db.webhook.findUniqueOrThrow({ where: { id: created.created?.id ?? "" } });
    assert.deepEqual([row.enabled, row.events], [false, "order.closed,billing.paid"]);

    const changed = (await actions.saveWebhook({}, form({ id: row.id, version: String(row.updatedAt.getTime()), name: "Neu", url: "https://hook.example.org/y", events: ["order.closed"], enabled: "on", allowPrivate: "", password: PASSWORD }))) as { ok?: boolean; created?: unknown };
    assert.equal(changed.ok, true);
    assert.equal(changed.created, undefined, "beim Ändern kein Geheimnis in der Antwort");
    assert.equal((await env.db.webhook.findUniqueOrThrow({ where: { id: row.id } })).enabled, true);
    assert.equal(await redirectOf(() => actions.deleteWebhook(form({ id: row.id }))), "/admin/api/webhooks");
    assert.equal(await env.db.webhook.count(), 0);
  });
});

describe("Seiten", () => {
  it("Übersicht: Tokens mit Besitzer, Rechten und Zustand – nie Hash oder Klartext; Hinweis auf Widerruf; Weiterleitung ohne api.manage", async () => {
    await admin();
    await actions.createApiToken({}, form({ name: "Lesender Zugriff", description: "für die Buchhaltung", scope: ["customers.view"], password: PASSWORD }));
    await env.db.apiToken.create({ data: { name: "Abgelaufen", tokenHash: "h".repeat(64), hint: "sos_zzzz…", userId: (await env.db.user.findFirstOrThrow()).id, expiresAt: new Date(Date.now() - 86_400_000) } });
    const { default: Page } = await import("@/app/(app)/(admin)/admin/api/page");
    const root = await render(await Page());
    const text = plain(root.textContent);
    assert.match(text, /Lesender Zugriff/);
    assert.match(text, /für die Buchhaltung/);
    assert.match(text, /nur lesend/);
    assert.match(text, /Gültig/);
    assert.match(text, /Abgelaufen/);
    assert.match(text, /Passwortwechsel, Notzugang/);
    assert.ok(!root.innerHTML.includes("h".repeat(64)));
    await unmountView();

    await login({ permissions: ["customers.view", "settings.manage"] });
    assert.equal(await redirectOf(() => Page()), "/forbidden");
    env.signOut();
    assert.match((await redirectOf(() => Page())) ?? "", /^\/login/);
  });

  it("Neues Token: Rechte je Ressource, nichts vorgewählt, nur Rechte, die die Schnittstelle nutzt – nie Verwaltung, Mitarbeiter-Sensibles oder Datenaustausch; gekennzeichnete Rechte markiert", async () => {
    await admin();
    const { default: Page } = await import("@/app/(app)/(admin)/admin/api/tokens/new/page");
    const root = await render(await Page());
    const checkboxes = [...root.querySelectorAll<HTMLInputElement>('input[type="checkbox"][name="scope"]')];
    assert.ok(checkboxes.length > 5);
    assert.ok(checkboxes.every((c) => !c.checked), "nichts vorgewählt");
    const values = new Set(checkboxes.map((c) => c.value));
    for (const allowed of ["customers.view", "customers.edit", "customers.delete", "vehicles.view"]) assert.ok(values.has(allowed), allowed);
    for (const forbidden of ["settings.manage", "users.manage", "roles.manage", "backup.manage", "api.manage", "employees.sensitive", "time.viewAll", "customers.export", "customers.import", "mail.send", "customers.privacy"]) assert.ok(!values.has(forbidden), `${forbidden} darf nicht angeboten werden`);
    assert.match(plain(root.textContent), /Alle lesenden Rechte/);
    assert.ok(root.querySelector('input[type="password"][name="password"]'), "erneute Passwortabfrage");
    assert.ok(root.querySelector('textarea[name="allowedNets"]'));
  });

  it("Dienstkonten: Anlegen mit Passwortabfrage, Liste, Formular mit Rollen; das Konto ist in der Benutzerliste gekennzeichnet und dort nicht änderbar; Token-Formular bietet es als Besitzer an; ohne api.manage nicht erreichbar", async () => {
    await admin();
    const role = await env.role({ key: "buero-pages", permissions: ["customers.view"] });
    const wrong = await actions.createServiceAccount({}, form({ name: "Portal", roleId: [role.id], password: "falsch" }));
    assert.ok(wrong && "fieldErrors" in wrong && wrong.fieldErrors?.password, "Passwort wird als Feld bemängelt");
    assert.equal(await env.db.user.count({ where: { authSource: "service" } }), 0);
    assert.equal(await redirectOf(() => actions.createServiceAccount({}, form({ name: "Portal", roleId: [role.id], password: PASSWORD }))), "/admin/api/accounts");
    const account = await env.db.user.findFirstOrThrow({ where: { authSource: "service" } });
    assert.equal(account.passwordHash, null);

    const { default: List } = await import("@/app/(app)/(admin)/admin/api/accounts/page");
    const list = plain((await render(await List())).textContent);
    assert.match(list, /Portal/);
    assert.match(list, /kein Passwort und keine Anmeldung/);
    await unmountView();
    const { default: NewAccount } = await import("@/app/(app)/(admin)/admin/api/accounts/new/page");
    const root = await render(await NewAccount());
    assert.ok(root.querySelector('input[type="password"][name="password"]'), "erneute Passwortabfrage");
    assert.ok(root.querySelector('input[name="roleId"]'), "Rollen zur Wahl");
    const offered = [...root.querySelectorAll('input[name="roleId"]')].map((el) => (el as HTMLInputElement).value);
    const adminIds = (await env.db.role.findMany({ where: { isAdmin: true }, select: { id: true } })).map((r) => r.id);
    assert.ok(adminIds.length > 0 && offered.length > 0 && adminIds.every((id) => !offered.includes(id)), "keine Administrator-Rolle zur Wahl");
    await unmountView();

    // Token-Formular: Besitzer wählbar
    const { default: NewToken } = await import("@/app/(app)/(admin)/admin/api/tokens/new/page");
    const tokenForm = await render(await NewToken());
    assert.ok(tokenForm.querySelector('select[name="ownerId"]'), "Besitzer wählbar, sobald es ein Dienstkonto gibt");
    assert.match(plain(tokenForm.textContent), /Portal \(Dienstkonto\)/);
    await unmountView();

    // Benutzerliste: gekennzeichnet; Detailseite: nicht änderbar
    const { default: Users } = await import("@/app/(app)/(admin)/admin/users/page");
    assert.match(plain((await render(await Users({ searchParams: Promise.resolve({}) } as never))).textContent), /Dienstkonto/);
    await unmountView();
    const { default: UserPage } = await import("@/app/(app)/(admin)/admin/users/[id]/page");
    const detail = await render(await UserPage({ params: Promise.resolve({ id: account.id }), searchParams: Promise.resolve({}) } as never));
    assert.match(plain(detail.textContent), /Dienstkonten werden unter/);
    assert.ok(!detail.querySelector('input[name="password"]'), "kein Passwortfeld für ein Dienstkonto");
    await unmountView();

    // ohne api.manage: weg
    await login({ permissions: ["customers.view"] });
    assert.equal(await redirectOf(() => List()), "/forbidden");
    assert.equal(await redirectOf(() => actions.createServiceAccount({}, form({ name: "X", roleId: [role.id], password: PASSWORD }))), "/forbidden");
  });

  it("Webhooks: Liste mit Zustand und Zustellprotokoll; Detailseite mit Geheimnis-Bereich, Test, Löschen; nie das Geheimnis; Rechte", async () => {
    await admin();
    const created = (await actions.saveWebhook({}, form({ name: "Buchhaltung", url: "https://hook.example.org/x?token=GEHEIM", events: ["order.closed"], password: PASSWORD }))) as { created?: { id: string; secret: string } };
    const id = created.created?.id ?? "";
    await env.db.webhookDelivery.create({ data: { webhookId: id, eventId: "evt_page", type: "order.closed", eventAt: new Date(), status: "failed", attempts: 12, lastStatus: 503, lastDurationMs: 40, completedAt: new Date() } });
    const { default: List } = await import("@/app/(app)/(admin)/admin/api/webhooks/page");
    const list = plain((await render(await List())).textContent);
    assert.match(list, /Buchhaltung/);
    assert.match(list, /hook\.example\.org/);
    assert.match(list, /Aufgegebene Zustellungen: 1/);
    assert.match(list, /HTTP 503/);
    assert.ok(!list.includes("GEHEIM") && !list.includes(created.created?.secret ?? "?"));
    await view?.unmount();

    const { default: Detail } = await import("@/app/(app)/(admin)/admin/api/webhooks/[id]/page");
    const root = await render(await Detail({ params: Promise.resolve({ id }) }));
    const text = plain(root.textContent);
    assert.match(text, /Ein Geheimnis ist gespeichert/);
    assert.match(text, /Test-Ereignis senden/);
    assert.match(text, /Webhook löschen/);
    assert.ok(!root.innerHTML.includes(created.created?.secret ?? "?"), "das Geheimnis steht nie im Dokument");
    assert.equal((root.querySelector('input[name="url"]') as HTMLInputElement).value, "https://hook.example.org/x?token=GEHEIM");
    await unmountView();

    await login({ permissions: ["customers.view"] });
    assert.equal(await redirectOf(async () => Detail({ params: Promise.resolve({ id }) })), "/forbidden");
    assert.equal(await redirectOf(() => List()), "/forbidden");
    await admin();
    const { isNotFound } = await import("@/test/harness");
    assert.equal(await isNotFound(async () => Detail({ params: Promise.resolve({ id: "gibtsnicht" }) })), true);
  });

  it("Neuer Webhook: ohne eingeschaltete Funktionen mit Ereignissen ein Hinweis; mit ihnen die Auswahl je Funktion", async () => {
    await admin();
    const { default: Page } = await import("@/app/(app)/(admin)/admin/api/webhooks/new/page");
    await env.db.featureSetting.deleteMany({ where: { key: { in: ["workshop.orders", "office.billing", "workshop.files", "workshop.checklists"] } } });
    const none = plain((await render(await Page())).textContent);
    assert.match(none, /meldet keine eingeschaltete Funktion Ereignisse/);
    await view?.unmount();
    for (const key of ["workshop.orders", "office.billing"]) await env.db.featureSetting.create({ data: { key, enabled: true, updatedByName: "Test" } });
    const root = await render(await Page());
    const events = [...root.querySelectorAll<HTMLInputElement>('input[type="checkbox"][name="events"]')].map((c) => c.value).sort();
    assert.deepEqual(events, ["billing.accepted", "billing.cancelled", "billing.finalized", "billing.paid", "billing.sent", "order.approved", "order.closed", "order.created", "order.reopened", "order.statusChanged"]);
    assert.match(plain(root.textContent), /Auftrag abgeschlossen/);
  });

  it("Doku-Seite: Überblick mit Konventionen, Versionierung, Webhooks samt Prüfcode; je Ressource eine Seite mit Endpunkten und curl mit Platzhalter – nie ein echtes Token", async () => {
    await admin();
    const { token } = await (await import("@/test/api-helpers")).makeToken(env, { admin: true, scope: ["customers.view"] });
    const { default: Page } = await import("@/app/(app)/(admin)/admin/api/docs/page");
    const overview = await render(await Page({ searchParams: Promise.resolve({}) }));
    const text = plain(overview.textContent);
    for (const part of [/Versionierung/, /Kompatibel und ohne Ankündigung/, /\/v2/, /Idempotency-Key/, /If-Match/, /RateLimit-Remaining/, /X-Webhook-Signature/, /HMAC-SHA256/, /export function verifyWebhook/, /def verify_webhook/, /function verify_webhook/, /Upload \(multipart\/form-data\)/, /Download: the response is the file itself/, /Endpunkte der aktiven Funktionen \(\d+\)/]) assert.match(text, part);
    assert.ok(overview.querySelector('a[href="/admin/api/docs?tag=Customers"]'), "Karte je Ressource");
    assert.ok(!overview.innerHTML.includes(token), "kein echtes Token");
    await view?.unmount();

    const resource = await render(await Page({ searchParams: Promise.resolve({ tag: "Customers" }) }));
    const detail = plain(resource.textContent);
    assert.match(detail, /GET\s*\/customers/);
    assert.match(detail, /POST\s*\/customers/);
    assert.match(detail, /Recht: customers\.view/);
    const code = [...resource.querySelectorAll("pre code")].map((c) => c.textContent ?? "").join("\n");
    assert.match(code, /curl -X GET "https:\/\/<adresse-der-anwendung>\/api\/v1\/customers"/);
    assert.match(code, /Authorization: Bearer <TOKEN>/);
    assert.match(code, /Idempotency-Key: \$\(uuidgen\)/);
    assert.match(code, /If-Match: "<etag>"/);
    assert.ok(!/sos_[A-Za-z0-9_-]{43}/.test(resource.innerHTML), "kein echtes Token in der Doku");
    assert.ok(resource.querySelector('input[name="x"]') === null);
    await unmountView();

    // unbekannte Ressource: wie der Überblick, kein Fehler
    const unknown = await render(await Page({ searchParams: Promise.resolve({ tag: "Gibt es nicht" }) }));
    assert.match(plain(unknown.textContent), /Überblick/);
    await unmountView();

    await login({ permissions: ["customers.view"] });
    assert.equal(await redirectOf(async () => Page({ searchParams: Promise.resolve({}) })), "/forbidden");
  });
});

describe("JSON der Beschreibung (/admin/api/openapi.json)", () => {
  it("nur mit Sitzung und api.manage; ein Token sieht über /api/v1/openapi.json nur die Endpunkte seiner Rechte (Teilmenge der Beschreibung der Verwaltung); ein Token gilt hier nie", async () => {
    const { GET } = await import("@/app/(app)/(admin)/admin/api/openapi.json/route");
    env.signOut();
    assert.equal((await GET()).status, 401);
    await login({ permissions: ["customers.view", "settings.manage"] });
    assert.equal((await GET()).status, 403);
    await admin();
    const response = await GET();
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /^application\/json/);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const doc = (await response.json()) as { openapi: string; paths: Record<string, unknown> };
    assert.equal(doc.openapi, "3.1.0");
    assert.ok("/customers" in doc.paths);

    const { apiRequest, makeToken } = await import("@/test/api-helpers");
    const { handleApiRequest } = await import("@/server/api/router");
    const { token } = await makeToken(env, { admin: true, scope: ["customers.view"] });
    const viaToken = (await (await handleApiRequest(apiRequest("GET", "/openapi.json", { token }))).json()) as { paths: Record<string, unknown> };
    assert.deepEqual(Object.keys(viaToken.paths).sort(), ["/customers", "/customers/{id}"], "nur die Endpunkte, deren Recht das Token trägt");
    assert.ok(Object.keys(viaToken.paths).every((path) => path in doc.paths));

    // ein Token ohne Sitzung erreicht die Seite und das JSON der Verwaltung nicht
    env.signOut();
    env.browser.setHeaders({ authorization: `Bearer ${token}` });
    assert.equal((await GET()).status, 401);
    const { default: Page } = await import("@/app/(app)/(admin)/admin/api/page");
    assert.match((await redirectOf(() => Page())) ?? "", /^\/login/);
    assert.match((await redirectOf(() => actions.createApiToken({}, form({ name: "x", scope: ["customers.view"], password: PASSWORD })))) ?? "", /^\/login/);
    assert.match((await redirectOf(() => actions.saveWebhook({}, form({ name: "x", url: "https://hook.example.org/", events: ["order.closed"] })))) ?? "", /^\/login/);
    env.browser.setHeaders({});
  });
});

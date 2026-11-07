import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createElement, type ReactNode } from "react";
import { installDom, mount, type MountedView, type TestDom } from "@/test/dom";
import { createTestEnv, form, redirectOf, type TestEnv } from "@/test/harness";
import { resolveServerTree } from "@/test/server-tree";
import { plain } from "@/test/ui";

/** Die Seite zum Einrichten des Kalender-Abos im echten Renderer und die Aktionen dahinter (Antwort mit einmaligem Klartext, Passwortabfrage, Rechte). */
let env: TestEnv;
let dom: TestDom;
let view: MountedView | null = null;
let actions: typeof import("./actions");

const PASSWORD = "geheim-passwort-123";
async function login(permissions: readonly string[], username = `p-${Math.random().toString(36).slice(2)}`) {
  const role = await env.role({ permissions });
  env.signOut();
  const user = await env.user({ username, password: PASSWORD, roles: [role] });
  await env.signIn(user);
  return user;
}
async function render(node: ReactNode) {
  const { I18nProvider } = await import("@/i18n/client");
  const { ToastProvider } = await import("@/components/ui/toast");
  const { de } = await import("@/i18n/messages/de");
  view = await mount(createElement(I18nProvider, { locale: "de", messages: de } as never, createElement(ToastProvider, null, await resolveServerTree(node))));
  return view.container;
}

before(async () => {
  dom = installDom();
  env = await createTestEnv();
  actions = await import("./actions");
});
after(async () => {
  await view?.unmount();
  await dom.close();
  await env.cleanup();
});

describe("Aktionen", () => {
  it("createFeed: die Antwort trägt den Klartext einmal; falsches Passwort ist ein Feldfehler und legt nichts an; ohne Recht Weiterleitung", async () => {
    const user = await login(["appointments.view"]);
    const wrong = await actions.createFeed({}, form({ password: "falsch", expires: "never" }));
    assert.ok(wrong && "fieldErrors" in wrong && wrong.fieldErrors?.password, "Passwort wird als Feld bemängelt");
    assert.equal(await env.db.calendarFeedToken.count({ where: { userId: user.id } }), 0);

    const ok = (await actions.createFeed({}, form({ password: PASSWORD, expires: "90" }))) as { ok?: boolean; feed?: { token: string }; message?: string };
    assert.equal(ok.ok, true);
    assert.match(ok.feed?.token ?? "", /^cal_[A-Za-z0-9_-]{43}$/);
    assert.equal(ok.message, "Abo-Adresse erzeugt. Sie wird nur jetzt angezeigt – bitte in die Kalender-App kopieren.");
    assert.equal(await env.db.calendarFeedToken.count({ where: { userId: user.id } }), 1);

    await login(["vehicles.view"]);
    assert.equal(await redirectOf(() => actions.createFeed({}, form({ password: PASSWORD, expires: "never" }))), "/forbidden");
  });

  it("revokeFeed: mit Passwort; danach gibt es keinen Stand mehr", async () => {
    const user = await login(["appointments.view"]);
    await actions.createFeed({}, form({ password: PASSWORD, expires: "never" }));
    const wrong = await actions.revokeFeed({}, form({ password: "falsch" }));
    assert.ok(wrong && "fieldErrors" in wrong && wrong.fieldErrors?.password);
    assert.equal(await env.db.calendarFeedToken.count({ where: { userId: user.id } }), 1);
    const done = await actions.revokeFeed({}, form({ password: PASSWORD }));
    assert.equal((done as { ok?: boolean }).ok, true);
    assert.equal(await env.db.calendarFeedToken.count({ where: { userId: user.id } }), 0);
  });
});

describe("Seite /appointments/feed", () => {
  it("ohne Abo: Hinweise, Erzeugen-Formular mit Passwort und Gültigkeit, kein Widerrufen; ohne eingestellte Adresse der Hinweis (mit Link nur für die Verwaltung)", async () => {
    await login(["appointments.view", "settings.manage"]);
    await env.db.appSetting.deleteMany({ where: { key: "app.publicUrl" } });
    const { default: Page } = await import("@/app/(app)/(workshop)/appointments/feed/page");
    const root = await render(await Page());
    const text = plain(root.textContent);
    assert.match(text, /Es gibt noch kein Kalender-Abo/);
    assert.match(text, /Die Abo-Adresse ist ein Geheimnis/);
    assert.match(text, /Termine mit Bezeichnung, Zeit, Kennzeichen/);
    assert.match(text, /nur als „abwesend“/);
    assert.ok(root.querySelector("input[name='password'][type='password']"));
    assert.ok(root.querySelector("select[name='expires']"));
    assert.equal(root.querySelectorAll("input[name='password']").length, 1, "Widerrufen gibt es erst mit einem Abo");
    assert.match(text, /noch keine Adresse der Anwendung/);
    assert.ok(root.querySelector("a[href='/settings?tab=security']"));
  });

  it("mit Abo: Kennung, Ablauf und letzter Abruf – nie der Klartext; Erneuern und Widerrufen mit Passwort", async () => {
    const user = await login(["appointments.view"]);
    const created = (await actions.createFeed({}, form({ password: PASSWORD, expires: "90" }))) as { feed: { token: string } };
    await env.db.calendarFeedToken.update({ where: { userId: user.id }, data: { lastUsedAt: new Date("2026-11-05T10:00:00Z") } });
    await env.db.appSetting.upsert({ where: { key: "app.publicUrl" }, update: { value: "https://werkstatt.example" }, create: { key: "app.publicUrl", value: "https://werkstatt.example" } });
    const { default: Page } = await import("@/app/(app)/(workshop)/appointments/feed/page");
    await view?.unmount();
    const root = await render(await Page());
    const html = root.innerHTML;
    const text = plain(root.textContent);
    assert.match(text, /Abo eingerichtet am/);
    assert.match(text, /Gültig bis/);
    assert.match(text, /Zuletzt abgerufen: 05\.11\.2026/);
    assert.ok(text.includes(`Kennung ${created.feed.token.slice(0, 8)}…`));
    assert.ok(!html.includes(created.feed.token), "der Klartext steht nicht auf der Seite");
    assert.match(text, /Neue Abo-Adresse erzeugen/);
    assert.match(text, /Abo widerrufen/);
    assert.equal(root.querySelectorAll("input[name='password']").length, 2, "Erneuern und Widerrufen fragen je das Passwort");
    assert.doesNotMatch(text, /noch keine Adresse der Anwendung/);
    await env.db.appSetting.deleteMany({ where: { key: "app.publicUrl" } });
  });

  it("abgelaufene Adresse wird als abgelaufen gemeldet; ohne `appointments.view` Weiterleitung", async () => {
    const user = await login(["appointments.view"]);
    await actions.createFeed({}, form({ password: PASSWORD, expires: "90" }));
    await env.db.calendarFeedToken.update({ where: { userId: user.id }, data: { expiresAt: new Date("2026-01-01T00:00:00Z") } });
    const { default: Page } = await import("@/app/(app)/(workshop)/appointments/feed/page");
    await view?.unmount();
    const root = await render(await Page());
    assert.match(plain(root.textContent), /Abgelaufen am 01\.01\.2026/);
    await view!.unmount();
    view = null;
    await login(["vehicles.view"]);
    assert.equal(await redirectOf(() => Page()), "/forbidden");
  });
});

describe("FeedCard im Renderer: einmalige Anzeige der Adresse", () => {
  it("nach dem Erzeugen steht die Adresse verborgen im SecretField (einmalig), der Knopf „In der Kalender-App öffnen“ nur solange sie da ist; Ausblenden wirft beides weg", async () => {
    const { click, type, wait, byText } = await import("@/test/ui");
    const user = await login(["appointments.view"]);
    const { FeedCard } = await import("./feed-card");
    await view?.unmount();
    const root = await render(createElement(FeedCard, { status: null, base: "https://werkstatt.example" } as never));
    await type(root.querySelector("input[name='password']") as HTMLInputElement, PASSWORD);
    await click(byText(root, "button", /^Abo-Adresse erzeugen$/));
    await wait(400);
    assert.match(plain(root.textContent), /Wird nur einmal angezeigt/, plain(root.textContent));
    assert.equal(await env.db.calendarFeedToken.count({ where: { userId: user.id } }), 1);
    const hidden = root.innerHTML;
    assert.ok(!/cal_[A-Za-z0-9_-]{43}/.test(hidden), "verborgen: der Klartext steht nicht im Dokument");
    assert.ok(byText(root, "button", /In der Kalender-App öffnen/), "Knopf für den webcal-Link (die Adresse steht nicht als Link im Dokument)");
    await click(byText(root, "button", /^Anzeigen$/));
    const shown = (root.querySelector("input[readonly], input[data-no-draft]") as HTMLInputElement | null)?.value ?? "";
    assert.match(shown, /^https:\/\/werkstatt\.example\/api\/ical\/cal_[A-Za-z0-9_-]{43}\.ics$/);
    await click(byText(root, "button", /Ausblenden/));
    assert.ok(!/cal_[A-Za-z0-9_-]{43}/.test(root.innerHTML), "ausgeblendet: nirgends mehr");
    assert.equal(byText(root, "button", /In der Kalender-App öffnen/), undefined, "auch der Knopf ist weg");
  });
});

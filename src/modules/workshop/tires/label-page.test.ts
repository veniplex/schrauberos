import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createElement, type ReactNode } from "react";
import { installDom, mount, type MountedView, type TestDom } from "@/test/dom";
import { createTestEnv, isNotFound, type TestEnv } from "@/test/harness";
import { resolveServerTree } from "@/test/server-tree";
import { plain } from "@/test/ui";

/** Die Druckseite des Reifenlager-Etiketts (F8) im echten Renderer: Format, Vorschau in Originalgröße, Hinweis ohne Adresse, A4-Bogen, Art. 18. */
let env: TestEnv;
let dom: TestDom;
let view: MountedView | null = null;
let ids: { set: string; restricted: string };

async function login(permissions: readonly string[]) {
  const role = await env.role({ permissions });
  env.signOut();
  await env.signIn(await env.user({ username: `l-${Math.random().toString(36).slice(2)}`, roles: [role] }));
  return (await (await import("@/server/auth/session")).getSession())!;
}

before(async () => {
  dom = installDom();
  env = await createTestEnv();
  const owner = await env.db.customer.create({ data: { firstName: "Erika", lastName: "Muster", nameKey: "erika muster" } });
  const restricted = await env.db.customer.create({ data: { lastName: "Gesperrt", processingRestrictedAt: new Date() } });
  const car = await env.db.vehicle.create({ data: { plate: "B-AB 1234", plateNorm: "BAB1234", customerId: owner.id } });
  const locked = await env.db.vehicle.create({ data: { plate: "B-GS 9", plateNorm: "BGS9", customerId: restricted.id } });
  ids = {
    set: (await env.db.tireSet.create({ data: { vehicleId: car.id, season: "winter", storageLocation: "Halle A / Regal 3" } })).id,
    restricted: (await env.db.tireSet.create({ data: { vehicleId: locked.id, season: "summer" } })).id,
  };
});
after(async () => {
  await view?.unmount();
  await dom.close();
  await env.cleanup();
});

describe("Seite /tires/[id]/label", () => {
  async function render(node: ReactNode) {
    const { I18nProvider } = await import("@/i18n/client");
    const { ToastProvider } = await import("@/components/ui/toast");
    const { de } = await import("@/i18n/messages/de");
    view = await mount(createElement(I18nProvider, { locale: "de", messages: de } as never, createElement(ToastProvider, null, await resolveServerTree(node))));
    return view.container;
  }

  it("zeigt Format-Auswahl, PDF-Wege und die Etiketten in Originalgröße; Hinweis ohne Adresse (mit Link nur für die Verwaltung)", async () => {
    await login(["tires.view", "settings.manage"]);
    await env.db.appSetting.deleteMany({ where: { key: "app.publicUrl" } });
    const { default: Page } = await import("@/app/(app)/(workshop)/tires/[id]/label/page");
    const root = await render(await Page({ params: Promise.resolve({ id: ids.set }), searchParams: Promise.resolve({ format: "100x50", copies: "2" }) }));
    const text = plain(root.textContent);
    assert.match(text, /Etikett drucken/);
    assert.match(text, /ohne QR-Code/);
    assert.ok(root.querySelector("a[href='/settings?tab=security']"), "Verwaltung bekommt den Link zur Einstellung");
    const cells = root.querySelectorAll("[data-label-cell='label']");
    assert.equal(cells.length, 2);
    assert.equal((cells[0] as HTMLElement).style.width, "100mm");
    assert.equal((cells[0] as HTMLElement).style.height, "50mm");
    assert.match(plain(cells[0].textContent), /B-AB 1234/);
    assert.equal(cells[0].querySelector("svg"), null, "ohne Adresse kein QR");
    assert.ok(root.querySelector("a[href^='/api/tires/'][href*='format=100x50'][href*='copies=2']"), "PDF öffnen mit denselben Parametern");
    assert.ok(root.querySelector("select[name='format']"));
    assert.ok(root.querySelector(".no-print"), "Werkzeuge und Hinweise erscheinen nicht im Ausdruck");
    await view!.unmount();

    await env.db.appSetting.create({ data: { key: "app.publicUrl", value: "https://werkstatt.example" } });
    const withQr = await render(await Page({ params: Promise.resolve({ id: ids.set }), searchParams: Promise.resolve({}) }));
    assert.ok(withQr.querySelector("[data-label-cell='label'] svg[role='img']"), "mit Adresse ein QR-Code");
    assert.doesNotMatch(plain(withQr.textContent), /ohne QR-Code/);
    await env.db.appSetting.deleteMany({ where: { key: "app.publicUrl" } });
  });

  it("A4-Bogen: ausgelassene Felder bleiben leer; eingeschränkter Kunde: 404", async () => {
    await login(["tires.view"]);
    const { default: Page } = await import("@/app/(app)/(workshop)/tires/[id]/label/page");
    await view?.unmount();
    const root = await render(await Page({ params: Promise.resolve({ id: ids.set }), searchParams: Promise.resolve({ format: "sheet-3x8", skip: "5" }) }));
    assert.equal(root.querySelectorAll("[data-label-cell='empty']").length, 5);
    assert.equal(root.querySelectorAll("[data-label-cell='label']").length, 1);
    assert.equal(root.querySelector("a[href='/settings?tab=security']"), null, "ohne Verwaltungsrecht kein Link, nur der Hinweis");
    await view!.unmount();
    view = null;
    assert.equal(await isNotFound(() => Page({ params: Promise.resolve({ id: ids.restricted }), searchParams: Promise.resolve({}) })), true);
  });

  it("Anzahl und Überspringen außerhalb der Grenzen werden geklemmt und genannt (nicht still auf den Standard gesetzt); Texte werden mit „…“ gekürzt statt still abgeschnitten", async () => {
    await login(["tires.view"]);
    const { default: Page } = await import("@/app/(app)/(workshop)/tires/[id]/label/page");
    await view?.unmount();
    const root = await render(await Page({ params: Promise.resolve({ id: ids.set }), searchParams: Promise.resolve({ format: "sheet-3x8", copies: "30", skip: "99" }) }));
    const text = plain(root.textContent);
    assert.match(text, /Verlangt waren 30 Etiketten – es sind höchstens 24 je Druck/);
    assert.match(text, /Verlangt waren 99 übersprungene Felder – möglich sind 0 bis 23/);
    assert.equal(root.querySelectorAll("[data-label-cell='empty']").length, 23);
    assert.equal(root.querySelectorAll("[data-label-cell='label']").length, 24, "24 Etiketten: eins auf dem ersten Bogen (23 Felder übersprungen), 23 auf dem zweiten");
    const title = root.querySelector(".print-label-title") as HTMLElement;
    assert.equal(title.style.getPropertyValue("--label-lines"), "1", "Zeilenzahl je Format; globals.css kürzt mit … (line-clamp)");
    assert.equal((root.querySelector(".print-label-body") as HTMLElement).style.getPropertyValue("--label-lines"), "8");
    assert.match(plain(text), /tatsächlicher Größe/);
    await view!.unmount();
    view = null;
    const plainRoot = await render(await Page({ params: Promise.resolve({ id: ids.set }), searchParams: Promise.resolve({ copies: "2" }) }));
    assert.doesNotMatch(plain(plainRoot.textContent), /Verlangt waren/, "kein Hinweis ohne Abweichung");
  });
});

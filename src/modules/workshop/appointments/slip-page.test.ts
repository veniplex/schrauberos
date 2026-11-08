import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createElement, type ReactNode } from "react";
import { resetWorkshopZone, setWorkshopZone } from "@/lib/zone";
import { installDom, mount, type MountedView, type TestDom } from "@/test/dom";
import { createTestEnv, isNotFound, type TestEnv } from "@/test/harness";
import { resolveServerTree } from "@/test/server-tree";
import { plain } from "@/test/ui";

/** Die Druckseite des Terminzettels (F8) im echten Renderer: Papier, Notizen nur auf Wunsch, kein Internes, Art. 18. */
let env: TestEnv;
let dom: TestDom;
let view: MountedView | null = null;
let ids: { slip: string; restricted: string };

async function login(permissions: readonly string[]) {
  const role = await env.role({ permissions });
  env.signOut();
  await env.signIn(await env.user({ username: `p-${Math.random().toString(36).slice(2)}`, roles: [role] }));
}
async function render(node: ReactNode) {
  const { I18nProvider } = await import("@/i18n/client");
  const { ToastProvider } = await import("@/components/ui/toast");
  const { de } = await import("@/i18n/messages/de");
  view = await mount(createElement(I18nProvider, { locale: "de", messages: de } as never, createElement(ToastProvider, null, await resolveServerTree(node))));
  return view.container;
}

before(async () => {
  // Die Erwartungen (09:00 Uhr für 08:00 UTC) gelten in der Zone der Werkstatt Europe/Berlin – nicht in der des Prozesses (CI und Container laufen in UTC)
  setWorkshopZone("Europe/Berlin");
  dom = installDom();
  env = await createTestEnv();
  const owner = await env.db.customer.create({ data: { firstName: "Erika", lastName: "Muster", phone: "0151 123456", nameKey: "erika muster" } });
  const restricted = await env.db.customer.create({ data: { lastName: "Gesperrt", processingRestrictedAt: new Date() } });
  const car = await env.db.vehicle.create({ data: { plate: "B-AB 1234", plateNorm: "BAB1234", make: "VW", model: "Golf", customerId: owner.id } });
  const bay = await env.db.bay.create({ data: { name: "Hebebühne 7" } });
  ids = {
    slip: (await env.db.appointment.create({ data: { title: "Räderwechsel", startsAt: new Date("2026-11-09T08:00:00Z"), endsAt: new Date("2026-11-09T09:30:00Z"), notes: "INTERN: Kunde zahlt spät", bayId: bay.id, vehicleId: car.id } })).id,
    restricted: (await env.db.appointment.create({ data: { title: "Gesperrt", startsAt: new Date("2026-11-09T08:00:00Z"), endsAt: new Date("2026-11-09T09:00:00Z"), customerId: restricted.id } })).id,
  };
});
after(async () => {
  resetWorkshopZone();
  await view?.unmount();
  await dom.close();
  await env.cleanup();
});

describe("Seite /appointments/[id]/slip", () => {
  it("zeigt den Zettel im gewählten Papier ohne Notizen, ohne Arbeitsplatz; das Telefon nur mit `customers.view`", async () => {
    await login(["appointments.view"]);
    const { default: Page } = await import("@/app/(app)/(workshop)/appointments/[id]/slip/page");
    const root = await render(await Page({ params: Promise.resolve({ id: ids.slip }), searchParams: Promise.resolve({ size: "a6" }) }));
    const text = plain(root.textContent);
    assert.ok(root.querySelector(".print-a6"));
    assert.match(text, /Montag, 9\. November 2026/);
    assert.match(text, /09:00 – 10:30 Uhr/);
    assert.match(text, /B-AB 1234 · VW Golf/);
    assert.match(text, /Erika Muster/);
    for (const internal of ["INTERN", "Hebebühne", "0151 123456"]) assert.ok(!text.includes(internal), `${internal} gehört nicht auf den Zettel`);
    assert.ok(root.querySelector("a[href^='/api/appointments/'][href*='/slip?size=a6']"));
    assert.ok(root.querySelector("input[name='notes']"), "Notizen sind ein ausdrücklicher Wunsch");
    await view!.unmount();

    await login(["appointments.view", "customers.view"]);
    const withNotes = await render(await Page({ params: Promise.resolve({ id: ids.slip }), searchParams: Promise.resolve({ notes: "1" }) }));
    const noted = plain(withNotes.textContent);
    assert.match(noted, /INTERN: Kunde zahlt spät/);
    assert.match(noted, /0151 123456/);
    assert.ok(withNotes.querySelector("a[href*='/slip?size=a5&notes=1']") || withNotes.querySelector("a[href*='notes=1']"));
  });

  it("Termine eingeschränkt verarbeiteter Kunden gibt es nicht (404)", async () => {
    await login(["appointments.view"]);
    const { default: Page } = await import("@/app/(app)/(workshop)/appointments/[id]/slip/page");
    assert.equal(await isNotFound(() => Page({ params: Promise.resolve({ id: ids.restricted }), searchParams: Promise.resolve({}) })), true);
  });
});

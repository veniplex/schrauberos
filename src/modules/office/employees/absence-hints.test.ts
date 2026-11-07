import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import { createElement } from "react";
import { installDom, mount, sleep, type MountedView, type TestDom } from "@/test/dom";

/** Hinweisliste im Abwesenheitsformular: holt die Hinweise beim Öffnen (Vorbelegung aus dem Raster), zeigt Krankheit nur neutral, schweigt ohne Treffer und bei Fehlern. */
let dom: TestDom;
let view: MountedView | null = null;
const realFetch = globalThis.fetch;
const calls: string[] = [];
let reply: unknown = { duplicate: false, overlaps: [] };
let ok = true;

before(() => {
  dom = installDom();
  globalThis.fetch = (async (url: string) => {
    calls.push(String(url));
    return { ok, json: async () => reply } as Response;
  }) as typeof fetch;
});
after(async () => {
  globalThis.fetch = realFetch;
  await dom.close();
});
afterEach(async () => {
  await view?.unmount();
  view = null;
  calls.length = 0;
  reply = { duplicate: false, overlaps: [] };
  ok = true;
});

async function mountList(props: { employeeId: string; type: string; start: string; end: string }) {
  const { AbsenceHintList } = await import("./absence-hints");
  const { I18nProvider } = await import("@/i18n/client");
  const { de } = await import("@/i18n/messages/de");
  const element = (p: typeof props) => createElement(I18nProvider, { locale: "de", messages: de } as never, createElement(AbsenceHintList, p));
  view = await mount(element(props));
  return { rerender: (p: typeof props) => view!.render(element(p)) };
}

describe("AbsenceHintList", () => {
  it("fragt beim Öffnen ab (Vorbelegung) und listet Überschneidungen ruhig auf; Krankheit nur als „abwesend“", async () => {
    reply = { duplicate: false, overlaps: [{ start: "2030-07-08", end: "2030-07-12", type: "vacation" }, { start: "2030-07-10", end: "2030-07-10", type: "masked" }] };
    await mountList({ employeeId: "e1", type: "vacation", start: "2030-07-09", end: "2030-07-15" });
    await sleep(400);
    assert.equal(calls.length, 1);
    assert.match(calls[0], /\/api\/employees\/absence-hints\?employeeId=e1&type=vacation&start=2030-07-09&end=2030-07-15/);
    const text = view!.container.textContent ?? "";
    assert.match(text, /schon etwas eingetragen/);
    assert.match(text, /Urlaub/);
    assert.match(text, /abwesend/);
    assert.equal(/krank/i.test(text), false);
    assert.match(text, /Speichern ist trotzdem möglich/);
  });

  it("exakte Dublette: Warnung statt Hinweis", async () => {
    reply = { duplicate: true, overlaps: [{ start: "2030-07-09", end: "2030-07-15", type: "vacation" }] };
    await mountList({ employeeId: "e1", type: "vacation", start: "2030-07-09", end: "2030-07-15" });
    await sleep(400);
    assert.match(view!.container.textContent ?? "", /nicht noch einmal speichern/);
  });

  it("ohne Treffer, ohne Person oder bei Fehlern: nichts (und ohne Person keine Abfrage)", async () => {
    await mountList({ employeeId: "", type: "vacation", start: "2030-07-09", end: "2030-07-15" });
    await sleep(400);
    assert.equal(calls.length, 0);
    assert.equal(view!.container.querySelector("[data-testid='absence-hints']"), null);
  });

  it("Änderung der Daten fragt neu ab; ein Serverfehler zeigt nichts", async () => {
    const m = await mountList({ employeeId: "e1", type: "vacation", start: "2030-07-09", end: "2030-07-15" });
    await sleep(400);
    ok = false;
    await m.rerender({ employeeId: "e2", type: "vacation", start: "2030-07-09", end: "2030-07-15" });
    await sleep(400);
    assert.equal(calls.length, 2);
    assert.equal(view!.container.querySelector("[data-testid='absence-hints']"), null);
  });
});

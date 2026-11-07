import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import { createElement, type ReactElement } from "react";
import { act, installDom, mount, sleep, type MountedView, type TestDom } from "@/test/dom";
import { withRouter } from "@/test/router";
import type { PreviewResponse } from "@/server/csv/types";

/**
 * Export- und Importfeld in einem echten Renderer (react-dom/client + happy-dom, `fetch` ersetzt): Der Import geht in zwei Schritten (Vorschau, dann bestätigen), die Anwendung gilt
 * der Datei der Vorschau (Prüfsumme), Zeilenfehler blockieren das Anwenden, solange „Fehlerhafte Zeilen überspringen“ nicht gewählt ist; der Export zeigt Fehlermeldungen des Servers
 * im Feld statt einer rohen Antwortseite.
 */
let dom: TestDom;
let view: MountedView | null = null;
const realFetch = globalThis.fetch;

before(() => {
  dom = installDom();
});
after(async () => {
  await dom.close();
  globalThis.fetch = realFetch;
});
afterEach(async () => {
  await view?.unmount();
  view = null;
  globalThis.fetch = realFetch;
});

async function withProviders(child: ReactElement) {
  const { I18nProvider } = await import("@/i18n/client");
  const { de } = await import("@/i18n/messages/de");
  return withRouter(createElement(I18nProvider, { locale: "de", messages: de } as never, child));
}

const previewBody = (over: Partial<PreviewResponse> = {}): PreviewResponse => ({
  mode: "preview",
  digest: "abc",
  encoding: "utf-8",
  delimiter: ";",
  columns: [
    { header: "Nachname", label: "Nachname", note: null },
    { header: "Foo", label: null, note: "Unbekannte Spalte, wird ignoriert." },
  ],
  missing: [],
  counts: { rows: 3, create: 2, duplicate: 0, error: 1, forced: 0 },
  formulaLike: 0,
  rows: [{ line: 3, status: "error", label: "Kaputt", messages: ["E-Mail: Bitte eine gültige E-Mail-Adresse eingeben"], forced: false }],
  truncated: false,
  canApply: true,
  ...over,
});

type Call = { url: string; fields: Record<string, string>; headers: Record<string, string> };
function fakeFetch(respond: (call: Call) => { status?: number; body: unknown }) {
  const calls: Call[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const fields: Record<string, string> = {};
    if (init.body instanceof FormData) for (const [k, v] of init.body) fields[k] = typeof v === "string" ? v : `file:${(v as File).name}`;
    const call = { url, fields, headers: Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>)) };
    calls.push(call);
    const { status = 200, body } = respond(call);
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return calls;
}

const text = (view: MountedView) => view.container.textContent ?? "";
const button = (view: MountedView, label: RegExp) => [...view.container.querySelectorAll("button")].find((b) => label.test(b.textContent ?? "")) as HTMLButtonElement | undefined;
async function click(view: MountedView, label: RegExp) {
  const b = button(view, label);
  assert.ok(b, `Knopf ${label} fehlt: ${text(view)}`);
  await act(() => b.click());
  await sleep(0);
}
async function choose(view: MountedView, name = "daten.csv") {
  const input = view.container.querySelector("input[type='file']") as HTMLInputElement;
  // die Datei des DOM (happy-dom), nicht die von Node: dessen FormData würde eine fremde Datei als Text einsetzen
  const file = new window.File(["Nachname\nA"], name, { type: "text/csv" });
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await act(() => void input.dispatchEvent(new window.Event("change", { bubbles: true })));
}

async function mountImport(props: Record<string, unknown> = {}) {
  const { ImportPanel } = await import("./import-panel");
  view = await mount(
    await withProviders(createElement(ImportPanel as never, { kind: "customers", duplicateOverride: false, columns: [{ label: "Nachname", required: false }], rules: "Regeln dieser Datenart.", ...props })),
  );
  return view;
}

describe("Importfeld", () => {
  it("Vorschau zuerst, dann bestätigen; die Anwendung bekommt die Prüfsumme der Vorschau; der Ort ist /api/exchange/<art>/import mit dem eigenen Header", async () => {
    const calls = fakeFetch((call) => (call.fields.mode === "preview" ? { body: previewBody({ counts: { rows: 2, create: 2, duplicate: 0, error: 0, forced: 0 }, rows: [] }) } : { body: { mode: "apply", created: 2, skipped: 0, errors: 0 } }));
    const v = await mountImport();
    assert.match(text(v), /Regeln dieser Datenart/);
    assert.ok(button(v, /Vorschau erstellen/)?.disabled, "ohne Datei keine Vorschau");
    await choose(v);
    await click(v, /Vorschau erstellen/);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "/api/exchange/customers/import");
    assert.equal(calls[0].headers["x-requested-with"], "schrauberos");
    assert.equal(calls[0].fields.mode, "preview");
    assert.match(text(v), /Neu anzulegen/);
    assert.match(text(v), /Zeichensatz utf-8, Trennzeichen ;/);
    await click(v, /Jetzt importieren/);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].fields.mode, "apply");
    assert.equal(calls[1].fields.digest, "abc");
    assert.equal(calls[1].fields.file, "file:daten.csv");
    assert.match(text(v), /Import abgeschlossen/);
    assert.match(text(v), /2 angelegt, 0 als Dublette übersprungen, 0 fehlerhafte Zeilen übersprungen/);
  });

  it("Zeilenfehler: Meldung je Zeile, Anwenden gesperrt, bis „Fehlerhafte Zeilen überspringen“ gewählt ist (dann neue Vorschau)", async () => {
    const calls = fakeFetch(() => ({ body: previewBody() }));
    const v = await mountImport();
    await choose(v);
    await click(v, /Vorschau erstellen/);
    assert.match(text(v), /E-Mail: Bitte eine gültige E-Mail-Adresse eingeben/);
    assert.match(text(v), /Es gibt 1 fehlerhafte Zeilen/);
    assert.ok(button(v, /Jetzt importieren/)?.disabled);
    const skip = [...v.container.querySelectorAll("input[type='checkbox']")].find((c) => (c.closest("label")?.textContent ?? "").includes("überspringen")) as HTMLInputElement;
    await act(() => skip.click());
    await sleep(0);
    assert.equal(calls.at(-1)?.fields.skipErrors, "1", "die Vorschau wird mit der Option neu gerechnet");
    assert.ok(!button(v, /Jetzt importieren/)?.disabled);
  });

  it("fehlende Pflichtspalte und ein Server-Dateifehler stehen verständlich da", async () => {
    fakeFetch(() => ({ body: previewBody({ missing: ["Kennzeichen"], canApply: false, counts: { rows: 1, create: 0, duplicate: 0, error: 0, forced: 0 }, rows: [] }) }));
    const v = await mountImport();
    await choose(v);
    await click(v, /Vorschau erstellen/);
    assert.match(text(v), /Pflichtspalten fehlen: Kennzeichen/);
    assert.ok(button(v, /Jetzt importieren/)?.disabled);

    fakeFetch(() => ({ status: 422, body: { error: "binary", message: "Das ist keine Textdatei." } }));
    await click(v, /Vorschau erstellen/);
    assert.match(text(v), /Das ist keine Textdatei\./);
    assert.ok(!button(v, /Jetzt importieren/), "ohne Vorschau gibt es nichts zu bestätigen");
  });

  it("Dubletten trotzdem anlegen gibt es nur bei Arten, die es anbieten", async () => {
    const v = await mountImport({ duplicateOverride: false });
    assert.ok(!text(v).includes("Dubletten trotzdem anlegen"));
    await v.unmount();
    view = null;
    const calls = fakeFetch(() => ({ body: previewBody() }));
    const v2 = await mountImport({ duplicateOverride: true });
    assert.match(text(v2), /Dubletten trotzdem anlegen/);
    await choose(v2);
    const dup = [...v2.container.querySelectorAll("input[type='checkbox']")].find((c) => (c.closest("label")?.textContent ?? "").includes("Dubletten")) as HTMLInputElement;
    await act(() => dup.click());
    await click(v2, /Vorschau erstellen/);
    assert.equal(calls.at(-1)?.fields.allowDuplicates, "1");
  });
});

describe("Exportfeld", () => {
  it("lädt per fetch mit dem eigenen Header, schickt Format und feste Filter, meldet den Dateinamen", async () => {
    const urls: string[] = [];
    const headers: Array<Record<string, string>> = [];
    let created = 0;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      urls.push(url);
      headers.push(init.headers as Record<string, string>);
      return new Response("a;b\r\n", { status: 200, headers: { "content-disposition": `attachment; filename="kunden-2026-11-07.csv"` } });
    }) as typeof fetch;
    (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => `blob:${++created}`;
    (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};
    const { ExportPanel } = await import("./export-panel");
    view = await mount(await withProviders(createElement(ExportPanel as never, { kind: "vehicles", defaultFormat: "excel-de", fixed: { q: "BAB", inspection: "soon" } })));
    await click(view, /CSV-Datei herunterladen/);
    await sleep(10);
    assert.equal(urls.length, 1);
    const url = new URL(urls[0], "http://localhost");
    assert.equal(url.pathname, "/api/exchange/vehicles");
    assert.deepEqual(Object.fromEntries(url.searchParams), { q: "BAB", inspection: "soon", format: "excel-de" });
    assert.equal(headers[0]["x-requested-with"], "schrauberos");
    assert.match(text(view), /„kunden-2026-11-07\.csv“ wurde heruntergeladen/);
    assert.equal(created, 1);
  });

  it("Fehlermeldung des Servers erscheint im Feld", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ error: "tooMany", message: "Zu viele Zeilen für einen Export." }), { status: 413 })) as typeof fetch;
    const { ExportPanel } = await import("./export-panel");
    view = await mount(await withProviders(createElement(ExportPanel as never, { kind: "customers", defaultFormat: "international" })));
    await click(view, /CSV-Datei herunterladen/);
    await sleep(10);
    assert.match(text(view), /Zu viele Zeilen für einen Export\./);
  });
});

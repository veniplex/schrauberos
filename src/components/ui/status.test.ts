import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import Module from "node:module";
import { createElement, type ReactElement } from "react";
import { TriangleAlert } from "lucide-react";
import { act, installDom, mount, type MountedView, type TestDom } from "@/test/dom";

/** Status- und Wartezustände in einem echten Renderer: Fokus, Titel, Landmarken, Live-Region. */
let dom: TestDom;
let view: MountedView | null = null;

before(() => {
  dom = installDom();
});
after(async () => {
  await dom.close();
});
afterEach(async () => {
  await view?.unmount();
  view = null;
  document.title = "";
});

async function withI18n(child: ReactElement) {
  const { I18nProvider } = await import("@/i18n/client");
  const { de } = await import("@/i18n/messages/de");
  return createElement(I18nProvider, { locale: "de", messages: de } as never, child);
}

describe("StatusPage", () => {
  it("Vollbild: die Seite ist das <main>; die Überschrift hat den Fokus und setzt den Seitentitel", async () => {
    const { StatusPage } = await import("./status-page");
    view = await mount(createElement(StatusPage, { icon: TriangleAlert, title: "Seite nicht gefunden", status: "not-found", fullscreen: true }, "Text"));
    const main = view.container.querySelector("main");
    assert.ok(main, "Vollbild ist das <main>");
    assert.equal(main.getAttribute("data-status"), "not-found");
    const h1 = view.container.querySelector("h1");
    assert.equal(h1?.textContent, "Seite nicht gefunden");
    assert.equal(document.activeElement, h1);
    assert.equal(document.title, "Seite nicht gefunden");
  });

  it("im Anwendungsrahmen kein zweites <main>; Fehlerseiten (danger) sind eine Live-Region, neutrale nicht", async () => {
    const { StatusPage } = await import("./status-page");
    view = await mount(
      createElement("div", null, [
        createElement(StatusPage, { key: "a", icon: TriangleAlert, title: "Fehler", tone: "danger", status: "error" }),
        createElement(StatusPage, { key: "b", icon: TriangleAlert, title: "Hinweis" }),
      ]),
    );
    assert.equal(view.container.querySelectorAll("main").length, 0);
    const alerts = [...view.container.querySelectorAll("[role='alert']")];
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].querySelector("h1")?.textContent, "Fehler");
  });
});

describe("Fehlerseite des Wurzel-Layouts (global-error)", () => {
  it("trägt data-status=error, damit die Browser-CI sie erkennt", async () => {
    // Das Layout bindet globals.css ein: im Test ohne Wirkung
    const extensions = (Module as unknown as { _extensions: Record<string, (module: { exports: unknown }) => void> })._extensions;
    extensions[".css"] ??= (module) => void (module.exports = {});
    const { renderToStaticMarkup } = await import("react-dom/server");
    const GlobalError = (await import("@/app/global-error")).default;
    const html = renderToStaticMarkup(createElement(GlobalError, { error: new Error("x"), retry: () => {} } as never));
    assert.match(html, /data-status="error"/);
    assert.match(html, /<main/);
    assert.match(html, /role="alert"/);
  });
});

describe("Wartezustand: Live-Region und Link-Symbol", () => {
  it("die Live-Region ist von Anfang an im DOM (leer) und sagt eine laufende Navigation an", async () => {
    const { NavProgress, useReportNavigationPending } = await import("./nav-progress");
    function Pending({ on }: { on: boolean }) {
      useReportNavigationPending(on);
      return null;
    }
    view = await mount(await withI18n(createElement("div", null, createElement(NavProgress), createElement(Pending, { on: false }))));
    const region = () => view!.container.querySelector("[role='status']");
    assert.ok(region(), "Region steht vor dem Laden im DOM");
    assert.equal(region()?.textContent, "");
    assert.equal(view.container.querySelector(".nav-progress"), null);
    await view.render(await withI18n(createElement("div", null, createElement(NavProgress), createElement(Pending, { on: true }))));
    assert.equal(region()?.textContent, "Wird geladen …");
    assert.ok(view.container.querySelector(".nav-progress"));
    await view.render(await withI18n(createElement("div", null, createElement(NavProgress), createElement(Pending, { on: false }))));
    assert.equal(region()?.textContent, "");
  });

  it("das Link-Symbol liegt immer im DOM (nur unsichtbar) und nimmt keinen Platz ein", async () => {
    const { LinkPending } = await import("./link-pending");
    view = await mount(createElement("a", { href: "/x" }, "Text", createElement(LinkPending)));
    const slot = view.container.querySelector("[data-pending], span[aria-hidden]");
    assert.ok(slot, "Platzhalter ist im DOM, bevor etwas lädt");
    assert.match(slot.className, /opacity-0/);
    assert.match(slot.className, /\babsolute\b/, "absolut positioniert: kein Platz im Fluss, kein Layout-Sprung");
    assert.equal(slot.getAttribute("aria-hidden"), "true");
  });
});

describe("LoadingView", () => {
  it("meldet sich als beschäftigt, ohne eigene Live-Region (die steht dauerhaft in NavProgress)", async () => {
    const { LoadingView, FullscreenLoadingView } = await import("@/components/shell/loading-view");
    view = await mount(createElement("div", null, createElement(LoadingView), createElement(FullscreenLoadingView)));
    assert.equal(view.container.querySelectorAll("[role='status']").length, 0);
    assert.equal(view.container.querySelectorAll("[aria-busy='true']").length, 2);
    assert.equal(view.container.querySelectorAll("main").length, 1, "nur die Vollbild-Variante ist ein <main>");
    await act(() => {});
  });
});

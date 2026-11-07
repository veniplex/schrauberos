import { Window } from "happy-dom";
import type { ReactElement } from "react";

/**
 * Minimale DOM-Umgebung für Komponententests (happy-dom + echtes react-dom/client): Die Komponente wird wirklich gerendert und bedient, nicht ihr
 * Quelltext geprüft. Nur in Tests verwenden (nicht im Produktionscode).
 *
 *   const dom = installDom({ width: 1440 });
 *   const view = await mount(createElement(MeineKomponente));
 *   …
 *   await view.unmount(); await dom.close();
 *
 * `react-dom/client` wird erst in `mount` geladen, nachdem `window`/`document` stehen.
 */
export type TestDom = {
  window: Window;
  /** Anzeigegröße ändern (steuert `matchMedia`, z. B. `(max-width: 1023px)`) */
  setViewport(width: number, height?: number): void;
  close(): Promise<void>;
};

const GLOBALS = /^(HTML.*|SVG.*|Event|EventTarget|CustomEvent|MouseEvent|KeyboardEvent|FocusEvent|InputEvent|PointerEvent|UIEvent|Node|Element|Text|Comment|Document|DocumentFragment|MutationObserver|DOMException|ShadowRoot|CSSStyleDeclaration|DOMParser|Range|Selection|NodeFilter|Attr|NamedNodeMap|DOMTokenList|FormData)$/;

export function installDom(options: { width?: number; height?: number; coarsePointer?: boolean } = {}): TestDom {
  const window = new Window({ url: "http://localhost/", innerWidth: options.width ?? 1440, innerHeight: options.height ?? 900 });
  // happy-dom wertet Medienabfragen mit Komma (ODER) nicht aus und kennt `pointer` nicht: hier ergänzt
  const baseMatchMedia = window.matchMedia.bind(window);
  window.matchMedia = (query: string) => {
    const matches = query.split(",").some((part) => {
      const pointer = /\(\s*pointer\s*:\s*(coarse|fine)\s*\)/.exec(part);
      return pointer ? (pointer[1] === "coarse") === (options.coarsePointer ?? false) : baseMatchMedia(part.trim()).matches;
    });
    const list = baseMatchMedia(query);
    Object.defineProperty(list, "matches", { value: matches });
    return list;
  };
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const define = (key: string, value: unknown) => {
    if (!saved.has(key)) saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  };
  define("window", window);
  define("self", window); // next/link und andere Bibliotheken lesen `self`
  define("document", window.document);
  define("navigator", window.navigator);
  define("getComputedStyle", window.getComputedStyle.bind(window));
  define("requestAnimationFrame", window.requestAnimationFrame.bind(window));
  define("cancelAnimationFrame", window.cancelAnimationFrame.bind(window));
  for (const key of Object.getOwnPropertyNames(window)) {
    if (GLOBALS.test(key)) define(key, (window as unknown as Record<string, unknown>)[key]);
  }
  define("IS_REACT_ACT_ENVIRONMENT", true);
  return {
    window,
    setViewport: (width, height = window.innerHeight) => window.happyDOM.setViewport({ width, height }),
    async close() {
      await window.happyDOM.close();
      for (const [key, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete (globalThis as Record<string, unknown>)[key];
      }
      saved.clear();
    },
  };
}

export type MountedView = {
  container: HTMLElement;
  /** Neu rendern (z. B. nach Zustandsänderung von außen) */
  render(element: ReactElement): Promise<void>;
  unmount(): Promise<void>;
};

/** Rendert ein Element in einen frischen Container (mit `act`, d. h. Effekte und Zustandsänderungen sind abgeschlossen, wenn der Aufruf zurückkehrt). */
export async function mount(element: ReactElement): Promise<MountedView> {
  const { act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(element));
  return {
    container,
    render: (next) => act(async () => root.render(next)),
    unmount: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

/** Führt eine Bedienung aus (Klick, Eingabe …) und wartet, bis React alles verarbeitet hat. */
export async function act(callback: () => void | Promise<void>): Promise<void> {
  const { act: reactAct } = await import("react");
  await reactAct(async () => {
    await callback();
  });
}

/** Wartet (in `act`) die angegebene Zeit ab – für Antworten, die der Test selbst mit einem Timer verzögert. */
export const sleep = (ms: number) => act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));

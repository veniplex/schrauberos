import { createElement, type ReactElement } from "react";
import { act, mount, type MountedView } from "./dom";

/**
 * Hilfen für Komponententests der UI-Bausteine (nur in Tests): mit Übersetzer (`mountI18n`), Texteingabe wie ein Mensch (`type`), Klick und Tastendruck.
 * Vor dem Aufruf muss `installDom()` gelaufen sein.
 */
export async function mountI18n(element: ReactElement, locale: "de" | "en" = "de"): Promise<MountedView> {
  const { I18nProvider } = await import("@/i18n/client");
  const messages = locale === "de" ? (await import("@/i18n/messages/de")).de : (await import("@/i18n/messages/en")).en;
  return mount(createElement(I18nProvider, { locale, messages } as never, element));
}

/** Neu rendern **mit** Übersetzer (`MountedView.render` ersetzt sonst den ganzen Baum samt Provider). */
export async function rerenderI18n(view: MountedView, element: ReactElement, locale: "de" | "en" = "de"): Promise<void> {
  const { I18nProvider } = await import("@/i18n/client");
  const messages = locale === "de" ? (await import("@/i18n/messages/de")).de : (await import("@/i18n/messages/en")).en;
  await view.render(createElement(I18nProvider, { locale, messages } as never, element));
}

/** Text in ein Feld schreiben: über den nativen Setter und ein `input`-Ereignis, damit auch von React gesteuerte Felder den Wert übernehmen. */
export async function type(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string): Promise<void> {
  const { setControlValue } = await import("@/components/ui/form-draft");
  await act(() => setControlValue(element, value));
}

export async function click(element: Element | null | undefined): Promise<void> {
  if (!element) throw new Error("click: Element nicht gefunden");
  await act(() => (element as HTMLElement).click());
}

export async function blur(element: HTMLElement): Promise<void> {
  await act(() => {
    element.focus();
    element.blur();
  });
}

export async function key(element: Element, name: string): Promise<boolean> {
  let prevented = false;
  await act(() => {
    const event = new window.KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true });
    element.dispatchEvent(event);
    prevented = event.defaultPrevented;
  });
  return prevented;
}

/** Text ohne geschützte Leerzeichen (Intl setzt eines vor das Euro-Zeichen) */
export const plain = (text: string | null | undefined): string => (text ?? "").replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();

export const byText = (root: ParentNode, selector: string, pattern: RegExp): HTMLElement | undefined =>
  Array.from(root.querySelectorAll<HTMLElement>(selector)).find((element) => pattern.test(plain(element.textContent)));

export const wait = (ms = 10) => act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));

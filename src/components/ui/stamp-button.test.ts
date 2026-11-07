import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import { createElement } from "react";
import { act, installDom, type MountedView, type TestDom } from "@/test/dom";
import { mountI18n, plain } from "@/test/ui";

/** Stempel-Knopf: groß, gegen Doppeltippen gesichert, Wiederholung mit demselben Idempotenzschlüssel. */
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
});

const flush = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 15)));

async function mountStamp(onStamp: (key: string) => Promise<void>, props: Record<string, unknown> = {}) {
  const { StampButton } = await import("./stamp-button");
  view = await mountI18n(createElement(StampButton, { onStamp, cooldownMs: 40, ...props, children: "Kommen" } as never));
  return { button: view.container.querySelector("button") as HTMLButtonElement, status: () => plain(view!.container.querySelector("[role='status']")?.textContent) };
}

describe("StampButton", () => {
  it("zwei Taps im selben Augenblick lösen genau einen Aufruf aus", async () => {
    const keys: string[] = [];
    let release!: () => void;
    const { button } = await mountStamp(
      (key) =>
        new Promise<void>((resolve) => {
          keys.push(key);
          release = resolve;
        }),
    );
    await act(() => {
      button.click();
      button.click();
    });
    assert.equal(keys.length, 1);
    assert.equal(button.getAttribute("aria-busy"), "true");
    assert.equal(button.getAttribute("aria-disabled"), "true");
    await act(async () => release());
    await flush();
  });

  it("nach Erfolg ignoriert der Knopf Antippen noch kurz (Cooldown), danach bucht er wieder – mit einem neuen Schlüssel", async () => {
    const keys: string[] = [];
    const { button, status } = await mountStamp(async (key) => void keys.push(key));
    await act(() => button.click());
    await flush();
    assert.match(status(), /Gebucht/);
    await act(() => button.click());
    assert.equal(keys.length, 1, "im Cooldown ignoriert");
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 60)));
    await act(() => button.click());
    await flush();
    assert.equal(keys.length, 2);
    assert.notEqual(keys[0], keys[1], "jede Buchung hat ihren eigenen Schlüssel");
  });

  it("scheitert die Buchung, bleibt der Schlüssel erhalten: erneutes Antippen sendet denselben (der Server bucht nicht doppelt)", async () => {
    const keys: string[] = [];
    let fail = true;
    const { button, status } = await mountStamp(async (key) => {
      keys.push(key);
      if (fail) throw new Error("kein Netz");
    });
    await act(() => button.click());
    await flush();
    assert.match(status(), /Nicht gebucht\. Bitte noch einmal tippen/);
    assert.equal(button.getAttribute("aria-disabled"), null, "gleich wieder bedienbar");
    fail = false;
    await act(() => button.click());
    await flush();
    assert.equal(keys.length, 2);
    assert.equal(keys[0], keys[1], "Wiederholung mit demselben Schlüssel");
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 60)));
    await act(() => button.click());
    await flush();
    assert.notEqual(keys[2], keys[1], "nach Erfolg beginnt eine neue Buchung");
  });

  it("gesperrt (disabled) bucht nichts; der Knopf ist groß (mindestens 64 px) und bleibt fokussierbar", async () => {
    let calls = 0;
    const { button } = await mountStamp(async () => void calls++, { disabled: true });
    await act(() => button.click());
    assert.equal(calls, 0);
    assert.match(button.className, /min-h-16/);
    assert.equal(button.disabled, false, "aria-disabled statt disabled: bleibt per Tastatur erreichbar");
  });

  it("newIdempotencyKey liefert verschiedene, ausreichend lange Schlüssel", async () => {
    const { newIdempotencyKey } = await import("./stamp-button");
    const keys = new Set(Array.from({ length: 50 }, () => newIdempotencyKey()));
    assert.equal(keys.size, 50);
    assert.ok([...keys].every((key) => key.length >= 32));
  });
});

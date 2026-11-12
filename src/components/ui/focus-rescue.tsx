"use client";

import { useEffect } from "react";

/**
 * Fokus nach Aktionen nie auf `<body>` verlieren lassen (Tastatur, Bildschirmleser): Ersetzt oder entfernt die Seite nach einer Aktion das fokussierte Element (Statuswechsel
 * „Arbeit beginnen“ → „Fertig melden“, Speichern, das Fenster einer Rückfrage schließt), setzt der Browser den Fokus auf `<body>`, und die Person beginnt wieder am Seitenanfang.
 * Der Baustein merkt sich das zuletzt fokussierte Element samt seiner Vorfahren und setzt den Fokus – **nur nach Tastaturbedienung** (Maus und Touch haben ohnehin keinen Fokus
 * zu verlieren) und nur kurz nach der letzten Taste – an die Stelle zurück: gleiche `id`, sonst der nächste noch vorhandene Vorfahr (bei der Hauptüberschrift der Seite bleibt es,
 * wenn nichts Näheres übrig ist). Ein nur vorübergehend gesperrtes Element (`disabled` während des Speicherns) bekommt den Fokus zurück, sobald es wieder frei ist.
 */

/** Wie lange nach der letzten Taste ein Fokusverlust noch als Folge dieser Bedienung gilt (eine langsame Aktion braucht Zeit) */
const WINDOW_MS = 15_000;
const NATIVE_FOCUSABLE = "a[href],button,input:not([type='hidden']),select,textarea,summary,[tabindex]";

type Remembered = { el: Element; id: string; trail: Element[] };

function focusable(el: Element): el is HTMLElement {
  return el instanceof HTMLElement && el.matches(NATIVE_FOCUSABLE) && !(el as HTMLButtonElement).disabled && el.getAttribute("aria-hidden") !== "true";
}

function takeFocus(el: HTMLElement) {
  if (!el.matches(NATIVE_FOCUSABLE)) el.setAttribute("tabindex", "-1");
  el.focus({ preventScroll: true });
  return el.ownerDocument.activeElement === el;
}

/** Hängt die Fokussicherung an das Dokument; gibt die Aufräumfunktion zurück (Tests, `useEffect`). */
export function installFocusRescue(doc: Document, now: () => number = () => Date.now()): () => void {
  let keyboardAt = Number.NEGATIVE_INFINITY;
  let last: Remembered | null = null;
  let scheduled = false;

  const onKey = (event: Event) => {
    const key = (event as KeyboardEvent).key;
    if (key === "Shift" || key === "Control" || key === "Alt" || key === "Meta") return;
    keyboardAt = now();
  };
  const onPointer = () => {
    keyboardAt = Number.NEGATIVE_INFINITY;
  };
  const onFocusIn = (event: Event) => {
    const target = event.target;
    if (!(target instanceof Element) || target === doc.body || target === doc.documentElement) return;
    const trail: Element[] = [];
    for (let node = target.parentElement; node && node !== doc.body && node !== doc.documentElement; node = node.parentElement) trail.push(node);
    last = { el: target, id: target.id, trail };
  };

  const check = () => {
    scheduled = false;
    if (!last || now() - keyboardAt > WINDOW_MS) return;
    const active = doc.activeElement;
    if (active && active !== doc.body && active !== doc.documentElement) return;
    const { el, id, trail } = last;
    if (el.isConnected) {
      // Nur vorübergehend gesperrt: warten, bis es wieder frei ist (die Beobachtung ruft `check` bei der Änderung erneut auf)
      if (focusable(el)) {
        takeFocus(el);
        last = null;
      }
      return;
    }
    const same = id ? doc.getElementById(id) : null;
    if (same && focusable(same) && takeFocus(same)) {
      last = null;
      return;
    }
    const survivor = trail.find((node) => node.isConnected && node.tagName !== "MAIN");
    const main = doc.querySelector("main");
    const target = survivor ?? main?.querySelector("h1") ?? main;
    if (target instanceof HTMLElement) takeFocus(target);
    last = null;
  };

  const observer = new MutationObserver(() => {
    if (scheduled || !last) return;
    scheduled = true;
    // nach dem Abschluss der Aktualisierung (React übernimmt in einem Zug), nicht mitten darin
    setTimeout(check, 0);
  });
  observer.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled", "aria-hidden", "hidden"] });
  doc.addEventListener("keydown", onKey, true);
  doc.addEventListener("pointerdown", onPointer, true);
  doc.addEventListener("mousedown", onPointer, true);
  doc.addEventListener("touchstart", onPointer, true);
  doc.addEventListener("focusin", onFocusIn, true);
  return () => {
    observer.disconnect();
    doc.removeEventListener("keydown", onKey, true);
    doc.removeEventListener("pointerdown", onPointer, true);
    doc.removeEventListener("mousedown", onPointer, true);
    doc.removeEventListener("touchstart", onPointer, true);
    doc.removeEventListener("focusin", onFocusIn, true);
  };
}

export function FocusRescue() {
  useEffect(() => installFocusRescue(document), []);
  return null;
}

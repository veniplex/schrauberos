"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Text in die Zwischenablage kopieren. `navigator.clipboard` gibt es nur in sicheren Kontexten (HTTPS, localhost) – viele Werkstätten betreiben die App im LAN über HTTP; dort greift der
 * Rückfall über ein unsichtbares Textfeld und `execCommand("copy")`. Gibt zurück, ob es geklappt hat; wirft nie.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* verweigert oder nicht erlaubt: Rückfall */
  }
  try {
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.setAttribute("aria-hidden", "true");
    field.style.position = "fixed";
    field.style.top = "0";
    field.style.opacity = "0";
    document.body.append(field);
    field.select();
    const ok = document.execCommand("copy");
    field.remove();
    return ok;
  } catch {
    return false;
  }
}

export type CopyStatus = "idle" | "copied" | "failed";

/** Kopieren mit Rückmeldung: `status` wechselt auf „kopiert“/„fehlgeschlagen“ und nach zwei Sekunden zurück. */
export function useCopy(resetMs = 2000): { status: CopyStatus; copy: (text: string) => Promise<boolean> } {
  const [status, setStatus] = useState<CopyStatus>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = useCallback(
    async (text: string) => {
      const ok = await copyToClipboard(text);
      setStatus(ok ? "copied" : "failed");
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setStatus("idle"), resetMs);
      return ok;
    },
    [resetMs],
  );
  return { status, copy };
}

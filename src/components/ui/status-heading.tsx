"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Überschrift einer Status- oder Fehlerseite („Seite nicht gefunden“, „Das hat nicht geklappt“). Beim Anzeigen bekommt sie den Fokus und die Seite
 * einen passenden Titel: Wer mit Tastatur oder Screenreader navigiert hat, erfährt sofort, was passiert ist (statt im alten Seitentitel
 * und auf einem Element zu bleiben, das es nicht mehr gibt).
 */
export function StatusHeading({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null);
  const title = typeof children === "string" ? children : null;
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    if (title) document.title = title;
  }, [title]);
  return (
    <h1 ref={ref} tabIndex={-1} className="text-xl font-semibold outline-none">
      {children}
    </h1>
  );
}

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
    if (!title) return;
    const apply = () => {
      if (document.title !== title) document.title = title;
    };
    apply();
    // Fehlergrenze der Wurzel: Das Layout zeichnet seinen Titel (Metadaten, streamend) mitunter erst nach diesem Effekt noch einmal – dann bliebe der Anwendungsname stehen. Darum ein paar
    // begrenzte Wiederholungen (kein Beobachter: Ein zweiter Schreiber würde mit ihm hin und her wechseln).
    const timers = [100, 500, 1500].map((ms) => window.setTimeout(apply, ms));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [title]);
  return (
    <h1 ref={ref} tabIndex={-1} className="text-xl font-semibold outline-none">
      {children}
    </h1>
  );
}

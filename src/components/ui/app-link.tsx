"use client";

import Link from "next/link";
import { useState, useSyncExternalStore, type ComponentProps } from "react";
import { constrainedNow, linkPrefetch, subscribeConnection } from "@/lib/connection";

/**
 * `next/link` mit gedrosseltem Vorladen (P3-6): Next lädt eine verlinkte Seite vorab, sobald der Link im Bild erscheint – eine Liste mit 25 Zeilen löst 25 Anfragen aus. Auf einem
 * Gerät mit Datensparmodus oder langsamer Verbindung (`lib/connection.ts`) geschieht das stattdessen erst bei Hover, Fokus oder Berührung (das Muster aus der Next-Dokumentation
 * „Linking and navigating“); sonst bleibt alles beim Standard. Ein ausdrückliches `prefetch` am Aufrufer gilt immer.
 * Die Bausteine in `components/ui` (Listen, Navigation, Chips, Textlinks) nutzen ihn; eigene Links in Funktionen dürfen `next/link` weiter benutzen.
 */
export function AppLink({ prefetch, onMouseEnter, onFocus, onTouchStart, ...rest }: ComponentProps<typeof Link>) {
  const constrained = useSyncExternalStore(subscribeConnection, constrainedNow, () => false);
  const [armed, setArmed] = useState(false);
  const throttled = constrained && prefetch === undefined;
  return (
    <Link
      {...rest}
      prefetch={linkPrefetch({ constrained, armed, explicit: prefetch })}
      onMouseEnter={(event) => {
        if (throttled) setArmed(true);
        onMouseEnter?.(event);
      }}
      onFocus={(event) => {
        if (throttled) setArmed(true);
        onFocus?.(event);
      }}
      onTouchStart={(event) => {
        if (throttled) setArmed(true);
        onTouchStart?.(event);
      }}
    />
  );
}

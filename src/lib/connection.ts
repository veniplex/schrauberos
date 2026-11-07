/**
 * Netzverbindung des Geräts (Network Information API, nur Chromium/Android – Safari kennt sie nicht und gilt als „nicht eingeschränkt“): Mit **Datensparmodus** oder einer
 * langsamen Verbindung (3G und schlechter) lädt die Anwendung Seiten nicht mehr vorab, sobald ein Link im Bild erscheint, sondern erst bei Hover, Fokus oder Berührung
 * (`components/ui/app-link.tsx`). Reine Funktionen, getestet in `connection.test.ts`.
 */
export type ConnectionLike = { saveData?: boolean; effectiveType?: string; addEventListener?: (type: "change", listener: () => void) => void; removeEventListener?: (type: "change", listener: () => void) => void };

const SLOW = new Set(["slow-2g", "2g", "3g"]);

/** Datensparmodus oder langsame Verbindung? */
export function isConstrained(connection: ConnectionLike | null | undefined): boolean {
  return Boolean(connection) && (connection!.saveData === true || SLOW.has(connection!.effectiveType ?? ""));
}

const connectionOf = (): ConnectionLike | undefined => (typeof navigator === "undefined" ? undefined : (navigator as Navigator & { connection?: ConnectionLike }).connection);

/** Für `useSyncExternalStore`: Der Zustand ändert sich, wenn das Gerät das Netz wechselt oder der Datensparmodus umgeschaltet wird. */
export function subscribeConnection(listener: () => void): () => void {
  const connection = connectionOf();
  connection?.addEventListener?.("change", listener);
  return () => connection?.removeEventListener?.("change", listener);
}

export const constrainedNow = (): boolean => isConstrained(connectionOf());

/**
 * Wert von `prefetch` für einen `<Link>`: Ein ausdrückliches Verbot oder Gebot des Aufrufers (`explicit` nicht `undefined`) gilt immer. Sonst Standard (`undefined`) –
 * außer bei eingeschränkter Verbindung: dann kein Vorladen (`false`), bis der Link angefasst wird (`armed`: Hover, Fokus, Berührung), danach normal (`null`).
 */
export function linkPrefetch(options: { constrained: boolean; armed: boolean; explicit: boolean | "auto" | null | undefined }): boolean | "auto" | null | undefined {
  if (options.explicit !== undefined || !options.constrained) return options.explicit;
  return options.armed ? null : false;
}

/**
 * Adresse für den Live-Filter (`LiveFilter`): dieselbe Abfrage wie das Absenden des GET-Formulars (alle Felder in Reihenfolge, auch leere – so deutet der Server sie genau wie bei
 * „Filter“), ohne Dateifelder. Rein, damit sie ohne Browser getestet werden kann.
 */
export function liveFilterUrl(action: string, entries: Iterable<[string, FormDataEntryValue]>): string {
  const params = new URLSearchParams();
  for (const [name, value] of entries) if (typeof value === "string") params.append(name, value);
  const query = params.toString();
  return query ? `${action}?${query}` : action;
}

/** Wartezeit nach dem letzten Tastendruck, bevor gefiltert wird. */
export const LIVE_FILTER_DELAY_MS = 350;

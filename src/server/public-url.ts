import "server-only";
import { parsePublicUrl } from "@/lib/public-url";
import { getSetting } from "@/server/settings";

/** Einstellung „Adresse der Anwendung“ (Einstellungen → Sicherheit), siehe `lib/public-url.ts`. */
export const PUBLIC_URL_KEY = "app.publicUrl";

/** Die eingestellte Herkunft der Anwendung; `null`, wenn keine (gültige) gesetzt ist. Nie aus dem Header der Anfrage abgeleitet. */
export async function getPublicUrl(): Promise<string | null> {
  const stored = await getSetting(PUBLIC_URL_KEY);
  if (!stored) return null;
  const parsed = parsePublicUrl(stored);
  return parsed.ok ? parsed.value : null;
}

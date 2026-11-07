import { getI18n } from "@/i18n/server";
import { flashCookieName, readFlash } from "@/server/operations/flash";
import { FlashMessage } from "./flash-message";

/**
 * Meldung nach einer Server Action (P1a-5/P2a-2): liest das Flash-Cookie, das Aktionen nach Erfolg/Fehler setzen (nur Meldungsschlüssel), übersetzt es in der Sprache der
 * Sitzung und übergibt es einmal an den Toast. Unbekannte Schlüssel werden ignoriert. Die Live-Regionen stehen immer im DOM – im `ToastProvider` des Wurzel-Layouts.
 */
export async function FlashNotice() {
  const flash = await readFlash();
  if (!flash) return null;
  const { t, has } = await getI18n();
  if (!has(flash.key)) return null;
  return <FlashMessage id={flash.id} cookieName={await flashCookieName()} tone={flash.tone} text={t(flash.key, flash.params)} />;
}

import { getI18n } from "@/i18n/server";
import { flashCookieName, readFlash } from "@/server/operations/flash";
import { FlashMessage } from "./flash-message";

/**
 * Minimaler Meldungsbereich im Layout (P1a-5): liest das Flash-Cookie, das Server Actions nach Erfolg/Fehler setzen (nur Meldungsschlüssel),
 * übersetzt es in der Sprache der Sitzung und zeigt es einmal. Unbekannte Schlüssel werden ignoriert.
 */
export async function FlashNotice() {
  const flash = await readFlash();
  if (!flash) return null;
  const { t, has } = await getI18n();
  if (!has(flash.key)) return null;
  return <FlashMessage id={flash.id} cookieName={await flashCookieName()} tone={flash.tone} text={t(flash.key, flash.params)} closeLabel={t("common.close")} />;
}

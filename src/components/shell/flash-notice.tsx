import { getI18n } from "@/i18n/server";
import { flashCookieName, readFlash } from "@/server/operations/flash";
import { FlashMessage } from "./flash-message";

/**
 * Minimaler Meldungsbereich im Layout (P1a-5): liest das Flash-Cookie, das Server Actions nach Erfolg/Fehler setzen (nur Meldungsschlüssel),
 * übersetzt es in der Sprache der Sitzung und zeigt es einmal. Unbekannte Schlüssel werden ignoriert.
 *
 * **Die Live-Regionen sind immer im DOM** (leer, solange es keine Meldung gibt): Screenreader sagen nur Änderungen an einer Region an, die schon da war – eine mit
 * der Meldung zusammen eingefügte Region bliebe stumm. Erfolg kommt in die höfliche (`polite`), ein Fehler in die sofortige (`assertive`) Region. Leer sind sie
 * ausgeblendet (`empty:hidden`), nehmen also keinen Platz.
 */
export async function FlashNotice() {
  const flash = await readFlash();
  let message: React.ReactNode = null;
  if (flash) {
    const { t, has } = await getI18n();
    if (has(flash.key)) {
      message = <FlashMessage id={flash.id} cookieName={await flashCookieName()} tone={flash.tone} text={t(flash.key, flash.params)} closeLabel={t("common.close")} />;
    }
  }
  const error = flash?.tone === "error";
  return (
    <>
      <div aria-live="polite" aria-atomic="true" data-flash-region="polite" className="empty:hidden">
        {error ? null : message}
      </div>
      <div aria-live="assertive" aria-atomic="true" data-flash-region="assertive" className="empty:hidden">
        {error ? message : null}
      </div>
    </>
  );
}

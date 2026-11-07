/**
 * Welche Adressen Markdown-Inhalte (Hilfe, Doku-Seiten, Release-Notizen) verwenden dürfen – rein, ohne Abhängigkeiten.
 *
 * Eine Adresse ist nur dann **intern**, wenn sie ein Pfad der eigenen Herkunft ist: `/pfad` oder `#anker`. `//host/pfad` (protokollrelativ, auch mit Rückwärtsschrägstrich)
 * beginnt zwar mit einem Schrägstrich, zeigt aber auf einen fremden Host und ist **extern** (neuer Tab, `noopener noreferrer nofollow`).
 * **Bilder** werden nur von der eigenen Herkunft geladen (`/api/docs/images/…`): Ein fremdes Bild würde beim Lesen eine Anfrage an einen fremden Server auslösen (Verfolgung der
 * Leser) – und die Content-Security-Policy (`img-src 'self' data: blob:`) würde es ohnehin blockieren und in der Browser-CI als Verstoß zählen.
 */

/** Pfad der eigenen Herkunft: ein Schrägstrich, dann weder `/` noch `\` (beides macht daraus einen fremden Host), keine Steuerzeichen. */
const LOCAL_PATH = /^\/(?![/\\])[^\u0000-\u001f]*$/;

/** `/pfad` oder `#anker` (nicht `//host`, nicht `/\host`); Steuerzeichen und Leerraum am Anfang sind keine interne Adresse. */
export function isInternalHref(href: string | undefined): boolean {
  if (!href) return false;
  return href.startsWith("#") || LOCAL_PATH.test(href);
}

/** Bild von der eigenen Herkunft (Pfad, nie `//host`)? */
export function isLocalImageSrc(src: string | undefined): src is string {
  return typeof src === "string" && LOCAL_PATH.test(src);
}

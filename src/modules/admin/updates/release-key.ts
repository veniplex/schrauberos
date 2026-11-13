/**
 * Schlüsselkette für Release-Signaturen (Details und Handhabung: README, Abschnitt „Release und Signaturschlüssel“).
 *
 *  - `RELEASE_PUBLIC_KEY`: Öffentlicher Release-Schlüssel (Ed25519), mit dem Release-Manifeste geprüft werden. Der private
 *    Gegenschlüssel liegt nur als GitHub-Secret `RELEASE_SIGNING_KEY` vor und signiert in der Release-Pipeline. Er bleibt für alle
 *    Installationen mit diesem Image **immer vertraut** – die Kette hilft bei seinem *Verlust* oder planmäßigen Wechsel, nicht bei
 *    Diebstahl (dazu bräuchte es einen neuen Wurzelschlüssel und ein neues Image, siehe `src/lib/updates/keychain.ts`).
 *  - `ROOT_PUBLIC_KEY`: Öffentlicher Wurzelschlüssel. Sein privater Teil gehört **offline** (nicht ins GitHub-Secret) und
 *    beglaubigt nur Release-Schlüssel (`scripts/endorse-release-key.mjs`, mit Pflicht-Ablaufdatum), nie Pakete. Die App akzeptiert
 *    Manifeste, die mit `RELEASE_PUBLIC_KEY` oder einem vom Wurzelschlüssel beglaubigten Schlüssel signiert sind.
 *
 * **Stand:** Wurzel- und Release-Schlüssel sind getrennte Paare (Zeremonie 2026-11-13). Die Wurzel ist offline verwahrt; der Release-Schlüssel liegt als
 * Environment-Secret `RELEASE_SIGNING_KEY` der Umgebung `release`. Das Release-Skript bricht beim Tag-Build weiter ab, wenn beide gleich wären.
 *
 * Die Schlüssel kommen **nur** aus dieser Datei (Build): keine Umgebungsvariable überschreibt sie, weder in der App noch im Starter (der Starter im Image
 * bekommt seinen Header aus derselben Datei, `scripts/gen-trust-header.mjs`). Eigene Forks tragen hier ihre Schlüssel ein.
 */
export const RELEASE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAqSLOJX4qmmywpHqs+orov8u1QZGmj0xlSLOeiOApuZw=
-----END PUBLIC KEY-----
`;

export const ROOT_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAWPyud9PDlkVyRlc8w6swG2Y1LenHbFIq+r0hsmqzDl4=
-----END PUBLIC KEY-----
`;

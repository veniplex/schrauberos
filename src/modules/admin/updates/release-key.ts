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
 * **Ausgangslage:** Solange hier kein eigener Offline-Wurzelschlüssel eingetragen ist (`ROOT_PUBLIC_KEY = RELEASE_PUBLIC_KEY`),
 * schützt die Kette nicht vor einem Diebstahl des GitHub-Secrets. **Das Release-Skript (`scripts/make-release.mjs`) bricht deshalb
 * beim Tag-Build ab**, bis ein eigener Wurzelschlüssel eingetragen ist – es fällt nie still auf den Release-Schlüssel zurück.
 * Vor der Veröffentlichung: Wurzelpaar offline erzeugen, öffentlichen Teil unten eintragen.
 *
 * Die Schlüssel kommen **nur** aus dieser Datei (Build): keine Umgebungsvariable überschreibt sie, weder in der App noch im Starter (der Starter im Image
 * bekommt seinen Header aus derselben Datei, `scripts/gen-trust-header.mjs`). Eigene Forks tragen hier ihre Schlüssel ein.
 */
export const RELEASE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAOY1veyDs85EBZMw40+3aDEBedu6QJAO7+u5hORhnf7g=
-----END PUBLIC KEY-----
`;

export const ROOT_PUBLIC_KEY = RELEASE_PUBLIC_KEY;

/**
 * Schlüsselkette für Release-Signaturen (Details und Handhabung: README, Abschnitt „Release und Signaturschlüssel“).
 *
 *  - `RELEASE_PUBLIC_KEY`: Öffentlicher Release-Schlüssel (Ed25519), mit dem Release-Manifeste geprüft werden. Der private
 *    Gegenschlüssel liegt nur als GitHub-Secret `RELEASE_SIGNING_KEY` vor und signiert in der Release-Pipeline.
 *  - `ROOT_PUBLIC_KEY`: Öffentlicher Wurzelschlüssel. Sein privater Teil gehört **offline** (nicht ins GitHub-Secret) und
 *    beglaubigt nur Release-Schlüssel (`scripts/endorse-release-key.mjs`), nie Pakete. Die App akzeptiert Manifeste, die mit
 *    `RELEASE_PUBLIC_KEY` oder einem vom Wurzelschlüssel beglaubigten Schlüssel signiert sind (`src/lib/updates/keychain.ts`).
 *
 * **Ausgangslage:** Solange der Besitzer keinen eigenen Offline-Wurzelschlüssel erzeugt und hier einträgt, gilt der Release-Schlüssel
 * zugleich als Wurzel (die Kette funktioniert, schützt aber noch nicht vor einem Diebstahl des GitHub-Secrets). Vor der
 * Veröffentlichung: Wurzelpaar offline erzeugen, öffentlichen Teil unten eintragen, ggf. neuen Release-Schlüssel beglaubigen.
 *
 * Eigene Forks setzen `UPDATE_PUBLIC_KEY` (Release-Schlüssel, zugleich Wurzel) und optional `UPDATE_ROOT_PUBLIC_KEY`.
 */
export const RELEASE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAOY1veyDs85EBZMw40+3aDEBedu6QJAO7+u5hORhnf7g=
-----END PUBLIC KEY-----
`;

export const ROOT_PUBLIC_KEY = RELEASE_PUBLIC_KEY;

/**
 * Öffentlicher Schlüssel (Ed25519), mit dem Release-Manifeste geprüft werden. Der private Gegenschlüssel liegt nur als
 * GitHub-Secret `RELEASE_SIGNING_KEY` vor und signiert in der Release-Pipeline. Nur signierte Pakete werden installiert.
 * Eigene Forks können einen anderen Schlüssel über die Umgebungsvariable UPDATE_PUBLIC_KEY hinterlegen.
 */
export const RELEASE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAOY1veyDs85EBZMw40+3aDEBedu6QJAO7+u5hORhnf7g=
-----END PUBLIC KEY-----
`;

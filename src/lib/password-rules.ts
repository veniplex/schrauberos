/**
 * Regeln für Passwörter. Das Formular nennt die Obergrenze in **Zeichen**; erzwungen wird zusätzlich eine Obergrenze in **Bytes**
 * (UTF-8), damit niemand durch riesige Eingaben Arbeit erzeugt. 128 Zeichen passen auch dann in 512 Bytes, wenn jedes vier Bytes hat.
 */
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_CHARS = 128;
export const MAX_PASSWORD_BYTES = 512;

export type PasswordProblem = "short" | "long";

export function passwordProblem(password: string): PasswordProblem | null {
  const chars = [...password].length;
  if (chars < MIN_PASSWORD_LENGTH) return "short";
  if (chars > MAX_PASSWORD_CHARS || new TextEncoder().encode(password).length > MAX_PASSWORD_BYTES) return "long";
  return null;
}

/** Für die Anmeldung: nur die Obergrenze (zu lange Eingaben werden gar nicht erst geprüft). */
export const passwordTooLong = (password: string): boolean => passwordProblem(password) === "long";

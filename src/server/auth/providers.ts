import "server-only";
import type { User } from "@/generated/prisma/client";
import { verifyPassword } from "./password";

/**
 * Authentifizierungs-Quellen. Jeder Benutzer hat `authSource`:
 *  - "local": Passwort-Hash in der eigenen Datenbank (Standard)
 *  - später z. B. "ldap": Prüfung gegen Active Directory
 *
 * Eine AD-Anbindung implementiert `AuthProvider`, wird unten in `externalProviders` registriert
 * und legt Benutzer beim ersten erfolgreichen Login automatisch an (Rollen über Gruppen-Mapping).
 * Rechte/Rollen bleiben dabei immer in der eigenen Datenbank.
 */
export interface AuthProvider {
  id: string;
  /** `bounded`: bei voller Warteschlange der Passwortprüfung abweisen (`QueueFullError`), statt zu warten */
  verify(user: User, password: string, options?: { bounded?: boolean; owner?: string }): Promise<boolean>;
}

const localProvider: AuthProvider = {
  id: "local",
  verify: (user, password, options) => verifyPassword(password, user.passwordHash, options),
};

const externalProviders: Record<string, AuthProvider> = {
  // ldap: ldapProvider,
};

export function getAuthProvider(authSource: string): AuthProvider | null {
  if (authSource === "local") return localProvider;
  return externalProviders[authSource] ?? null;
}

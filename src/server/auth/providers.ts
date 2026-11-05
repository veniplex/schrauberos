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
  verify(user: User, password: string): Promise<boolean>;
}

const localProvider: AuthProvider = {
  id: "local",
  verify: (user, password) => verifyPassword(password, user.passwordHash),
};

const externalProviders: Record<string, AuthProvider> = {
  // ldap: ldapProvider,
};

export function getAuthProvider(authSource: string): AuthProvider | null {
  if (authSource === "local") return localProvider;
  return externalProviders[authSource] ?? null;
}

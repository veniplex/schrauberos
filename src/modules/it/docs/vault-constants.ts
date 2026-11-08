/** Konstanten des IT-Tresors (ohne Server-Code: auch Formulare im Browser dürfen sie lesen). */
export const VAULT_KINDS = ["server", "network", "account", "other"] as const;
export type VaultKind = (typeof VAULT_KINDS)[number];

/** Zustand eines Eintrags: `sealed` = Zugangsdaten hinterlegt (verschlüsselt), `empty` = noch keine, `unreadable` = nach einer Wiederherstellung ohne passenden Schlüssel zurückgesetzt („Neu eingeben nötig“) */
export type VaultState = "sealed" | "empty" | "unreadable";

/** Grenzen der Felder (Zeichen) – URL, Benutzername, Geheimnis und Notiz werden zusammen verschlüsselt */
export const VAULT_LIMITS = { title: 120, system: 120, url: 300, username: 200, secret: 2000, note: 2000 } as const;

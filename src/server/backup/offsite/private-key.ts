import { normalizePrivateKey } from "@/lib/offsite/private-key";

type Ssh2 = typeof import("ssh2");

export type PrivateKeyCheck = { ok: true; pem: string } | { ok: false; problem: "privateKey" | "privateKeyPassphrase" };

/**
 * Prüft einen eingegebenen privaten SSH-Schlüssel beim Speichern (statt erst beim ersten Verbindungsversuch): bringt ihn in Form (`normalizePrivateKey`) und liest ihn mit
 * `ssh2` (`utils.parseKey`, bei verschlüsselten Schlüsseln mit der Passphrase). `privateKey` = kein (lesbarer) privater Schlüssel, `privateKeyPassphrase` = verschlüsselt, Passphrase
 * fehlt oder ist falsch. Gespeichert wird die bereinigte Form; die Passphrase bleibt getrennt (wie bisher).
 */
export async function checkPrivateKey(input: string, passphrase?: string): Promise<PrivateKeyCheck> {
  const pem = normalizePrivateKey(input);
  if (!pem) return { ok: false, problem: "privateKey" };
  const loaded = (await import("ssh2")) as Ssh2 & { default?: Ssh2 };
  const ssh2 = loaded.utils ? loaded : (loaded.default as Ssh2);
  const parsed = ssh2.utils.parseKey(pem, passphrase || undefined);
  const key = Array.isArray(parsed) ? parsed[0] : parsed;
  if (key instanceof Error) return { ok: false, problem: /passphrase/i.test(key.message) ? "privateKeyPassphrase" : "privateKey" };
  if (!key || !key.isPrivateKey()) return { ok: false, problem: "privateKey" };
  return { ok: true, pem };
}

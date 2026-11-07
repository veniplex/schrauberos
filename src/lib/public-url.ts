/**
 * „Adresse der Anwendung“ (Einstellungen → Sicherheit): die Adresse, unter der die Leute die App erreichen – gebraucht für **Links, die außerhalb der Anwendung stehen**: der QR-Code auf dem
 * Reifenlager-Etikett und die Adresse des Kalender-Abos. Sie kommt **nur aus dieser Einstellung**, nie aus dem `Host`-Header der Anfrage (der ließe sich fälschen: ein Etikett mit fremder
 * Adresse wäre ein Phishing-Weg).
 *
 * Erlaubt ist ausschließlich eine Herkunft (`https://werkstatt.example` oder `http://192.168.1.10:3000`): kein Pfad, keine Anmeldedaten, keine Parameter. `http` ist erlaubt, weil die App im
 * Werkstattnetz oft ohne HTTPS läuft; die Oberfläche weist darauf hin.
 */

export const PUBLIC_URL_MAX_LENGTH = 200;

export type PublicUrlProblem = "empty" | "invalid" | "scheme" | "credentials" | "extra";

export type PublicUrlResult = { ok: true; value: string } | { ok: false; error: PublicUrlProblem };

/** Prüft und normalisiert die Eingabe zur Herkunft (ohne abschließenden Schrägstrich). */
export function parsePublicUrl(input: string): PublicUrlResult {
  const text = input.trim();
  if (text === "") return { ok: false, error: "empty" };
  if (text.length > PUBLIC_URL_MAX_LENGTH) return { ok: false, error: "invalid" };
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, error: "invalid" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, error: "scheme" };
  if (url.hostname === "") return { ok: false, error: "invalid" };
  if (url.username || url.password) return { ok: false, error: "credentials" };
  if ((url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) return { ok: false, error: "extra" };
  return { ok: true, value: url.origin };
}

/** Absolute Adresse zu einem Pfad der Anwendung; `null`, wenn keine Adresse eingestellt ist. Der Pfad beginnt mit `/`, Teile daraus (Kennungen) werden kodiert. */
export function publicLink(base: string | null, path: string): string | null {
  if (!base || !path.startsWith("/")) return null;
  return `${base}${path}`;
}

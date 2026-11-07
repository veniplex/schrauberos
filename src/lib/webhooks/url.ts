import { canonicalHost, isAllowedAddress, isForbiddenHost, isPrivateAddress } from "@/lib/offsite/host-policy";

/**
 * Ziel eines Webhooks – Prüfung der Adresse **ohne Netzwerk** (die Auflösung und das Festlegen der Adresse beim Verbinden stehen in `server/webhooks/target.ts`).
 *
 *  - Nur `https`; `http` nur mit ausdrücklicher Freigabe für das eigene Netz (`allowPrivate`) **und** nur zu einem Ziel mit privater Adresse (gegen eine öffentliche Adresse wird nie unverschlüsselt gesendet).
 *  - Keine Zugangsdaten in der Adresse (`https://user:pass@…`), kein Fragment, höchstens 500 Zeichen.
 *  - Der eigene Rechner, Verbindungs-lokale Adressen und Metadaten-Dienste sind nie erlaubt (`host-policy.ts`, auch nicht als Administrator); eine Adresse im privaten Netz nur mit `allowPrivate`.
 *    Adressen in jeder Schreibweise (Dezimal, Hex, Oktal, IPv4-in-IPv6) zählen wie die kanonische Adresse.
 */
export const MAX_URL_LENGTH = 500;

export type WebhookUrlProblem = "invalid" | "scheme" | "credentials" | "fragment" | "forbiddenHost" | "privateNeedsApproval" | "plainNeedsPrivate";

export function checkWebhookUrl(raw: string, options: { allowPrivate: boolean }): { ok: true; url: URL } | { ok: false; problem: WebhookUrlProblem } {
  const text = raw.trim();
  if (!text || text.length > MAX_URL_LENGTH || /[\s\u0000-\u001f]/.test(text)) return { ok: false, problem: "invalid" };
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, problem: "invalid" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, problem: "scheme" };
  if (url.username || url.password) return { ok: false, problem: "credentials" };
  if (url.hash) return { ok: false, problem: "fragment" };
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const canonical = canonicalHost(host);
  if (!canonical) return { ok: false, problem: "invalid" };
  if (isForbiddenHost(host)) return { ok: false, problem: "forbiddenHost" };
  if (canonical.kind === "ip") {
    if (!isAllowedAddress(canonical.ip)) return { ok: false, problem: "forbiddenHost" };
    const isPrivate = isPrivateAddress(canonical.ip);
    if (isPrivate && !options.allowPrivate) return { ok: false, problem: "privateNeedsApproval" };
    if (url.protocol === "http:" && !isPrivate) return { ok: false, problem: "plainNeedsPrivate" };
  } else if (url.protocol === "http:" && !options.allowPrivate) {
    // ein Name wird erst beim Verbinden aufgelöst; Klartext gibt es nur mit der Freigabe und nur, wenn er dort privat auflöst (target.ts)
    return { ok: false, problem: "plainNeedsPrivate" };
  }
  return { ok: true, url };
}

import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { canonicalHost, isForbiddenHost, isPrivateAddress } from "@/lib/offsite/host-policy";
import { isAllowedTarget } from "@/server/host-gateway";
import type { DeliveryError } from "@/lib/webhooks/schedule";

/**
 * Ziel eines Webhooks beim **Verbinden**: Name auflösen, **jede** Antwort gegen die Richtlinie prüfen (`lib/offsite/host-policy.ts`), danach mit der geprüften Adresse verbinden
 * (`send.ts` bekommt die IP, den Namen nur für SNI und die Prüfung des Zertifikats). Zwischen Prüfung und Verbindung gibt es keine zweite Auflösung – ein Name kann nicht umgelenkt werden
 * (DNS-Rebinding). Private Adressen nur mit der Freigabe der Administration (`allowPrivate`).
 */
export class WebhookError extends Error {
  constructor(readonly code: DeliveryError) {
    super(`Webhook: ${code}`);
    this.name = "WebhookError";
  }
}

export type PinnedTarget = { address: string; family: 4 | 6; private: boolean; servername: string | null };

export type Lookup = (name: string, options: { all: true; verbatim: true }) => Promise<Array<{ address: string; family: number }>>;
const LOOKUP_MS = 10_000;

export async function resolveWebhookTarget(host: string, options: { allowPrivate: boolean }, lookupImpl: Lookup = lookup as Lookup): Promise<PinnedTarget> {
  const canonical = canonicalHost(host);
  if (!canonical) throw new WebhookError("config");
  if (isForbiddenHost(host)) throw new WebhookError("forbiddenHost");
  // Das Host-Gateway des Containers ist der Server selbst: auch mit der Freigabe `allowPrivate` nie erlaubt (`server/host-gateway.ts`)
  const allowed = (address: string) => isAllowedTarget(address, { allowPrivate: options.allowPrivate });
  if (canonical.kind === "ip") {
    if (!allowed(canonical.ip)) throw new WebhookError("forbiddenHost");
    return { address: canonical.ip, family: isIP(canonical.ip) as 4 | 6, private: isPrivateAddress(canonical.ip), servername: null };
  }
  let timer: NodeJS.Timeout | undefined;
  try {
    const answers = await Promise.race([
      lookupImpl(canonical.name, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new WebhookError("dns")), LOOKUP_MS))),
    ]);
    if (answers.length === 0) throw new WebhookError("dns");
    // Jede Antwort muss erlaubt sein: ein Name mit einer erlaubten und einer verbotenen (oder nicht freigegebenen privaten) Adresse wäre ein Umlenkversuch
    if (answers.some((answer) => !allowed(answer.address))) throw new WebhookError("forbiddenHost");
    const first = answers[0];
    return { address: first.address, family: first.family as 4 | 6, private: isPrivateAddress(first.address), servername: canonical.name };
  } catch (error) {
    throw error instanceof WebhookError ? error : new WebhookError("dns");
  } finally {
    clearTimeout(timer);
  }
}

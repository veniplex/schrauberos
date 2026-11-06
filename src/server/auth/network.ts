import "server-only";
import { headers } from "next/headers";
import { clientIp } from "@/lib/client-ip";
import { getSetting } from "@/server/settings";

/** Einstellung „Hinter Reverse-Proxy“ (Einstellungen → Sicherheit): nur dann wird `X-Forwarded-For` ausgewertet. */
export const BEHIND_PROXY_KEY = "auth.behindProxy";

export async function isBehindProxy(): Promise<boolean> {
  return (await getSetting(BEHIND_PROXY_KEY)) === "true";
}

/** Adresse des Clients für das IP-Limit; ohne die Einstellung immer null (der Header ließe sich fälschen). */
export async function currentClientIp(): Promise<string | null> {
  return clientIp((await headers()).get("x-forwarded-for"), await isBehindProxy());
}

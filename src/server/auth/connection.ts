import "server-only";
import { headers } from "next/headers";
import { isSecureRequest } from "@/lib/session-cookie";

/** Kam die aktuelle Anfrage über HTTPS an (erkannt am Header des Reverse-Proxys, siehe `lib/session-cookie.ts`)? Für Hinweise an Administratoren. */
export async function connectionIsSecure(): Promise<boolean> {
  return isSecureRequest((await headers()).get("x-forwarded-proto"));
}

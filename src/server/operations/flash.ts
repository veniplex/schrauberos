import "server-only";
import { randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import type { MessageKey, Vars } from "@/i18n/translate";
import { cookieAttributes, cookieName, isSecureRequest } from "@/lib/session-cookie";

/**
 * Flash-Meldung nach einer Server Action (v. a. Aktionen ohne Formularzustand: Löschen, Statuswechsel, Schalter): ein kurzlebiges Cookie
 * mit **nur einem Meldungsschlüssel** (und einfachen Platzhaltern) – nie fertiger Text, nie Daten. Der Meldungsbereich im Layout
 * (`FlashNotice`) übersetzt und zeigt sie einmal; der Toast (P2a-2) übernimmt später dieselbe Quelle.
 */
export const FLASH_COOKIE = "so_flash";
const MAX_AGE_SECONDS = 120;

export type Flash = { id: string; tone: "success" | "error"; key: MessageKey; params?: Vars };

const KEY = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)*$/;

export const encodeFlash = (flash: Flash): string => Buffer.from(JSON.stringify(flash)).toString("base64url");

/** Liest und prüft den Cookie-Wert; alles, was nicht genau der erwarteten Form entspricht, ist „keine Meldung“. */
export function decodeFlash(raw: string | undefined | null): Flash | null {
  if (!raw || raw.length > 600) return null;
  try {
    const value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Partial<Flash>;
    if (!value || typeof value !== "object") return null;
    if ((value.tone !== "success" && value.tone !== "error") || typeof value.key !== "string" || !KEY.test(value.key) || value.key.length > 120) return null;
    if (typeof value.id !== "string" || value.id.length > 40) return null;
    let params: Vars | undefined;
    if (value.params !== undefined) {
      if (typeof value.params !== "object" || value.params === null) return null;
      params = {};
      for (const [name, v] of Object.entries(value.params)) {
        if (!/^\w{1,30}$/.test(name) || (typeof v !== "string" && typeof v !== "number")) return null;
        params[name] = typeof v === "string" ? v.slice(0, 80) : v;
      }
    }
    return { id: value.id, tone: value.tone, key: value.key as MessageKey, params };
  } catch {
    return null;
  }
}

async function secure(): Promise<boolean> {
  return isSecureRequest((await headers()).get("x-forwarded-proto"));
}

/** Name des Cookies für diese Anfrage (unter HTTPS mit `__Host-`). */
export async function flashCookieName(): Promise<string> {
  return cookieName(FLASH_COOKIE, await secure());
}

/** Merkt eine Meldung für die nächste Seite. Nur Schlüssel und einfache Platzhalter. */
export async function setFlash(flash: Omit<Flash, "id">): Promise<void> {
  const isSecure = await secure();
  const jar = await cookies();
  // Lesbar für das Skript, das den Cookie nach dem Anzeigen löscht (kein Geheimnis: nur ein Meldungsschlüssel)
  jar.set(cookieName(FLASH_COOKIE, isSecure), encodeFlash({ ...flash, id: randomBytes(6).toString("hex") }), { ...cookieAttributes(isSecure), httpOnly: false, maxAge: MAX_AGE_SECONDS });
}

/** Die vorgemerkte Meldung der Anfrage (falls vorhanden). */
export async function readFlash(): Promise<Flash | null> {
  const [jar, isSecure] = await Promise.all([cookies(), secure()]);
  return decodeFlash(jar.get(cookieName(FLASH_COOKIE, isSecure))?.value);
}

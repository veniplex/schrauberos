import { NextResponse, type NextRequest } from "next/server";
import { CSP_HEADER, CSP_REPORT_ONLY_HEADER, HSTS_VALUE, requestPolicy, type RequestPolicy } from "@/lib/csp";
import { cspMode } from "@/lib/csp-mode";
import { reinstallHtml } from "@/lib/reinstall-text";
import { startingHtml, STARTING_RETRY_SECONDS } from "@/lib/starting-text";
import { isSecureRequest, sessionCookieName } from "@/lib/session-cookie";
import { startupState } from "@/server/startup-state";

// Nur eine schnelle, optimistische Prüfung (Cookie vorhanden?). Die echte Prüfung der Sitzung und der Berechtigungen passiert
// serverseitig in getSession()/requirePermission(). Deshalb leitet der Proxy nie „von /login weg“: Ein totes Cookie führte sonst zu
// einer Schleife (Seite → /login → /). Ob jemand wirklich angemeldet ist, entscheidet die Anmeldeseite selbst.
// Ohne Sitzung erreichbar außerdem: die Offline-Seite des Service Workers (`/offline`) und das Logo für die Anmeldeseite (`/api/logo`, öffentlich lesbar, nur Rasterbilder).
const OPEN_PAGES = new Set(["/login", "/login/recover", "/login/verify", "/login/key", "/setup", "/offline", "/api/logo"]);

// Programmierschnittstelle (Bearer-Token) und iCal-Feed (Token in der URL) prüfen sich selbst und brauchen kein Sitzungs-Cookie.
const SELF_AUTHENTICATED = ["/api/v1", "/api/ical"];
const isSelfAuthenticated = (pathname: string) => SELF_AUTHENTICATED.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));

/**
 * Fremde Datenbank („Neuinstallation nötig“): Die App bleibt am Leben, fasst die Datenbank aber nicht an. Der Proxy beantwortet deshalb **jeden**
 * Pfad außer `/api/health` (nicht im Matcher) mit 503 – auch Server Actions, Route Handler und die Metadaten, die das Root-Layout allein nicht sperrt.
 */
function reinstallResponse(request: NextRequest, nonce?: string): NextResponse {
  const wantsHtml = request.method === "GET" && (request.headers.get("accept") ?? "").includes("text/html");
  const headers = { "cache-control": "no-store", "retry-after": "3600" };
  if (wantsHtml) return new NextResponse(reinstallHtml(nonce), { status: 503, headers: { ...headers, "content-type": "text/html; charset=utf-8" } });
  return NextResponse.json({ status: "reinstall" }, { status: 503, headers });
}

/**
 * Der Start läuft noch (Sicherung vor Migrationen, Migrationen – `instrumentation.ts` startet ihn im Hintergrund): **Keine** Anfrage darf eine noch nicht migrierte
 * Datenbank erreichen. Der Proxy beantwortet deshalb jeden Pfad außer `/api/health` (nicht im Matcher; meldet 503 `starting`) mit 503. Statik (`_next/static`, Icons …)
 * und der Upload von Sicherungen liegen außerhalb des Proxys: Statik fasst die Datenbank nicht an, die Upload-Route prüft den Zustand selbst.
 */
function startingResponse(request: NextRequest, nonce?: string): NextResponse {
  const wantsHtml = request.method === "GET" && (request.headers.get("accept") ?? "").includes("text/html");
  const headers = { "cache-control": "no-store", "retry-after": String(STARTING_RETRY_SECONDS) };
  if (wantsHtml) return new NextResponse(startingHtml(nonce), { status: 503, headers: { ...headers, "content-type": "text/html; charset=utf-8" } });
  return NextResponse.json({ status: "starting" }, { status: 503, headers });
}

/**
 * Sicherheits-Köpfe jeder Antwort des Proxys (`lib/csp.ts` erklärt, wer welchen Kopf setzt): die Content-Security-Policy dieser Anfrage (mit frischem Nonce; als
 * `Report-Only`, solange der Notschalter in den Einstellungen so steht) und HSTS nur bei erkanntem HTTPS.
 */
function secured(response: NextResponse, policy: RequestPolicy, secure: boolean): NextResponse {
  if (policy) response.headers.set(policy.headerName, policy.value);
  if (secure) response.headers.set("Strict-Transport-Security", HSTS_VALUE);
  return response;
}

/**
 * Anfrage weiterreichen. Bei Seiten bekommt sie die Richtlinie samt Nonce als Kopf (`content-security-policy` bzw. `-report-only`, dazu `x-nonce`): Next liest den Nonce
 * **aus dem Kopf der Anfrage** und trägt ihn in alle eigenen Skripte und Stile ein. Von außen mitgeschickte Köpfe gleichen Namens werden entfernt (sonst käme der Nonce
 * des Absenders durch, wenn der Notschalter auf „nur melden“ steht: Next bevorzugt `content-security-policy`).
 */
function passThrough(request: NextRequest, policy: RequestPolicy, secure: boolean): NextResponse {
  if (!policy || policy.kind === "api") return secured(NextResponse.next(), policy, secure);
  const headers = new Headers(request.headers);
  // Pfad der Anfrage für das Rücksprungziel nach einer abgelaufenen Sitzung (`requireSession`); ein vom Absender mitgeschickter Wert wird überschrieben
  headers.set("x-so-path", request.nextUrl.pathname + request.nextUrl.search);
  headers.delete(CSP_HEADER);
  headers.delete(CSP_REPORT_ONLY_HEADER);
  headers.set("x-nonce", policy.nonce);
  headers.set(policy.headerName, policy.value);
  return secured(NextResponse.next({ request: { headers } }), policy, secure);
}

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const secure = isSecureRequest(request.headers.get("x-forwarded-proto"));
  const policy = requestPolicy(pathname, { dev: process.env.NODE_ENV !== "production", mode: cspMode() });
  const status = startupState().status;
  if (status === "reinstall") return secured(reinstallResponse(request, policy?.nonce), policy, secure);
  if (status !== "ready") return secured(startingResponse(request, policy?.nonce), policy, secure);
  if (isSelfAuthenticated(pathname)) return passThrough(request, policy, secure);
  // Nur der Cookie-Name, der zum Übertragungsweg passt (unter HTTPS ausschließlich __Host-…), siehe lib/session-cookie.ts
  const hasSession = request.cookies.has(sessionCookieName(secure));

  if (!hasSession && !OPEN_PAGES.has(pathname)) {
    // Programmzugriffe bekommen eine Antwort, keine Weiterleitung auf eine HTML-Seite
    if (pathname.startsWith("/api/")) return secured(NextResponse.json({ error: "unauthorized" }, { status: 401 }), policy, secure);
    const url = new URL("/login", request.url);
    if (pathname !== "/") url.searchParams.set("next", pathname + search);
    return secured(NextResponse.redirect(url), policy, secure);
  }
  return passThrough(request, policy, secure);
}

// Ausgenommen: Statik, Manifest, Service Worker, Icons, der Health-Check und der Upload von Sicherungen (Verwaltung und Einrichtung). /api/v1 und /api/ical laufen durch den Proxy
// (wegen „Neuinstallation nötig“), brauchen aber kein Sitzungs-Cookie. Der Matcher muss ein Literal sein, Next liest ihn beim Build.
//
// `/api/backups/upload` läuft bewusst **nicht** durch den Proxy: Next puffert den Request-Body für den Proxy im Speicher und schneidet ihn bei
// `experimental.proxyClientMaxBodySize` (Standard 10 MiB) **stumm** ab – eine größere Sicherung käme verstümmelt (und ein Gigabyte im Speicher) an.
// Die Route prüft Sitzung, Recht, Herkunft und den Zustand „Neuinstallation nötig“ selbst und streamt den Body auf die Platte. Dasselbe gilt für `/api/setup/restore`
// (Wiederherstellung in der Einrichtung, mit Einrichtungs-Token statt Sitzung).
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|manifest\\.webmanifest|sw\\.js|icon\\.|apple-icon\\.|icons/|api/health$|api/backups/upload$|api/setup/restore$).*)"],
};

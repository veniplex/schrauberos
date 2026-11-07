import { NextResponse, type NextRequest } from "next/server";
import { reinstallHtml } from "@/lib/reinstall-text";
import { startingHtml, STARTING_RETRY_SECONDS } from "@/lib/starting-text";
import { isSecureRequest, sessionCookieName } from "@/lib/session-cookie";
import { startupState } from "@/server/startup-state";

// Nur eine schnelle, optimistische Prüfung (Cookie vorhanden?). Die echte Prüfung der Sitzung und der Berechtigungen passiert
// serverseitig in getSession()/requirePermission(). Deshalb leitet der Proxy nie „von /login weg“: Ein totes Cookie führte sonst zu
// einer Schleife (Seite → /login → /). Ob jemand wirklich angemeldet ist, entscheidet die Anmeldeseite selbst.
const OPEN_PAGES = new Set(["/login", "/login/recover", "/setup"]);

// Programmierschnittstelle (Bearer-Token) und iCal-Feed (Token in der URL) prüfen sich selbst und brauchen kein Sitzungs-Cookie.
const SELF_AUTHENTICATED = ["/api/v1", "/api/ical"];
const isSelfAuthenticated = (pathname: string) => SELF_AUTHENTICATED.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));

/**
 * Fremde Datenbank („Neuinstallation nötig“): Die App bleibt am Leben, fasst die Datenbank aber nicht an. Der Proxy beantwortet deshalb **jeden**
 * Pfad außer `/api/health` (nicht im Matcher) mit 503 – auch Server Actions, Route Handler und die Metadaten, die das Root-Layout allein nicht sperrt.
 */
function reinstallResponse(request: NextRequest): NextResponse {
  const wantsHtml = request.method === "GET" && (request.headers.get("accept") ?? "").includes("text/html");
  const headers = { "cache-control": "no-store", "retry-after": "3600" };
  if (wantsHtml) return new NextResponse(reinstallHtml(), { status: 503, headers: { ...headers, "content-type": "text/html; charset=utf-8" } });
  return NextResponse.json({ status: "reinstall" }, { status: 503, headers });
}

/**
 * Der Start läuft noch (Sicherung vor Migrationen, Migrationen – `instrumentation.ts` startet ihn im Hintergrund): **Keine** Anfrage darf eine noch nicht migrierte
 * Datenbank erreichen. Der Proxy beantwortet deshalb jeden Pfad außer `/api/health` (nicht im Matcher; meldet 503 `starting`) mit 503. Statik (`_next/static`, Icons …)
 * und der Upload von Sicherungen liegen außerhalb des Proxys: Statik fasst die Datenbank nicht an, die Upload-Route prüft den Zustand selbst.
 */
function startingResponse(request: NextRequest): NextResponse {
  const wantsHtml = request.method === "GET" && (request.headers.get("accept") ?? "").includes("text/html");
  const headers = { "cache-control": "no-store", "retry-after": String(STARTING_RETRY_SECONDS) };
  if (wantsHtml) return new NextResponse(startingHtml(), { status: 503, headers: { ...headers, "content-type": "text/html; charset=utf-8" } });
  return NextResponse.json({ status: "starting" }, { status: 503, headers });
}

export function proxy(request: NextRequest) {
  const status = startupState().status;
  if (status === "reinstall") return reinstallResponse(request);
  if (status !== "ready") return startingResponse(request);
  const { pathname, search } = request.nextUrl;
  if (isSelfAuthenticated(pathname)) return NextResponse.next();
  // Nur der Cookie-Name, der zum Übertragungsweg passt (unter HTTPS ausschließlich __Host-…), siehe lib/session-cookie.ts
  const hasSession = request.cookies.has(sessionCookieName(isSecureRequest(request.headers.get("x-forwarded-proto"))));

  if (!hasSession && !OPEN_PAGES.has(pathname)) {
    // Programmzugriffe bekommen eine Antwort, keine Weiterleitung auf eine HTML-Seite
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const url = new URL("/login", request.url);
    if (pathname !== "/") url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

// Ausgenommen: Statik, Manifest, Service Worker, Icons, der Health-Check und der Upload von Sicherungen. /api/v1 und /api/ical laufen durch den Proxy
// (wegen „Neuinstallation nötig“), brauchen aber kein Sitzungs-Cookie. Der Matcher muss ein Literal sein, Next liest ihn beim Build.
//
// `/api/backups/upload` läuft bewusst **nicht** durch den Proxy: Next puffert den Request-Body für den Proxy im Speicher und schneidet ihn bei
// `experimental.proxyClientMaxBodySize` (Standard 10 MiB) **stumm** ab – eine größere Sicherung käme verstümmelt (und ein Gigabyte im Speicher) an.
// Die Route prüft Sitzung, Recht, Herkunft und den Zustand „Neuinstallation nötig“ selbst und streamt den Body auf die Platte.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|manifest\\.webmanifest|sw\\.js|icon\\.|apple-icon\\.|icons/|api/health$|api/backups/upload$).*)"],
};

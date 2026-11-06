import { NextResponse, type NextRequest } from "next/server";
import { isSecureRequest, sessionCookieName } from "@/lib/session-cookie";

// Nur eine schnelle, optimistische Prüfung (Cookie vorhanden?). Die echte Prüfung der Sitzung und der Berechtigungen passiert
// serverseitig in getSession()/requirePermission(). Deshalb leitet der Proxy nie „von /login weg“: Ein totes Cookie führte sonst zu
// einer Schleife (Seite → /login → /). Ob jemand wirklich angemeldet ist, entscheidet die Anmeldeseite selbst.
const OPEN_PAGES = new Set(["/login", "/login/recover", "/setup"]);

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
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

// Ausgenommen (eigene Anmeldung bzw. öffentlich): Statik, Manifest, Service Worker, Icons, Health-Check, die Programmierschnittstelle
// /api/v1 (Bearer-Token) und der iCal-Feed (Token in der URL). Der Matcher muss ein Literal sein, Next liest ihn beim Build.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|manifest\\.webmanifest|sw\\.js|icon\\.|apple-icon\\.|icons/|api/health$|api/v1(?:/|$)|api/ical/).*)"],
};

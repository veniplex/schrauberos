import { NextResponse, type NextRequest } from "next/server";

// Nur eine schnelle, optimistische Prüfung (Cookie vorhanden?). Die echte Prüfung der Sitzung
// und der Berechtigungen passiert serverseitig in getSession()/requirePermission().
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const hasSession = request.cookies.has("so_session");

  if (!hasSession && pathname !== "/login" && pathname !== "/setup") {
    const url = new URL("/login", request.url);
    if (pathname !== "/") url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }
  if (hasSession && pathname === "/login") {
    return NextResponse.redirect(new URL("/", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/health).*)"],
};

import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { deliveryHeaders } from "@/lib/file-delivery";
import { parseLogoDataUrl } from "@/lib/logo";
import { db } from "@/server/db";

/**
 * Das Werkstatt-Logo – **öffentlich lesbar** (die Anmeldeseite zeigt es, bevor sich jemand anmeldet; es ist kein Geheimnis). Nur die Rasterformate aus `lib/logo.ts`, geprüft
 * beim Hochladen an den ersten Bytes (`upload-sniff.ts`); ein früher gespeichertes SVG antwortet mit 404. Auslieferung über `deliveryHeaders` (`nosniff`, `sandbox; default-src 'none'`),
 * zwischengespeichert mit ETag: Die Adresse trägt `?v=` (Änderungszeit des Profils), ein geändertes Logo hat also eine neue Adresse; ohne `v` prüft der Browser nach einer Stunde.
 */
export async function GET(request: NextRequest) {
  const row = await db.workshop.findUnique({ where: { id: "default" }, select: { logoDataUrl: true } });
  const logo = parseLogoDataUrl(row?.logoDataUrl);
  if (!logo) return new NextResponse("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

  const etag = `"${createHash("sha256").update(logo.data).digest("hex").slice(0, 32)}"`;
  const headers: Record<string, string> = { ...deliveryHeaders({ mime: logo.mime, name: "logo", cacheControl: "public, max-age=3600" }), ETag: etag };
  if (request.headers.get("if-none-match")?.split(",").some((value) => value.trim() === etag)) {
    // 304 hat keinen Körper: ohne Content-Disposition (der Browser behält die Kopfzeilen der gespeicherten Antwort)
    delete headers["Content-Disposition"];
    return new NextResponse(null, { status: 304, headers });
  }
  return new NextResponse(new Uint8Array(logo.data), { status: 200, headers: { ...headers, "Content-Length": String(logo.data.length) } });
}

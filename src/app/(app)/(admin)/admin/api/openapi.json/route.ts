import { errorResponse } from "@/lib/file-delivery";
import { apiDocument } from "@/server/api/doc";
import { getSession } from "@/server/auth/session";

export const dynamic = "force-dynamic";

/**
 * Die OpenAPI-Beschreibung (JSON) für die Verwaltung: nur mit Sitzung und Recht `api.manage` – dieselbe Beschreibung wie `GET /api/v1/openapi.json`, das ein gültiges Token verlangt. Sie nennt nur
 * Struktur der Endpunkte aktiver Funktionen, keine Daten. Die Sitzung gilt hier, ein Token nie (Cookie und Token bleiben getrennt).
 */
export async function GET() {
  const session = await getSession();
  if (!session || session.user.mustChangePassword || session.user.mustSetupTwoFactor) return errorResponse(401, "Unauthorized");
  if (!session.can("api.manage")) return errorResponse(403, "Forbidden");
  return new Response(JSON.stringify(apiDocument(session.features), null, 2), {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "content-disposition": 'inline; filename="schrauberos-openapi.json"' },
  });
}

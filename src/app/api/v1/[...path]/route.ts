import { handleApiRequest } from "@/server/api/router";

/**
 * Programmierschnittstelle `/api/v1/*` – ein Eintrittspunkt für alle Ressourcen der Funktionen (`src/modules/api.ts`). Die Pipeline (Bearer-Token,
 * Rate-Limit, Funktion aktiv, Recht, Idempotenz, Fehlerformat) steht in `src/server/api/router.ts`. Das Sitzungs-Cookie wird hier nie gelesen.
 */
export const dynamic = "force-dynamic";

const handler = (request: Request) => handleApiRequest(request);

export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE, handler as HEAD, handler as OPTIONS };

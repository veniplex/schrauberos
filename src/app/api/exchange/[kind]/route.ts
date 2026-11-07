import { type NextRequest } from "next/server";
import { EXPORTS } from "@/modules/exchange";
import { handleExport } from "@/server/csv/handlers";

export const dynamic = "force-dynamic";

/** CSV-Export (`/api/exchange/<art>`): Sitzung, Herkunft, Funktion, Recht und Audit prüft `handleExport` (`src/server/csv/handlers.ts`). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  return handleExport(request, kind, EXPORTS);
}

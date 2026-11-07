import { type NextRequest } from "next/server";
import { IMPORTS } from "@/modules/exchange";
import { handleImport } from "@/server/csv/handlers";

export const dynamic = "force-dynamic";

/** CSV-Import (`/api/exchange/<art>/import`, `mode=preview|apply`): Sitzung, Herkunft, Länge, Recht, Vorschau und Anwenden in `handleImport` (`src/server/csv/handlers.ts`). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  return handleImport(request, kind, IMPORTS);
}

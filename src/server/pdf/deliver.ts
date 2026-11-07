import { deliveryHeaders } from "@/lib/file-delivery";

/**
 * Auslieferung eines erzeugten PDF: dieselben Kopfzeilen wie jede gespeicherte Datei (`deliveryHeaders`: `nosniff`, PDF inline nur zum Einbetten in dieselbe Herkunft, sicherer Dateiname,
 * `private, no-store`). Die **Rechteprüfung** gehört in die Route der Funktion, die das Dokument erzeugt (Beispiel: `app/api/invoices/[id]/file/route.ts`) – sie prüft Sitzung und Recht
 * **vor** der Erzeugung (kein Rechenaufwand für Unberechtigte) und ruft dann diese Funktion. Ein erzeugtes PDF wird nicht gespeichert, es entsteht bei jedem Abruf aus den Daten neu
 * (oder als festgeschriebener Beleg über `files.ts`, siehe F3).
 */
export function pdfResponse(bytes: Uint8Array, options: { name: string; download?: boolean }): Response {
  const name = /\.pdf$/i.test(options.name) ? options.name : `${options.name}.pdf`;
  return new Response(new Uint8Array(bytes), { headers: deliveryHeaders({ mime: "application/pdf", name, download: options.download, size: bytes.byteLength }) });
}

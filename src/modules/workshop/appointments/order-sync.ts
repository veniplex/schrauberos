/**
 * Terminstatus zum Auftragsstatus (Hook auf die Operationen der Aufträge, atomar in derselben Transaktion): Beginn der Arbeit → „In Arbeit“, Abschluss („Abgeholt“) → „Erledigt“; beim
 * Wiederöffnen eines abgeschlossenen Auftrags ist ein erledigter Termin wieder „In Arbeit“. Alles andere (Angenommen, Fertig, Storniert) lässt den Termin, wie er ist – insbesondere
 * wird er durch das Stornieren eines Auftrags nie abgesagt. Liefert `null`, wenn der Termin unverändert bleibt. `from`: bisheriger Terminstatus.
 */
export function appointmentStatusForOrder(operation: "orders.setStatus" | "orders.close" | "orders.reopen", orderStatus: string, from: string): "in_progress" | "done" | null {
  if (operation === "orders.reopen") return from === "done" ? "in_progress" : null;
  if (orderStatus === "in_progress" && (from === "scheduled" || from === "confirmed")) return "in_progress";
  if (orderStatus === "picked_up" && (from === "scheduled" || from === "confirmed" || from === "in_progress")) return "done";
  return null;
}

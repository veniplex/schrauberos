/**
 * „Bis“ zieht „Von“ nach: Wer im Formular den Beginn einer Abwesenheit verschiebt, meint meist denselben Tag oder einen späteren Zeitraum. Das Ende folgt dem neuen Beginn,
 * wenn es leer ist, davor läge oder noch auf dem alten Beginn stand (also nicht bewusst später gesetzt wurde); ein bewusst gesetztes späteres Ende bleibt.
 * Datumswerte sind `JJJJ-MM-TT` (Vergleich als Text ist chronologisch).
 */
export function endAfterStartChange(end: string, previousStart: string, nextStart: string): string {
  if (!nextStart) return end;
  return end === "" || end < nextStart || end === previousStart ? nextStart : end;
}

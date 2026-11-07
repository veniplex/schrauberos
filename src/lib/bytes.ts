/** Größenangaben für die Anzeige: Zahl und Einheit getrennt, damit die Zahl in der Sprache der Oberfläche formatiert werden kann (Dezimaltrenner). 1 KB = 1024 Byte. */
const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

export function splitBytes(bytes: number): { value: number; unit: (typeof UNITS)[number] } {
  let value = Math.max(0, bytes);
  let index = 0;
  while (value >= 1024 && index < UNITS.length - 1) {
    value /= 1024;
    index += 1;
  }
  return { value, unit: UNITS[index] };
}

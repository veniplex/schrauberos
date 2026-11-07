/**
 * iCalendar (RFC 5545) für das Kalender-Abo (F10): reine Textfunktionen ohne Datenbank, ohne Zeitzonen-Bibliothek, getestet. Entscheidungen:
 *
 *  - **Zeitpunkte in UTC** (`DTSTART:20261109T080000Z`): Der Instant ist eindeutig, die Sommerzeit-Umstellung der Werkstatt spielt keine Rolle (es gibt keine Serientermine, die sie verschieben könnte);
 *    das Kalenderprogramm zeigt die Zeit in der Zone des Geräts. **Ganztägige** Einträge (Abwesenheit, Frist) als `VALUE=DATE` mit exklusivem Ende (RFC 5545 3.6.1).
 *  - **Zeilenfaltung** nach 75 Oktetten (UTF-8), nie mitten in einem Zeichen; Folgezeilen beginnen mit einem Leerzeichen. Zeilenende CRLF.
 *  - **Escaping** von Textwerten (3.3.11): Rückwärtsschrägstrich, Semikolon, Komma, Zeilenumbruch. **Schutz gegen Einschleusen von Zeilen:** Zeilenumbrüche aus Nutzertexten werden zu `\n`, alle übrigen
 *    Steuerzeichen und die Unicode-Zeilentrenner entfernt – ein Termintitel kann keine eigene Eigenschaft (`ATTENDEE`, `URL`) hinzufügen. Namen von Eigenschaften und Parametern sind feste Texte im Code.
 *  - **UID stabil** (aus der Kennung der Sache), `DTSTAMP`/`LAST-MODIFIED` aus dem Änderungszeitpunkt (nicht „jetzt“): dieselben Daten ergeben dieselbe Datei. Für abgeleitete Einträge (Fristen) wählt der
 *    Aufrufer einen **festen** Zeitpunkt, sonst änderte sich die Datei täglich. `SEQUENCE` (optional) ist die Revisionsnummer; der Aufrufer leitet sie monoton aus dem Änderungszeitpunkt ab.
 *  - **Erst kürzen, dann maskieren** (`clampText`): Texte werden bereinigt, auf ganze Schriftzeichen gekürzt (nie mitten in einem Ersatzzeichenpaar oder einer Emoji-Folge) und erst danach maskiert –
 *    ein Escape wird nie zerschnitten.
 */

import { addDaysToKey } from "./zone";

const CRLF = "\r\n";
const encoder = new TextEncoder();

/** Steuerzeichen (außer Tabulator und Zeilenumbruch), Unicode-Zeilen-/Absatztrenner, Umkehrzeichen (Bidi) und das Nullbreiten-Leerzeichen – kommen in keinem Text vor. Verbindungszeichen (U+200C/U+200D) bleiben: Emoji-Folgen (Familie, Hautton) und Schriften wie Persisch brauchen sie. */
const UNWANTED = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/g;

/** Zeilenumbrüche vereinheitlichen und unerwünschte Zeichen entfernen (noch nicht maskiert). */
const clean = (value: string): string => value.replace(/\r\n?/g, "\n").replace(UNWANTED, "");

const escapeClean = (value: string): string => value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");

/** Textwert nach RFC 5545 3.3.11 maskieren; Zeilenumbrüche (CR, LF, CRLF) werden zu `\n`. */
export function escapeText(value: string): string {
  return escapeClean(clean(value));
}

const segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;

/**
 * Erst bereinigen, dann auf höchstens `max` Schriftzeichen kürzen (ganze Graphem-Cluster: ein Emoji mit Hautton oder eine Familien-Folge mit Verbindungszeichen bleibt ganz oder fällt ganz weg),
 * ein gekürzter Text endet auf „…“ – und **danach** erst maskieren. So entsteht nie ein halbes Escape (eine Zeile, die auf einem einzelnen Rückwärtsschrägstrich endet) oder ein einzelnes Ersatzzeichen.
 */
export function clampText(value: string, max: number): string {
  const text = clean(value);
  const parts = segmenter ? Array.from(segmenter.segment(text), (s) => s.segment) : Array.from(text);
  if (Array.from(text).length <= max) return escapeClean(text);
  const kept: string[] = [];
  let count = 0;
  for (const part of parts) {
    const size = Array.from(part).length;
    if (count + size > max - 1) break;
    kept.push(part);
    count += size;
  }
  return escapeClean(`${kept.join("")}…`);
}

/** Eine Zeile auf höchstens 75 Oktette je Zeile falten (RFC 5545 3.1); ein Zeichen wird nie geteilt. Das Ergebnis enthält die CRLF zwischen den Teilen, nicht am Ende. */
export function foldLine(line: string): string {
  if (encoder.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let bytes = 0;
  let limit = 75;
  for (const char of line) {
    const size = encoder.encode(char).length;
    if (bytes + size > limit) {
      parts.push(current);
      current = "";
      bytes = 0;
      limit = 74; // die Folgezeile beginnt mit einem Leerzeichen (zählt mit)
    }
    current += char;
    bytes += size;
  }
  parts.push(current);
  return parts.join(`${CRLF} `);
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** Zeitpunkt in UTC: `YYYYMMDDTHHMMSSZ`. */
export function utcStamp(date: Date): string {
  return `${pad(date.getUTCFullYear(), 4)}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

/** Kalendertag `JJJJ-MM-TT` → `JJJJMMTT`; `null` bei ungültiger Form. */
export function dateValue(day: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  return m ? `${m[1]}${m[2]}${m[3]}` : null;
}

export type IcalStatus = "CONFIRMED" | "TENTATIVE" | "CANCELLED";

type IcalBase = {
  /** Kennung, stabil und von Dauer; nur `A–Z a–z 0–9 . _ -` (wird nicht maskiert, sondern geprüft) */
  uid: string;
  /** Zeitpunkt der letzten Änderung (`DTSTAMP` und `LAST-MODIFIED`) */
  modified: Date;
  summary: string;
  description?: string;
  /** Revisionsnummer (ganze Zahl ≥ 0); fehlt sie, steht keine `SEQUENCE` im Eintrag */
  sequence?: number;
  url?: string;
  status?: IcalStatus;
};
/** Termin mit Uhrzeit: Anfang und Ende als Zeitpunkte. */
export type IcalTimed = IcalBase & { start: Date; end: Date; allDay?: false };
/** Ganztägig: `startDay` und `endDay` (einschließlich) als `JJJJ-MM-TT`. */
export type IcalAllDay = IcalBase & { allDay: true; startDay: string; endDay: string };
export type IcalEvent = IcalTimed | IcalAllDay;

const UID_SHAPE = /^[A-Za-z0-9._-]{1,120}$/;

/** `JJJJ-MM-TT` + n Tage (reiner Kalender, ohne Zone) – dieselbe Rechnung wie überall (`lib/zone.ts`). */
export const addDayToKey = addDaysToKey;

function eventLines(event: IcalEvent, domain: string): string[] | null {
  if (!UID_SHAPE.test(event.uid)) return null;
  const lines = ["BEGIN:VEVENT", `UID:${event.uid}@${domain}`, `DTSTAMP:${utcStamp(event.modified)}`, `LAST-MODIFIED:${utcStamp(event.modified)}`];
  if (event.allDay) {
    const start = dateValue(event.startDay);
    const endExclusive = dateValue(addDayToKey(event.endDay >= event.startDay ? event.endDay : event.startDay, 1));
    if (!start || !endExclusive) return null;
    lines.push(`DTSTART;VALUE=DATE:${start}`, `DTEND;VALUE=DATE:${endExclusive}`, "TRANSP:TRANSPARENT");
  } else {
    if (Number.isNaN(event.start.getTime())) return null;
    lines.push(`DTSTART:${utcStamp(event.start)}`);
    // DTEND muss nach DTSTART liegen; ein Ende davor oder gleich ergibt einen Termin ohne Dauer (kein DTEND)
    if (event.end.getTime() > event.start.getTime()) lines.push(`DTEND:${utcStamp(event.end)}`);
  }
  lines.push(`SUMMARY:${clampText(event.summary, 500)}`);
  if (event.description) lines.push(`DESCRIPTION:${clampText(event.description, 2000)}`);
  if (event.sequence !== undefined && Number.isInteger(event.sequence) && event.sequence >= 0) lines.push(`SEQUENCE:${event.sequence}`);
  // URL ist ein URI-Wert (kein Text): nur eine einfache http(s)-Adresse ohne Leerraum und Steuerzeichen
  if (event.url && /^https?:\/\/[^\s\u0000-\u001f\u007f-\u009f]+$/.test(event.url)) lines.push(`URL:${event.url}`);
  if (event.status) lines.push(`STATUS:${event.status}`);
  lines.push("END:VEVENT");
  return lines;
}

/**
 * Der ganze Kalender (`BEGIN:VCALENDAR` … `END:VCALENDAR`), Zeilenende CRLF, jede Zeile gefaltet. Ungültige Einträge (UID mit unzulässigen Zeichen, kaputtes Datum) werden ausgelassen, nie
 * halb geschrieben. `name` ist der Anzeigename des Kalenders im Kalenderprogramm; `domain` der Teil nach dem @ der UID.
 */
export function buildCalendar(options: { name: string; domain?: string; events: readonly IcalEvent[]; refreshHours?: number }): string {
  const domain = options.domain ?? "schrauberos";
  const refresh = `PT${Math.max(1, Math.floor(options.refreshHours ?? 1))}H`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//SchrauberOS//Kalender-Abo//DE",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${clampText(options.name, 120)}`,
    `REFRESH-INTERVAL;VALUE=DURATION:${refresh}`,
    `X-PUBLISHED-TTL:${refresh}`,
  ];
  for (const event of options.events) {
    const block = eventLines(event, domain);
    if (block) lines.push(...block);
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join(CRLF) + CRLF;
}

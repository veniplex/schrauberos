import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addDayToKey, buildCalendar, dateValue, escapeText, foldLine, utcStamp, type IcalEvent } from "./ical";

/**
 * iCalendar (RFC 5545), gegen die Regeln des Standards geprüft: Maskierung, Zeilenfaltung nach 75 Oktetten (nie mitten im Zeichen), CRLF, Einschleusen von Zeilen, Zeitpunkte in UTC über die
 * Sommerzeit-Umstellung hinweg, ganztägige Einträge mit exklusivem Ende, stabile UID.
 */
const MODIFIED = new Date("2026-11-01T12:00:00Z");
const timed = (extra: Partial<IcalEvent> = {}): IcalEvent => ({ uid: "appointment-abc123", modified: MODIFIED, summary: "Räderwechsel", start: new Date("2026-11-09T08:00:00Z"), end: new Date("2026-11-09T09:30:00Z"), ...extra }) as IcalEvent;
const unfold = (text: string) => text.replace(/\r\n[ \t]/g, "");
const octets = (line: string) => new TextEncoder().encode(line).length;

describe("escapeText (RFC 5545 3.3.11)", () => {
  it("maskiert Rückwärtsschrägstrich, Semikolon, Komma und Zeilenumbruch", () => {
    assert.equal(escapeText("a, b; c\\d"), "a\\, b\\; c\\\\d");
    assert.equal(escapeText("Zeile 1\nZeile 2"), "Zeile 1\\nZeile 2");
    assert.equal(escapeText("Zeile 1\r\nZeile 2\rZeile 3"), "Zeile 1\\nZeile 2\\nZeile 3");
  });

  it("schützt vor dem Einschleusen von Zeilen: CRLF, Zeilentrenner und Steuerzeichen aus Nutzertexten werden nie zu einer eigenen Zeile", () => {
    const LS = String.fromCharCode(0x2028), PS = String.fromCharCode(0x2029), NEL = String.fromCharCode(0x0085), NUL = String.fromCharCode(0x0000), BEL = String.fromCharCode(0x0007), ESC = String.fromCharCode(0x001b);
    const hostile = ["Titel\r\nATTENDEE:mailto:evil@example.org", "Titel\nURL:https://evil.example", `Titel${LS}ORGANIZER:x`, `Titel${PS}X:y`, `Titel${NEL}X:y`, `Titel${NUL}${BEL}${ESC}END:VEVENT`];
    for (const value of hostile) {
      const escaped = escapeText(value);
      const forbidden = new RegExp("[" + [0x0d, 0x0a, 0x2028, 0x2029, 0x85, 0x00, 0x07, 0x1b].map((code) => String.fromCharCode(code)).join("") + "]");
      assert.ok(!forbidden.test(escaped), `${JSON.stringify(value)} → ${JSON.stringify(escaped)}`);
    }
    const calendar = buildCalendar({ name: "Werkstatt\r\nBEGIN:VEVENT", events: [timed({ summary: "Titel\r\nATTENDEE:mailto:evil@example.org\r\nEND:VEVENT\r\nBEGIN:VEVENT", description: "Zeile\r\nURL:https://evil.example" })] });
    const lines = unfold(calendar).split("\r\n");
    assert.equal(lines.filter((l) => l === "BEGIN:VEVENT").length, 1, "genau ein Termin");
    assert.equal(lines.filter((l) => l === "END:VEVENT").length, 1);
    assert.ok(!lines.some((l) => l.startsWith("ATTENDEE") || l.startsWith("URL:https://evil")), "keine eingeschleuste Eigenschaft");
    assert.ok(lines.some((l) => l.startsWith("SUMMARY:Titel\\nATTENDEE:mailto:evil@example.org")), "der Text steht maskiert in der Zusammenfassung");
  });

  it("entfernt Umkehrzeichen und Nullbreitenzeichen, lässt Umlaute, Euro und Emoji unberührt", () => {
    assert.equal(escapeText(`a${String.fromCharCode(0x202e)}b${String.fromCharCode(0x200b)}c`), "abc");
    assert.equal(escapeText("Öl für 12 € 🚗"), "Öl für 12 € 🚗");
  });
});

describe("foldLine (RFC 5545 3.1)", () => {
  it("kurze Zeilen bleiben unverändert", () => {
    assert.equal(foldLine("SUMMARY:kurz"), "SUMMARY:kurz");
    assert.equal(foldLine("x".repeat(75)), "x".repeat(75));
  });

  it("lange Zeilen: höchstens 75 Oktette je Zeile, Folgezeilen mit Leerzeichen; Entfalten ergibt das Original", () => {
    const line = `SUMMARY:${"abcdefghij".repeat(40)}`;
    const folded = foldLine(line);
    const parts = folded.split("\r\n");
    assert.ok(parts.length > 1);
    for (const part of parts) assert.ok(octets(part) <= 75, `${octets(part)} Oktette`);
    for (const part of parts.slice(1)) assert.ok(part.startsWith(" "));
    assert.equal(unfold(folded), line);
  });

  it("teilt nie mitten in einem Zeichen: 2-, 3- und 4-Byte-Zeichen (Ä, €, Emoji) bleiben ganz", () => {
    for (const unit of ["Ä", "€", "🚗", "Äß€🚗"]) {
      const line = `SUMMARY:${unit.repeat(120)}`;
      const folded = foldLine(line);
      for (const part of folded.split("\r\n")) {
        assert.ok(octets(part) <= 75, `${unit}: ${octets(part)} Oktette`);
        // jedes Teilstück ist gültiges UTF-8 (nichts Halbes)
        assert.equal(new TextDecoder("utf-8", { fatal: true }).decode(new TextEncoder().encode(part)), part);
      }
      assert.equal(unfold(folded), line, unit);
    }
  });

  it("die Grenze liegt exakt bei 75 Oktetten in der ersten und 74 + Leerzeichen in den Folgezeilen", () => {
    const folded = foldLine("a".repeat(200)).split("\r\n");
    assert.equal(folded[0].length, 75);
    assert.equal(folded[1].length, 75);
    assert.equal(folded.join("").replace(/ /g, "").length, 200);
  });
});

describe("Zeitwerte", () => {
  it("utcStamp: JJJJMMTTTHHMMSSZ", () => {
    assert.equal(utcStamp(new Date("2026-11-09T08:05:09Z")), "20261109T080509Z");
    assert.equal(utcStamp(new Date("2026-01-01T00:00:00Z")), "20260101T000000Z");
  });

  it("dateValue und addDayToKey rechnen auf Kalendertagen (Monats-, Jahres- und Schaltjahrgrenze)", () => {
    assert.equal(dateValue("2026-11-09"), "20261109");
    assert.equal(dateValue("2026-1-9"), null);
    assert.equal(addDayToKey("2026-11-30", 1), "2026-12-01");
    assert.equal(addDayToKey("2026-12-31", 1), "2027-01-01");
    assert.equal(addDayToKey("2028-02-28", 1), "2028-02-29");
    assert.equal(addDayToKey("2026-03-29", 1), "2026-03-30");
  });

  it("Termine in UTC: der Instant bleibt über die Sommerzeit-Umstellung der Werkstatt unverändert (Berlin: 29.3.2026 02:00 → 03:00)", () => {
    // 10:00 Ortszeit Berlin am Tag der Umstellung = 08:00 UTC (MESZ), am Tag davor 09:00 UTC (MEZ)
    const before = buildCalendar({ name: "x", events: [timed({ start: new Date("2026-03-28T09:00:00Z"), end: new Date("2026-03-28T10:00:00Z") })] });
    const after = buildCalendar({ name: "x", events: [timed({ uid: "b", start: new Date("2026-03-29T08:00:00Z"), end: new Date("2026-03-29T09:00:00Z") })] });
    assert.ok(before.includes("DTSTART:20260328T090000Z"));
    assert.ok(after.includes("DTSTART:20260329T080000Z"));
    // der Termin in der Lücke 02:30 (gibt es nicht) ist als Instant 01:30 UTC eindeutig
    assert.ok(buildCalendar({ name: "x", events: [timed({ start: new Date("2026-03-29T01:30:00Z"), end: new Date("2026-03-29T02:00:00Z") })] }).includes("DTSTART:20260329T013000Z"));
  });

  it("über Mitternacht: Beginn und Ende an verschiedenen Tagen; Ende vor/gleich Beginn ergibt einen Termin ohne DTEND", () => {
    const night = buildCalendar({ name: "x", events: [timed({ start: new Date("2026-11-09T22:30:00Z"), end: new Date("2026-11-10T07:00:00Z") })] });
    assert.ok(night.includes("DTSTART:20261109T223000Z") && night.includes("DTEND:20261110T070000Z"));
    const same = buildCalendar({ name: "x", events: [timed({ end: new Date("2026-11-09T08:00:00Z") })] });
    assert.ok(!same.includes("DTEND"));
  });
});

describe("Kalender (RFC 5545 4.6)", () => {
  const allDay: IcalEvent = { uid: "absence-1", modified: MODIFIED, summary: "Abwesend: Max Mustermann", allDay: true, startDay: "2026-12-30", endDay: "2027-01-02" };

  it("Aufbau: VCALENDAR mit Pflichtangaben, CRLF überall, Ende mit CRLF", () => {
    const text = buildCalendar({ name: "Werkstatt Müller – Termine", events: [timed()] });
    assert.ok(text.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:"));
    assert.ok(text.endsWith("END:VCALENDAR\r\n"));
    assert.ok(!/(^|[^\r])\n/.test(text), "nur CRLF als Zeilenende");
    assert.ok(text.includes("CALSCALE:GREGORIAN") && text.includes("METHOD:PUBLISH"));
    assert.ok(text.includes("X-WR-CALNAME:Werkstatt Müller – Termine"));
    for (const line of text.split("\r\n")) assert.ok(octets(line) <= 75, `Zeile zu lang: ${line}`);
  });

  it("Termin: stabile UID, DTSTAMP und LAST-MODIFIED aus dem Änderungszeitpunkt, UTC-Zeiten; gleiche Daten ergeben dieselbe Datei", () => {
    const a = buildCalendar({ name: "x", events: [timed()] });
    const b = buildCalendar({ name: "x", events: [timed()] });
    assert.equal(a, b);
    assert.ok(a.includes("UID:appointment-abc123@schrauberos"));
    assert.ok(a.includes("DTSTAMP:20261101T120000Z") && a.includes("LAST-MODIFIED:20261101T120000Z"));
    assert.ok(a.includes("DTSTART:20261109T080000Z") && a.includes("DTEND:20261109T093000Z"));
    assert.ok(a.includes("SUMMARY:Räderwechsel"));
  });

  it("ganztägig: VALUE=DATE, Ende exklusiv (Folgetag), über den Jahreswechsel; eintägig und vertauschtes Ende sind ein Tag", () => {
    const text = buildCalendar({ name: "x", events: [allDay, { ...allDay, uid: "absence-2", startDay: "2026-03-29", endDay: "2026-03-29" }, { ...allDay, uid: "absence-3", startDay: "2026-05-10", endDay: "2026-05-01" }] });
    assert.ok(text.includes("DTSTART;VALUE=DATE:20261230") && text.includes("DTEND;VALUE=DATE:20270103"));
    assert.ok(text.includes("DTSTART;VALUE=DATE:20260329") && text.includes("DTEND;VALUE=DATE:20260330"), "Umstellungstag: ein ganzer Tag");
    assert.ok(text.includes("DTSTART;VALUE=DATE:20260510") && text.includes("DTEND;VALUE=DATE:20260511"));
    assert.ok(text.includes("TRANSP:TRANSPARENT"), "Abwesenheit und Frist blockieren den Kalender nicht");
  });

  it("lange Zusammenfassungen werden gefaltet und sind entfaltet vollständig", () => {
    const summary = `Räderwechsel Winter, Sommer; ${"sehr lange Bezeichnung ".repeat(10)}`;
    const text = buildCalendar({ name: "x", events: [timed({ summary })] });
    for (const line of text.split("\r\n")) assert.ok(octets(line) <= 75);
    assert.ok(unfold(text).includes(`SUMMARY:${escapeText(summary)}`));
  });

  it("ungültige Einträge (UID mit Sonderzeichen, kaputtes Datum, kaputter Zeitpunkt) fallen ganz weg; URL nur als einfache http(s)-Adresse", () => {
    const text = buildCalendar({
      name: "x",
      events: [timed({ uid: "böse\r\nUID:x" }), timed({ uid: "ok-1", url: "javascript:alert(1)" }), timed({ uid: "ok-2", url: "https://werkstatt.example/appointments?show=abc" }), timed({ uid: "ok-3", url: "https://a.example/x\r\nATTENDEE:y" }), { ...allDay, uid: "kaputt", startDay: "2026-13-45x" }, timed({ uid: "zeit", start: new Date("nein") })],
    });
    const lines = unfold(text).split("\r\n");
    assert.equal(lines.filter((l) => l === "BEGIN:VEVENT").length, 3, "nur ok-1, ok-2 und ok-3 bleiben");
    assert.ok(!lines.some((l) => l.startsWith("URL:javascript")));
    assert.ok(lines.includes("URL:https://werkstatt.example/appointments?show=abc"));
    assert.ok(!lines.some((l) => l.startsWith("ATTENDEE")));
    assert.ok(!lines.some((l) => l.startsWith("URL:https://a.example")), "eine URL mit Zeilenumbruch wird verworfen");
  });

  it("Status wird übernommen; ohne Einträge entsteht ein gültiger leerer Kalender", () => {
    assert.ok(buildCalendar({ name: "x", events: [timed({ status: "CANCELLED" })] }).includes("STATUS:CANCELLED"));
    const empty = buildCalendar({ name: "x", events: [] });
    assert.ok(empty.includes("BEGIN:VCALENDAR") && empty.includes("END:VCALENDAR") && !empty.includes("BEGIN:VEVENT"));
  });
});

describe("Kürzen vor dem Maskieren (clampText)", () => {
  const BS = String.fromCharCode(92);
  const lineOf = (text: string, name: string) => unfold(text).split("\r\n").find((l) => l.startsWith(`${name}:`)) ?? "";
  /** der Wert endet nie auf einem unpaarigen Rückwärtsschrägstrich (halbes Escape) */
  const endsWithHalfEscape = (value: string) => /(^|[^\\])(\\\\)*\\$/.test(value);

  it("ein Komma an der Grenze: das Escape wird nie zerschnitten (die Zeile endet nicht auf einem einzelnen Rückwärtsschrägstrich)", () => {
    for (const filler of [498, 499, 500, 501]) {
      const summary = `${"x".repeat(filler)},,,y`;
      const value = lineOf(buildCalendar({ name: "x", events: [timed({ summary })] }), "SUMMARY").slice("SUMMARY:".length);
      assert.ok(!endsWithHalfEscape(value), `${filler}: ${value.slice(-8)}`);
      assert.ok(value.endsWith("…"), "ein gekürzter Text endet auf „…“");
    }
    // Rückwärtsschrägstriche selbst: jeder wird ganz maskiert
    const value = lineOf(buildCalendar({ name: "x", events: [timed({ summary: `${"x".repeat(497)}${BS}${BS}${BS}end` })] }), "SUMMARY").slice("SUMMARY:".length);
    assert.ok(!endsWithHalfEscape(value));
    assert.equal(escapeText(`a${BS}b`), `a${BS}${BS}b`);
  });

  it("ein Emoji (Ersatzzeichenpaar) und eine Familien-Folge mit Verbindungszeichen werden nie geteilt", () => {
    const family = "👨‍👩‍👧‍👦"; // vier Personen, drei Zero-Width-Joiner
    const flag = "🇩🇪";
    for (const emoji of ["😀", family, flag, "👍🏽"]) {
      for (let pad = 494; pad <= 500; pad++) {
        const text = buildCalendar({ name: "x", events: [timed({ summary: `${"a".repeat(pad)}${emoji}${emoji}` })] });
        const value = unfold(text).split("\r\n").find((l) => l.startsWith("SUMMARY:"))!.slice("SUMMARY:".length);
        // kein einzelnes Ersatzzeichen, kein Verbindungszeichen am Ende, kein halbes Emoji
        assert.ok(!/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(value), `${emoji} bei ${pad}: einzelnes Ersatzzeichen`);
        assert.ok(!value.replace("…", "").endsWith("‍"), `${emoji} bei ${pad}: endet auf Verbindungszeichen`);
        const withoutPad = value.replace(/^a+/, "").replace("…", "");
        assert.ok(withoutPad === "" || withoutPad === emoji || withoutPad === emoji + emoji, `${emoji} bei ${pad}: ganz oder gar nicht, war ${JSON.stringify(withoutPad)}`);
        // die Zeile bleibt gültiges UTF-8 (kein U+FFFD)
        assert.ok(!text.includes("�"));
      }
    }
  });

  it("die Beschreibung (2000) und der Kalendername (120) werden ebenso gekürzt; kurze Texte bleiben unverändert", () => {
    const text = buildCalendar({ name: `${"n".repeat(119)},,`, events: [timed({ description: `${"d".repeat(1999)},x` })] });
    const name = lineOf(text, "X-WR-CALNAME").slice("X-WR-CALNAME:".length);
    const description = lineOf(text, "DESCRIPTION").slice("DESCRIPTION:".length);
    assert.ok(!endsWithHalfEscape(name) && name.endsWith("…") && !endsWithHalfEscape(description) && description.endsWith("…"));
    assert.equal(lineOf(buildCalendar({ name: "Kurz", events: [timed({ summary: "Räder, Winter" })] }), "SUMMARY"), `SUMMARY:Räder${BS}, Winter`);
  });

  it("SEQUENCE steht nur, wenn sie angegeben ist (ganze Zahl ≥ 0)", () => {
    assert.ok(!buildCalendar({ name: "x", events: [timed()] }).includes("SEQUENCE"));
    assert.ok(buildCalendar({ name: "x", events: [timed({ sequence: 7 })] }).includes("SEQUENCE:7\r\n"));
    assert.ok(buildCalendar({ name: "x", events: [timed({ sequence: 0 })] }).includes("SEQUENCE:0\r\n"));
    for (const bad of [-1, 1.5, Number.NaN]) assert.ok(!buildCalendar({ name: "x", events: [timed({ sequence: bad })] }).includes("SEQUENCE"));
  });
});

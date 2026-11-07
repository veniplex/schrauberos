import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  checkMailLimits,
  classifyMailError,
  countAttachmentLines,
  DEFAULT_MAIL_LIMITS,
  MAIL_MAX_RECIPIENTS,
  normalizeContentType,
  normalizeMailAddress,
  parseAttachments,
  parseRecipients,
  sanitizeAttachmentName,
  sanitizeDisplayName,
  sanitizeSubject,
  serializeAttachments,
  splitAddresses,
} from "./mail";

describe("Adressen", () => {
  it("gültige Adressen werden normalisiert (Domain klein, Punycode), ungültige abgelehnt", () => {
    assert.equal(normalizeMailAddress("  Erika.Muster@Firma.DE "), "Erika.Muster@firma.de");
    assert.equal(normalizeMailAddress("o'brien+kfz@werkstatt-mueller.example"), "o'brien+kfz@werkstatt-mueller.example");
    assert.equal(normalizeMailAddress("info@müller.de"), "info@xn--mller-kva.de");
    for (const bad of ["", "ohne-at", "a@b", "a@@b.de", "a b@c.de", "a@b .de", "<a@b.de>", '"a"@b.de', "a@b.de\r\nBcc: x@y.de", "a@b.de\nx", "a,b@c.de", ".a@b.de", "a.@b.de", "a..b@c.de", "a@-b.de", "a@b-.de", "a@b.123", "ä@b.de", "a@b.de>", "a@[127.0.0.1]", `${"x".repeat(65)}@b.de`, `a@${"x".repeat(250)}.de`]) {
      assert.equal(normalizeMailAddress(bad), null, JSON.stringify(bad));
    }
  });

  it("Empfängerliste: doppelte entfallen, leer/zu viele/ungültig werden benannt", () => {
    assert.deepEqual(parseRecipients(["a@b.de", "A@B.DE", "c@d.de"]), { ok: true, addresses: ["a@b.de", "c@d.de"] });
    assert.deepEqual(parseRecipients([]), { ok: false, reason: "empty" });
    assert.deepEqual(parseRecipients(["a@b.de", "kaputt"]), { ok: false, reason: "invalid", bad: "kaputt" });
    assert.deepEqual(parseRecipients(Array.from({ length: MAIL_MAX_RECIPIENTS + 1 }, (_, i) => `u${i}@b.de`)), { ok: false, reason: "tooMany" });
    const bad = parseRecipients(["x@y.de\r\nBcc: boese@evil.example"]);
    assert.equal(bad.ok, false);
    assert.ok(!(bad as { bad?: string }).bad?.includes("\n"), "die Fehlermeldung trägt keine Zeilenumbrüche");
  });
});

describe("Kopfzeilen ohne Einschleusen (CRLF-Schutz)", () => {
  it("Betreff: Zeilenumbrüche und Steuerzeichen werden zu Leerzeichen, Länge begrenzt, wohlgeformt", () => {
    assert.equal(sanitizeSubject("Rechnung 1\r\nBcc: boese@evil.example"), "Rechnung 1 Bcc: boese@evil.example");
    assert.equal(sanitizeSubject("a\u0000b‮c d"), "a b c d");
    assert.equal(sanitizeSubject("x".repeat(500)).length, 200);
    assert.doesNotThrow(() => encodeURIComponent(sanitizeSubject("😀".repeat(150) + "\ud800")));
    assert.ok(!/[\r\n]/.test(sanitizeSubject("a\rb\nc")));
  });

  it("Anzeigename: auch ohne Anführungszeichen, spitze Klammern, Komma, Semikolon, @ und Backslash", () => {
    assert.equal(sanitizeDisplayName('Werkstatt "Müller" <chef@evil.example>'), "Werkstatt Müller chef evil.example");
    assert.equal(sanitizeDisplayName("Müller\r\nBcc: x@y.de"), "Müller Bcc: x y.de");
    assert.equal(sanitizeDisplayName("a;b,c\\d"), "a b c d");
    assert.equal(sanitizeDisplayName("x".repeat(200)).length, 80);
  });

  it("Dateiname eines Anhangs: nur ein Name, ohne Trenner, Anführungszeichen und Zeilenumbrüche; nie leer", () => {
    assert.equal(sanitizeAttachmentName('../../etc/passwd'), "_.._etc_passwd".replace("_.._", "_.._"), "Pfad-Trenner werden ersetzt");
    assert.ok(!sanitizeAttachmentName("../../etc/passwd").includes("/"));
    assert.equal(sanitizeAttachmentName('Rechnung "1"\r\nContent-Type: text/html.pdf'), "Rechnung _1_ Content-Type_ text_html.pdf");
    assert.equal(sanitizeAttachmentName("..."), "anhang");
    assert.equal(sanitizeAttachmentName("\r\n"), "anhang");
    assert.equal(sanitizeAttachmentName(".hidden.pdf"), "hidden.pdf");
  });

  it("Anhänge im Datenbanktext: Rundlauf; unlesbare Zeilen entfallen; ein | im Namen wird ersetzt", () => {
    const list = [{ path: "rechnungen/2026/re-1.pdf", filename: "Rechnung|1.pdf", contentType: "application/pdf" }, { path: "rechnungen/2026/re-1.xml", filename: "re-1.xml", contentType: "application/xml" }];
    const text = serializeAttachments(list);
    assert.deepEqual(parseAttachments(text), [{ ...list[0], filename: "Rechnung_1.pdf" }, list[1]]);
    assert.equal(serializeAttachments([]), null);
    assert.deepEqual(parseAttachments(null), []);
    assert.deepEqual(parseAttachments("kaputt\nnur|zwei\na|b|kein-typ"), []);
  });

  it("Inhaltstyp mit Parametern wird auf den Typ vor dem Semikolon gekürzt (kein stilles Verwerfen); Unbrauchbares ist null", () => {
    assert.equal(normalizeContentType("application/pdf; charset=binary"), "application/pdf");
    assert.equal(normalizeContentType("Text/XML;x"), "text/xml");
    assert.equal(normalizeContentType(" image/png "), "image/png");
    for (const bad of ["", "pdf", "application/", "a b/c", "application/pdf/x", ";charset=x"]) assert.equal(normalizeContentType(bad), null, bad);
    const parsed = parseAttachments("rechnungen/2026/a.pdf|a.pdf|application/pdf; charset=binary");
    assert.deepEqual(parsed, [{ path: "rechnungen/2026/a.pdf", filename: "a.pdf", contentType: "application/pdf" }]);
    assert.equal(serializeAttachments([{ path: "rechnungen/2026/a.pdf", filename: "a.pdf", contentType: "Application/PDF;x" }]), "rechnungen/2026/a.pdf|a.pdf|application/pdf");
  });

  it("die Zahl gespeicherter Zeilen zeigt, ob eine verworfen wurde", () => {
    const text = "rechnungen/2026/a.pdf|a.pdf|application/pdf\nkaputt";
    assert.equal(countAttachmentLines(text), 2);
    assert.equal(parseAttachments(text).length, 1);
    assert.equal(countAttachmentLines(null), 0);
  });

  it("Empfängerliste aus dem Datenbanktext", () => {
    assert.deepEqual(splitAddresses("a@b.de, c@d.de"), ["a@b.de", "c@d.de"]);
    assert.deepEqual(splitAddresses(null), []);
    assert.deepEqual(splitAddresses(""), []);
  });
});

describe("Fehlerarten", () => {
  it("ordnet Fehler von Netz, TLS, Anmeldung und Server Codes zu – nie der Text des Servers", () => {
    assert.deepEqual(classifyMailError({ code: "EAUTH", message: "535 Zugang mit Passwort geheim123 abgelehnt" }), { code: "auth", permanent: false });
    assert.deepEqual(classifyMailError({ code: "ETLS" }), { code: "tls", permanent: false });
    assert.deepEqual(classifyMailError({ code: "DEPTH_ZERO_SELF_SIGNED_CERT" }), { code: "tls", permanent: false });
    assert.deepEqual(classifyMailError({ code: "ERR_TLS_CERT_ALTNAME_INVALID" }), { code: "tls", permanent: false });
    assert.deepEqual(classifyMailError({ code: "ETIMEDOUT" }), { code: "timeout", permanent: false });
    assert.deepEqual(classifyMailError({ code: "ECONNREFUSED" }), { code: "connect", permanent: false });
    assert.deepEqual(classifyMailError({ code: "ECONNECTION" }), { code: "connect", permanent: false });
    assert.deepEqual(classifyMailError({ code: "ENOTFOUND" }), { code: "dns", permanent: false });
    assert.deepEqual(classifyMailError(new Error("irgendwas")), { code: "failed", permanent: false });
    assert.deepEqual(classifyMailError(null), { code: "failed", permanent: false });
  });

  it("Fehler beim Aushandeln von TLS kommen von nodemailer als allgemeiner Socket-Fehler: nur der Text unterscheidet sie von Netzfehlern", () => {
    for (const message of ["self-signed certificate; if the root CA is installed locally", "Hostname/IP does not match certificate's altnames", "unable to verify the first certificate", "Client network socket disconnected before secure TLS connection was established", "error:0A00010B:SSL routines::wrong version number"]) {
      assert.deepEqual(classifyMailError({ code: "ESOCKET", message }), { code: "tls", permanent: false }, message);
    }
    assert.deepEqual(classifyMailError({ code: "ESOCKET", message: "read ECONNRESET" }), { code: "connect", permanent: false });
    assert.deepEqual(classifyMailError({ code: "ECONNECTION", message: "Connection closed unexpectedly" }), { code: "connect", permanent: false });
  });

  it("endgültige Ablehnung des Empfängers (5xx) und zu große Nachricht werden nicht wiederholt, vorübergehende 4xx schon", () => {
    assert.deepEqual(classifyMailError({ code: "EENVELOPE", command: "RCPT TO", responseCode: 550 }), { code: "recipient", permanent: true });
    assert.deepEqual(classifyMailError({ code: "EENVELOPE", command: "RCPT TO", responseCode: 450 }), { code: "rejected", permanent: false });
    assert.deepEqual(classifyMailError({ code: "EMESSAGE", command: "DATA", responseCode: 552 }), { code: "tooLarge", permanent: true });
    assert.deepEqual(classifyMailError({ code: "EMESSAGE", command: "DATA", responseCode: 554 }), { code: "rejected", permanent: true });
    assert.deepEqual(classifyMailError({ code: "EMESSAGE", command: "DATA", responseCode: 451 }), { code: "rejected", permanent: false });
  });
});

describe("Versandlimits", () => {
  const zero = { hour: 0, day: 0, userHour: 0, userDay: 0 };
  it("eine weitere Nachricht passt, bis das Limit erreicht ist; 0 heißt aus", () => {
    const limits = { hour: 5, day: 10, userHour: 2, userDay: 4 };
    assert.equal(checkMailLimits(zero, limits), null);
    assert.equal(checkMailLimits({ ...zero, userHour: 1 }, limits), null);
    assert.equal(checkMailLimits({ ...zero, userHour: 2 }, limits), "userHour");
    assert.equal(checkMailLimits({ ...zero, userDay: 4 }, limits), "userDay");
    assert.equal(checkMailLimits({ ...zero, hour: 5 }, limits), "hour");
    assert.equal(checkMailLimits({ ...zero, day: 10 }, limits), "day");
    assert.equal(checkMailLimits({ hour: 999, day: 999, userHour: 999, userDay: 999 }, { hour: 0, day: 0, userHour: 0, userDay: 0 }), null);
  });

  it("der Benutzer-Grund hat Vorrang, mehrere Nachrichten auf einmal zählen mit", () => {
    const limits = { hour: 5, day: 10, userHour: 2, userDay: 4 };
    assert.equal(checkMailLimits({ hour: 5, day: 0, userHour: 2, userDay: 0 }, limits), "userHour");
    const wide = { hour: 5, day: 10, userHour: 50, userDay: 50 };
    assert.equal(checkMailLimits({ ...zero, hour: 3 }, wide, 3), "hour");
    assert.equal(checkMailLimits({ ...zero, hour: 2 }, wide, 3), null);
  });

  it("die Standardwerte sind vernünftig (Werkstatt: ein paar Dutzend Mails am Tag)", () => {
    assert.ok(DEFAULT_MAIL_LIMITS.userHour > 0 && DEFAULT_MAIL_LIMITS.userHour <= DEFAULT_MAIL_LIMITS.hour);
    assert.ok(DEFAULT_MAIL_LIMITS.userDay <= DEFAULT_MAIL_LIMITS.day);
  });
});

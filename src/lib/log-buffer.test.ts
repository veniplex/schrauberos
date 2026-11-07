import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { LOG_CAPACITY, clearLogs, formatLogArgs, installLogCapture, recentLogs, recordLog, redactSecrets, resetLogCaptureForTest } from "./log-buffer";

beforeEach(() => clearLogs());

describe("Ringpuffer der Warn-/Fehlerzeilen (Systemstatus)", () => {
  it("nimmt Zeilen auf, neueste zuerst, und begrenzt auf die Kapazität (die älteste fällt heraus)", () => {
    for (let i = 0; i < LOG_CAPACITY + 25; i++) recordLog("error", [`Zeile ${i}`], 1000 + i);
    const all = recentLogs(LOG_CAPACITY + 50);
    assert.equal(all.length, LOG_CAPACITY);
    assert.equal(all[0].message, `Zeile ${LOG_CAPACITY + 24}`);
    assert.equal(all.at(-1)!.message, "Zeile 25");
    assert.equal(recentLogs(3).length, 3);
    assert.equal(all[0].level, "error");
    assert.equal(all[0].at, 1000 + LOG_CAPACITY + 24);
  });

  it("Fehlerobjekte nur als Klasse und Code – nie Meldung oder Stack (die enthalten Eingaben)", () => {
    class PrismaClientKnownRequestError extends Error {
      code = "P2002";
    }
    const error = new PrismaClientKnownRequestError("Unique constraint failed on the fields: (`email`) für max.mustermann@example.org");
    const text = formatLogArgs(["[invoices]", error]);
    assert.equal(text, "[invoices] PrismaClientKnownRequestError P2002");
    assert.doesNotMatch(text, /mustermann|constraint|email/);
  });

  it("andere Objekte nur als Typ, Zahlen und Wahrheitswerte als Text", () => {
    assert.equal(formatLogArgs(["a", { passwort: "geheim" }, 5, true, null, undefined]), "a object 5 true null undefined");
  });

  it("Steuerzeichen und Zeilenumbrüche werden entfernt (keine gefälschten Zeilen), lange Zeilen gekürzt", () => {
    const text = formatLogArgs(["ok\n[system] gefälscht\r\n\u001b[31mrot\u0007"]);
    assert.equal(/[\u0000-\u001f]/.test(text), false);
    assert.equal(formatLogArgs(["x".repeat(1000)]).length <= 300, true);
  });

  it("Zugangsdaten und lange Schlüsselzeichenketten werden unkenntlich gemacht", () => {
    assert.equal(redactSecrets("Authorization: Bearer abc.def-ghi"), "Authorization […]");
    assert.match(redactSecrets("Header Bearer abc123xyz gesendet"), /Bearer \[…\] gesendet/);
    assert.equal(redactSecrets("token=abcdef123 und password: hunter2"), "token […] und password […]");
    assert.equal(redactSecrets(`Schlüssel ${"a1b2c3d4".repeat(8)} gesetzt`), "Schlüssel […] gesetzt");
    assert.equal(redactSecrets("Migration 20260101000000_baseline angewendet"), "Migration 20260101000000_baseline angewendet", "normale Namen bleiben lesbar");
    assert.equal(redactSecrets("Token ungültig"), "Token ungültig", "ein Wort ohne Zuweisung ist kein Geheimnis");
    assert.equal(formatLogArgs(["setup-token ", "a".repeat(64)]).includes("aaaa"), false);
  });

  it("leere Zeilen werden nicht aufgenommen", () => {
    recordLog("warn", ["   "]);
    recordLog("warn", []);
    assert.equal(recentLogs().length, 0);
  });

  it("installLogCapture nimmt console.warn/error auf, lässt die Ausgabe unverändert und hängt nur einmal um", () => {
    const out: string[] = [];
    const fake = { warn: (...a: unknown[]) => void out.push(`warn:${a.join(" ")}`), error: (...a: unknown[]) => void out.push(`error:${a.join(" ")}`) } as unknown as Pick<Console, "warn" | "error">;
    resetLogCaptureForTest();
    installLogCapture(fake);
    installLogCapture(fake);
    fake.warn("langsam", 3);
    fake.error("[x] kaputt");
    assert.deepEqual(out, ["warn:langsam 3", "error:[x] kaputt"], "jede Ausgabe genau einmal");
    assert.deepEqual(recentLogs().map((e) => `${e.level}:${e.message}`), ["error:[x] kaputt", "warn:langsam 3"]);
    resetLogCaptureForTest();
  });
});

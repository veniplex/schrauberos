import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { installFakes } from "@/test/harness";

let isSameOriginUpload: typeof import("./request-guard").isSameOriginUpload;
before(async () => {
  installFakes(); // „server-only“ ist außerhalb von Next ein Fehler
  ({ isSameOriginUpload } = await import("./request-guard"));
});

const request = (headers: Record<string, string>) => new Request("http://app.intern:3000/api/x", { method: "POST", headers: { "x-requested-with": "schrauberos", ...headers } });

describe("Schutz der Upload-Routen (Herkunft)", () => {
  it("verlangt den eigenen Header und vergleicht Origin mit Host", () => {
    assert.equal(isSameOriginUpload(new Request("http://x/", { method: "POST", headers: { host: "app.example" } })), false, "ohne X-Requested-With");
    assert.equal(isSameOriginUpload(request({ host: "app.example" })), true, "ohne Origin (kein Browser-Formular)");
    assert.equal(isSameOriginUpload(request({ host: "app.example", origin: "https://app.example" })), true);
    assert.equal(isSameOriginUpload(request({ host: "app.example", origin: "https://evil.example" })), false);
    assert.equal(isSameOriginUpload(request({ host: "app.example", origin: "null" })), false);
    assert.equal(isSameOriginUpload(request({ host: "app.example", "sec-fetch-site": "cross-site" })), false);
  });

  it("hinter einem Reverse-Proxy mit umgeschriebenem Host zählt X-Forwarded-Host (nur mit der Einstellung), sonst 403 bei jedem Upload (ZP3-S-F8)", () => {
    // Der Proxy leitet an app.intern:3000 weiter und meldet den öffentlichen Host im X-Forwarded-Host
    const behind = { host: "app.intern:3000", "x-forwarded-host": "werkstatt.example.de", origin: "https://werkstatt.example.de" };
    assert.equal(isSameOriginUpload(request(behind), true), true, "mit Einstellung: öffentlicher Host");
    assert.equal(isSameOriginUpload(request(behind), false), false, "ohne Einstellung wird der Header ignoriert (und der Host passt nicht)");
    assert.equal(isSameOriginUpload(request(behind)), false, "Standard: ohne Einstellung");
    // Liste, Groß-/Kleinschreibung und Leerzeichen
    assert.equal(isSameOriginUpload(request({ ...behind, "x-forwarded-host": " Werkstatt.Example.DE , proxy.intern" }), true), true, "erster Eintrag, normalisiert");
    // Fremde Herkunft bleibt fremd – auch mit der Einstellung
    assert.equal(isSameOriginUpload(request({ ...behind, origin: "https://evil.example" }), true), false);
    // Der Proxy schreibt Host nicht um und sendet keinen X-Forwarded-Host: Host gilt
    assert.equal(isSameOriginUpload(request({ host: "werkstatt.example.de", origin: "https://werkstatt.example.de" }), true), true);
    // Ein gefälschter X-Forwarded-Host hilft einer fremden Seite nicht: Origin bleibt das, was der Browser meldet
    assert.equal(isSameOriginUpload(request({ host: "app.intern:3000", "x-forwarded-host": "evil.example", origin: "https://werkstatt.example.de" }), true), false);
  });
});

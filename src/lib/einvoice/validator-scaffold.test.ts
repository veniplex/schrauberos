import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { writeEinvoiceSample } from "@/test/einvoice-samples";

/**
 * Gerüst der XRechnung-Prüfung (KoSIT-Prüfer in der Pipeline, F-PDF): Die Festlegungen im Skript sind vollständig (Version und Prüfsumme je Datei, nur von GitHub), der Job läuft nur zu den
 * vereinbarten Anlässen, und das Skript tut ohne Beispiele nichts (bzw. bricht mit `XRECHNUNG_REQUIRE_SAMPLES=1` ab) – es lädt in diesen Fällen nie etwas herunter. Die eigentliche Prüfung
 * läuft erst in der Pipeline (Java, Netz) und ist hier **nicht** ausgeführt.
 */
const script = readFileSync(path.resolve(process.cwd(), "scripts/validate-xrechnung.sh"), "utf8");
const workflow = readFileSync(path.resolve(process.cwd(), ".github/workflows/docker-publish.yml"), "utf8");
const temp: string[] = [];
afterEach(() => {
  for (const dir of temp.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const pin = (name: string) => new RegExp(`^${name}="([^"]+)"$`, "m").exec(script)?.[1] ?? "";

describe("XRechnung-Prüfung: Gerüst", () => {
  it("Prüfer und Prüfkonfiguration sind mit Version und SHA-256 festgelegt, die Adressen führen zu den Release-Dateien des KoSIT", () => {
    assert.match(pin("VALIDATOR_SHA256"), /^[0-9a-f]{64}$/);
    assert.match(pin("CONFIG_SHA256"), /^[0-9a-f]{64}$/);
    assert.match(pin("VALIDATOR_VERSION"), /^\d+\.\d+\.\d+$/);
    assert.match(script, /VALIDATOR_URL="https:\/\/github\.com\/itplr-kosit\/validator\/releases\/download\/v\$\{VALIDATOR_VERSION\}\/validator-\$\{VALIDATOR_VERSION\}-standalone\.jar"/);
    assert.match(script, /CONFIG_URL="https:\/\/github\.com\/itplr-kosit\/validator-configuration-xrechnung\/releases\/download\/\$\{CONFIG_TAG\}\/\$\{CONFIG_ZIP\}"/);
    assert.match(pin("CONFIG_ZIP"), /^xrechnung-[\d.]+-validator-configuration-[\d-]+\.zip$/);
    assert.ok(pin("CONFIG_TAG").length > 3);
    assert.doesNotMatch(script, /latest/i, "keine beweglichen Versionen");
    assert.match(script, /sha256sum --check --strict/);
  });

  it("der Pipeline-Job läuft bei Pull Requests, Versions-Tags und von Hand – nicht bei jedem Push auf main – und ruft das Skript auf", () => {
    const job = /\n  xrechnung:\n([\s\S]*?)(?=\n  [a-z-]+:\n)/.exec(workflow)?.[1] ?? "";
    assert.ok(job, "Job „xrechnung“ fehlt");
    assert.match(job, /if: github\.event_name == 'pull_request' \|\| github\.event_name == 'workflow_dispatch' \|\| startsWith\(github\.ref, 'refs\/tags\/v'\)/);
    assert.match(job, /EINVOICE_SAMPLES_DIR/);
    assert.match(job, /scripts\/validate-xrechnung\.sh/);
    assert.doesNotMatch(job, /secrets\./, "der Job braucht keine Geheimnisse");
  });

  it("ohne Beispiele meldet das Skript das Gerüst und endet erfolgreich; mit XRECHNUNG_REQUIRE_SAMPLES=1 ist es ein Fehler – beide laden nichts herunter", (t) => {
    if (spawnSync("bash", ["-c", "true"]).status !== 0) return t.skip("bash fehlt");
    const empty = mkdtempSync(path.join(os.tmpdir(), "sos-xr-"));
    temp.push(empty);
    const toPosix = (p: string) => p.replace(/\\/g, "/").replace(/^([A-Za-z]):/, (_, d: string) => `/${d.toLowerCase()}`);
    const run = (env: Record<string, string>) =>
      spawnSync("bash", ["scripts/validate-xrechnung.sh", toPosix(empty), toPosix(path.join(empty, "work"))], { cwd: process.cwd(), encoding: "utf8", env: { ...process.env, ...env, PATH: process.env.PATH ?? "" } });
    const ok = run({});
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /Gerüst ohne Prüfung/);
    const required = run({ XRECHNUNG_REQUIRE_SAMPLES: "1" });
    assert.equal(required.status, 1);
    assert.match(required.stderr, /Keine XML-Beispiele/);
  });

  it("writeEinvoiceSample schreibt nur, wenn EINVOICE_SAMPLES_DIR gesetzt ist, und nimmt nur einfache Dateinamen", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "sos-xr-"));
    temp.push(dir);
    const saved = process.env.EINVOICE_SAMPLES_DIR;
    try {
      delete process.env.EINVOICE_SAMPLES_DIR;
      assert.equal(writeEinvoiceSample("a.xml", "<x/>"), null);
      process.env.EINVOICE_SAMPLES_DIR = dir;
      const file = writeEinvoiceSample("rechnung-1.xml", "<Invoice/>");
      assert.equal(file && readFileSync(file, "utf8"), "<Invoice/>");
      for (const bad of ["../x.xml", "a/b.xml", "a.txt", "", ".xml", "a b.xml"]) assert.throws(() => writeEinvoiceSample(bad, "x"), /Ungültiger Beispielname/, bad);
    } finally {
      if (saved === undefined) delete process.env.EINVOICE_SAMPLES_DIR;
      else process.env.EINVOICE_SAMPLES_DIR = saved;
    }
  });
});

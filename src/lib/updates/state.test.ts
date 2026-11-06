import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compareVersions } from "./semver";
import {
  afterFailure,
  afterHealthy,
  afterInstall,
  chooseStart,
  emptyState,
  isCompatible,
  parseState,
  versionsToKeep,
  type VersionMeta,
} from "./state";

const image: VersionMeta = { version: "1.0.0", base: 1 };
const meta = (version: string, over: Partial<VersionMeta> = {}): VersionMeta => ({ ...image, version, ...over });
const installed = (known: Record<string, VersionMeta>) => (v: string) => known[v] ?? null;

describe("Update-Zustand", () => {
  it("liest kaputte oder fremde Dateien als leeren Zustand", () => {
    assert.deepEqual(parseState(null), emptyState());
    assert.deepEqual(parseState({ schema: 99, current: "1.1.0" }), emptyState());
    assert.deepEqual(parseState("text"), emptyState());
  });

  it("übernimmt gültige Felder und ignoriert ungültige", () => {
    const s = parseState({ schema: 1, current: "1.1.0", previous: 5, pending: true, failed: ["1.0.5", 3], last: { at: "x", version: "1.1.0", status: "bogus" } });
    assert.equal(s.current, "1.1.0");
    assert.equal(s.previous, null);
    assert.equal(s.pending, true);
    assert.deepEqual(s.failed, ["1.0.5"]);
    assert.equal(s.last, null);
  });

  it("Kompatibilität verlangt die gleiche Basis", () => {
    assert.equal(isCompatible(meta("1.1.0"), image), true);
    assert.equal(isCompatible(meta("1.1.0", { base: 2 }), image), false);
  });

  it("Installieren merkt die Vorversion und wartet auf Bestätigung", () => {
    const s = afterInstall({ ...emptyState(), current: "1.1.0", failed: ["1.2.0"] }, "1.2.0");
    assert.deepEqual([s.current, s.previous, s.pending, s.failed], ["1.2.0", "1.1.0", true, []]);
  });

  it("Bestätigung beendet den Wartezustand", () => {
    const s = afterHealthy(afterInstall(emptyState(), "1.1.0"), "1.1.0", "t");
    assert.equal(s.pending, false);
    assert.equal(s.last?.status, "ok");
    assert.equal(s.current, "1.1.0");
  });

  it("Rückfall geht auf die Vorversion zurück und sperrt die fehlerhafte", () => {
    const s = afterFailure(afterInstall({ ...emptyState(), current: "1.1.0" }, "1.2.0"), "startet nicht", "t");
    assert.deepEqual([s.current, s.previous, s.pending, s.failed], ["1.1.0", null, false, ["1.2.0"]]);
    assert.deepEqual(s.last, { at: "t", version: "1.2.0", status: "rolled-back", reason: "startet nicht" });
  });

  it("Rückfall ohne Vorversion landet bei der eingebauten Version", () => {
    const s = afterFailure(afterInstall(emptyState(), "1.1.0"), "x", "t");
    assert.equal(s.current, null);
  });

  it("Start: ohne Eintrag die eingebaute Version", () => {
    assert.deepEqual(chooseStart(emptyState(), image, installed({}), compareVersions), { kind: "builtin" });
  });

  it("Start: neuere, kompatible, vorhandene Version aus dem Volume", () => {
    const state = { ...emptyState(), current: "1.1.0" };
    assert.deepEqual(chooseStart(state, image, installed({ "1.1.0": meta("1.1.0") }), compareVersions), { kind: "volume", version: "1.1.0" });
  });

  it("Start: ein neu gezogenes, neueres Image löst das Volume ab", () => {
    const newer = { ...image, version: "1.3.0" };
    const state = { ...emptyState(), current: "1.1.0" };
    assert.deepEqual(chooseStart(state, newer, installed({ "1.1.0": meta("1.1.0") }), compareVersions), { kind: "builtin" });
  });

  it("Start: inkompatible, fehlende, fehlerhafte oder falsch beschriftete Versionen werden übersprungen", () => {
    const base = { ...emptyState(), current: "1.1.0" };
    assert.equal(chooseStart(base, image, installed({ "1.1.0": meta("1.1.0", { base: 2 }) }), compareVersions).kind, "builtin");
    assert.equal(chooseStart(base, image, installed({}), compareVersions).kind, "builtin");
    assert.equal(chooseStart({ ...base, failed: ["1.1.0"] }, image, installed({ "1.1.0": meta("1.1.0") }), compareVersions).kind, "builtin");
    assert.equal(chooseStart(base, image, installed({ "1.1.0": meta("1.9.9") }), compareVersions).kind, "builtin");
  });

  it("behält nur aktuelle und vorherige Version", () => {
    assert.deepEqual(versionsToKeep({ ...emptyState(), current: "1.2.0", previous: "1.1.0" }), ["1.2.0", "1.1.0"]);
    assert.deepEqual(versionsToKeep(emptyState()), []);
  });
});

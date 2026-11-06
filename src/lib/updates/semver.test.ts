import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compareVersions, isReleaseVersion, parseSemver } from "./semver";

describe("SemVer", () => {
  it("parst gültige und lehnt ungültige Versionen ab", () => {
    assert.deepEqual(parseSemver("1.2.3"), { major: 1, minor: 2, patch: 3, pre: [] });
    assert.deepEqual(parseSemver("0.2.0-dev.abc1234"), { major: 0, minor: 2, patch: 0, pre: ["dev", "abc1234"] });
    assert.equal(parseSemver("1.2"), null);
    assert.equal(parseSemver("v1.2.3"), null);
    assert.equal(parseSemver("../../etc"), null);
  });

  it("erkennt veröffentlichte Versionen", () => {
    assert.equal(isReleaseVersion("1.2.3"), true);
    assert.equal(isReleaseVersion("1.2.3-dev.1"), false);
    assert.equal(isReleaseVersion("1.2.3/../x"), false);
  });

  it("vergleicht numerisch statt als Text", () => {
    assert.ok(compareVersions("1.10.0", "1.9.9") > 0);
    assert.ok(compareVersions("0.1.0", "0.1.1") < 0);
    assert.equal(compareVersions("2.0.0", "2.0.0"), 0);
  });

  it("Vorabversionen liegen unter der Veröffentlichung, aber über der Vorversion", () => {
    assert.ok(compareVersions("0.2.0-dev.abc", "0.2.0") < 0);
    assert.ok(compareVersions("0.2.0-dev.abc", "0.1.9") > 0);
    assert.ok(compareVersions("1.0.0-alpha.2", "1.0.0-alpha.10") < 0);
    assert.ok(compareVersions("1.0.0-alpha", "1.0.0-alpha.1") < 0);
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { activeHref } from "./nav-active";

const HREFS = ["/", "/help", "/fleet", "/fleet/licenses", "/docs/handbook", "/admin/users", "/admin"];

describe("activeHref", () => {
  it("längster passender Eintrag gewinnt", () => {
    assert.equal(activeHref("/fleet/licenses", HREFS), "/fleet/licenses");
    assert.equal(activeHref("/fleet/licenses/neu", HREFS), "/fleet/licenses");
    assert.equal(activeHref("/fleet", HREFS), "/fleet");
    assert.equal(activeHref("/fleet/abc123", HREFS), "/fleet");
    assert.equal(activeHref("/admin/users/42", HREFS), "/admin/users");
  });

  it("Übersicht nur exakt, ähnliche Präfixe nicht", () => {
    assert.equal(activeHref("/", HREFS), "/");
    assert.equal(activeHref("/helpful", HREFS), null);
    assert.equal(activeHref("/fleetwood", HREFS), null);
    assert.equal(activeHref("/unbekannt", HREFS), null);
  });

  it("es ist höchstens ein Eintrag aktiv, unabhängig von der Reihenfolge", () => {
    const reversed = [...HREFS].reverse();
    for (const path of ["/fleet/licenses", "/fleet", "/admin/users/1", "/docs/handbook/x"]) {
      assert.equal(activeHref(path, HREFS), activeHref(path, reversed));
      assert.equal(HREFS.filter((h) => h === activeHref(path, HREFS)).length <= 1, true);
    }
  });
});

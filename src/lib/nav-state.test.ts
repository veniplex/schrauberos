import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NAV_COOKIE, collapsedCookie, parseCollapsed } from "./nav-state";

/** Zustand der eingeklappten Navigationsgruppen (Cookie): nur wohlgeformte Gruppen-IDs, Server und Browser lesen dasselbe Format. */
describe("nav-state", () => {
  it("liest Komma-getrennte Gruppen-IDs und ignoriert alles Unerwartete", () => {
    assert.deepEqual(parseCollapsed("workshop,office"), ["workshop", "office"]);
    assert.deepEqual(parseCollapsed(" it , admin "), ["it", "admin"]);
    assert.deepEqual(parseCollapsed(undefined), []);
    assert.deepEqual(parseCollapsed(""), []);
    assert.deepEqual(parseCollapsed("../etc,<script>,a b,UPPER,ok-id"), ["ok-id"]);
    assert.equal(parseCollapsed(Array.from({ length: 50 }, (_, i) => `g${i}`).join(",")).length, 20);
  });

  it("schreibt Pfad /, ein Jahr, SameSite=Lax – unter HTTPS zusätzlich Secure", () => {
    assert.equal(collapsedCookie(["a", "b"], false), `${NAV_COOKIE}=a%2Cb; Path=/; Max-Age=31536000; SameSite=Lax`);
    assert.match(collapsedCookie([], true), /; Secure$/);
    assert.deepEqual(parseCollapsed(decodeURIComponent(collapsedCookie(["workshop", "it"], false).split("=")[1].split(";")[0])), ["workshop", "it"]);
  });
});

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { markdownHeadings, slugify, uniqueSlug } from "./slug";

describe("slugify", () => {
  test("Umlaute und Sonderzeichen", () => {
    assert.equal(slugify("Neue Mitarbeiter – Onboarding (IT)"), "neue-mitarbeiter-onboarding-it");
    assert.equal(slugify("Größe & Maße für Übergabe"), "groesse-masse-fuer-uebergabe");
  });
  test("Fallback und Länge", () => {
    assert.equal(slugify("***"), "seite");
    assert.ok(slugify("a".repeat(200)).length <= 60);
  });
});

describe("uniqueSlug", () => {
  test("zählt hoch", () => {
    assert.equal(uniqueSlug("abc", ["x"]), "abc");
    assert.equal(uniqueSlug("abc", ["abc"]), "abc-2");
    assert.equal(uniqueSlug("abc", ["abc", "abc-2"]), "abc-3");
  });
});

describe("markdownHeadings", () => {
  test("H2/H3, ohne Code-Blöcke und H1", () => {
    const md = ["# Titel", "## Ablauf", "text", "```", "## kein Heading", "```", "### Details **fett**", "#### zu tief"].join("\n");
    assert.deepEqual(markdownHeadings(md), [
      { level: 2, text: "Ablauf", id: "ablauf" },
      { level: 3, text: "Details fett", id: "details-fett" },
    ]);
  });
});

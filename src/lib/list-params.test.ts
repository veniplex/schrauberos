import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clampPage, listHref, listLinks, pageCount, pageWindow, parseListParams, sortFields } from "./list-params";

const OPTIONS = { sorts: ["name", "city"], sort: "name" } as const;

describe("parseListParams", () => {
  it("Standard, wenn nichts gesetzt ist", () => {
    assert.deepEqual(parseListParams({}, OPTIONS), { sort: "name", dir: "asc", page: 1, pageSize: 25 });
  });
  it("übernimmt erlaubte Sortierung und Richtung", () => {
    assert.deepEqual(parseListParams({ sort: "city", dir: "desc", page: "3" }, OPTIONS), { sort: "city", dir: "desc", page: 3, pageSize: 25 });
  });
  it("unbekannter Schlüssel fällt auf den Standard zurück – samt Richtung (kein halbes Übernehmen)", () => {
    assert.deepEqual(parseListParams({ sort: "passwordHash", dir: "desc" }, { ...OPTIONS, dir: "asc" }), { sort: "name", dir: "asc", page: 1, pageSize: 25 });
  });
  it("ungültige Seiten werden zu 1, absurd große begrenzt", () => {
    for (const page of ["0", "-4", "abc", ""]) assert.equal(parseListParams({ page }, OPTIONS).page, 1);
    assert.equal(parseListParams({ page: "99999999999" }, OPTIONS).page, 1_000_000);
  });
  it("Richtungsparameter mit anderem Namen (dir heißt schon etwas anderes)", () => {
    assert.equal(parseListParams({ sort: "city", order: "desc", dir: "incoming" }, { ...OPTIONS, dirParam: "order" }).dir, "desc");
  });
  it("Listenwerte (?sort=a&sort=b) zählen als der erste", () => {
    assert.equal(parseListParams({ sort: ["city", "name"] }, OPTIONS).sort, "city");
  });
});

describe("Seiten", () => {
  it("pageCount/clampPage/pageWindow", () => {
    assert.equal(pageCount(0, 25), 1);
    assert.equal(pageCount(25, 25), 1);
    assert.equal(pageCount(26, 25), 2);
    assert.equal(clampPage(9, 30, 25), 2, "hinter der letzten Seite gilt die letzte");
    assert.equal(clampPage(0, 30, 25), 1);
    assert.deepEqual(pageWindow(3, 25), { skip: 50, take: 25 });
  });
});

describe("Adressen", () => {
  it("listHref lässt leere Werte weg", () => {
    assert.equal(listHref("/x", { q: "", a: undefined, b: null, c: false, d: "1", e: 2 }), "/x?d=1&e=2");
    assert.equal(listHref("/x", {}), "/x");
  });
  it("listLinks: Standard-Sortierung steht nicht in der Adresse, Filter bleiben, Seite 1 steht nicht", () => {
    const current = { sort: "city", dir: "desc" as const, page: 2, pageSize: 25 };
    const links = listLinks("/customers", { q: "müller" }, current, { sort: "name", dir: "asc" });
    assert.equal(links.sortHref("name", "asc"), "/customers?q=m%C3%BCller");
    assert.equal(links.sortHref("city", "asc"), "/customers?q=m%C3%BCller&sort=city&dir=asc");
    assert.equal(links.pageHref(1), "/customers?q=m%C3%BCller&sort=city&dir=desc");
    assert.equal(links.pageHref(3), "/customers?q=m%C3%BCller&sort=city&dir=desc&page=3");
  });
  it("sortFields: die gewählte Sortierung als Formularfelder (für Filter), Standard entfällt, eigener Richtungsparameter", () => {
    const defaults = { sort: "name", dir: "asc" as const };
    assert.deepEqual(sortFields({ sort: "name", dir: "asc" }, defaults), {});
    assert.deepEqual(sortFields({ sort: "city", dir: "desc" }, defaults), { sort: "city", dir: "desc" });
    assert.deepEqual(sortFields({ sort: "name", dir: "desc" }, defaults, "order"), { sort: "name", order: "desc" });
  });
  it("listLinks mit eigenem Richtungsparameter", () => {
    const links = listLinks("/invoices", { dir: "outgoing" }, { sort: "gross", dir: "desc", page: 1, pageSize: 25 }, { sort: "date", dir: "desc" }, "order");
    assert.equal(links.sortHref("gross", "asc"), "/invoices?dir=outgoing&sort=gross&order=asc");
  });
});

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { NextRequest } from "next/server";
import { CSV_LIMITS } from "@/server/csv";
import { createTestEnv, type TestEnv } from "@/test/harness";

/**
 * Datenaustausch (CSV) gegen eine echte temporäre Datenbank: die Routen `/api/exchange/<art>` (Export) und `/api/exchange/<art>/import` (Vorschau und Anwenden) mit Rechten,
 * Herkunftsprüfung, Dubletten, Fehlerzeilen, Formelschutz, Transaktion und Audit.
 */
let env: TestEnv;
let exportRoute: typeof import("@/app/api/exchange/[kind]/route");
let importRoute: typeof import("@/app/api/exchange/[kind]/import/route");
let handlers: typeof import("./handlers");

before(async () => {
  env = await createTestEnv();
  exportRoute = await import("@/app/api/exchange/[kind]/route");
  importRoute = await import("@/app/api/exchange/[kind]/import/route");
  handlers = await import("./handlers");
});
after(() => env.cleanup());

beforeEach(async () => {
  await env.db.tire.deleteMany();
  await env.db.tireSet.deleteMany();
  await env.db.vehicleOwnership.deleteMany();
  await env.db.vehicleOwnership.deleteMany();
  await env.db.vehicle.deleteMany();
  await env.db.invoice.deleteMany();
  await env.db.customer.deleteMany();
  await env.db.auditLog.deleteMany();
  await env.db.featureSetting.deleteMany();
  env.signOut();
});

const HEADERS = { "x-requested-with": "schrauberos", host: "localhost" };
let seq = 0;
async function as(permissions: string[], options: { admin?: boolean; mustChangePassword?: boolean } = {}) {
  const role = await env.role({ permissions, isAdmin: options.admin });
  env.signOut();
  await env.signIn(await env.user({ username: `ex${++seq}`, roles: [role], mustChangePassword: options.mustChangePassword }));
}

const exportCall = (kind: string, query = "", headers: Record<string, string> = HEADERS) =>
  exportRoute.GET(new NextRequest(`http://localhost/api/exchange/${kind}${query}`, { headers }), { params: Promise.resolve({ kind }) });

type PreviewBody = Awaited<ReturnType<typeof handlers.handleImport>> extends Response ? Record<string, unknown> : never;
async function importCall(kind: string, file: string | Uint8Array, fields: Record<string, string> = {}, options: { headers?: Record<string, string>; length?: string | null } = {}) {
  const fd = new FormData();
  const bytes = typeof file === "string" ? new TextEncoder().encode(file) : file;
  fd.set("file", new File([bytes as BlobPart], "daten.csv", { type: "text/csv" }));
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  const probe = new Request("http://localhost/", { method: "POST", body: fd });
  const body = new Uint8Array(await probe.arrayBuffer());
  const headers: Record<string, string> = { ...(options.headers ?? HEADERS), "content-type": probe.headers.get("content-type") ?? "" };
  if (options.length !== null) headers["content-length"] = options.length ?? String(body.length);
  const response = await importRoute.POST(new NextRequest(`http://localhost/api/exchange/${kind}/import`, { method: "POST", body, headers }), { params: Promise.resolve({ kind }) });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> & PreviewBody };
}
const preview = (kind: string, file: string | Uint8Array, fields: Record<string, string> = {}) => importCall(kind, file, { mode: "preview", ...fields });
async function apply(kind: string, file: string | Uint8Array, fields: Record<string, string> = {}) {
  const p = await preview(kind, file, fields);
  assert.equal(p.status, 200, JSON.stringify(p.body));
  return importCall(kind, file, { mode: "apply", digest: String(p.body.digest), ...fields });
}

const text = async (response: Response) => (await response.text()).replace(/^﻿/, "");
const lines = (csv: string) => csv.trim().split("\r\n");

describe("Export: Schutz", () => {
  it("ohne Sitzung 401, mit offenem Passwortwechsel 401", async () => {
    assert.equal((await exportCall("customers")).status, 401);
    await as(["customers.view", "customers.export"], { mustChangePassword: true });
    assert.equal((await exportCall("customers")).status, 401);
  });

  it("verlangt den eigenen Header und gleiche Herkunft (ein fremder Link darf nichts auslösen)", async () => {
    await as(["customers.view", "customers.export"]);
    assert.equal((await exportCall("customers", "", { host: "localhost" })).status, 403);
    assert.equal((await exportCall("customers", "", { ...HEADERS, origin: "https://evil.example" })).status, 403);
    assert.equal((await exportCall("customers", "", { ...HEADERS, "sec-fetch-site": "cross-site" })).status, 403);
    assert.equal((await exportCall("customers", "", { ...HEADERS, origin: "http://localhost" })).status, 200);
  });

  it("Recht je Datenart: ohne <art>.export 403 – auch mit allen anderen Rechten; ohne <art>.view ebenfalls", async () => {
    const all = (await import("@/modules/catalog")).ALL_PERMISSIONS;
    for (const [kind, group] of [["customers", "customers"], ["vehicles", "vehicles"], ["tires", "tires"], ["invoices", "invoices"]] as const) {
      await as(all.filter((p) => p !== `${group}.export`));
      assert.equal((await exportCall(kind)).status, 403, `${kind} ohne export`);
      await as([`${group}.export`]);
      assert.equal((await exportCall(kind)).status, 403, `${kind} nur export, ohne view`);
      await as(all.filter((p) => p !== `${group}.view`));
      assert.equal((await exportCall(kind)).status, 403, `${kind} ohne view`);
      await as([`${group}.view`, `${group}.export`]);
      assert.equal((await exportCall(kind)).status, 200, `${kind} mit view und export`);
    }
    // Steuerberater: braucht invoices.export und invoices.view; einen Zeitraum dazu
    await as(["invoices.view"]);
    assert.equal((await exportCall("accountant", "?from=2026-01-01&to=2026-12-31")).status, 403);
    await as(["invoices.view", "invoices.export"]);
    assert.equal((await exportCall("accountant", "?from=2026-01-01&to=2026-12-31")).status, 200);
  });

  it("Import-Recht erlaubt keinen Export und umgekehrt", async () => {
    await as(["customers.view", "customers.import"]);
    assert.equal((await exportCall("customers")).status, 403);
    await as(["customers.view", "customers.export"]);
    assert.equal((await importCall("customers", "Nachname\nA", { mode: "preview" })).status, 403);
  });

  it("unbekannte Art und ausgeschaltete Funktion: 404", async () => {
    await as(["customers.view", "customers.export"]);
    assert.equal((await exportCall("nope")).status, 404);
    await env.db.featureSetting.create({ data: { key: "workshop.customers", enabled: false } });
    await as(["customers.view", "customers.export"], { admin: true });
    assert.equal((await exportCall("customers")).status, 404);
  });
});

describe("Export: Inhalt", () => {
  it("Kunden: UTF-8 mit BOM, Kopfzeile in der Sprache, Excel-Format; Formeln werden entschärft; Audit mit Anzahl", async () => {
    await env.db.customer.createMany({
      data: [
        { lastName: "Müller", firstName: "Anna", customerNumber: "K1", email: "a@x.de", phone: "+49 170 1", street: "Hauptstr. 1, 2. OG", zip: "10115", city: "Berlin", notes: "zeile 1\nzeile 2" },
        { lastName: "=HYPERLINK(\"http://evil\")", company: "@Firma", notes: "-1+1" },
      ],
    });
    await as(["customers.view", "customers.export"]);
    const res = await exportCall("customers");
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/csv; charset=utf-8/);
    assert.match(res.headers.get("content-disposition") ?? "", /^attachment; filename="kunden-\d{4}-\d{2}-\d{2}\.csv"/);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    const bytes = new Uint8Array(await res.arrayBuffer());
    assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], "BOM");
    const csv = new TextDecoder().decode(bytes);
    assert.equal(lines(csv)[0], "Kundennummer;Vorname;Nachname;Firma;E-Mail;Telefon;Straße;PLZ;Ort;Notizen");
    assert.ok(csv.includes("K1;Anna;Müller;;a@x.de;'+49 170 1;Hauptstr. 1, 2. OG;10115;Berlin;\"zeile 1\nzeile 2\""), csv);
    assert.ok(csv.includes("\"'=HYPERLINK(\"\"http://evil\"\")\""), "Formel entschärft: " + csv);
    assert.ok(csv.includes(";'@Firma;"), csv);
    assert.ok(csv.includes(";'-1+1"), csv);
    const entry = await env.db.auditLog.findFirst({ where: { action: "customer.export" } });
    assert.equal(entry?.target, "2 Zeilen");
    assert.ok(entry?.actorName);
  });

  it("internationales Format und ohne BOM", async () => {
    await env.db.customer.create({ data: { lastName: "Smith", notes: "a;b" } });
    await as(["customers.view", "customers.export"]);
    const csv = await (await exportCall("customers", "?format=international&bom=0")).text();
    assert.ok(!csv.startsWith("﻿"));
    assert.equal(lines(csv)[0], "Kundennummer,Vorname,Nachname,Firma,E-Mail,Telefon,Straße,PLZ,Ort,Notizen");
    assert.equal(lines(csv)[1], ",,Smith,,,,,,,a;b");
  });

  it("Geld und Datum: Cent als Dezimalzahl, Tage als JJJJ-MM-TT; negative Beträge bleiben Zahlen", async () => {
    await env.db.invoice.create({
      data: { direction: "outgoing", number: "A-1", outgoingKey: "A-1", partyName: "Kunde", issueDate: new Date("2026-03-14T12:00:00"), dueDate: new Date("2026-04-13T12:00:00"), netCents: -10000, vatCents: -1900, grossCents: -11900, status: "open", finalizedAt: new Date("2026-03-15T12:00:00") },
    });
    await as(["invoices.view", "invoices.export"]);
    const csv = await text(await exportCall("invoices"));
    assert.equal(lines(csv)[0], "Art;Rechnungsnummer;Geschäftspartner;Rechnungsdatum;Fällig am;Netto;MwSt.;Brutto;Zahlstatus;Bezahlt am;Kategorie;Referenz;Notizen;Festgeschrieben am;Storno zu Rechnung");
    assert.equal(lines(csv)[1], "Ausgang;A-1;Kunde;2026-03-14;2026-04-13;-100,00;-19,00;-119,00;Offen;;;;;2026-03-15;");
    const intl = await text(await exportCall("invoices", "?format=international"));
    assert.ok(lines(intl)[1].includes(",-100.00,-19.00,-119.00,"));
  });

  it("Kundennummer in Fahrzeug- und Rechnungsdateien nur mit customers.view", async () => {
    const customer = await env.db.customer.create({ data: { lastName: "Halter", customerNumber: "K-9" } });
    await env.db.vehicle.create({ data: { plate: "B AB 12", plateNorm: "BAB12", customerId: customer.id } });
    await env.db.invoice.create({ data: { direction: "outgoing", number: "A-2", outgoingKey: "A-2", partyName: "Partner GmbH", issueDate: new Date("2026-01-02T12:00:00"), grossCents: 100, customerId: customer.id } });
    await as(["vehicles.view", "vehicles.export", "invoices.view", "invoices.export"]);
    for (const kind of ["vehicles", "invoices"]) {
      const csv = await text(await exportCall(kind));
      assert.ok(!csv.includes("Kundennummer") && !csv.includes("K-9") && !csv.includes("Halter;"), `${kind} ohne customers.view: ${csv}`);
    }
    await as(["vehicles.view", "vehicles.export", "invoices.view", "invoices.export", "customers.view"]);
    for (const kind of ["vehicles", "invoices"]) {
      const csv = await text(await exportCall(kind));
      assert.ok(csv.includes("K-9"), `${kind} mit customers.view`);
    }
  });

  it("Fahrzeuge: Filter der Liste werden übernommen; Auswahlwerte lesbar", async () => {
    await env.db.vehicle.createMany({
      data: [
        { plate: "B AB 1", plateNorm: "BAB1", inspectionDue: "2020-01", fuel: "diesel", make: "VW" },
        { plate: "B AB 2", plateNorm: "BAB2", inspectionDue: "2099-12", fuel: "petrol" },
      ],
    });
    await as(["vehicles.view", "vehicles.export"]);
    const all = lines(await text(await exportCall("vehicles")));
    assert.equal(all.length, 3);
    const soon = lines(await text(await exportCall("vehicles", "?inspection=soon")));
    assert.equal(soon.length, 2);
    assert.ok(soon[1].startsWith("B AB 1;VW;;;;;Diesel;"), soon[1]);
    assert.equal(lines(await text(await exportCall("vehicles", "?q=BAB2"))).length, 2);
  });

  it("Reifen: eine Zeile je Satz mit Positionen", async () => {
    const v = await env.db.vehicle.create({ data: { plate: "B AB 1", plateNorm: "BAB1" } });
    await env.db.tireSet.create({
      data: { vehicleId: v.id, season: "winter", brand: "Conti", width: 205, aspect: 55, rim: 16, storageLocation: "A1", tires: { create: [{ position: "FL", dot: "2321", treadDepthMm: 6.5, condition: "good" }] } },
    });
    await as(["tires.view", "tires.export"]);
    const csv = lines(await text(await exportCall("tires", "?format=international")));
    assert.equal(csv.length, 2);
    assert.ok(csv[0].startsWith("Kennzeichen,Saison,Status,Marke,Modell,Breite (mm)"));
    assert.ok(csv[1].startsWith("B AB 1,Winter,Eingelagert,Conti,,205,55,16,,,Ohne Felgen,A1,"), csv[1]);
    assert.ok(csv[1].includes(",2321,6.5,Gut,"), csv[1]);
  });

  it("Steuerberater: Zeitraum und Richtung, Zahlstatus, ohne Belege und Kundennummern; Pflicht: gültiger Zeitraum", async () => {
    const mk = (number: string, direction: string, day: string, extra: Record<string, unknown> = {}) =>
      env.db.invoice.create({ data: { direction, number, outgoingKey: direction === "outgoing" ? number.toUpperCase() : null, partyName: "P", issueDate: new Date(`${day}T12:00:00`), grossCents: 11900, netCents: 10000, vatCents: 1900, notes: "geheim", category: "Kat", ...extra } });
    await mk("E-1", "incoming", "2026-01-15", { status: "paid", paidAt: new Date("2026-02-01T12:00:00") });
    await mk("A-1", "outgoing", "2026-02-10", { dueDate: new Date("2020-01-01T12:00:00") });
    await mk("A-2", "outgoing", "2026-05-10");
    await mk("A-3", "outgoing", "2025-12-31");
    await as(["invoices.view", "invoices.export"]);
    const res = await exportCall("accountant", "?from=2026-01-01&to=2026-03-31");
    const csv = await text(res);
    assert.match(res.headers.get("content-disposition") ?? "", /rechnungen-steuerberater-2026-01-01_2026-03-31\.csv/);
    assert.deepEqual(lines(csv), [
      "Art;Rechnungsnummer;Rechnungsdatum;Geschäftspartner;Netto;MwSt.;Brutto;Zahlstatus;Bezahlt am;Festgeschrieben am;Storno zu Rechnung",
      "Eingang;E-1;2026-01-15;P;100,00;19,00;119,00;Bezahlt;2026-02-01;;",
      "Ausgang;A-1;2026-02-10;P;100,00;19,00;119,00;Überfällig;;;",
    ]);
    assert.ok(!csv.includes("geheim") && !csv.includes("Kat"));
    assert.equal(lines(await text(await exportCall("accountant", "?from=2026-01-01&to=2026-12-31&direction=outgoing"))).length, 3);
    assert.equal(lines(await text(await exportCall("accountant", "?from=2026-01-01&to=2026-12-31&direction=incoming"))).length, 2);
    for (const bad of ["", "?from=2026-01-01", "?from=2026-03-01&to=2026-01-01", "?from=2026-02-30&to=2026-03-01", "?from=x&to=y"]) assert.equal((await exportCall("accountant", bad)).status, 422, bad);
    const entry = await env.db.auditLog.findFirst({ where: { action: "invoice.accountantExport" } });
    assert.match(entry?.target ?? "", /^2 Zeilen · 2026-01-01\.\.2026-03-31$/);
  });

  it("Zeilengrenze: zu viele Zeilen → 413 ohne Audit-Eintrag und ohne Daten", async () => {
    await as(["customers.view", "customers.export"]);
    const def = {
      id: "big",
      feature: "workshop.customers" as const,
      permission: "customers.export" as const,
      also: [],
      audit: "customer.export" as const,
      filename: () => "x.csv",
      open: async () => ({ columns: [{ labelKey: "customers.exchange.cols.city" as const }], count: CSV_LIMITS.exportRows + 1, target: "", rows: (async function* () {})() }),
    };
    const res = await handlers.handleExport(new Request("http://localhost/api/exchange/big", { headers: HEADERS }), "big", [def]);
    assert.equal(res.status, 413);
    assert.equal(await env.db.auditLog.count({ where: { action: "customer.export" } }), 0);
  });
});

describe("Import: Schutz", () => {
  const csv = "Nachname\nNeu";

  it("ohne Sitzung 401, mit offenem Passwortwechsel 401", async () => {
    assert.equal((await preview("customers", csv)).status, 401);
    await as(["customers.import"], { mustChangePassword: true });
    assert.equal((await preview("customers", csv)).status, 401);
  });

  it("Herkunft: Header und Origin; Längenangabe Pflicht (411); Größenlimit (413) – vor dem Lesen des Bodys", async () => {
    await as(["customers.import"]);
    assert.equal((await importCall("customers", csv, { mode: "preview" }, { headers: { host: "localhost" } })).status, 403);
    assert.equal((await importCall("customers", csv, { mode: "preview" }, { headers: { ...HEADERS, origin: "https://evil.example" } })).status, 403);
    assert.equal((await importCall("customers", csv, { mode: "preview" }, { length: null })).status, 411);
    assert.equal((await importCall("customers", csv, { mode: "preview" }, { length: "abc" })).status, 411);
    assert.equal((await importCall("customers", csv, { mode: "preview" }, { length: String(CSV_LIMITS.importBytes + 1024 * 1024) })).status, 413);
    assert.equal((await importCall("customers", new Uint8Array(CSV_LIMITS.importBytes + 1).fill(97), { mode: "preview" })).status, 413);
  });

  it("Recht je Datenart: ohne <art>.import 403 (auch mit allen übrigen Rechten); ohne Datei/Modus 400", async () => {
    const all = (await import("@/modules/catalog")).ALL_PERMISSIONS;
    for (const [kind, group] of [["customers", "customers"], ["vehicles", "vehicles"], ["tires", "tires"], ["invoices", "invoices"]] as const) {
      await as(all.filter((p) => p !== `${group}.import`));
      assert.equal((await preview(kind, "x\n1")).status, 403, kind);
      assert.equal((await importCall(kind, "x\n1", { mode: "apply" })).status, 403, kind);
      await as([`${group}.import`]);
      assert.notEqual((await preview(kind, "x\n1")).status, 403, kind);
    }
    await as(["customers.import"]);
    assert.equal((await importCall("customers", csv, {})).status, 400);
    assert.equal((await importCall("customers", csv, { mode: "boom" })).status, 400);
  });

  it("unbekannte Art und ausgeschaltete Funktion: 404", async () => {
    await as(["customers.import"], { admin: true });
    assert.equal((await preview("nope", csv)).status, 404);
    await env.db.featureSetting.create({ data: { key: "workshop.customers", enabled: false } });
    assert.equal((await preview("customers", csv)).status, 404);
  });

  it("Dateifehler: leer, binär, nicht geschlossenes Anführungszeichen, keine bekannte Spalte – mit verständlicher Meldung", async () => {
    await as(["customers.import"]);
    assert.equal((await preview("customers", new Uint8Array([32]))).status, 422);
    const empty = await importCall("customers", new Uint8Array(0), { mode: "preview" });
    assert.equal(empty.status, 422);
    assert.match(String(empty.body.message), /leer/);
    const binary = await preview("customers", new Uint8Array([0x50, 0x4b, 3, 4, 0, 0, 0, 0]));
    assert.equal(binary.status, 422);
    assert.match(String(binary.body.message), /keine Textdatei/);
    const open = await preview("customers", 'Nachname\n"offen');
    assert.equal(open.status, 422);
    assert.match(String(open.body.message), /Zeile 2/);
    const unknown = await preview("customers", "Foo;Bar\n1;2");
    assert.equal(unknown.status, 422);
    assert.match(String(unknown.body.message), /Spaltenüberschrift/);
    const many = await preview("customers", `Nachname\n${Array.from({ length: CSV_LIMITS.importRows + 1 }, (_, i) => `N${i}`).join("\n")}`);
    assert.equal(many.status, 422);
    assert.match(String(many.body.message), /zu viele Zeilen/);
  });
});

describe("Import: Kunden", () => {
  const header = "Kundennummer;Vorname;Nachname;Firma;E-Mail;Telefon;Straße;PLZ;Ort;Notizen";

  it("Vorschau schreibt nichts; Anwenden legt an, protokolliert die Anzahl und verlangt dieselbe Datei", async () => {
    await as(["customers.import"]);
    const file = `${header}\nK1;Anna;Müller;;a@x.de;0170;Hauptstr. 1;10115;Berlin;Notiz\nK2;;;Muster GmbH;info@muster.de;;;;;\n`;
    const p = await preview("customers", file);
    assert.equal(p.status, 200);
    assert.deepEqual(p.body.counts, { rows: 2, create: 2, duplicate: 0, error: 0, forced: 0 });
    assert.equal(p.body.canApply, true);
    assert.equal(await env.db.customer.count(), 0, "die Vorschau schreibt nichts");
    assert.equal(await env.db.auditLog.count({ where: { action: "customer.import" } }), 0);

    // Eine andere Datei als in der Vorschau: abgelehnt
    const swapped = await importCall("customers", file + "K3;;Dritter;;;;;;;\n", { mode: "apply", digest: String(p.body.digest) });
    assert.equal(swapped.status, 409);
    assert.equal(await env.db.customer.count(), 0);
    const noDigest = await importCall("customers", file, { mode: "apply" });
    assert.equal(noDigest.status, 409);

    const done = await importCall("customers", file, { mode: "apply", digest: String(p.body.digest) });
    assert.equal(done.status, 200);
    assert.deepEqual(done.body, { mode: "apply", created: 2, skipped: 0, errors: 0 });
    const anna = await env.db.customer.findFirst({ where: { customerNumber: "K1" } });
    assert.equal(anna?.lastName, "Müller");
    assert.equal(anna?.city, "Berlin");
    const firma = await env.db.customer.findFirst({ where: { customerNumber: "K2" } });
    assert.equal(firma?.lastName, "Muster GmbH", "reine Firmenkunden: Firmenname als Nachname wie im Formular");
    assert.equal(firma?.company, "Muster GmbH");
    const entry = await env.db.auditLog.findFirst({ where: { action: "customer.import" } });
    assert.equal(entry?.target, "2 neu, 0 übersprungen, 0 fehlerhaft");
  });

  it("Dubletten (Nummer, E-Mail mit Name, Name mit Anschrift; auch in der Datei) werden übersprungen, bestehende Kunden nie verändert", async () => {
    await env.db.customer.createMany({
      data: [
        { customerNumber: "K1", lastName: "Alt", city: "Hamburg" },
        { lastName: "Meier", email: "meier@x.de" },
        { firstName: "Karl", lastName: "Schmidt", street: "Weg 1", zip: "50667" },
      ],
    });
    await as(["customers.import"]);
    const file = [
      header,
      "k1 ;;Neu;;;;;;Köln;", // gleiche Nummer (Groß-/Kleinschreibung und Leerraum egal)
      ";;Meier;;MEIER@x.de;;;;;", // gleiche E-Mail mit gleichem Namen
      ";Karl;Schmidt;;;;weg 1;50667;;", // gleicher Name mit gleicher Anschrift
      ";;Frisch;;;;;;;", // neu
      ";;Frisch;;;;;;;", // ohne Nummer, E-Mail und Anschrift lässt sich nichts wiedererkennen: bleibt erlaubt
      "K7;;Doppelt;;;;;;;",
      "K7;;Doppelt 2;;;;;;;", // gleiche Nummer in der Datei
    ].join("\n");
    const result = await apply("customers", file);
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { mode: "apply", created: 3, skipped: 4, errors: 0 });
    assert.equal((await env.db.customer.findFirst({ where: { customerNumber: "K1" } }))?.city, "Hamburg", "nichts überschrieben");
    assert.equal(await env.db.customer.count({ where: { lastName: "Frisch" } }), 2);
    assert.equal(await env.db.customer.count({ where: { customerNumber: "K7" } }), 1);
    const p = await preview("customers", file);
    assert.equal((p.body.counts as { duplicate: number }).duplicate, 5, "ein zweiter Lauf: alles mit Schlüssel ist jetzt Dublette (die beiden „Frisch“ ohne Merkmal nicht)");
  });

  it("Zeilenfehler mit Zeilennummer und Spalte; ohne „Fehlerhafte überspringen“ wird nichts angelegt, mit wird der Rest übernommen", async () => {
    await as(["customers.import"]);
    const file = [header, ";;Gut;;;;;;;", ";;Kaputt;;keine-mail;;;;;", ";;;;;;;;;"," ;Nur Vorname;;;;;;;;", ";;Zu lang;;;;;;;" + "x".repeat(2100)].join("\n");
    const p = await preview("customers", file);
    assert.equal(p.status, 200);
    const counts = p.body.counts as { create: number; error: number };
    assert.deepEqual([counts.create, counts.error], [1, 3]);
    const rows = p.body.rows as Array<{ line: number; status: string; messages: string[] }>;
    const bad = rows.filter((r) => r.status === "error");
    assert.deepEqual(bad.map((r) => r.line), [3, 5, 6]);
    assert.match(bad[0].messages.join(" "), /E-Mail: .*gültige E-Mail/);
    const blocked = await importCall("customers", file, { mode: "apply", digest: String(p.body.digest) });
    assert.equal(blocked.status, 422);
    assert.match(String(blocked.body.message), /3 fehlerhafte Zeilen/);
    assert.equal(await env.db.customer.count(), 0, "nichts angelegt");
    const skipped = await importCall("customers", file, { mode: "apply", digest: String(p.body.digest), skipErrors: "1" });
    assert.deepEqual(skipped.body, { mode: "apply", created: 1, skipped: 0, errors: 3 });
    assert.equal(await env.db.customer.count(), 1);
  });

  it("Formel-Injektion: Werte beginnen mit = + - @ und werden nur als Text gespeichert (nie ausgeführt); der Export entschärft sie wieder", async () => {
    await as(["customers.import", "customers.export", "customers.view"]);
    const file = `${header}\n;;"=HYPERLINK(""http://evil"",""x"")";;;+SUM(1);;;;@cmd|' /C calc'!A0\n`;
    const p = await preview("customers", file);
    assert.equal(p.body.formulaLike, 3);
    assert.equal((await apply("customers", file)).status, 200);
    const c = await env.db.customer.findFirstOrThrow();
    assert.equal(c.lastName, '=HYPERLINK("http://evil","x")');
    assert.equal(c.phone, "+SUM(1)");
    assert.equal(c.notes, "@cmd|' /C calc'!A0");
    const out = await text(await exportCall("customers"));
    assert.ok(out.includes("\"'=HYPERLINK(\"\"http://evil\"\",\"\"x\"\")\""), out);
    assert.ok(out.includes(";'+SUM(1);"), out);
  });

  it("Rundlauf: Export in einer Sprache, Import in die leere Datenbank ergibt dieselben Kunden (beide Formate)", async () => {
    await env.db.customer.createMany({
      data: [
        { customerNumber: "K1", firstName: "Zoë", lastName: "Å Müller", email: "z@x.de", phone: "+49 (0)30 123", street: 'Str. "A", 1', zip: "01234", city: "Köln", notes: "Zeile 1\nZeile 2; mit Semikolon" },
        { lastName: "=1+1", company: "Firma, mit Komma" },
      ],
    });
    await as(["customers.view", "customers.export", "customers.import"]);
    for (const format of ["excel-de", "international"]) {
      const out = await text(await exportCall("customers", `?format=${format}`));
      const before = await env.db.customer.findMany({ orderBy: { lastName: "asc" }, select: { customerNumber: true, firstName: true, lastName: true, company: true, email: true, phone: true, street: true, zip: true, city: true, notes: true } });
      await env.db.customer.deleteMany();
      const result = await apply("customers", out);
      assert.equal(result.status, 200, JSON.stringify(result.body));
      const after = await env.db.customer.findMany({ orderBy: { lastName: "asc" }, select: { customerNumber: true, firstName: true, lastName: true, company: true, email: true, phone: true, street: true, zip: true, city: true, notes: true } });
      assert.deepEqual(after, before, format);
    }
  });

  it("Zeichensätze: UTF-8 mit BOM, Windows-1252 und Komma als Trennzeichen", async () => {
    await as(["customers.import"]);
    const win = new Uint8Array([...new TextEncoder().encode("Nachname,Ort\nM"), 0xfc, ...new TextEncoder().encode("ller,K"), 0xf6, ...new TextEncoder().encode("ln")]);
    const p = await preview("customers", win);
    assert.equal(p.body.encoding, "windows-1252");
    assert.equal(p.body.delimiter, ",");
    assert.equal((await apply("customers", win)).status, 200);
    assert.equal((await env.db.customer.findFirstOrThrow()).lastName, "Müller");
    await env.db.customer.deleteMany();
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("Nachname;Ort\nÄrger;Köln")]);
    assert.equal((await preview("customers", bom)).body.encoding, "utf-8-bom");
    assert.equal((await apply("customers", bom)).status, 200);
    assert.equal((await env.db.customer.findFirstOrThrow()).lastName, "Ärger");
  });

  it("Vorschau nennt Spalten, Zuordnung und Hinweise (unbekannt, doppelt, fehlend); englische Überschriften gehen", async () => {
    await as(["customers.import"]);
    const p = await preview("customers", "Last name;E-mail;Bogus;Last name\nSmith;s@x.org;?;Other");
    const columns = p.body.columns as Array<{ header: string; label: string | null; note: string | null }>;
    assert.deepEqual(columns.map((c) => [c.header, c.label]), [["Last name", "Nachname"], ["E-mail", "E-Mail"], ["Bogus", null], ["Last name", null]]);
    assert.match(columns[2].note ?? "", /Unbekannt/);
    assert.match(columns[3].note ?? "", /Doppelt/);
    assert.equal((await apply("customers", "Last name;E-mail\nSmith;s@x.org")).status, 200);
  });

  it("alles oder nichts: scheitert das Anlegen in der Mitte, bleibt die Datenbank unverändert und das Audit-Log leer", async () => {
    await as(["customers.import"]);
    const { defineImport } = await import("./define-import");
    const boom = defineImport<{ name: string }>({
      id: "boom",
      feature: "workshop.customers",
      permission: "customers.import",
      operationName: "customers.importBoom",
      audit: "customer.import",
      columns: () => [{ key: "name", labelKey: "customers.exchange.cols.lastName", names: ["Name"] }],
      parse: (v) => ({ ok: true, data: { name: v.name } }),
      check: async () => new Map(),
      label: (d) => d.name,
      create: async (tx, rows) => {
        await tx.customer.create({ data: { lastName: rows[0].name } });
        throw new Error("Platte voll");
      },
    });
    const fd = new FormData();
    fd.set("file", new File(["Name\nA\nB"], "x.csv"));
    const outcome = await boom.operation.execute((await (await import("@/server/auth/session")).getSession())!, { bytes: new TextEncoder().encode("Name\nA\nB"), allowDuplicates: false, skipErrors: false }).catch((e: unknown) => e);
    assert.ok(outcome instanceof Error, "unerwartete Fehler gehen bis zum Adapter");
    assert.equal(await env.db.customer.count(), 0, "zurückgerollt");
    assert.equal(await env.db.auditLog.count({ where: { action: "customer.import" } }), 0);
  });

  it("5000 Zeilen in einer Transaktion bleiben unter der Zeitgrenze", async () => {
    await as(["customers.import"]);
    const file = `Nachname;Kundennummer;Ort\n${Array.from({ length: CSV_LIMITS.importRows }, (_, i) => `Kunde ${i};K${i};Ort ${i % 50}`).join("\n")}`;
    const started = Date.now();
    const result = await apply("customers", file);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.created, CSV_LIMITS.importRows);
    assert.ok(Date.now() - started < 15_000, `dauerte ${Date.now() - started} ms`);
  });
});

describe("Import: Fahrzeuge", () => {
  it("Kennzeichen-Dubletten sind eine Warnung: übersprungen oder – bewusst – trotzdem angelegt; Halter über die Kundennummer", async () => {
    const owner = await env.db.customer.create({ data: { lastName: "Halter", customerNumber: "K-1" } });
    await env.db.customer.createMany({ data: [{ lastName: "Zwei A", customerNumber: "K-2" }, { lastName: "Zwei B", customerNumber: "k-2" }] });
    await env.db.vehicle.create({ data: { plate: "B AB 1", plateNorm: "BAB1" } });
    await as(["vehicles.import", "customers.view"]);
    const file = [
      "Kennzeichen;Hersteller;Modell;FIN;Baujahr;Kilometerstand;Kraftstoff;HU fällig (JJJJ-MM);Kundennummer (Halter)",
      "B-AB 1;VW;Golf;;;;;;", // Dublette (gibt es schon)
      "M XY 99;BMW;3er;WBA12345678901234;2019;123.456;Diesel;11/2026;K-1",
      "M XY 99;Audi;;;;;;;", // Dublette in der Datei
      "K ZZ 5;Opel;;;;;petrol;;K-404", // Kunde unbekannt
      "K ZZ 6;Opel;;;;;;;K-2", // Kunde nicht eindeutig
      "K ZZ 7;Opel;;;;;Dampf;;", // ungültiger Kraftstoff
    ].join("\n");
    const p = await preview("vehicles", file);
    assert.deepEqual(p.body.counts, { rows: 6, create: 1, duplicate: 2, error: 3, forced: 0 });
    const rows = p.body.rows as Array<{ line: number; status: string; messages: string[] }>;
    assert.match(rows.find((r) => r.line === 5)?.messages[0] ?? "", /Kundennummer \(Halter\): Nicht gefunden/);
    assert.match(rows.find((r) => r.line === 6)?.messages[0] ?? "", /Nicht eindeutig/);
    assert.match(rows.find((r) => r.line === 2)?.messages[0] ?? "", /Das Kennzeichen B AB 1 gibt es schon/);

    const first = await importCall("vehicles", file, { mode: "apply", digest: String(p.body.digest), skipErrors: "1" });
    assert.deepEqual(first.body, { mode: "apply", created: 1, skipped: 2, errors: 3 });
    const bmw = await env.db.vehicle.findFirstOrThrow({ where: { plateNorm: "MXY99" }, include: { ownerships: true } });
    assert.equal(bmw.customerId, owner.id);
    assert.equal(bmw.ownerships.length, 1);
    assert.equal(bmw.mileageKm, 123456);
    assert.equal(bmw.fuel, "diesel");
    assert.equal(bmw.inspectionDue, "2026-11");
    assert.equal(bmw.vin, "WBA12345678901234");

    // „Dubletten trotzdem anlegen“
    const forced = await apply("vehicles", "Kennzeichen\nB AB 1\nB-AB 1", { allowDuplicates: "1" });
    assert.deepEqual(forced.body, { mode: "apply", created: 2, skipped: 0, errors: 0 });
    assert.equal(await env.db.vehicle.count({ where: { plateNorm: "BAB1" } }), 3);
  });

  it("ohne customers.view wird die Halter-Spalte nicht gelesen (Spalte ignoriert, kein Hinweis auf Kunden)", async () => {
    await env.db.customer.create({ data: { lastName: "Halter", customerNumber: "K-1" } });
    await as(["vehicles.import"]);
    const p = await preview("vehicles", "Kennzeichen;Kundennummer\nB AB 7;K-1\nB AB 8;K-999");
    assert.deepEqual(p.body.counts, { rows: 2, create: 2, duplicate: 0, error: 0, forced: 0 });
    const columns = p.body.columns as Array<{ label: string | null }>;
    assert.equal(columns[1].label, null);
    assert.equal((await apply("vehicles", "Kennzeichen;Kundennummer\nB AB 7;K-1")).status, 200);
    assert.equal((await env.db.vehicle.findFirstOrThrow({ where: { plateNorm: "BAB7" } })).customerId, null);
  });

  it("Pflicht: Kennzeichen; fehlende Pflichtspalte verhindert das Anwenden", async () => {
    await as(["vehicles.import"]);
    const p = await preview("vehicles", "Hersteller\nVW");
    assert.deepEqual(p.body.missing, ["Kennzeichen"]);
    assert.equal(p.body.canApply, false);
    const res = await importCall("vehicles", "Hersteller\nVW", { mode: "apply", digest: String(p.body.digest) });
    assert.equal(res.status, 422);
    assert.equal(await env.db.vehicle.count(), 0);
  });

  it("Rundlauf mit Halter, HU und Auswahlwerten", async () => {
    const owner = await env.db.customer.create({ data: { lastName: "Halter", customerNumber: "K-1" } });
    await env.db.vehicle.create({
      data: { plate: "B AB 1", plateNorm: "BAB1", make: "VW", vin: "WVWZZZ1JZXW000001", year: 2001, mileageKm: 100000, fuel: "lpg", hsn: "0603", tsn: "ABC", firstRegistration: new Date("2001-05-04T12:00:00"), inspectionDue: "2027-02", extraInspectionKind: "gas", extraInspectionDue: new Date("2027-03-04T12:00:00"), notes: "-Notiz", customerId: owner.id },
    });
    await as(["vehicles.view", "vehicles.export", "vehicles.import", "customers.view"]);
    const out = await text(await exportCall("vehicles"));
    const select = { plate: true, make: true, vin: true, year: true, mileageKm: true, fuel: true, hsn: true, tsn: true, firstRegistration: true, inspectionDue: true, extraInspectionKind: true, extraInspectionDue: true, notes: true, customerId: true } as const;
    const before = await env.db.vehicle.findMany({ select });
    await env.db.vehicleOwnership.deleteMany();
    await env.db.vehicleOwnership.deleteMany();
    await env.db.vehicle.deleteMany();
    assert.equal((await apply("vehicles", out)).status, 200);
    assert.deepEqual(await env.db.vehicle.findMany({ select }), before);
  });
});

describe("Import: Reifen", () => {
  it("Fahrzeug über das Kennzeichen, Positionen, Dubletten, Fehler je Spalte", async () => {
    const v = await env.db.vehicle.create({ data: { plate: "B AB 1", plateNorm: "BAB1" } });
    await env.db.vehicle.createMany({ data: [{ plate: "B AB 2", plateNorm: "BAB2" }, { plate: "B AB 2", plateNorm: "BAB2" }] });
    await env.db.tireSet.create({ data: { vehicleId: v.id, season: "summer", brand: "Conti", width: 205, aspect: 55, rim: 16 } });
    await as(["tires.import"]);
    const file = [
      "Kennzeichen;Saison;Marke;Breite (mm);Querschnitt (%);Felge (Zoll);Lagerort;DOT vorne links;Profil (mm) vorne links;Zustand vorne links;DOT Ersatzrad",
      "B AB 1;Winter;Pirelli;205;55;16;A-1;2321;6,5;Gut;", // neu
      "B-AB 1;Sommer;Conti;205;55;16;;;;;", // Dublette
      "B AB 9;Winter;;;;;;;;;", // Fahrzeug fehlt
      "B AB 2;Winter;;;;;;;;;", // nicht eindeutig
      "B AB 1;Ganzjahr;X;;;;;99;;;", // DOT ungültig
      "B AB 1;Ganzjahr;Y;;;;;;;Kaputt;", // Zustand ungültig
      "B AB 1;Frühling;Z;;;;;;;;", // Saison ungültig
      "B AB 1;Winter;Mit Reserve;;;;;;;;2418", // Ersatzrad
    ].join("\n");
    const p = await preview("tires", file);
    assert.deepEqual(p.body.counts, { rows: 8, create: 2, duplicate: 1, error: 5, forced: 0 });
    const rows = p.body.rows as Array<{ line: number; status: string; messages: string[] }>;
    assert.match(rows.find((r) => r.line === 6)?.messages[0] ?? "", /DOT vorne links/);
    assert.match(rows.find((r) => r.line === 7)?.messages[0] ?? "", /Zustand vorne links/);
    const done = await importCall("tires", file, { mode: "apply", digest: String(p.body.digest), skipErrors: "1" });
    assert.deepEqual(done.body, { mode: "apply", created: 2, skipped: 1, errors: 5 });
    const winter = await env.db.tireSet.findFirstOrThrow({ where: { brand: "Pirelli" }, include: { tires: true } });
    assert.equal(winter.vehicleId, v.id);
    assert.equal(winter.storageLocation, "A-1");
    assert.deepEqual(winter.tires.map((t) => [t.position, t.dot, t.treadDepthMm, t.producedYear]), [["FL", "2321", 6.5, 2021], ["FR", null, null, null], ["RL", null, null, null], ["RR", null, null, null]]);
    const reserve = await env.db.tireSet.findFirstOrThrow({ where: { brand: "Mit Reserve" }, include: { tires: true } });
    assert.equal(reserve.tires.length, 5, "Ersatzrad entsteht, sobald eine seiner Spalten gefüllt ist");
    assert.equal(reserve.tires.find((t) => t.position === "SPARE")?.dot, "2418");
  });

  it("Rundlauf", async () => {
    const v = await env.db.vehicle.create({ data: { plate: "B AB 1", plateNorm: "BAB1" } });
    await env.db.tireSet.create({
      data: { vehicleId: v.id, season: "allseason", status: "mounted", brand: "Conti", model: "AllSeason", width: 205, aspect: 55, rim: 16, loadIndex: "91", speedIndex: "H", rimType: "alloy", storageLocation: "Halle A, Regal 3", notes: "=Notiz", tires: { create: [{ position: "FL", dot: "2321", producedWeek: 23, producedYear: 2021, treadDepthMm: 6.5, condition: "new" }, { position: "FR", condition: "fair" }, { position: "RL", condition: "good" }, { position: "RR", condition: "worn" }] } },
    });
    await as(["tires.view", "tires.export", "tires.import"]);
    const out = await text(await exportCall("tires"));
    const snapshot = () => env.db.tireSet.findMany({ select: { season: true, status: true, brand: true, model: true, width: true, aspect: true, rim: true, loadIndex: true, speedIndex: true, rimType: true, storageLocation: true, notes: true, tires: { select: { position: true, dot: true, treadDepthMm: true, condition: true, producedYear: true }, orderBy: { position: "asc" } } } });
    const before = await snapshot();
    await env.db.tire.deleteMany();
    await env.db.tireSet.deleteMany();
    assert.equal((await apply("tires", out)).status, 200);
    assert.deepEqual(await snapshot(), before);
  });
});

describe("Import: Rechnungen", () => {
  const header = "Art;Rechnungsnummer;Geschäftspartner;Rechnungsdatum;Fällig am;Netto;MwSt.;Brutto;Zahlstatus;Bezahlt am";

  it("Beträge als Cent, Datumsformate, Status; Prüfungen wie im Formular; Dubletten nach Nummer und Richtung", async () => {
    await env.db.invoice.create({ data: { direction: "outgoing", number: "RE-1", outgoingKey: "RE-1", partyName: "X", issueDate: new Date("2026-01-01T12:00:00"), grossCents: 100 } });
    await env.db.invoice.create({ data: { direction: "incoming", number: "L-1", partyName: "Lieferant", issueDate: new Date("2026-01-01T12:00:00"), grossCents: 100 } });
    await as(["invoices.import"]);
    const file = [
      header,
      "Ausgang;RE-2;Kunde A;14.03.2026;13.04.2026;100,00;19,00;119,00;Offen;",
      "Eingang;L-2;Lieferant;2026-03-01;;;;1.234,56;Bezahlt;2026-03-05",
      "Ausgang;re-1;Kunde B;2026-03-01;;;;50;;", // Dublette: normalisierte Ausgangsnummer
      "Eingang;L-1;lieferant;2026-03-01;;;;50;;", // Dublette: gleiche Nummer beim gleichen Partner
      "Eingang;RE-1;Anderer;2026-03-01;;;;50;;", // gleiche Nummer, aber Eingang: neu
      "Ausgang;RE-3;Kunde;2026-03-01;;100,00;19,00;100,00;;", // Summe stimmt nicht
      "Ausgang;RE-4;Kunde;2026-03-01;2026-02-01;;;100,00;;", // Fälligkeit vor Datum
      "Ausgang;RE-5;Kunde;2026-03-01;;;;0;;", // Brutto 0
      "Ausgang;RE-6;Kunde;2026-02-30;;;;5;;", // Datum gibt es nicht
      "Eingangsrechnung;L-9;Lieferant;2026-03-01;;;;7,5 €;Storniert;",
    ].join("\n");
    const p = await preview("invoices", file);
    assert.deepEqual(p.body.counts, { rows: 10, create: 4, duplicate: 2, error: 4, forced: 0 });
    const done = await importCall("invoices", file, { mode: "apply", digest: String(p.body.digest), skipErrors: "1" });
    assert.deepEqual(done.body, { mode: "apply", created: 4, skipped: 2, errors: 4 });
    const re2 = await env.db.invoice.findFirstOrThrow({ where: { number: "RE-2" } });
    assert.deepEqual([re2.netCents, re2.vatCents, re2.grossCents, re2.outgoingKey, re2.status, re2.issueDate.getDate(), re2.dueDate?.getMonth()], [10000, 1900, 11900, "RE-2", "open", 14, 3]);
    const l2 = await env.db.invoice.findFirstOrThrow({ where: { number: "L-2" } });
    assert.deepEqual([l2.grossCents, l2.netCents, l2.status, l2.paidAt?.getDate(), l2.outgoingKey], [123456, null, "paid", 5, null]);
    assert.equal((await env.db.invoice.findFirstOrThrow({ where: { number: "L-9" } })).status, "cancelled");
    assert.equal((await env.db.invoice.findFirstOrThrow({ where: { number: "L-9" } })).grossCents, 750);
    assert.equal(await env.db.invoice.count({ where: { number: "RE-1" } }), 2);
  });

  it("Rundlauf des Archivs, mit Kunde über die Kundennummer", async () => {
    const customer = await env.db.customer.create({ data: { lastName: "Kunde", customerNumber: "K-1" } });
    await env.db.invoice.createMany({
      data: [
        { direction: "outgoing", number: "A-1", outgoingKey: "A-1", partyName: "Kunde", customerId: customer.id, issueDate: new Date("2026-03-14T12:00:00"), dueDate: new Date("2026-04-13T12:00:00"), netCents: 10000, vatCents: 1900, grossCents: 11900, status: "paid", paidAt: new Date("2026-03-20T12:00:00"), category: "Werkstatt", reference: "Ordner 3", notes: "=1\nzwei" },
        { direction: "incoming", number: "E-1", partyName: "Lieferant, Dr.", issueDate: new Date("2026-01-14T12:00:00"), grossCents: -500 },
      ],
    });
    await as(["invoices.view", "invoices.export", "invoices.import", "customers.view"]);
    const select = { direction: true, number: true, outgoingKey: true, partyName: true, customerId: true, issueDate: true, dueDate: true, netCents: true, vatCents: true, grossCents: true, status: true, paidAt: true, category: true, reference: true, notes: true } as const;
    for (const format of ["excel-de", "international"]) {
      const out = await text(await exportCall("invoices", `?format=${format}`));
      const before = await env.db.invoice.findMany({ select, orderBy: { number: "asc" } });
      await env.db.invoice.deleteMany();
      const result = await apply("invoices", out);
      assert.equal(result.status, 200, JSON.stringify(result.body));
      assert.deepEqual(await env.db.invoice.findMany({ select, orderBy: { number: "asc" } }), before, format);
    }
  });

  it("Pflichtspalten: ohne Rechnungsnummer-Spalte nichts anzulegen", async () => {
    await as(["invoices.import"]);
    const p = await preview("invoices", "Art;Brutto\nAusgang;5");
    assert.deepEqual(p.body.missing, ["Rechnungsnummer", "Geschäftspartner", "Rechnungsdatum"]);
    assert.equal(p.body.canApply, false);
  });
});

describe("Rechte und Standardrollen", () => {
  it("Export- und Import-Rechte stecken in keiner Standardrolle (Regel 9) und sind im Katalog gekennzeichnet", async () => {
    const { DEFAULT_ROLES } = await import("@/modules/default-roles");
    const { MARKED_PERMISSIONS } = await import("@/modules/catalog");
    for (const role of DEFAULT_ROLES) for (const p of role.permissions) assert.ok(!/\.(export|import)$/.test(p), `${role.key}: ${p}`);
    for (const p of ["customers", "vehicles", "tires", "invoices"]) {
      assert.equal(MARKED_PERMISSIONS.get(`${p}.export`), "export");
      assert.equal(MARKED_PERMISSIONS.get(`${p}.import`), "import");
    }
  });

  it("die Import-Operationen prüfen das Recht selbst (auch ohne die Route): ohne Recht verboten, nichts geschrieben, nichts protokolliert", async () => {
    const { IMPORTS } = await import("@/modules/exchange");
    const all = (await import("@/modules/catalog")).ALL_PERMISSIONS;
    const { getSession } = await import("@/server/auth/session");
    for (const def of IMPORTS) {
      await as(all.filter((p) => p !== def.permission));
      const session = (await getSession())!;
      const outcome = await def.operation.execute(session, { bytes: new TextEncoder().encode("Nachname;Kennzeichen;Saison;Art;Rechnungsnummer\nX;B AB 1;Winter;Eingang;1"), allowDuplicates: false, skipErrors: true });
      assert.equal(outcome.ok, false, def.id);
      assert.equal(!outcome.ok && outcome.failure.code, "forbidden", def.id);
    }
    assert.equal(await env.db.customer.count(), 0);
    assert.equal(await env.db.vehicle.count(), 0);
    assert.equal(await env.db.auditLog.count({ where: { action: { endsWith: ".import" } } }), 0);
  });

  it("Administratoren haben beides über „Alle Rechte“", async () => {
    await env.db.customer.create({ data: { lastName: "A" } });
    await as([], { admin: true });
    assert.equal((await exportCall("customers")).status, 200);
    assert.equal((await preview("customers", "Nachname\nB")).status, 200);
  });
});

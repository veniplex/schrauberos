import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { NextRequest } from "next/server";
import { createTestEnv, type TestEnv } from "@/test/harness";

/** E-Rechnung als Vorschlag (P4b-3): Recht, Herkunft, Inhaltsprüfung, Fehlercodes – und es wird nichts gespeichert. */
let env: TestEnv;
let route: typeof import("./route");

before(async () => {
  env = await createTestEnv();
  route = await import("./route");
});
after(() => env.cleanup());

beforeEach(async () => {
  await env.db.session.deleteMany();
  await env.db.user.deleteMany();
  await env.db.role.deleteMany();
  env.signOut();
});

const UBL = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>RE-9</cbc:ID><cbc:IssueDate>2026-05-02</cbc:IssueDate><cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty><cac:Party><cac:PartyLegalEntity><cbc:RegistrationName>Lieferant AG</cbc:RegistrationName></cac:PartyLegalEntity></cac:Party></cac:AccountingSupplierParty>
  <cac:TaxTotal><cbc:TaxAmount currencyID="EUR">19.00</cbc:TaxAmount></cac:TaxTotal>
  <cac:LegalMonetaryTotal><cbc:TaxExclusiveAmount currencyID="EUR">100.00</cbc:TaxExclusiveAmount><cbc:TaxInclusiveAmount currencyID="EUR">119.00</cbc:TaxInclusiveAmount></cac:LegalMonetaryTotal>
</Invoice>`;

const as = async (permissions: string[]) => env.signIn(await env.user({ username: `u${Math.random()}`, roles: [await env.role({ permissions })] }));
const post = async (content: string | Uint8Array<ArrayBuffer> | null, headers: Record<string, string> = { "x-requested-with": "schrauberos" }, name = "re.xml", type = "text/xml") => {
  const body = new FormData();
  if (content !== null) body.set("file", new File([content], name, { type }));
  const response = await route.POST(new NextRequest("http://localhost/api/invoices/e-invoice", { method: "POST", body, headers }));
  return { status: response.status, json: (await response.json()) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
};

describe("POST /api/invoices/e-invoice", () => {
  it("ohne Sitzung 401, ohne invoices.edit 403, ohne die Herkunftsprüfung 403", async () => {
    assert.equal((await post(UBL)).status, 401);
    await as(["invoices.view"]);
    assert.equal((await post(UBL)).status, 403);
    await as(["invoices.edit"]);
    assert.equal((await post(UBL, {})).status, 403, "ohne X-Requested-With");
  });

  it("liefert den Vorschlag im Eingabeformat des Formulars und speichert nichts", async () => {
    await as(["invoices.edit"]);
    const before = await env.db.invoice.count();
    const { status, json } = await post(UBL);
    assert.equal(status, 200);
    assert.deepEqual(json.proposal, {
      syntax: "ubl",
      creditNote: false,
      number: "RE-9",
      issueDate: "2026-05-02",
      dueDate: "",
      partyName: "Lieferant AG",
      buyer: "",
      currency: "EUR",
      net: "100,00",
      vat: "19,00",
      gross: "119,00",
      warnings: [],
    });
    assert.equal(await env.db.invoice.count(), before);
    assert.equal(await env.db.invoiceFile.count(), 0);
  });

  it("lehnt Nicht-XML, fremdes XML, DTD und Entitäten mit Fehlercode ab", async () => {
    await as(["invoices.edit"]);
    assert.deepEqual([(await post("das ist kein xml")).status, (await post("das ist kein xml")).json.error], [422, "notXml"]);
    assert.equal((await post('<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"/>')).json.error, "notXml");
    assert.equal((await post(`<?xml version="1.0"?><Invoice xmlns="urn:fremd"><ID>1</ID></Invoice>`)).json.error, "unsupported");
    // DOCTYPE am Anfang weist schon die Upload-Prüfung ab; weiter hinten (jenseits ihrer ersten 2 KB) der Leser selbst
    assert.equal((await post(UBL.replace("<cbc:ID>", "<!DOCTYPE a><cbc:ID>"))).json.error, "notXml");
    assert.equal((await post(UBL.replace("<cbc:ID>", `<!--${"x".repeat(3000)}--><!DOCTYPE a [<!ENTITY e SYSTEM \"file:///etc/passwd\">]><cbc:ID>`))).json.error, "doctype");
    assert.equal((await post(UBL.replace("RE-9", "&xxe;"))).json.error, "entity");
    assert.equal((await post(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]), undefined, "x.png", "image/png")).json.error, "notXml");
  });

  it("ohne Datei 400", async () => {
    await as(["invoices.edit"]);
    assert.equal((await post(null)).status, 400);
  });
});

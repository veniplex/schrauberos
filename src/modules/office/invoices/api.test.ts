import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { apiRequest, makeToken } from "@/test/api-helpers";
import { createTestEnv, type TestEnv } from "@/test/harness";
import { jpeg } from "@/test/images";

/**
 * Beleg des Rechnungsarchivs über die API (F11): Upload (Multipart, Inhalt statt gemeldetem Typ, Größenlimit, `If-Match`, `Idempotency-Key`), Download (`deliveryHeaders`), Entfernen; festgeschriebene
 * Ausgangsrechnungen behalten ihren Beleg; Rechte `invoices.edit`/`invoices.view`; Belege der Rechnungserstellung gibt es hier nicht.
 */
let env: TestEnv;
let router: typeof import("@/server/api/router");
let full: string;
let viewOnly: string;
let editOnly: string;
let finalizer: string;

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function owner(permissions: string[]) {
  const role = await env.role({ permissions });
  const user = await env.user({ username: `api-${Math.random().toString(36).slice(2)}`, roles: [role] });
  return (await makeToken(env, { ownerId: user.id, scope: permissions, rateLimitPerMinute: 6000 })).token;
}

const call = async (method: string, url: string, token: string, init: { body?: unknown; headers?: Record<string, string> } = {}) => {
  const response = await router.handleApiRequest(apiRequest(method, url, { token, body: init.body, headers: init.headers }));
  const buffer = Buffer.from(await response.arrayBuffer());
  const type = response.headers.get("content-type") ?? "";
  return { status: response.status, headers: response.headers, buffer, json: (type.includes("json") && buffer.length ? JSON.parse(buffer.toString("utf8")) : null) as Json };
};

const pdf = () => Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n", "latin1");

function upload(token: string, id: string, file: { bytes: Uint8Array; name?: string; type?: string } | null, headers: Record<string, string> = {}) {
  const form = new FormData();
  if (file) form.set("file", new File([new Uint8Array(file.bytes)], file.name ?? "beleg.pdf", { type: file.type ?? "application/pdf" }));
  return router.handleApiRequest(new Request(`http://localhost/api/v1/invoices/${id}/file`, { method: "POST", headers: { authorization: `Bearer ${token}`, ...headers }, body: form }));
}

const etagOf = async (id: string) => `"${(await env.db.invoice.findUniqueOrThrow({ where: { id } })).updatedAt.getTime()}"`;

async function newInvoice(direction: "incoming" | "outgoing", number: string) {
  const row = await env.db.invoice.create({ data: { direction, number, partyName: "Lieferant", partyKey: "lieferant", issueDate: new Date("2026-03-02T11:00:00Z"), grossCents: 11900, netCents: 10000, vatCents: 1900, status: "open", outgoingKey: direction === "outgoing" ? number.toLowerCase() : null } });
  return row.id;
}

before(async () => {
  env = await createTestEnv();
  await env.db.featureSetting.upsert({ where: { key: "office.invoices" }, update: { enabled: true }, create: { key: "office.invoices", enabled: true, updatedByName: "test" } });
  router = await import("@/server/api/router");
  full = await owner(["invoices.view", "invoices.edit"]);
  viewOnly = await owner(["invoices.view"]);
  editOnly = await owner(["invoices.edit"]);
  finalizer = await owner(["invoices.view", "invoices.edit", "invoices.finalize"]);
});
after(() => env.cleanup());
beforeEach(async () => {
  await env.db.invoiceFile.deleteMany();
  await env.db.invoice.deleteMany();
});

describe("Beleg ablegen und lesen", () => {
  it("PDF hochladen (If-Match), Metadaten zeigen hasFile, Download liefert die Bytes mit Schutz-Kopfzeilen; Ersetzen durch ein Foto; Entfernen", async () => {
    const id = await newInvoice("incoming", "ER-1");
    const ok = await upload(full, id, { bytes: pdf() }, { "if-match": await etagOf(id) });
    assert.equal(ok.status, 200, await ok.clone().text());
    const json = (await ok.json()) as Json;
    assert.equal(json.data.hasFile, true);
    assert.ok(ok.headers.get("etag"));

    const download = await call("GET", `/invoices/${id}/file`, full);
    assert.equal(download.status, 200);
    assert.equal(download.headers.get("content-type"), "application/pdf");
    assert.equal(download.headers.get("x-content-type-options"), "nosniff");
    assert.match(download.headers.get("content-disposition") ?? "", /beleg\.pdf/);
    assert.deepEqual(download.buffer, pdf());
    const forced = await call("GET", `/invoices/${id}/file?download=1`, full);
    assert.match(forced.headers.get("content-disposition") ?? "", /attachment/);

    // Ersetzen: gespeichert wird der erkannte Typ; ein abweichend gemeldeter Typ wird abgelehnt
    assert.equal((await upload(full, id, { bytes: jpeg(), name: "foto.pdf", type: "application/pdf" }, { "if-match": await etagOf(id) })).status, 422);
    const replaced = await upload(full, id, { bytes: jpeg(), name: "foto.jpg", type: "image/jpeg" }, { "if-match": await etagOf(id) });
    assert.equal(replaced.status, 200, await replaced.clone().text());
    const image = await call("GET", `/invoices/${id}/file`, full);
    assert.equal(image.headers.get("content-type"), "image/jpeg");
    assert.equal(await env.db.invoiceFile.count({ where: { invoiceId: id } }), 1);

    const removed = await call("DELETE", `/invoices/${id}/file`, full, { headers: { "if-match": await etagOf(id) } });
    assert.equal(removed.status, 204);
    assert.equal(await env.db.invoiceFile.count({ where: { invoiceId: id } }), 0);
    assert.equal((await call("GET", `/invoices/${id}/file`, full)).status, 404);
    assert.equal((await call("DELETE", `/invoices/${id}/file`, full, { headers: { "if-match": await etagOf(id) } })).status, 404, "nichts mehr zu entfernen");
  });

  it("Inhalt statt Typ: HTML als „.pdf“ wird abgelehnt (422, nichts gespeichert); ohne Datei 422; ohne If-Match 428; zu groß 413", async () => {
    const id = await newInvoice("incoming", "ER-2");
    const html = await upload(full, id, { bytes: Buffer.from("<html><script>alert(1)</script></html>"), name: "x.pdf", type: "application/pdf" }, { "if-match": await etagOf(id) });
    assert.equal(html.status, 422);
    assert.equal(await env.db.invoiceFile.count(), 0);
    assert.equal((await upload(full, id, null, { "if-match": await etagOf(id) })).status, 422);
    assert.equal((await upload(full, id, { bytes: pdf() })).status, 428);
    const { INVOICE_FILE_MAX_BYTES } = await import("./domain");
    const big = await upload(full, id, { bytes: new Uint8Array(INVOICE_FILE_MAX_BYTES + 1) }, { "if-match": await etagOf(id) });
    assert.equal(big.status, 413);
    // veraltete Version
    const stale = await upload(full, id, { bytes: pdf() }, { "if-match": '"1"' });
    assert.equal(stale.status, 412);
    assert.equal(await env.db.invoiceFile.count(), 0);
  });

  it("Idempotency-Key: dieselbe Wiederholung liefert die gespeicherte Antwort (kein zweiter Beleg), anderer Inhalt mit demselben Schlüssel 422", async () => {
    const id = await newInvoice("incoming", "ER-3");
    const etag = await etagOf(id);
    const first = await upload(full, id, { bytes: pdf() }, { "if-match": etag, "idempotency-key": "beleg-1" });
    assert.equal(first.status, 200);
    const again = await upload(full, id, { bytes: pdf() }, { "if-match": etag, "idempotency-key": "beleg-1" });
    assert.equal(again.status, 200);
    assert.equal(again.headers.get("idempotent-replayed"), "true");
    assert.equal(await env.db.invoiceFile.count(), 1);
    const other = await upload(full, id, { bytes: jpeg(), name: "foto.jpg", type: "image/jpeg" }, { "if-match": etag, "idempotency-key": "beleg-1" });
    assert.equal(other.status, 422);
  });

  it("eine festgeschriebene Ausgangsrechnung behält ihren Beleg (409 beim Ablegen und Entfernen), lesen geht weiter; Belege der Rechnungserstellung gibt es hier nicht (404)", async () => {
    const id = await newInvoice("outgoing", "RE-1");
    assert.equal((await upload(full, id, { bytes: pdf() }, { "if-match": await etagOf(id) })).status, 200);
    const finalized = await call("POST", `/invoices/${id}/finalize`, finalizer, { headers: { "if-match": await etagOf(id) } });
    assert.ok([200, 201].includes(finalized.status), JSON.stringify(finalized.json));
    assert.equal((await upload(full, id, { bytes: jpeg(), name: "foto.jpg", type: "image/jpeg" }, { "if-match": await etagOf(id) })).status, 409);
    assert.equal((await call("DELETE", `/invoices/${id}/file`, full, { headers: { "if-match": await etagOf(id) } })).status, 409);
    assert.equal(await env.db.invoiceFile.count({ where: { invoiceId: id } }), 1, "der Beleg bleibt");
    assert.equal((await call("GET", `/invoices/${id}/file`, full)).status, 200);

    const draft = await env.db.invoice.create({ data: { source: "billing", direction: "outgoing", docType: "invoice", number: "", partyName: "X", partyKey: "x", issueDate: new Date(), grossCents: 100 } as never });
    assert.equal((await upload(full, draft.id, { bytes: pdf() }, { "if-match": await etagOf(draft.id) })).status, 404);
    assert.equal((await call("GET", `/invoices/${draft.id}/file`, full)).status, 404);
  });

  it("Rechte: Ablegen und Entfernen verlangen invoices.edit, Lesen invoices.view; unbekannte Kennung 404", async () => {
    const id = await newInvoice("incoming", "ER-4");
    assert.equal((await upload(viewOnly, id, { bytes: pdf() }, { "if-match": await etagOf(id) })).status, 403);
    assert.equal((await call("DELETE", `/invoices/${id}/file`, viewOnly, { headers: { "if-match": await etagOf(id) } })).status, 403);
    assert.equal((await upload(editOnly, id, { bytes: pdf() }, { "if-match": await etagOf(id) })).status, 200);
    assert.equal((await call("GET", `/invoices/${id}/file`, editOnly)).status, 403);
    assert.equal((await call("GET", `/invoices/${id}/file`, viewOnly)).status, 200);
    assert.equal((await call("GET", "/invoices/gibt-es-nicht/file", full)).status, 404);
    assert.equal((await upload(full, "gibt-es-nicht", { bytes: pdf() }, { "if-match": '"1"' })).status, 404);
  });
});

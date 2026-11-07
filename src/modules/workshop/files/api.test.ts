import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { apiRequest, makeToken } from "@/test/api-helpers";
import { createTestEnv, type TestEnv } from "@/test/harness";
import { jpeg, SECRET, tiffWith } from "@/test/images";
import { makePng } from "@/test/png";

/**
 * Dokumente & Fotos über die API: Multipart-Upload (Exif/GPS wird auch hier serverseitig entfernt), `Idempotency-Key`, Binärauslieferung mit Schutz-Kopfzeilen, Art. 18 (404), Rechte je Entität, Entfernen.
 */
let env: TestEnv;
let router: typeof import("@/server/api/router");
let full: string;
let vehiclesOnly: string;
let readOnly: string;
let vehicleId: string;
let orderId: string;
let restrictedOrderId: string;

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

function uploadRequest(token: string, fields: Record<string, string>, file: { bytes: Uint8Array; name?: string; type?: string } | null, headers: Record<string, string> = {}) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  if (file) form.set("file", new File([new Uint8Array(file.bytes)], file.name ?? "IMG_0001.jpg", { type: file.type ?? "image/jpeg" }));
  return router.handleApiRequest(new Request("http://localhost/api/v1/files", { method: "POST", headers: { authorization: `Bearer ${token}`, ...headers }, body: form }));
}

before(async () => {
  env = await createTestEnv();
  for (const key of ["workshop.files", "workshop.orders"]) await env.db.featureSetting.create({ data: { key, enabled: true, updatedByName: "test" } });
  router = await import("@/server/api/router");
  full = await owner(["files.view", "files.upload", "files.delete", "vehicles.view", "orders.view"]);
  vehiclesOnly = await owner(["files.view", "files.upload", "vehicles.view"]);
  readOnly = await owner(["files.view", "vehicles.view", "orders.view"]);
  vehicleId = (await env.db.vehicle.create({ data: { plate: "B AB 12", plateNorm: "BAB12" } })).id;
  orderId = (await env.db.order.create({ data: { number: "A-2026-0001", status: "in_progress", vehicleId } })).id;
  const customer = await env.db.customer.create({ data: { lastName: "Gesperrt", processingRestrictedAt: new Date() } });
  const restricted = await env.db.vehicle.create({ data: { plate: "B XY 9", plateNorm: "BXY9", customerId: customer.id } });
  restrictedOrderId = (await env.db.order.create({ data: { number: "A-2026-0002", status: "in_progress", vehicleId: restricted.id, customerId: customer.id } })).id;
});
after(() => env.cleanup());
beforeEach(async () => {
  await env.db.fileAttachment.deleteMany();
});

describe("Dateien: API", () => {
  it("Multipart-Upload: 201 mit Location, ETag und Metadaten; Exif/GPS ist in der gespeicherten und der ausgelieferten Datei weg, die Drehung bleibt", async () => {
    const response = await uploadRequest(full, { ownerType: "order", ownerId: orderId, category: "intake", caption: "Front" }, { bytes: jpeg({ exif: tiffWith(6), comment: true, trailing: true }) });
    assert.equal(response.status, 201);
    const created = (await response.json()) as { data: Json };
    assert.match(response.headers.get("location") ?? "", /^\/api\/v1\/files\//);
    assert.ok(response.headers.get("etag"));
    assert.deepEqual([created.data.ownerType, created.data.category, created.data.caption, created.data.mime], ["order", "intake", "Front", "image/jpeg"]);
    assert.equal(created.data.contentUrl, `/api/v1/files/${created.data.id}/content`);

    const row = await env.db.fileAttachment.findUniqueOrThrow({ where: { id: created.data.id } });
    const onDisk = readFileSync(path.join(env.dir, "files", ...row.path.split("/")));
    assert.ok(!onDisk.includes(Buffer.from(SECRET)) && !onDisk.includes(Buffer.from("<?php")));

    const content = await call("GET", `/files/${created.data.id}/content`, full);
    assert.equal(content.status, 200);
    assert.equal(content.headers.get("content-type"), "image/jpeg");
    assert.equal(content.headers.get("x-content-type-options"), "nosniff");
    assert.match(content.headers.get("content-security-policy") ?? "", /sandbox/);
    assert.ok(content.buffer.equals(onDisk));
    assert.ok(!content.buffer.includes(Buffer.from(SECRET)));
  });

  it("Idempotency-Key: derselbe Schlüssel mit derselben Datei liefert dieselbe Antwort ohne Dublette, auch wenn die Formulargrenze eine andere ist", async () => {
    const bytes = makePng(8, 4);
    const fields = { ownerType: "order", ownerId: orderId };
    const first = await uploadRequest(full, fields, { bytes, name: "a.png", type: "image/png" }, { "idempotency-key": "api-k-1" });
    assert.equal(first.status, 201);
    const again = await uploadRequest(full, fields, { bytes, name: "a.png", type: "image/png" }, { "idempotency-key": "api-k-1" });
    assert.equal(again.status, 201);
    assert.equal(again.headers.get("idempotent-replayed"), "true");
    assert.equal(((await again.json()) as { data: Json }).data.id, ((await first.json()) as { data: Json }).data.id);
    assert.equal(await env.db.fileAttachment.count(), 1);
    const other = await uploadRequest(full, fields, { bytes: makePng(16, 8), name: "b.png", type: "image/png" }, { "idempotency-key": "api-k-1" });
    assert.equal(other.status, 422, "derselbe Schlüssel mit anderem Inhalt");
  });

  it("Prüfungen: kein Multipart 415, fehlende Datei/Felder 422, unbekannte Felder 422, zu große Datei 413, fremder Typ 415, Bombe 413", async () => {
    assert.equal((await call("POST", "/files", full, { body: { ownerType: "order" } })).status, 415);
    assert.equal((await uploadRequest(full, { ownerType: "order", ownerId: orderId }, null)).status, 422);
    assert.equal((await uploadRequest(full, { ownerType: "order" }, { bytes: makePng() })).status, 422);
    assert.equal((await uploadRequest(full, { ownerType: "order", ownerId: orderId, extra: "x" }, { bytes: makePng() })).status, 422);
    // zu groß: angekündigt (Content-Length) und – ohne Angabe – beim Lesen des Datenstroms begrenzt (nie unbegrenzt gepuffert)
    assert.equal((await uploadRequest(full, { ownerType: "order", ownerId: orderId }, { bytes: makePng() }, { "content-length": String(17 * 1024 * 1024) })).status, 413);
    const chunk = new Uint8Array(1024 * 1024);
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent++ < 20) controller.enqueue(chunk);
        else controller.close();
      },
    });
    const streamed = await router.handleApiRequest(
      new Request("http://localhost/api/v1/files", { method: "POST", headers: { authorization: `Bearer ${full}`, "content-type": "multipart/form-data; boundary=x" }, body: stream, duplex: "half" } as RequestInit),
    );
    assert.equal(streamed.status, 413);
    assert.ok(sent <= 17, "der Datenstrom wird nicht bis zum Ende gelesen");
    const gif = await uploadRequest(full, { ownerType: "order", ownerId: orderId }, { bytes: Buffer.from("GIF89a....."), name: "x.gif", type: "image/gif" });
    assert.equal(gif.status, 422);
    assert.equal(((await gif.json()) as Json).fields.file.code, "files.errors.type");
    const bomb = await uploadRequest(full, { ownerType: "order", ownerId: orderId }, { bytes: jpeg({ width: 8000, height: 7000 }) });
    assert.equal(bomb.status, 422);
    assert.equal(((await bomb.json()) as Json).fields.file.code, "files.errors.pixels");
    assert.equal(await env.db.fileAttachment.count(), 0);
  });

  it("Rechte je Entität und Art. 18: ohne orders.view kein Auftrag (403/404), eingeschränkte Kunden 404, Lesen nur sichtbarer Dateien", async () => {
    const mine = await uploadRequest(full, { ownerType: "order", ownerId: orderId }, { bytes: makePng(), type: "image/png" });
    const id = ((await mine.json()) as { data: Json }).data.id as string;
    const onVehicle = await uploadRequest(full, { ownerType: "vehicle", ownerId: vehicleId }, { bytes: makePng(), type: "image/png" });
    assert.equal(onVehicle.status, 201);
    assert.equal((await uploadRequest(vehiclesOnly, { ownerType: "order", ownerId: orderId }, { bytes: makePng(), type: "image/png" })).status, 403);
    assert.equal((await uploadRequest(full, { ownerType: "order", ownerId: restrictedOrderId }, { bytes: makePng(), type: "image/png" })).status, 404);
    assert.equal((await call("GET", "/files", vehiclesOnly)).json.data.length, 1, "nur die Datei am Fahrzeug");
    assert.equal((await call("GET", `/files/${id}`, vehiclesOnly)).status, 404);
    assert.equal((await call("GET", `/files/${id}/content`, vehiclesOnly)).status, 404);
    assert.equal((await call("GET", "/files", full)).json.data.length, 2);
    assert.equal((await call("GET", `/files?ownerType=order&ownerId=${orderId}`, full)).json.data.length, 1);
    assert.equal((await uploadRequest(readOnly, { ownerType: "order", ownerId: orderId }, { bytes: makePng(), type: "image/png" })).status, 403, "ohne files.upload");
    const hidden = await env.db.fileAttachment.create({ data: { orderId: restrictedOrderId, name: "h.png", mime: "image/png", size: 1, path: "auftraege/A-2026-0002/h.png", sha256: "0", uploadedById: "x", uploadedByName: "X" } });
    assert.equal((await call("GET", `/files/${hidden.id}`, full)).status, 404);
    assert.equal((await call("GET", "/files", full)).json.data.every((f: Json) => f.id !== hidden.id), true);
  });

  it("Beschriftung ändern (If-Match) und Entfernen (204): danach 404; die Datei bleibt auf dem Datenträger", async () => {
    const created = (await (await uploadRequest(full, { ownerType: "order", ownerId: orderId, caption: "alt" }, { bytes: makePng(), type: "image/png" })).json()) as { data: Json };
    const id = created.data.id as string;
    const item = await call("GET", `/files/${id}`, full);
    assert.equal((await call("PATCH", `/files/${id}`, full, { body: { caption: "neu" } })).status, 428);
    const patched = await call("PATCH", `/files/${id}`, full, { body: { caption: "neu", category: "damage" }, headers: { "if-match": item.headers.get("etag")! } });
    assert.equal(patched.status, 200);
    assert.deepEqual([patched.json.data.caption, patched.json.data.category], ["neu", "damage"]);
    assert.equal((await call("PATCH", `/files/${id}`, full, { body: { caption: "zu spät" }, headers: { "if-match": item.headers.get("etag")! } })).status, 412);
    assert.equal((await call("DELETE", `/files/${id}`, readOnly)).status, 403);
    const row = await env.db.fileAttachment.findUniqueOrThrow({ where: { id } });
    assert.equal((await call("DELETE", `/files/${id}`, full)).status, 204);
    assert.equal((await call("GET", `/files/${id}`, full)).status, 404);
    assert.equal((await call("DELETE", `/files/${id}`, full)).status, 404);
    assert.ok(readFileSync(path.join(env.dir, "files", ...row.path.split("/"))).length > 0);
  });
});

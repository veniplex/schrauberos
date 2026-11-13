import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { NextRequest } from "next/server";
import { versionOf } from "@/lib/concurrency";
import type { AppSession } from "@/server/auth/session";
import type { Outcome } from "@/server/operations/operation";
import { createTestEnv, type TestEnv } from "@/test/harness";
import { jpeg, SECRET, tiffWith } from "@/test/images";
import { makePng } from "@/test/png";

/**
 * Dokumente & Fotos gegen eine echte temporäre SQLite und ein echtes Dateiverzeichnis: Rechte je Entität (Fahrzeug/Auftrag), Art. 18, Inhaltsprüfung, Pixelgrenze, Entfernen von Exif/GPS an den gespeicherten
 * Bytes, Idempotenz (nacheinander und gleichzeitig), Aufräumen bei Rollback, Entfernen (Archiv), Auslieferung mit Kopfzeilen, Datenschutz (Auskunft, Anonymisierung).
 */
let env: TestEnv;
let ops: typeof import("./operations");
let queries: typeof import("./queries");
let hooks: typeof import("@/server/operations/hooks");
let mechanic: AppSession;
let mechanic2: AppSession;
let lead: AppSession;
let vehicleOnly: AppSession;
let blind: AppSession;
let vehicleId: string;
let orderId: string;
let restrictedVehicleId: string;
let restrictedOrderId: string;

const MECHANIC = ["files.view", "files.upload", "vehicles.view", "orders.view"];

const out = <T>(outcome: Outcome<T>): T => {
  assert.ok(outcome.ok, JSON.stringify(!outcome.ok && outcome.failure));
  return outcome.data;
};
const failure = <T>(outcome: Outcome<T>) => {
  assert.ok(!outcome.ok, "Fehler erwartet");
  return outcome.failure;
};

async function sessionFor(permissions: readonly string[]): Promise<AppSession> {
  const role = await env.role({ permissions });
  const user = await env.user({ username: `u-${Math.random().toString(36).slice(2)}`, roles: [role] });
  await env.signIn(user);
  const { getSession } = await import("@/server/auth/session");
  const session = (await getSession())!;
  env.signOut();
  return session;
}

before(async () => {
  env = await createTestEnv();
  for (const key of ["workshop.files", "workshop.orders"]) await env.db.featureSetting.create({ data: { key, enabled: true, updatedByName: "test" } });
  ops = await import("./operations");
  queries = await import("./queries");
  hooks = await import("@/server/operations/hooks");
  mechanic = await sessionFor(MECHANIC);
  mechanic2 = await sessionFor(MECHANIC);
  lead = await sessionFor([...MECHANIC, "files.delete"]);
  vehicleOnly = await sessionFor(["files.view", "files.upload", "vehicles.view"]);
  blind = await sessionFor(["files.view", "files.upload"]);
  vehicleId = (await env.db.vehicle.create({ data: { plate: "B AB 12", plateNorm: "BAB12" } })).id;
  orderId = (await env.db.order.create({ data: { number: "A-2026-0001", status: "in_progress", vehicleId } })).id;
  const customer = await env.db.customer.create({ data: { lastName: "Gesperrt", processingRestrictedAt: new Date() } });
  restrictedVehicleId = (await env.db.vehicle.create({ data: { plate: "B XY 9", plateNorm: "BXY9", customerId: customer.id } })).id;
  restrictedOrderId = (await env.db.order.create({ data: { number: "A-2026-0002", status: "in_progress", vehicleId: restrictedVehicleId, customerId: customer.id } })).id;
});
after(() => env.cleanup());
beforeEach(async () => {
  hooks.setOperationHooksForTest(null);
  rmSync(path.join(env.dir, "files"), { recursive: true, force: true });
  await env.db.fileAttachment.deleteMany();
  await env.db.auditLog.deleteMany();
  await env.db.order.update({ where: { id: orderId }, data: { status: "in_progress" } });
  await env.db.vehicle.update({ where: { id: vehicleId }, data: { archivedAt: null } });
});

const upload = (session: AppSession, extra: Record<string, unknown> = {}, bytes: Uint8Array = makePng(8, 4)) =>
  ops.uploadFileOperation.execute(session, { ownerType: "order", ownerId: orderId, category: "photo", name: "IMG_0001.png", declaredType: "image/png", bytes, ...extra });
const filesOnDisk = (): string[] => {
  const walk = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? (d.name === ".tmp" ? [] : walk(path.join(dir, d.name))) : [path.join(dir, d.name)])) : []);
  return walk(path.join(env.dir, "files"));
};
const stored = (id: string) => env.db.fileAttachment.findUniqueOrThrow({ where: { id } }).then((row) => readFileSync(path.join(env.dir, "files", ...row.path.split("/"))));

describe("Hochladen: Prüfung und Bereinigung", () => {
  it("speichert den erkannten Typ, nie den Namen des Absenders im Pfad, und legt Audit ohne Dateinamen an", async () => {
    const created = out(await upload(mechanic, { name: "../../Müller Hans Foto.png", caption: "  Front  " }));
    const row = await env.db.fileAttachment.findUniqueOrThrow({ where: { id: created.id } });
    assert.equal(row.orderId, orderId);
    assert.equal(row.vehicleId, null);
    assert.equal(row.mime, "image/png");
    assert.equal(row.caption, "Front");
    assert.match(row.path, /^auftraege\/A-2026-0001\/foto-[\dTZ-]+\.png$/);
    assert.equal(row.uploadedById, mechanic.user.id);
    const audit = await env.db.auditLog.findFirstOrThrow({ where: { action: "file.upload" } });
    assert.ok(!(audit.target ?? "").includes("Müller"), "kein Dateiname im Audit");
    assert.match(audit.target ?? "", /A-2026-0001 · photo/);
  });

  it("entfernt Exif/GPS, XMP, Kommentare und Anhängsel an den gespeicherten Bytes – die Drehung bleibt; sha256 gehört zum Original", async () => {
    const original = jpeg({ exif: tiffWith(6), comment: true, iptc: true, trailing: true, thumbnail: true });
    const created = out(await upload(mechanic, { name: "IMG.jpg", declaredType: "image/jpeg" }, original));
    const row = await env.db.fileAttachment.findUniqueOrThrow({ where: { id: created.id } });
    const bytes = await stored(created.id);
    assert.ok(!bytes.includes(Buffer.from(SECRET)), "kein Geheimnis in der Datei");
    assert.ok(!bytes.includes(Buffer.from("<?php")) && !bytes.includes(Buffer.from("xmpmeta")));
    assert.ok(bytes.length < original.length);
    assert.equal(row.size, bytes.length);
    assert.ok(row.strippedBytes > 0);
    assert.deepEqual([row.width, row.height], [8, 4]);
    assert.equal(row.mime, "image/jpeg");
    assert.ok(row.path.endsWith(".jpg"));
    assert.ok(bytes.includes(Buffer.from("Exif")), "minimaler Exif-Block mit der Ausrichtung");
    const { createHash } = await import("node:crypto");
    assert.equal(row.sha256, createHash("sha256").update(original).digest("hex"));
  });

  it("weist ab: fremde Typen (GIF, SVG, HEIC, WebP), falsch gemeldeten Typ, Bomben, defekte Bilder, leere und zu große Dateien – ohne Datei auf dem Datenträger", async () => {
    const before = filesOnDisk().length;
    const type = async (bytes: Uint8Array, declared = "") => failure(await upload(mechanic, { declaredType: declared }, bytes)).fields?.file?.key;
    assert.equal(await type(Buffer.from("GIF89a....")), "files.errors.type");
    assert.equal(await type(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"), "image/svg+xml"), "files.errors.type");
    assert.equal(await type(Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypheic"), Buffer.alloc(40)])), "files.errors.type");
    assert.equal(await type(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 "), Buffer.alloc(30)])), "files.errors.type");
    assert.equal(await type(makePng(), "image/jpeg"), "files.errors.mismatch");
    assert.equal(await type(jpeg({ width: 8000, height: 7000 })), "files.errors.pixels");
    assert.equal(await type(makePng(8, 4, { ihdr: { width: 100_000, height: 100_000 } })), "files.errors.pixels");
    assert.equal(await type(jpeg({ truncate: true })), "files.errors.corrupt");
    assert.equal(await type(new Uint8Array(0)), "files.errors.empty");
    assert.equal(await type(Buffer.concat([makePng(), Buffer.alloc(15 * 1024 * 1024, 0)])), "files.errors.tooLarge");
    assert.equal(filesOnDisk().length, before);
    assert.equal(await env.db.fileAttachment.count(), 0);
  });

  it("PDF wird angenommen (ohne Bildprüfung), als Dokument abgelegt", async () => {
    const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
    const created = out(await upload(mechanic, { category: "document", name: "Kostenvoranschlag.pdf", declaredType: "application/pdf" }, pdf));
    const row = await env.db.fileAttachment.findUniqueOrThrow({ where: { id: created.id } });
    assert.equal(row.mime, "application/pdf");
    assert.match(row.path, /dokument-.*\.pdf$/);
    assert.equal(row.width, null);
    assert.ok((await stored(created.id)).equals(pdf), "PDF unverändert");
  });
});

describe("Rechte je Entität und Datenschutz", () => {
  it("Dateien am Fahrzeug nur mit vehicles.view, am Auftrag nur mit orders.view; ohne das Recht auf die Entität gibt es nichts zu sehen oder hochzuladen", async () => {
    out(await upload(mechanic, { ownerType: "vehicle", ownerId: vehicleId }));
    out(await upload(mechanic));
    assert.equal((await queries.filesOf(mechanic, { type: "vehicle", id: vehicleId })).length, 1);
    assert.equal((await queries.filesOf(vehicleOnly, { type: "order", id: orderId })).length, 0, "ohne orders.view");
    assert.equal((await queries.filesOf(vehicleOnly, { type: "vehicle", id: vehicleId })).length, 1);
    assert.equal((await queries.filesOf(blind, { type: "vehicle", id: vehicleId })).length, 0, "ohne vehicles.view");
    assert.equal(failure(await upload(blind, { ownerType: "vehicle", ownerId: vehicleId })).code, "forbidden");
    assert.equal(failure(await upload(vehicleOnly)).code, "forbidden", "Auftrag ohne orders.view");
    const reader = await sessionFor(["files.view", "vehicles.view", "orders.view"]);
    assert.equal(failure(await upload(reader)).code, "forbidden", "ohne files.upload");
    assert.equal((await queries.listFiles(vehicleOnly, {}, { skip: 0, take: 10 })).total, 1);
    assert.equal((await queries.listFiles(mechanic, {}, { skip: 0, take: 10 })).total, 2);
  });

  it("Kunden mit eingeschränkter Verarbeitung (Art. 18): Dateien unsichtbar, nichts neu anhängbar, Auslieferung findet sie nicht", async () => {
    const hidden = await env.db.fileAttachment.create({ data: { vehicleId: restrictedVehicleId, name: "x.png", mime: "image/png", size: 1, path: "fahrzeuge/BXY9/x.png", sha256: "0", uploadedById: "u", uploadedByName: "U" } });
    await env.db.fileAttachment.create({ data: { orderId: restrictedOrderId, name: "y.png", mime: "image/png", size: 1, path: "auftraege/A-2026-0002/y.png", sha256: "0", uploadedById: "u", uploadedByName: "U" } });
    assert.deepEqual(await queries.filesOf(lead, { type: "vehicle", id: restrictedVehicleId }), []);
    assert.deepEqual(await queries.filesOf(lead, { type: "order", id: restrictedOrderId }), []);
    assert.equal((await queries.listFiles(lead, {}, { skip: 0, take: 10 })).total, 0);
    assert.equal(await queries.fileForDelivery(lead, hidden.id), null);
    assert.equal(await queries.getFile(lead, hidden.id), null);
    assert.equal(failure(await upload(mechanic, { ownerType: "vehicle", ownerId: restrictedVehicleId })).code, "notFound");
    assert.equal(failure(await upload(mechanic, { ownerId: restrictedOrderId })).code, "notFound");
    assert.equal(failure(await ops.archiveFileOperation.execute(lead, { id: hidden.id })).code, "notFound");
  });

  it("archiviertes Fahrzeug und nicht offener Auftrag: neue Dateien abgelehnt, bestehende nur ansehbar", async () => {
    const created = out(await upload(mechanic));
    await env.db.order.update({ where: { id: orderId }, data: { status: "picked_up" } });
    assert.equal(failure(await upload(mechanic)).key, "files.errors.orderClosed");
    assert.equal(failure(await ops.archiveFileOperation.execute(lead, { id: created.id })).key, "files.errors.orderClosed");
    const files = await queries.filesOf(lead, { type: "order", id: orderId });
    assert.equal(files.length, 1);
    assert.equal(files[0].locked, true);
    assert.equal(files[0].mayChange, false);
    await env.db.vehicle.update({ where: { id: vehicleId }, data: { archivedAt: new Date() } });
    assert.equal(failure(await upload(mechanic, { ownerType: "vehicle", ownerId: vehicleId })).key, "files.errors.vehicleArchived");
  });

  it("Anonymisierung: Beschriftungen und Namen verschwinden, die Dateien bleiben; Auskunft listet sie ohne Inhalt", async () => {
    const customer = await env.db.customer.create({ data: { lastName: "Muster", firstName: "Erika" } });
    const owned = await env.db.vehicle.create({ data: { plate: "B-MU 1", plateNorm: "BMU1", customerId: customer.id } });
    const created = out(await upload(mechanic, { ownerType: "vehicle", ownerId: owned.id, name: "Erika Muster Fahrzeugschein.png", caption: "Fahrzeugschein Erika Muster" }));
    const { privacyProviders } = await import("./privacy");
    const sections = await privacyProviders[0].collect({ id: customer.id, terms: [] });
    assert.equal(sections[0].records.length, 1);
    assert.ok(JSON.stringify(sections).includes("Fahrzeugschein Erika Muster"));
    const { hooks: anonymizeHooks } = await import("./hooks");
    await env.db.$transaction(async (tx) => {
      await anonymizeHooks[0].run({ tx, input: { id: customer.id }, operation: "customers.anonymize", result: {}, principal: lead } as never);
    });
    const row = await env.db.fileAttachment.findUniqueOrThrow({ where: { id: created.id } });
    assert.equal(row.caption, null);
    assert.equal(row.name, "foto.png");
    assert.ok((await stored(created.id)).length > 0, "die Datei bleibt");
    assert.equal(row.archivedAt, null);
  });

  it("Fahrzeug mit Dateien ist nicht löschbar (inUse), Restrict im Schema", async () => {
    out(await upload(mechanic, { ownerType: "vehicle", ownerId: vehicleId }));
    const { vehicleDeletable } = await import("@/modules/workshop/vehicles/domain");
    assert.equal(vehicleDeletable({ appointments: 0, tireSets: 0, orders: 0, transfers: 0, files: 1 }), false);
    await assert.rejects(env.db.vehicle.delete({ where: { id: vehicleId } }), /Foreign key|constraint/i);
  });
});

describe("Idempotenz und Aufräumen", () => {
  it("derselbe Schlüssel liefert denselben Eintrag und legt keine zweite Datei ab; anderer Inhalt mit demselben Schlüssel wird abgelehnt", async () => {
    const first = out(await upload(mechanic, { uploadKey: "k-1" }));
    const files = filesOnDisk().length;
    const again = out(await upload(mechanic, { uploadKey: "k-1" }));
    assert.equal(again.id, first.id);
    assert.equal(again.replayed, true);
    assert.equal(first.replayed, false);
    assert.equal(await env.db.fileAttachment.count(), 1);
    assert.equal(filesOnDisk().length, files, "keine zweite Datei");
    assert.equal(failure(await upload(mechanic, { uploadKey: "k-1" }, makePng(16, 8))).fields?.file?.key, "files.errors.keyReuse");
    // derselbe Schlüssel einer anderen Person ist ein anderer Vorgang
    const other = out(await upload(mechanic2, { uploadKey: "k-1" }));
    assert.notEqual(other.id, first.id);
  });

  it("gleichzeitiges Wiederholen (verlorene Antwort): genau ein Eintrag, eine Datei auf dem Datenträger", async () => {
    const results = await Promise.all([upload(mechanic, { uploadKey: "race" }), upload(mechanic, { uploadKey: "race" }), upload(mechanic, { uploadKey: "race" })]);
    const ids = new Set(results.map((r) => out(r).id));
    assert.equal(ids.size, 1);
    assert.equal(await env.db.fileAttachment.count(), 1);
    assert.equal(filesOnDisk().length, 1, "überzählig abgelegte Dateien werden entfernt");
  });

  it("scheitert die Transaktion nach dem Ablegen (Hook wirft), ist die Datei wieder entfernt und nichts gespeichert", async () => {
    hooks.setOperationHooksForTest([
      {
        operation: "files.upload",
        feature: "workshop.files",
        run: async () => {
          throw new Error("kaputt");
        },
      },
    ]);
    await assert.rejects(upload(mechanic), /kaputt/);
    assert.equal(await env.db.fileAttachment.count(), 0);
    assert.deepEqual(filesOnDisk(), []);
  });
});

describe("Entfernen und Beschriften", () => {
  it("eigene Dateien entfernt, wer hochladen darf; fremde nur mit files.delete; die Datei bleibt auf dem Datenträger", async () => {
    const mine = out(await upload(mechanic));
    assert.equal(failure(await ops.archiveFileOperation.execute(mechanic2, { id: mine.id })).code, "forbidden");
    out(await ops.archiveFileOperation.execute(mechanic, { id: mine.id }));
    const row = await env.db.fileAttachment.findUniqueOrThrow({ where: { id: mine.id } });
    assert.ok(row.archivedAt && row.archivedByName);
    assert.ok(existsSync(path.join(env.dir, "files", ...row.path.split("/"))), "nichts gelöscht");
    assert.equal(await queries.fileForDelivery(mechanic, mine.id), null, "ausgeblendet");
    assert.equal(failure(await ops.archiveFileOperation.execute(mechanic, { id: mine.id })).code, "notFound", "zweites Entfernen");
    const other = out(await upload(mechanic));
    out(await ops.archiveFileOperation.execute(lead, { id: other.id }));
    assert.equal(await env.db.auditLog.count({ where: { action: "file.archive" } }), 2);
  });

  it("gleichzeitiges Entfernen: genau eines gelingt", async () => {
    const created = out(await upload(mechanic));
    const results = await Promise.all([ops.archiveFileOperation.execute(mechanic, { id: created.id }), ops.archiveFileOperation.execute(lead, { id: created.id })]);
    assert.equal(results.filter((r) => r.ok).length, 1);
  });

  it("Beschriftung ändern: mit Version (Konflikt bei veraltetem Stand), eigene oder mit files.delete; die Datei bleibt unverändert", async () => {
    const created = out(await upload(mechanic, { caption: "alt" }));
    const row = await env.db.fileAttachment.findUniqueOrThrow({ where: { id: created.id } });
    const before = await stored(created.id);
    out(await ops.updateFileOperation.execute(mechanic, { id: created.id, version: versionOf(row), category: "damage", caption: "neu" }));
    assert.equal(failure(await ops.updateFileOperation.execute(mechanic, { id: created.id, version: versionOf(row), category: "damage", caption: "zu spät" })).code, "conflict");
    assert.equal(failure(await ops.updateFileOperation.execute(mechanic2, { id: created.id, version: versionOf(await env.db.fileAttachment.findUniqueOrThrow({ where: { id: created.id } })), category: "damage" })).code, "forbidden");
    const after = await env.db.fileAttachment.findUniqueOrThrow({ where: { id: created.id } });
    assert.equal(after.caption, "neu");
    assert.equal(after.category, "damage");
    assert.ok((await stored(created.id)).equals(before));
  });
});

describe("Auslieferung und Upload-Route", () => {
  const send = async (method: "GET" | "POST", url: string, init: { headers?: Record<string, string>; body?: FormData } = {}) => {
    const request = new NextRequest(`http://localhost${url}`, { method, headers: init.headers, body: init.body });
    if (url === "/api/files") return (await import("@/app/api/files/route")).POST(request);
    const id = url.split("/").pop()!.split("?")[0];
    return (await import("@/app/api/files/[id]/route")).GET(request, { params: Promise.resolve({ id }) });
  };

  const formFor = (bytes: Uint8Array, type: string, extra: Record<string, string> = {}) => {
    const form = new FormData();
    form.set("ownerType", "order");
    form.set("ownerId", orderId);
    form.set("category", "photo");
    for (const [k, v] of Object.entries(extra)) form.set(k, v);
    form.set("file", new File([new Uint8Array(bytes)], "IMG.png", { type }));
    return form;
  };
  const headers = (extra: Record<string, string> = {}) => ({ "x-requested-with": "schrauberos", "content-length": "400", ...extra });

  it("Upload-Route: 401 ohne Sitzung, 403 ohne eigenen Header oder Recht, 411 ohne Content-Length, 413 zu groß; mit Schlüssel 201 und beim Wiederholen 200 ohne Dublette", async () => {
    env.signOut();
    assert.equal((await send("POST", "/api/files", { headers: headers(), body: formFor(makePng(), "image/png") })).status, 401);
    const user = await env.user({ username: "route-user", roles: [await env.role({ permissions: MECHANIC })] });
    await env.signIn(user);
    assert.equal((await send("POST", "/api/files", { headers: { "content-length": "400" }, body: formFor(makePng(), "image/png") })).status, 403, "ohne X-Requested-With");
    assert.equal((await send("POST", "/api/files", { headers: { ...headers(), "content-length": "999999999" }, body: formFor(makePng(), "image/png") })).status, 413);
    const first = await send("POST", "/api/files", { headers: headers({ "idempotency-key": "route-1" }), body: formFor(makePng(), "image/png", { caption: "Front" }) });
    assert.equal(first.status, 201);
    const json = (await first.json()) as { id: string; url: string; replayed: boolean };
    assert.equal(json.url, `/api/files/${json.id}`);
    const again = await send("POST", "/api/files", { headers: headers({ "idempotency-key": "route-1" }), body: formFor(makePng(), "image/png", { caption: "Front" }) });
    assert.equal(again.status, 200);
    assert.equal(((await again.json()) as { id: string }).id, json.id);
    assert.equal(await env.db.fileAttachment.count(), 1);
    assert.equal((await send("POST", "/api/files", { headers: headers(), body: formFor(Buffer.from("GIF89a"), "image/gif") })).status, 415);
    assert.equal((await send("POST", "/api/files", { headers: headers(), body: formFor(makePng(), "image/png", { ownerId: "gibt-es-nicht" }) })).status, 404);
    env.signOut();
  });

  it("Auslieferung: nur mit Sitzung und Recht, Kopfzeilen nosniff + sandbox-CSP + Content-Disposition, fremde/entfernte/gesperrte Dateien 404", async () => {
    const created = out(await upload(mechanic));
    const user = await env.user({ username: "viewer", roles: [await env.role({ permissions: MECHANIC })] });
    env.signOut();
    assert.equal((await send("GET", `/api/files/${created.id}`)).status, 401);
    await env.signIn(user);
    const response = await send("GET", `/api/files/${created.id}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/png");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.match(response.headers.get("content-security-policy") ?? "", /sandbox/);
    assert.match(response.headers.get("content-disposition") ?? "", /^inline;/);
    assert.ok(Buffer.from(await response.arrayBuffer()).length > 0);
    assert.match((await send("GET", `/api/files/${created.id}?download=1`)).headers.get("content-disposition") ?? "", /^attachment;/);
    out(await ops.archiveFileOperation.execute(lead, { id: created.id }));
    assert.equal((await send("GET", `/api/files/${created.id}`)).status, 404, "entfernt");
    env.signOut();
    const noOrders = await env.user({ username: "viewer2", roles: [await env.role({ permissions: ["files.view", "vehicles.view"] })] });
    await env.signIn(noOrders);
    const second = out(await upload(mechanic));
    assert.equal((await send("GET", `/api/files/${second.id}`)).status, 404, "ohne orders.view");
    env.signOut();
  });
});

describe("Kontingent und Löschlauf", () => {
  const removedAgo = async (id: string, days: number) => env.db.fileAttachment.update({ where: { id }, data: { archivedAt: new Date(Date.now() - days * 86_400_000) } });

  it("entfernte Dateien zählen im Kontingent mit, bis der Löschlauf sie löst – Hochladen und Entfernen füllt den Datenträger nicht unbegrenzt", async () => {
    const { MAX_FILES_PER_OWNER } = await import("./constants");
    const created = out(await upload(mechanic));
    const row = await env.db.fileAttachment.findUniqueOrThrow({ where: { id: created.id } });
    // das Kontingent des Auftrags ist bis auf eine Datei gefüllt (die Zeilen sind echt genug: der Zähler zählt Zeilen)
    await env.db.fileAttachment.createMany({
      data: Array.from({ length: MAX_FILES_PER_OWNER - 2 }, (_, i) => ({ orderId, name: `x${i}`, mime: "image/png", size: 1, path: `auftraege/A-2026-0001/fuell-${i}.png`, sha256: "0", uploadedById: mechanic.user.id, uploadedByName: "Tom" })),
    });
    out(await upload(mechanic)); // die letzte freie Stelle
    assert.equal(failure(await upload(mechanic)).key, "files.errors.tooMany");
    // Entfernen schafft keinen Platz (die Datei liegt noch auf dem Datenträger)
    out(await ops.archiveFileOperation.execute(mechanic, { id: created.id }));
    assert.equal(failure(await upload(mechanic)).key, "files.errors.tooMany", "entfernte Dateien zählen mit");
    // der Löschlauf löst sie nach der Frist; erst dann ist wieder Platz
    const { purgeRemovedFiles } = await import("./purge");
    assert.equal(await purgeRemovedFiles(new Date()), 0, "noch innerhalb der Frist");
    await removedAgo(created.id, 31);
    assert.equal(await purgeRemovedFiles(new Date()), 1);
    out(await upload(mechanic));
    assert.ok(row.id);
  });

  it("Löschlauf: die Datei verschwindet vom Datenträger (ein Backup-Hardlink bleibt unberührt), die Zeile bleibt ohne Namen und Beschriftung; wiederholbar", async () => {
    const { linkSync, existsSync: exists } = await import("node:fs");
    const created = out(await upload(mechanic, { name: "Müller Hans.png", caption: "Herr Müller" }));
    const row = await env.db.fileAttachment.findUniqueOrThrow({ where: { id: created.id } });
    const full = path.join(env.dir, "files", ...row.path.split("/"));
    const backupLink = path.join(env.dir, "backup-link.png");
    linkSync(full, backupLink);
    out(await ops.archiveFileOperation.execute(mechanic, { id: created.id }));
    const { purgeRemovedFiles } = await import("./purge");
    assert.equal(await purgeRemovedFiles(new Date()), 0, "frisch entfernt: bleibt");
    assert.ok(exists(full));
    await removedAgo(created.id, 31);
    assert.equal(await purgeRemovedFiles(new Date()), 1);
    assert.equal(exists(full), false, "unter /data/files gelöscht");
    assert.ok(readFileSync(backupLink).length > 0, "der Verweis des Backups bleibt");
    const after = await env.db.fileAttachment.findUniqueOrThrow({ where: { id: created.id } });
    assert.ok(after.purgedAt);
    assert.equal(after.caption, null);
    assert.ok(!after.name.includes("Müller"));
    assert.equal(await purgeRemovedFiles(new Date()), 0, "wiederholbar: nichts mehr zu tun");
    // eine bereits fehlende Datei ist kein Fehler
    const second = out(await upload(mechanic));
    out(await ops.archiveFileOperation.execute(mechanic, { id: second.id }));
    await removedAgo(second.id, 40);
    rmSync(path.join(env.dir, "files"), { recursive: true, force: true });
    assert.equal(await purgeRemovedFiles(new Date()), 1);
  });

  it("der Job ist angemeldet und gehört der Funktion", async () => {
    const { jobs } = await import("./jobs");
    assert.deepEqual(jobs.map((j) => [j.id, j.feature]), [["files.purge", "workshop.files"]]);
  });
});

describe("Idempotenz-Schlüssel: nur für dieselbe Datei am selben Ziel", () => {
  it("anderes Ziel, andere Art oder entfernte Datei: keyReuse statt stillem Erfolg; die Wiederholung gilt auch nach dem Schließen des Auftrags", async () => {
    const first = out(await upload(mechanic, { uploadKey: "k-ziel" }));
    assert.equal(failure(await upload(mechanic, { uploadKey: "k-ziel", ownerType: "vehicle", ownerId: vehicleId })).fields?.file?.key, "files.errors.keyReuse", "anderes Ziel");
    assert.equal(failure(await upload(mechanic, { uploadKey: "k-ziel", category: "damage" })).fields?.file?.key, "files.errors.keyReuse", "andere Art");
    // Auftrag inzwischen abgeschlossen: die Wiederholung (verlorene Antwort) liefert den vorhandenen Eintrag
    await env.db.order.update({ where: { id: orderId }, data: { status: "picked_up" } });
    const replay = out(await upload(mechanic, { uploadKey: "k-ziel" }));
    assert.deepEqual([replay.id, replay.replayed], [first.id, true]);
    await env.db.order.update({ where: { id: orderId }, data: { status: "in_progress" } });
    // entfernt: der Schlüssel liefert nicht mehr die unsichtbare Datei
    out(await ops.archiveFileOperation.execute(mechanic, { id: first.id }));
    assert.equal(failure(await upload(mechanic, { uploadKey: "k-ziel" })).fields?.file?.key, "files.errors.keyReuse", "entfernte Datei");
  });
});

describe("Beschriften und Entfernen: Rechte und Sperren", () => {
  it("wer files.delete hat (ohne files.upload), darf beschriften und entfernen – auch ohne Recht zum Hochladen; am archivierten Fahrzeug bleibt das erlaubt, am geschlossenen Auftrag nicht", async () => {
    const manager = await sessionFor(["files.view", "files.delete", "vehicles.view", "orders.view"]);
    const onVehicle = out(await upload(mechanic, { ownerType: "vehicle", ownerId: vehicleId }));
    const onOrder = out(await upload(mechanic));
    const version = async (id: string) => versionOf(await env.db.fileAttachment.findUniqueOrThrow({ where: { id } }));
    assert.equal(failure(await upload(manager)).code, "forbidden", "hochladen darf die Leitung nicht");
    out(await ops.updateFileOperation.execute(manager, { id: onOrder.id, version: await version(onOrder.id), category: "damage", caption: "Beschriftet von der Leitung" }));
    // archiviertes Fahrzeug: neue Dateien abgelehnt, Beschriften und Entfernen erlaubt
    await env.db.vehicle.update({ where: { id: vehicleId }, data: { archivedAt: new Date() } });
    assert.equal(failure(await upload(mechanic, { ownerType: "vehicle", ownerId: vehicleId })).key, "files.errors.vehicleArchived");
    out(await ops.updateFileOperation.execute(manager, { id: onVehicle.id, version: await version(onVehicle.id), category: "photo", caption: "Archiviertes Fahrzeug" }));
    out(await ops.archiveFileOperation.execute(manager, { id: onVehicle.id }));
    // geschlossener Auftrag: gesperrt
    await env.db.order.update({ where: { id: orderId }, data: { status: "picked_up" } });
    assert.equal(failure(await ops.archiveFileOperation.execute(manager, { id: onOrder.id })).key, "files.errors.orderClosed");
    assert.equal(failure(await ops.updateFileOperation.execute(manager, { id: onOrder.id, version: await version(onOrder.id), category: "photo" })).key, "files.errors.orderClosed");
  });

  it("Art. 18: Dateien am Auftrag sind auch unsichtbar, wenn nur der Halter des Fahrzeugs eingeschränkt ist (wie bei den Checklisten)", async () => {
    const customer = await env.db.customer.create({ data: { lastName: "Halter", processingRestrictedAt: new Date() } });
    const vehicle = await env.db.vehicle.create({ data: { plate: "B HA 1", plateNorm: "BHA1", customerId: customer.id } });
    const order = await env.db.order.create({ data: { number: "A-2026-0077", status: "in_progress", vehicleId: vehicle.id } });
    await env.db.fileAttachment.create({ data: { orderId: order.id, name: "x.png", mime: "image/png", size: 1, path: "auftraege/A-2026-0077/x.png", sha256: "0", uploadedById: mechanic.user.id, uploadedByName: "Tom" } });
    assert.equal((await queries.filesOf(mechanic, { type: "order", id: order.id })).length, 0, "Auftragskunde frei, Halter eingeschränkt: unsichtbar");
    assert.equal(failure(await upload(mechanic, { ownerId: order.id })).code, "notFound", "und nichts neu anhängbar");
  });
});

describe("Auslieferung: Zwischenspeicher und Drossel", () => {
  const send = async (url: string, init: { method?: "GET" | "POST"; headers?: Record<string, string>; body?: FormData } = {}) => {
    const request = new NextRequest(`http://localhost${url}`, { method: init.method ?? "GET", headers: init.headers, body: init.body });
    if (url === "/api/files") return (await import("@/app/api/files/route")).POST(request);
    return (await import("@/app/api/files/[id]/route")).GET(request, { params: Promise.resolve({ id: url.split("/").pop()!.split("?")[0] }) });
  };

  it("Cache-Control ist private, no-cache (Rechte wirken sofort) mit ETag; If-None-Match ergibt 304 – erst nach der Rechteprüfung", async () => {
    const created = out(await upload(mechanic));
    const user = await env.user({ username: "cache-viewer", roles: [await env.role({ permissions: MECHANIC })] });
    await env.signIn(user);
    const first = await send(`/api/files/${created.id}`);
    assert.equal(first.headers.get("cache-control"), "private, no-cache");
    const etag = first.headers.get("etag")!;
    assert.ok(etag);
    const again = await send(`/api/files/${created.id}`, { headers: { "if-none-match": etag } });
    assert.equal(again.status, 304);
    assert.equal(again.headers.get("cache-control"), "private, no-cache");
    out(await ops.archiveFileOperation.execute(lead, { id: created.id }));
    assert.equal((await send(`/api/files/${created.id}`, { headers: { "if-none-match": etag } })).status, 404, "entfernt: nie 304");
    env.signOut();
  });

  it("die Oberfläche ist je Konto gedrosselt: nach zu vielen Anfragen in der Stunde 429 mit Retry-After; andere Konten sind nicht betroffen", async () => {
    const user = await env.user({ username: "heavy", roles: [await env.role({ permissions: MECHANIC })] });
    const other = await env.user({ username: "light", roles: [await env.role({ permissions: MECHANIC })] });
    await env.signIn(user);
    const headers = { "x-requested-with": "schrauberos", "content-length": "400" };
    let status = 0;
    for (let i = 0; i < 205 && status !== 429; i++) status = (await send("/api/files", { method: "POST", headers, body: new FormData() })).status;
    assert.equal(status, 429);
    const refused = await send("/api/files", { method: "POST", headers, body: new FormData() });
    assert.equal(refused.status, 429);
    assert.ok(Number(refused.headers.get("retry-after")) >= 1);
    env.signOut();
    await env.signIn(other);
    assert.notEqual((await send("/api/files", { method: "POST", headers, body: new FormData() })).status, 429);
    env.signOut();
  });
});

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { NextRequest } from "next/server";
import { versionOf } from "@/lib/concurrency";
import type { AppSession } from "@/server/auth/session";
import type { Outcome } from "@/server/operations/operation";
import { createTestEnv, type TestEnv } from "@/test/harness";
import { makePng, pngChunk } from "@/test/png";

/**
 * Checklisten gegen eine echte temporäre SQLite: versionierte Vorlagen (jede Änderung eine neue Version, laufende Checklisten behalten ihre), Beginnen, Punkte je Art (jeder mit eigener Version, gleichzeitig),
 * Abschließen mit Pflichtpunkten und Unterschrift (gezeichnet/getippt, Wiederverwendung, Rollback-Aufräumen), Unveränderlichkeit, Wiederöffnen, Rechte je Entität, Art. 18, Datenschutz, Annahmeprotokoll für den Druck.
 */
let env: TestEnv;
let ops: typeof import("./operations");
let queries: typeof import("./queries");
let hooks: typeof import("@/server/operations/hooks");
let lead: AppSession;
let reopener: AppSession;
let worker: AppSession;
let worker2: AppSession;
let viewer: AppSession;
let vehicleOnly: AppSession;
let blind: AppSession;
let vehicleId: string;
let orderId: string;
let restrictedOrderId: string;
let restrictedVehicleId: string;

const WORK = ["checklists.view", "checklists.fill", "vehicles.view", "orders.view"];

const out = <T>(outcome: Outcome<T>): T => {
  assert.ok(outcome.ok, JSON.stringify(!outcome.ok && outcome.failure));
  return outcome.data;
};
const failure = <T>(outcome: Outcome<T>) => {
  assert.ok(!outcome.ok, "Fehler erwartet");
  return outcome.failure;
};

async function sessionFor(permissions: readonly string[], name = "Person"): Promise<AppSession> {
  const role = await env.role({ permissions });
  const user = await env.user({ username: `u-${Math.random().toString(36).slice(2)}`, name, roles: [role] });
  await env.signIn(user);
  const { getSession } = await import("@/server/auth/session");
  const session = (await getSession())!;
  env.signOut();
  return session;
}

before(async () => {
  env = await createTestEnv();
  for (const key of ["workshop.checklists", "workshop.orders"]) await env.db.featureSetting.create({ data: { key, enabled: true, updatedByName: "test" } });
  ops = await import("./operations");
  queries = await import("./queries");
  hooks = await import("@/server/operations/hooks");
  lead = await sessionFor([...WORK, "checklists.manage"], "Leitung");
  reopener = await sessionFor([...WORK, "checklists.reopen"], "Wiederöffnerin");
  worker = await sessionFor(WORK, "Tom Meyer");
  worker2 = await sessionFor(WORK, "Lena Hoffmann");
  viewer = await sessionFor(["checklists.view", "vehicles.view", "orders.view"], "Nur Lesen");
  vehicleOnly = await sessionFor(["checklists.view", "checklists.fill", "vehicles.view"], "Fahrzeug");
  blind = await sessionFor(["checklists.view", "checklists.fill"], "Blind");
  vehicleId = (await env.db.vehicle.create({ data: { plate: "B AB 12", plateNorm: "BAB12" } })).id;
  orderId = (await env.db.order.create({ data: { number: "A-2026-0001", status: "in_progress", vehicleId } })).id;
  const customer = await env.db.customer.create({ data: { lastName: "Gesperrt", processingRestrictedAt: new Date() } });
  restrictedVehicleId = (await env.db.vehicle.create({ data: { plate: "B XY 9", plateNorm: "BXY9", customerId: customer.id } })).id;
  restrictedOrderId = (await env.db.order.create({ data: { number: "A-2026-0002", status: "in_progress", vehicleId: restrictedVehicleId, customerId: customer.id } })).id;
});
after(() => env.cleanup());

let templateId: string;
beforeEach(async () => {
  hooks.setOperationHooksForTest(null);
  rmSync(path.join(env.dir, "files"), { recursive: true, force: true });
  for (const table of ["checklistEvent", "checklistItem", "checklist", "checklistTemplateItem", "checklistTemplateVersion", "checklistTemplate", "auditLog"] as const) await (env.db[table] as unknown as { deleteMany(): Promise<unknown> }).deleteMany();
  await env.db.order.update({ where: { id: orderId }, data: { status: "in_progress" } });
  templateId = out(
    await ops.saveTemplateOperation.execute(lead, {
      name: "Prüfung",
      signatureMode: "optional",
      items: JSON.stringify([
        { label: "Sichtprüfung", type: "check", required: true },
        { label: "Profiltiefe", type: "measure", unit: "mm", minValue: 1.6, targetValue: 4, required: true },
        { label: "Drehmoment", type: "torque", unit: "Nm", targetValue: 120, minValue: 100, maxValue: 140, required: true },
        { label: "Zustand", type: "choice", options: "gut\nmittel\nschlecht", required: true },
        { label: "Bemerkung", type: "text", required: false },
      ]),
    }),
  ).id;
});

const start = async (session = worker, extra: Record<string, unknown> = {}) => out(await ops.startChecklistOperation.execute(session, { templateId, orderId, ...extra })).id;
const items = (id: string) => env.db.checklistItem.findMany({ where: { checklistId: id }, orderBy: { position: "asc" } });
const itemId = async (id: string, label: string) => (await items(id)).find((i) => i.label === label)!;
const setItem = async (session: AppSession, label: string, checklistId: string, input: Record<string, unknown>) => {
  const item = await itemId(checklistId, label);
  return ops.setItemOperation.execute(session, { id: item.id, version: versionOf(item), ...input });
};
async function fillAll(id: string, session = worker) {
  out(await setItem(session, "Sichtprüfung", id, { done: "1" }));
  out(await setItem(session, "Profiltiefe", id, { numberValue: "3,5" }));
  out(await setItem(session, "Drehmoment", id, { numberValue: "118" }));
  out(await setItem(session, "Zustand", id, { textValue: "gut" }));
}
const checklist = (id: string) => env.db.checklist.findUniqueOrThrow({ where: { id } });
const signaturePng = () => `data:image/png;base64,${makePng(300, 100).toString("base64")}`;
const filesOnDisk = (): string[] => {
  const walk = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? (d.name === ".tmp" ? [] : walk(path.join(dir, d.name))) : [path.join(dir, d.name)])) : []);
  return walk(path.join(env.dir, "files"));
};

describe("Vorlagen und Versionen", () => {
  it("eine Vorlage startet mit Version 1; jede inhaltliche Änderung erzeugt eine neue Version, ohne Änderung bleibt es dabei", async () => {
    const template = await env.db.checklistTemplate.findUniqueOrThrow({ where: { id: templateId } });
    const v1 = await env.db.checklistTemplateVersion.findMany({ where: { templateId } });
    assert.equal(v1.length, 1);
    assert.equal(v1[0].version, 1);
    const detail = (await queries.getTemplate(lead, templateId))!;
    const same = JSON.stringify(detail.items.map((i) => ({ ...i })));
    const unchanged = out(await ops.saveTemplateOperation.execute(lead, { id: templateId, version: versionOf(template), name: "Prüfung", signatureMode: "optional", items: same }));
    assert.deepEqual([unchanged.version, unchanged.changed], [1, false]);
    assert.equal(await env.db.checklistTemplateVersion.count({ where: { templateId } }), 1);

    const changedItems = JSON.stringify([...detail.items.map((i) => ({ ...i })), { label: "Neu", type: "check", required: true }]);
    const fresh = await env.db.checklistTemplate.findUniqueOrThrow({ where: { id: templateId } });
    const changed = out(await ops.saveTemplateOperation.execute(lead, { id: templateId, version: versionOf(fresh), name: "Prüfung neu", signatureMode: "required", note: "Punkt ergänzt", items: changedItems }));
    assert.deepEqual([changed.version, changed.changed], [2, true]);
    const versions = await env.db.checklistTemplateVersion.findMany({ where: { templateId }, orderBy: { version: "asc" }, include: { items: true } });
    assert.deepEqual(versions.map((v) => [v.version, v.items.length, v.name, v.signatureMode]), [[1, 5, "Prüfung", "optional"], [2, 6, "Prüfung neu", "required"]]);
    assert.equal(versions[1].note, "Punkt ergänzt");
    assert.equal(await env.db.auditLog.count({ where: { action: "checklist.templateUpdate" } }), 2, "auch das Speichern ohne Änderung steht im Audit-Log (als unverändert)");
  });

  it("laufende und abgeschlossene Checklisten behalten ihre Version und ihre Punkte, wenn die Vorlage geändert wird", async () => {
    const id = await start();
    const before = (await items(id)).map((i) => i.label);
    const fresh = await env.db.checklistTemplate.findUniqueOrThrow({ where: { id: templateId } });
    out(await ops.saveTemplateOperation.execute(lead, { id: templateId, version: versionOf(fresh), name: "Prüfung", signatureMode: "none", items: JSON.stringify([{ label: "Nur noch einer", type: "check" }]) }));
    assert.deepEqual((await items(id)).map((i) => i.label), before);
    const row = await checklist(id);
    assert.equal(row.templateVersion, 1);
    assert.equal(row.signatureMode, "optional");
    const next = out(await ops.startChecklistOperation.execute(worker, { templateId, orderId }));
    assert.deepEqual((await items(next.id)).map((i) => i.label), ["Nur noch einer"]);
    assert.equal((await checklist(next.id)).templateVersion, 2);
  });

  it("Prüfung der Punkte (Auswahl braucht zwei Möglichkeiten, Grenzen in Reihenfolge), Rechte (nur manage), veraltetes Formular (Konflikt), archivierte Vorlage", async () => {
    const bad = failure(await ops.saveTemplateOperation.execute(lead, { name: "X", items: JSON.stringify([{ label: "A", type: "check" }, { label: "B", type: "choice", options: "eins" }, { label: "C", type: "measure", minValue: 9, maxValue: 1 }]) }));
    assert.equal(bad.fields?.["items.1.options"]?.key, "checklists.errors.optionsNeeded");
    assert.equal(bad.fields?.["items.2.maxValue"]?.key, "checklists.errors.rangeOrder");
    assert.equal(failure(await ops.saveTemplateOperation.execute(worker, { name: "X", items: JSON.stringify([{ label: "A", type: "check" }]) })).code, "forbidden");
    assert.ok(failure(await ops.saveTemplateOperation.execute(lead, { name: "X", items: "kein json" })).fields?.items);
    const template = await env.db.checklistTemplate.findUniqueOrThrow({ where: { id: templateId } });
    const stale = versionOf(template);
    out(await ops.saveTemplateOperation.execute(lead, { id: templateId, version: stale, name: "Prüfung 2", items: JSON.stringify([{ label: "A", type: "check" }]) }));
    assert.equal(failure(await ops.saveTemplateOperation.execute(lead, { id: templateId, version: stale, name: "Prüfung 3", items: JSON.stringify([{ label: "B", type: "check" }]) })).code, "conflict");
    out(await ops.archiveTemplateOperation.execute(lead, { id: templateId, archived: "1" }));
    assert.equal(failure(await ops.startChecklistOperation.execute(worker, { templateId, orderId })).fields?.templateId?.key, "checklists.errors.templateArchived");
    out(await ops.archiveTemplateOperation.execute(lead, { id: templateId, archived: "0" }));
    await start();
  });

  it("mitgelieferte Vorlagen: einrichten (idempotent: ein zweites Mal gibt es nichts mehr), angepasste bleiben unberührt", async () => {
    const created = out(await ops.installDefaultsOperation.execute(lead, {}));
    assert.equal(created.created, 4);
    const intake = await env.db.checklistTemplate.findUniqueOrThrow({ where: { standardKey: "intake" } });
    assert.equal(failure(await ops.installDefaultsOperation.execute(lead, {})).key, "checklists.errors.defaultsPresent");
    out(await ops.saveTemplateOperation.execute(lead, { id: intake.id, version: versionOf(intake), name: "Annahme (angepasst)", items: JSON.stringify([{ label: "Eins", type: "check" }]) }));
    await env.db.checklistTemplate.delete({ where: { standardKey: "oil" } }).catch(() => undefined);
    assert.equal((await env.db.checklistTemplate.findUniqueOrThrow({ where: { standardKey: "intake" } })).name, "Annahme (angepasst)");
    assert.equal(failure(await ops.installDefaultsOperation.execute(worker, {})).code, "forbidden");
  });
});

describe("Beginnen und Punkte", () => {
  it("am Auftrag (Fahrzeug ergibt sich) oder am Fahrzeug; die Punkte werden kopiert; Verlauf und Audit", async () => {
    const id = await start();
    const row = await checklist(id);
    assert.deepEqual([row.vehicleId, row.orderId, row.status, row.templateName, row.templateVersion], [vehicleId, orderId, "open", "Prüfung", 1]);
    assert.equal((await items(id)).length, 5);
    const onVehicle = out(await ops.startChecklistOperation.execute(worker, { templateId, vehicleId })).id;
    assert.equal((await checklist(onVehicle)).orderId, null);
    assert.equal(failure(await ops.startChecklistOperation.execute(worker, { templateId })).key, "checklists.errors.ownerRequired");
    assert.equal(await env.db.checklistEvent.count({ where: { checklistId: id, kind: "created" } }), 1);
    assert.match((await env.db.auditLog.findFirstOrThrow({ where: { action: "checklist.start", entityId: id } })).target ?? "", /Prüfung · A-2026-0001/);
  });

  it("Punkte je Art: Haken, Messwert (mit Komma), Drehmoment außerhalb der Grenzen (gespeichert und markiert), Auswahl, Text; Unsinn wird abgewiesen", async () => {
    const id = await start();
    out(await setItem(worker, "Sichtprüfung", id, { done: "1" }));
    out(await setItem(worker, "Profiltiefe", id, { numberValue: "3,5" }));
    out(await setItem(worker, "Drehmoment", id, { numberValue: "150" }));
    out(await setItem(worker, "Zustand", id, { textValue: "mittel" }));
    out(await setItem(worker, "Bemerkung", id, { textValue: "Kratzer links" }));
    const rows = await items(id);
    const by = (label: string) => rows.find((i) => i.label === label)!;
    assert.deepEqual([by("Sichtprüfung").done, by("Profiltiefe").numberValue, by("Drehmoment").numberValue, by("Zustand").textValue, by("Bemerkung").textValue], [true, 3.5, 150, "mittel", "Kratzer links"]);
    assert.ok(by("Profiltiefe").doneByName === "Tom Meyer" && by("Profiltiefe").doneAt);
    const detail = (await queries.getChecklist(worker, id))!;
    assert.equal(detail.items.find((i) => i.label === "Drehmoment")!.outOfRange, true, "150 Nm liegt über dem Höchstwert 140");
    assert.equal(detail.items.find((i) => i.label === "Profiltiefe")!.outOfRange, false);
    assert.equal(failure(await setItem(worker, "Profiltiefe", id, { done: "1" })).fields?.numberValue?.key, "checklists.errors.valueRequired");
    assert.ok(failure(await setItem(worker, "Profiltiefe", id, { numberValue: "viel" })).fields);
    assert.ok(failure(await setItem(worker, "Zustand", id, { textValue: "super" })).fields?.textValue);
    // Abhaken zurücknehmen löscht Wert und Person
    out(await setItem(worker, "Sichtprüfung", id, { done: "0" }));
    assert.equal((await itemId(id, "Sichtprüfung")).done, false);
    out(await setItem(worker, "Profiltiefe", id, {}));
    const cleared = await itemId(id, "Profiltiefe");
    assert.deepEqual([cleared.done, cleared.numberValue, cleared.doneByName], [false, null, null]);
  });

  it("jeder Punkt hat seine eigene Version: gleichzeitiges Abhaken zweier Personen – verschiedene Punkte gelingen beide, derselbe Punkt nur einmal", async () => {
    const id = await start();
    const a = await itemId(id, "Sichtprüfung");
    const b = await itemId(id, "Zustand");
    const [r1, r2] = await Promise.all([ops.setItemOperation.execute(worker, { id: a.id, version: versionOf(a), done: "1" }), ops.setItemOperation.execute(worker2, { id: b.id, version: versionOf(b), textValue: "gut" })]);
    assert.ok(r1.ok && r2.ok);
    const same = await Promise.all([ops.setItemOperation.execute(worker, { id: a.id, version: versionOf(a), done: "0" }), ops.setItemOperation.execute(worker2, { id: a.id, version: versionOf(a), done: "0" })]);
    assert.equal(same.filter((r) => r.ok).length, 0, "beide Versionen sind seit dem ersten Speichern veraltet");
    assert.equal(failure(same[0]).code, "conflict");
    // mit der neuen Version geht es
    const fresh = await itemId(id, "Sichtprüfung");
    out(await ops.setItemOperation.execute(worker2, { id: fresh.id, version: versionOf(fresh), done: "0" }));
    // die Antwort nennt die neue Version des Punkts
    const result = out(await ops.setItemOperation.execute(worker, { id: a.id, version: versionOf(await itemId(id, "Sichtprüfung")), done: "1" }));
    assert.equal(result.version, versionOf(await itemId(id, "Sichtprüfung")));
  });
});

describe("Abschließen, Unveränderlichkeit, Wiederöffnen", () => {
  it("Abschluss verlangt alle Pflichtpunkte (der optionale darf offen bleiben); danach ist die Checkliste unveränderlich", async () => {
    const id = await start();
    const open = failure(await ops.completeChecklistOperation.execute(worker, { id, version: versionOf(await checklist(id)) }));
    assert.equal(open.key, "checklists.errors.requiredOpen");
    assert.equal(open.params?.count, 4);
    await fillAll(id);
    const done = out(await ops.completeChecklistOperation.execute(worker, { id, version: versionOf(await checklist(id)), note: "alles gut" }));
    assert.equal(done.id, id);
    const row = await checklist(id);
    assert.deepEqual([row.status, row.completedByName, row.note], ["completed", "Tom Meyer", "alles gut"]);
    assert.ok(row.completedAt);
    // unveränderlich
    const item = await itemId(id, "Sichtprüfung");
    assert.equal(failure(await ops.setItemOperation.execute(worker, { id: item.id, version: versionOf(item), done: "0" })).key, "checklists.errors.completed");
    assert.equal(failure(await ops.completeChecklistOperation.execute(worker, { id, version: versionOf(row) })).key, "checklists.errors.completed");
    assert.equal(failure(await ops.discardChecklistOperation.execute(lead, { id, version: versionOf(row) })).key, "checklists.errors.notOpen");
    assert.equal(await env.db.auditLog.count({ where: { action: "checklist.complete" } }), 1);
    assert.equal(await env.db.checklistEvent.count({ where: { checklistId: id, kind: "completed" } }), 1);
  });

  it("Unterschrift gezeichnet: Datei unter /data/files, Prüfsumme; dasselbe Bild für eine zweite Checkliste wird abgelehnt; ohne Kundennamen Feldfehler", async () => {
    const id = await start();
    await fillAll(id);
    const version = versionOf(await checklist(id));
    assert.equal(failure(await ops.completeChecklistOperation.execute(worker, { id, version, signature: signaturePng() })).fields?.customerName?.key, "validation.required");
    out(await ops.completeChecklistOperation.execute(worker, { id, version, customerName: "Erika Muster", signature: signaturePng() }));
    const row = await checklist(id);
    assert.match(row.signaturePath ?? "", /^checklisten\/unterschriften\/unterschrift-.*\.png$/);
    assert.ok(row.signatureHash && row.customerName === "Erika Muster" && row.signedName === null);
    assert.ok(existsSync(path.join(env.dir, "files", ...(row.signaturePath ?? "").split("/"))));
    // dasselbe Bild für die nächste Checkliste
    const second = await start();
    await fillAll(second);
    const reused = failure(await ops.completeChecklistOperation.execute(worker, { id: second, version: versionOf(await checklist(second)), customerName: "Erika Muster", signature: signaturePng() }));
    assert.equal(reused.fields?.signature?.key, "checklists.errors.signatureReused");
    assert.equal((await checklist(second)).status, "open");
    assert.equal(filesOnDisk().length, 1, "die abgelehnte Unterschrift hinterlässt keine Datei");
  });

  it("Namensweg: der getippte Name muss zum Kundennamen passen; Pflicht-Unterschrift fehlt → Fehler; Vorlage ohne Unterschrift nimmt keine an", async () => {
    const id = await start();
    await fillAll(id);
    const version = versionOf(await checklist(id));
    assert.equal(failure(await ops.completeChecklistOperation.execute(worker, { id, version, customerName: "Erika Muster", signature: "typed:Max Mustermann" })).fields?.signature?.key, "checklists.errors.nameMismatch");
    assert.equal(failure(await ops.completeChecklistOperation.execute(worker, { id, version, customerName: "Erika Muster", signature: "unsinn" })).fields?.signature?.key, "checklists.errors.signatureInvalid");
    out(await ops.completeChecklistOperation.execute(worker, { id, version, customerName: "Erika Muster", signature: "typed:erika  MUSTER" }));
    const row = await checklist(id);
    assert.deepEqual([row.signedName, row.signaturePath], ["erika MUSTER", null]);

    const fresh = await env.db.checklistTemplate.findUniqueOrThrow({ where: { id: templateId } });
    out(await ops.saveTemplateOperation.execute(lead, { id: templateId, version: versionOf(fresh), name: "Pflicht", signatureMode: "required", items: JSON.stringify([{ label: "Eins", type: "check" }]) }));
    const required = await start();
    await setItem(worker, "Eins", required, { done: "1" });
    assert.equal(failure(await ops.completeChecklistOperation.execute(worker, { id: required, version: versionOf(await checklist(required)) })).fields?.signature?.key, "checklists.errors.signatureRequired");
    out(await ops.saveTemplateOperation.execute(lead, { id: templateId, version: versionOf(await env.db.checklistTemplate.findUniqueOrThrow({ where: { id: templateId } })), name: "Ohne", signatureMode: "none", items: JSON.stringify([{ label: "Zwei", type: "check" }]) }));
    const none = await start();
    await setItem(worker, "Zwei", none, { done: "1" });
    assert.equal(failure(await ops.completeChecklistOperation.execute(worker, { id: none, version: versionOf(await checklist(none)), customerName: "X", signature: "typed:X" })).fields?.signature?.key, "checklists.errors.signatureNotAllowed");
  });

  it("scheitert der Abschluss nach dem Ablegen der Unterschrift (Hook wirft), ist die Datei wieder entfernt und die Checkliste bleibt offen", async () => {
    const id = await start();
    await fillAll(id);
    hooks.setOperationHooksForTest([{ operation: "checklists.complete", feature: "workshop.checklists", run: async () => { throw new Error("kaputt"); } }]);
    await assert.rejects(ops.completeChecklistOperation.execute(worker, { id, version: versionOf(await checklist(id)), customerName: "Erika Muster", signature: signaturePng() }), /kaputt/);
    assert.deepEqual(filesOnDisk(), []);
    assert.equal((await checklist(id)).status, "open");
  });

  it("Wiederöffnen: nur mit checklists.reopen (nicht schon mit manage) und Begründung; die Unterschrift gilt nicht mehr, ihre Datei bleibt und steht im Verlauf; bei geschlossenem Auftrag nicht möglich", async () => {
    const id = await start();
    await fillAll(id);
    out(await ops.completeChecklistOperation.execute(worker, { id, version: versionOf(await checklist(id)), customerName: "Erika Muster", signature: signaturePng() }));
    const signedPath = (await checklist(id)).signaturePath!;
    const version = versionOf(await checklist(id));
    assert.equal(failure(await ops.reopenChecklistOperation.execute(worker, { id, version, reason: "Fehler korrigieren" })).code, "forbidden");
    assert.equal(failure(await ops.reopenChecklistOperation.execute(lead, { id, version, reason: "Fehler korrigieren" })).code, "forbidden", "checklists.manage pflegt nur Vorlagen");
    assert.equal(failure(await ops.reopenChecklistOperation.execute(reopener, { id, version, reason: "" })).fields?.reason?.key, "checklists.errors.reasonRequired");
    await env.db.order.update({ where: { id: orderId }, data: { status: "picked_up" } });
    assert.equal(failure(await ops.reopenChecklistOperation.execute(reopener, { id, version, reason: "Fehler korrigieren" })).key, "checklists.errors.orderClosed");
    await env.db.order.update({ where: { id: orderId }, data: { status: "in_progress" } });
    const hash = (await checklist(id)).signatureHash;
    out(await ops.reopenChecklistOperation.execute(reopener, { id, version, reason: "Messwert falsch abgelesen" }));
    const row = await checklist(id);
    assert.deepEqual([row.status, row.signaturePath, row.signatureHash, row.signedName, row.completedAt], ["open", null, null, null, null]);
    assert.ok(existsSync(path.join(env.dir, "files", ...signedPath.split("/"))), "die Datei bleibt");
    const event = await env.db.checklistEvent.findFirstOrThrow({ where: { checklistId: id, kind: "reopened" } });
    assert.deepEqual([event.note, event.signaturePath, event.signatureHash], ["Messwert falsch abgelesen", signedPath, hash]);
    assert.equal(await env.db.auditLog.count({ where: { action: "checklist.reopen" } }), 1);
    // wieder änderbar und erneut abschließbar (mit neuer Unterschrift)
    out(await setItem(worker, "Profiltiefe", id, { numberValue: "3" }));
    assert.equal(failure(await ops.reopenChecklistOperation.execute(reopener, { id, version: versionOf(await checklist(id)), reason: "noch offen" })).key, "checklists.errors.notCompleted");
  });

  it("die Bild-Sperre überdauert das Wiederöffnen und lässt sich nicht mit einem Zusatzteil im PNG umgehen (Prüfsumme über die Bildpunkte); die Checkliste selbst darf ihr Bild erneut nehmen", async () => {
    const id = await start();
    await fillAll(id);
    out(await ops.completeChecklistOperation.execute(worker, { id, version: versionOf(await checklist(id)), customerName: "Erika Muster", signature: signaturePng() }));
    const other = await start();
    await fillAll(other);
    // dasselbe Bild mit einem zusätzlichen Textteil: gleiche Bildpunkte, andere Bytes
    const plain = makePng(300, 100);
    const withText = Buffer.concat([plain.subarray(0, plain.length - 12), pngChunk("tEXt", Buffer.from("Comment\0versteckt")), plain.subarray(plain.length - 12)]);
    const tagged = `data:image/png;base64,${withText.toString("base64")}`;
    assert.equal(failure(await ops.completeChecklistOperation.execute(worker, { id: other, version: versionOf(await checklist(other)), customerName: "Erika Muster", signature: tagged })).fields?.signature?.key, "checklists.errors.signatureReused", "Zusatzteil ändert die Pixelsumme nicht");
    // wiederöffnen: die Sperre bleibt (über den Verlauf)
    out(await ops.reopenChecklistOperation.execute(reopener, { id, version: versionOf(await checklist(id)), reason: "Messwert falsch abgelesen" }));
    assert.equal((await checklist(id)).signatureHash, null);
    assert.equal(failure(await ops.completeChecklistOperation.execute(worker, { id: other, version: versionOf(await checklist(other)), customerName: "Erika Muster", signature: signaturePng() })).fields?.signature?.key, "checklists.errors.signatureReused");
    assert.equal((await checklist(other)).status, "open");
    // dieselbe Checkliste darf ihr Bild erneut verwenden
    out(await ops.completeChecklistOperation.execute(worker, { id, version: versionOf(await checklist(id)), customerName: "Erika Muster", signature: signaturePng() }));
    // gespeichert wird nur die bereinigte Datei (ohne den Zusatzteil)
    const saved = readFileSync(path.join(env.dir, "files", ...((await checklist(id)).signaturePath ?? "").split("/")));
    assert.ok(!saved.includes(Buffer.from("versteckt")));
  });

  it("Fahrzeug mit Checkliste ist nicht löschbar: inUse mit Zählung (nicht erst am Fremdschlüssel), nur archivierbar", async () => {
    const { vehicleDeletable } = await import("@/modules/workshop/vehicles/domain");
    assert.equal(vehicleDeletable({ appointments: 0, tireSets: 0, orders: 0, transfers: 0, checklists: 1 }), false);
    assert.equal(vehicleDeletable({ appointments: 0, tireSets: 0, orders: 0, transfers: 0, checklists: 0 }), true);
    const own = await env.db.vehicle.create({ data: { plate: "B CL 1", plateNorm: "BCL1" } });
    out(await ops.startChecklistOperation.execute(worker, { templateId, vehicleId: own.id }));
    const { deleteVehicleOperation } = await import("@/modules/workshop/vehicles/operations");
    const admin = await sessionFor(["vehicles.delete", "vehicles.view"], "Löscher");
    const refused = failure(await deleteVehicleOperation.execute(admin, { id: own.id }));
    assert.equal(refused.code, "inUse");
    assert.equal(refused.params?.checklists, 1);
    assert.ok(await env.db.vehicle.findUnique({ where: { id: own.id } }));
  });

  it("Verwerfen: wer begonnen hat oder die Leitung; danach nicht mehr änderbar; bleibt mit Verlauf erhalten", async () => {
    const id = await start();
    const version = versionOf(await checklist(id));
    assert.equal(failure(await ops.discardChecklistOperation.execute(worker2, { id, version })).code, "forbidden");
    // gleichnamiges Konto: der Anzeigename berechtigt nicht
    const namesake = await sessionFor(WORK, "Tom Meyer");
    assert.equal(failure(await ops.discardChecklistOperation.execute(namesake, { id, version })).code, "forbidden");
    out(await ops.discardChecklistOperation.execute(worker, { id, version }));
    assert.equal((await checklist(id)).status, "discarded");
    const item = await itemId(id, "Sichtprüfung");
    assert.equal(failure(await ops.setItemOperation.execute(worker, { id: item.id, version: versionOf(item), done: "1" })).key, "checklists.errors.discarded");
    assert.equal(await env.db.checklistEvent.count({ where: { checklistId: id, kind: "discarded" } }), 1);
    const other = await start();
    out(await ops.discardChecklistOperation.execute(lead, { id: other, version: versionOf(await checklist(other)) }));
  });
});

describe("Rechte, Art. 18 und Datenschutz", () => {
  it("Checklisten am Auftrag nur mit orders.view, am Fahrzeug nur mit vehicles.view; Kunden mit eingeschränkter Verarbeitung: unsichtbar und nichts neu beginnbar", async () => {
    const onOrder = await start();
    const onVehicle = out(await ops.startChecklistOperation.execute(worker, { templateId, vehicleId })).id;
    assert.deepEqual((await queries.listChecklists(viewer, { status: "all" }, { skip: 0, take: 10 })).rows.map((r) => r.id).sort(), [onOrder, onVehicle].sort());
    assert.deepEqual((await queries.listChecklists(vehicleOnly, { status: "all" }, { skip: 0, take: 10 })).rows.map((r) => r.id), [onVehicle], "ohne orders.view nur die am Fahrzeug");
    assert.equal((await queries.listChecklists(blind, { status: "all" }, { skip: 0, take: 10 })).total, 0);
    assert.equal(await queries.getChecklist(vehicleOnly, onOrder), null);
    assert.equal(failure(await ops.startChecklistOperation.execute(vehicleOnly, { templateId, orderId })).code, "forbidden");
    assert.equal(failure(await ops.startChecklistOperation.execute(blind, { templateId, vehicleId })).code, "forbidden");
    const item = await itemId(onOrder, "Sichtprüfung");
    assert.equal(failure(await ops.setItemOperation.execute(vehicleOnly, { id: item.id, version: versionOf(item), done: "1" })).code, "notFound");
    assert.equal(failure(await ops.startChecklistOperation.execute(worker, { templateId, orderId: restrictedOrderId })).code, "notFound");
    assert.equal(failure(await ops.startChecklistOperation.execute(worker, { templateId, vehicleId: restrictedVehicleId })).code, "notFound");
    const hidden = await env.db.checklist.create({ data: { templateId, versionId: (await env.db.checklistTemplateVersion.findFirstOrThrow({ where: { templateId } })).id, templateName: "Prüfung", templateVersion: 1, vehicleId: restrictedVehicleId, orderId: restrictedOrderId, createdByName: "X" } });
    assert.equal(await queries.getChecklist(lead, hidden.id), null);
    assert.equal((await queries.statusCounts(lead)).open, 2);
    await env.db.order.update({ where: { id: orderId }, data: { status: "picked_up" } });
    assert.equal(failure(await ops.startChecklistOperation.execute(worker, { templateId, orderId })).key, "checklists.errors.orderClosed");
    const closed = await queries.getChecklist(worker, onOrder);
    assert.equal(closed!.ownerOpen, false);
    assert.equal(failure(await ops.setItemOperation.execute(worker, { id: item.id, version: versionOf(item), done: "1" })).key, "checklists.errors.orderClosed");
  });

  it("Auskunft und Anonymisierung: Kundenname, getippter Name, Anmerkung und Freitexte verschwinden, die Unterschrift-Datei bleibt; Haken und Messwerte bleiben", async () => {
    const customer = await env.db.customer.create({ data: { lastName: "Muster", firstName: "Erika" } });
    const owned = await env.db.vehicle.create({ data: { plate: "B-MU 1", plateNorm: "BMU1", customerId: customer.id } });
    const id = out(await ops.startChecklistOperation.execute(worker, { templateId, vehicleId: owned.id })).id;
    await fillAll(id);
    out(await setItem(worker, "Bemerkung", id, { textValue: "Frau Muster wartet im Kundenraum" }));
    out(await ops.completeChecklistOperation.execute(worker, { id, version: versionOf(await checklist(id)), customerName: "Erika Muster", note: "Rückruf unter 0170", signature: signaturePng() }));
    const { privacyProviders } = await import("./privacy");
    const section = (await privacyProviders[0].collect({ id: customer.id, terms: [] }))[0];
    const text = JSON.stringify(section);
    assert.equal(section.records.length, 1);
    assert.ok(text.includes("Erika Muster") && text.includes("Frau Muster wartet") && text.includes("gespeichert (Bilddatei)"));
    const { hooks: anonymize } = await import("./hooks");
    await env.db.$transaction(async (tx) => {
      await anonymize[0].run({ tx, input: { id: customer.id }, operation: "customers.anonymize", result: {}, principal: lead } as never);
    });
    const row = await checklist(id);
    assert.deepEqual([row.customerName, row.signedName, row.note], [null, null, null]);
    assert.ok(row.signaturePath && existsSync(path.join(env.dir, "files", ...row.signaturePath.split("/"))), "die Unterschrift bleibt");
    const rows = await items(id);
    assert.equal(rows.find((i) => i.label === "Bemerkung")!.textValue, null);
    assert.equal(rows.find((i) => i.label === "Profiltiefe")!.numberValue, 3.5);
    assert.equal(rows.find((i) => i.label === "Zustand")!.textValue, "gut");
  });

  it("Annahmeprotokoll für den Druck (F8): rechtegeprüft, mit Punkten und Unterschrift-Referenz; ohne Recht oder bei eingeschränktem Kunden null", async () => {
    await ops.installDefaultsOperation.execute(lead, {});
    const intake = await env.db.checklistTemplate.findUniqueOrThrow({ where: { standardKey: "intake" } });
    const id = out(await ops.startChecklistOperation.execute(worker, { templateId: intake.id, orderId })).id;
    const { intakeProtocol, readProtocolSignature } = await import("./public");
    const open = (await intakeProtocol(viewer, orderId))!;
    assert.deepEqual([open.status, open.templateName, open.orderNumber, open.signature.kind], ["open", "Annahmeprotokoll", "A-2026-0001", "none"]);
    assert.ok(open.items.length >= 8);
    assert.equal(await intakeProtocol(vehicleOnly, orderId), null, "ohne orders.view");
    assert.equal(await intakeProtocol(blind, orderId), null);
    const rows = await items(id);
    for (const row of rows.filter((r) => r.required)) {
      const patch = row.type === "measure" ? { numberValue: "87450" } : row.type === "choice" ? { textValue: row.options!.split("\n")[0] } : { done: "1" };
      out(await ops.setItemOperation.execute(worker, { id: row.id, version: versionOf(row), ...patch }));
    }
    out(await ops.completeChecklistOperation.execute(worker, { id, version: versionOf(await checklist(id)), customerName: "Erika Muster", signature: signaturePng() }));
    const done = (await intakeProtocol(viewer, orderId))!;
    assert.deepEqual([done.status, done.signature.kind, done.signature.name, done.customerName], ["completed", "image", "Erika Muster", "Erika Muster"]);
    const png = await readProtocolSignature(viewer, id);
    assert.ok(png && png.subarray(1, 4).toString() === "PNG");
    assert.equal(await readProtocolSignature(vehicleOnly, id), null);
    assert.equal(await readProtocolSignature(blind, id), null);
  });
});

describe("Auslieferung der Unterschrift", () => {
  it("nur mit Sitzung und Rechten, Kopfzeilen nosniff + sandbox, sonst 401/403/404", async () => {
    const id = await start();
    await fillAll(id);
    out(await ops.completeChecklistOperation.execute(worker, { id, version: versionOf(await checklist(id)), customerName: "Erika Muster", signature: signaturePng() }));
    const get = async () => (await import("@/app/api/checklists/[id]/signature/route")).GET(new NextRequest(`http://localhost/api/checklists/${id}/signature`), { params: Promise.resolve({ id }) });
    env.signOut();
    assert.equal((await get()).status, 401);
    await env.signIn(await env.user({ username: "sig-view", roles: [await env.role({ permissions: WORK })] }));
    const ok = await get();
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("content-type"), "image/png");
    assert.equal(ok.headers.get("x-content-type-options"), "nosniff");
    assert.match(ok.headers.get("content-security-policy") ?? "", /sandbox/);
    assert.ok(readFileSync(path.join(env.dir, "files", ...(await checklist(id)).signaturePath!.split("/"))).length > 0);
    env.signOut();
    await env.signIn(await env.user({ username: "sig-blind", roles: [await env.role({ permissions: ["checklists.view", "vehicles.view"] })] }));
    assert.equal((await get()).status, 404, "ohne orders.view gibt es die Checkliste am Auftrag nicht");
    env.signOut();
    await env.signIn(await env.user({ username: "sig-none", roles: [await env.role({ permissions: [] })] }));
    assert.equal((await get()).status, 403);
    env.signOut();
  });
});

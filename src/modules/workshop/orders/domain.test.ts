import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { appointmentStatusForOrder } from "../appointments/order-sync";
import { ORDER_STATUSES } from "./constants";
import { CLOSABLE, STATUS_STEPS, canStep, formatOrderNumber, isOpen, mileageDecision } from "./domain";

describe("Auftragsnummer", () => {
  it("A-JJJJ-NNNN mit mindestens vier Stellen; darüber wächst sie ohne abzuschneiden", () => {
    assert.equal(formatOrderNumber(2026, 1), "A-2026-0001");
    assert.equal(formatOrderNumber(2026, 9999), "A-2026-9999");
    assert.equal(formatOrderNumber(2026, 12345), "A-2026-12345");
  });
});

describe("Statuskette", () => {
  it("jeder Status kommt in der Tabelle vor; „Abgeholt“ ist nie ein Ziel eines gewöhnlichen Schritts und führt nirgendwohin", () => {
    assert.deepEqual(Object.keys(STATUS_STEPS).sort(), [...ORDER_STATUSES].sort());
    for (const targets of Object.values(STATUS_STEPS)) assert.ok(!targets.includes("picked_up"));
    assert.deepEqual(STATUS_STEPS.picked_up, []);
  });

  it("vorwärts, ein Schritt zurück und stornieren; abgeschlossen bewegt sich nicht, storniert nur zurück auf Angenommen", () => {
    assert.ok(canStep("accepted", "in_progress") && canStep("in_progress", "ready") && canStep("ready", "in_progress"));
    assert.ok(canStep("accepted", "cancelled") && canStep("ready", "cancelled"));
    assert.ok(!canStep("picked_up", "ready") && !canStep("picked_up", "cancelled"));
    assert.ok(canStep("cancelled", "accepted") && !canStep("cancelled", "ready"));
    assert.ok(!canStep("nonsense", "accepted"));
  });

  it("offen sind Angenommen, In Arbeit und Fertig; abschließen lässt sich aus In Arbeit und Fertig", () => {
    assert.deepEqual(ORDER_STATUSES.filter(isOpen), ["accepted", "in_progress", "ready"]);
    assert.deepEqual([...CLOSABLE], ["in_progress", "ready"]);
  });
});

describe("Kilometerstand", () => {
  it("höher oder Fahrzeug ohne Stand: schreiben; niedriger: behalten (Hinweis); gleich oder ohne Angabe: nichts", () => {
    assert.equal(mileageDecision(100, 101), "write");
    assert.equal(mileageDecision(null, 5), "write");
    assert.equal(mileageDecision(100, 99), "keep");
    assert.equal(mileageDecision(100, 100), "none");
    assert.equal(mileageDecision(100, null), "none");
    assert.equal(mileageDecision(100, undefined), "none");
    assert.equal(mileageDecision(null, 0), "write");
  });
});

describe("Terminstatus zum Auftrag", () => {
  it("In Arbeit nur aus Geplant/Bestätigt, Abschluss erledigt auch einen laufenden Termin, Fertig/Storniert/Angenommen ändern nichts", () => {
    const step = (status: string, from: string) => appointmentStatusForOrder("orders.setStatus", status, from);
    assert.equal(step("in_progress", "scheduled"), "in_progress");
    assert.equal(step("in_progress", "confirmed"), "in_progress");
    assert.equal(step("in_progress", "in_progress"), null);
    assert.equal(step("in_progress", "done"), null, "ein erledigter Termin wird nicht zurückgesetzt");
    for (const status of ["accepted", "ready", "cancelled"]) assert.equal(step(status, "scheduled"), null, status);
    assert.equal(appointmentStatusForOrder("orders.close", "picked_up", "in_progress"), "done");
    assert.equal(appointmentStatusForOrder("orders.close", "picked_up", "scheduled"), "done");
    assert.equal(appointmentStatusForOrder("orders.close", "picked_up", "cancelled"), null, "ein abgesagter Termin bleibt abgesagt");
    assert.equal(appointmentStatusForOrder("orders.close", "picked_up", "no_show"), null);
    assert.equal(appointmentStatusForOrder("orders.reopen", "ready", "done"), "in_progress");
    assert.equal(appointmentStatusForOrder("orders.reopen", "ready", "scheduled"), null);
  });
});

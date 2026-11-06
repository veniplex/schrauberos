import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { togglePermission, toggleGroupPermissions } from "./role-mask";

const GROUP = ["appointments.view", "appointments.create", "appointments.edit", "appointments.delete"] as const;
const none = new Set<string>();

describe("Rollenmaske: Bearbeiten setzt Ansehen", () => {
  it("wer ein Recht der Gruppe anwählt, bekommt „Ansehen“ dazu", () => {
    for (const key of ["appointments.create", "appointments.edit", "appointments.delete"]) {
      const next = togglePermission(new Set(), key, true, GROUP, none);
      assert.deepEqual([...next].sort(), ["appointments.view", key].sort(), key);
    }
  });

  it("„Ansehen“ selbst zieht nichts nach; abwählen von „Ansehen“ entfernt die übrigen Rechte der Gruppe", () => {
    assert.deepEqual([...togglePermission(new Set(), "appointments.view", true, GROUP, none)], ["appointments.view"]);
    const all = new Set<string>([...GROUP, "tires.view"]);
    assert.deepEqual([...togglePermission(all, "appointments.view", false, GROUP, none)], ["tires.view"]);
  });

  it("ein einzelnes Recht abwählen lässt „Ansehen“ stehen", () => {
    const next = togglePermission(new Set(GROUP), "appointments.edit", false, GROUP, none);
    assert.equal(next.has("appointments.edit"), false);
    assert.equal(next.has("appointments.view"), true);
  });

  it("gesperrte Rechte bleiben unverändert: „Ansehen“ wird nicht gesetzt, wenn man es nicht vergeben darf; beim Abwählen bleiben gesperrte stehen", () => {
    const locked = new Set(["appointments.view", "appointments.delete"]);
    assert.equal(togglePermission(new Set(), "appointments.edit", true, GROUP, locked).has("appointments.view"), false);
    const next = togglePermission(new Set(GROUP), "appointments.create", false, GROUP, locked);
    assert.equal(next.has("appointments.create"), false);
    // „Ansehen“ ist gesperrt und lässt sich nicht umschalten
    assert.deepEqual([...togglePermission(new Set(GROUP), "appointments.view", false, GROUP, locked)].sort(), [...GROUP].sort());
    const viewOnly = new Set(["appointments.create", "appointments.edit"]);
    assert.deepEqual([...togglePermission(viewOnly, "appointments.view", false, GROUP, new Set(["appointments.delete"]))], [], "beim Abwählen von Ansehen fallen nur ungesperrte Rechte");
  });

  it("Gruppe an-/abwählen überspringt gesperrte Rechte", () => {
    const locked = new Set(["appointments.delete"]);
    assert.deepEqual([...toggleGroupPermissions(new Set(), GROUP, true, locked)].sort(), ["appointments.create", "appointments.edit", "appointments.view"]);
    assert.deepEqual([...toggleGroupPermissions(new Set(GROUP), GROUP, false, locked)], ["appointments.delete"]);
  });

  it("verändert die übergebene Auswahl nicht", () => {
    const before = new Set(["appointments.view"]);
    togglePermission(before, "appointments.edit", true, GROUP, none);
    assert.deepEqual([...before], ["appointments.view"]);
  });
});

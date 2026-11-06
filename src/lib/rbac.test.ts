import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ALL_PERMISSIONS } from "@/modules/catalog";
import { actorOf, checkGrantRole, checkManageUser, checkRoleChange, checkRoleDelete, hasAdminOnlyRights, lockedPermissions, rawRights } from "./rbac";

const role = (id: string, permissions: string[], isAdmin = false) => ({ id, isAdmin, permissions });
const admin = actorOf("a", [role("admin", [], true)]);
const helper = actorOf("h", [role("helper", ["appointments.view", "appointments.edit", "roles.manage"])]);

describe("Rechte-Hierarchie (reine Logik)", () => {
  it("Rohrechte: Administrator-Rolle = alle Rechte, sonst die Vereinigung", () => {
    assert.equal(rawRights([role("x", [], true)]).size, ALL_PERMISSIONS.length);
    assert.deepEqual([...rawRights([role("a", ["x.1"]), role("b", ["x.2", "x.1"])])].sort(), ["x.1", "x.2"]);
  });

  it("Konten: nur Teilmengen der eigenen Rechte, nie Administratoren", () => {
    assert.equal(checkManageUser(helper, [role("r", ["appointments.view"])]), null);
    assert.equal(checkManageUser(helper, []), null);
    assert.equal(checkManageUser(helper, [role("r", ["invoices.view"])]), "notSubset");
    assert.equal(checkManageUser(helper, [role("admin", [], true)]), "adminRole");
    assert.equal(checkManageUser(admin, [role("admin", [], true)]), null);
  });

  it("Rollen vergeben: Teilmenge, kein adminOnly (auch nicht, wenn man es selbst hat), keine Administrator-Rolle", () => {
    assert.equal(checkGrantRole(helper, role("r", ["appointments.edit"])), null);
    assert.equal(checkGrantRole(helper, role("r", ["roles.manage"])), "adminOnly");
    assert.equal(checkGrantRole(helper, role("r", ["tires.view"])), "notSubset");
    assert.equal(checkGrantRole(helper, role("r", [], true)), "adminRole");
    assert.equal(checkGrantRole(admin, role("r", ["roles.manage"])), null);
  });

  it("Rollen ändern: nur die Differenz zählt", () => {
    const target = role("t", ["appointments.view", "invoices.edit"]);
    assert.equal(checkRoleChange(helper, target, ["appointments.view", "invoices.edit"]), null, "unverändert");
    assert.equal(checkRoleChange(helper, target, ["appointments.view", "invoices.edit", "appointments.edit"]), null, "eigenes Recht dazu");
    assert.equal(checkRoleChange(helper, target, ["appointments.view"]), "notSubset", "fremdes Recht entfernt");
    assert.equal(checkRoleChange(helper, target, ["appointments.view", "invoices.edit", "tires.view"]), "notSubset", "fremdes Recht dazu");
    assert.equal(checkRoleChange(helper, target, ["appointments.view", "invoices.edit", "roles.manage"]), "adminOnly");
  });

  it("Rollen ändern: nie die eigene, nie Administrator-Rollen, nie Rollen mit adminOnly-Rechten", () => {
    assert.equal(checkRoleChange(helper, role("helper", ["appointments.view"]), ["appointments.view"]), "ownRole");
    assert.equal(checkRoleChange(helper, role("admin", [], true), []), "adminRole");
    assert.equal(checkRoleChange(helper, role("t", ["users.manage"]), ["users.manage"]), "adminOnly");
    assert.equal(checkRoleChange(admin, role("helper", ["users.manage"]), []), null);
  });

  it("Neue Rolle: Rechte des Aufrufers ohne adminOnly", () => {
    assert.equal(checkRoleChange(helper, null, ["appointments.view"]), null);
    assert.equal(checkRoleChange(helper, null, ["tires.view"]), "notSubset");
    assert.equal(checkRoleChange(helper, null, ["roles.manage"]), "adminOnly");
  });

  it("Rolle löschen: wie Vergeben, nie die eigene", () => {
    assert.equal(checkRoleDelete(helper, role("helper", ["appointments.view"])), "ownRole");
    assert.equal(checkRoleDelete(helper, role("t", ["appointments.view"])), null);
    assert.equal(checkRoleDelete(helper, role("t", ["tires.view"])), "notSubset");
  });

  it("gesperrte Rechte in der Maske: adminOnly und fremde; für Administratoren keine", () => {
    assert.deepEqual(lockedPermissions(admin, ["users.manage", "tires.view"]), []);
    assert.deepEqual(lockedPermissions(helper, ["roles.manage", "tires.view", "appointments.view"]), ["roles.manage", "tires.view"]);
  });

  it("Warnung: Konto/Rolle ohne Administrator, aber mit Verwaltungsrechten", () => {
    assert.equal(hasAdminOnlyRights([role("h", ["roles.manage"])]), true);
    assert.equal(hasAdminOnlyRights([role("h", ["appointments.view"])]), false);
    assert.equal(hasAdminOnlyRights([role("a", [], true), role("h", ["roles.manage"])]), false);
  });
});

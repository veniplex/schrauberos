import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AUDIT_ACTIONS } from "@/lib/audit-actions";
import { de } from "@/i18n/messages/de";
import { en } from "@/i18n/messages/en";
import { ADMIN_ONLY_PERMISSIONS, ALL_PERMISSIONS, FEATURES, MODULES, fullFeatureId } from "./catalog";
import { DEFAULT_ROLES } from "./default-roles";
import { featureKey } from "./catalog-logic";

/** Löst einen Schlüssel wie "tires.feature.name" in einem Übersetzungsbaum auf. */
function lookup(tree: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => (node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined), tree);
}

const ids = FEATURES.map((f) => featureKey(f));
const byId = new Map<string, (typeof FEATURES)[number]>(FEATURES.map((f) => [featureKey(f), f]));

describe("Katalog", () => {
  it("IDs von Modulen und Funktionen sind eindeutig", () => {
    assert.equal(new Set(MODULES.map((m) => m.id)).size, MODULES.length);
    assert.equal(new Set(ids).size, ids.length);
  });

  it("jede Funktion gehört zu einem Modul, jedes Modul hat Funktionen", () => {
    const moduleIds = new Set<string>(MODULES.map((m) => m.id));
    for (const f of FEATURES) assert.ok(moduleIds.has(f.module), `${fullFeatureId(f)}: unbekanntes Modul`);
    for (const m of MODULES) assert.ok(FEATURES.some((f) => f.module === m.id), `${m.id}: ohne Funktionen`);
  });

  it("Rechte sind eindeutig und beginnen mit dem Namen ihrer Gruppe", () => {
    assert.equal(new Set(ALL_PERMISSIONS).size, ALL_PERMISSIONS.length, "Recht kommt doppelt vor");
    const groups = FEATURES.map((f) => f.permissions.group);
    assert.equal(new Set(groups).size, groups.length, "Rechte-Gruppe kommt doppelt vor");
    for (const f of FEATURES) for (const key of f.permissions.keys) assert.ok(key.startsWith(`${f.permissions.group}.`), `${key} passt nicht zur Gruppe ${f.permissions.group}`);
  });

  it("Navigationseinträge verlangen ein Recht ihrer eigenen Funktion", () => {
    for (const f of FEATURES) for (const n of f.nav) assert.ok((f.permissions.keys as readonly string[]).includes(n.permission), `${fullFeatureId(f)}: ${n.href} → ${n.permission}`);
  });

  it("Routen sind eindeutig", () => {
    const routes = FEATURES.flatMap((f) => f.routes);
    assert.equal(new Set(routes).size, routes.length);
  });

  it("requires/uses verweisen auf vorhandene Funktionen, ohne Selbstbezug und ohne Zyklen", () => {
    for (const f of FEATURES) {
      const id = featureKey(f);
      for (const dep of [...("requires" in f ? f.requires : []), ...("uses" in f ? f.uses : [])]) {
        assert.ok(byId.has(dep), `${id}: unbekannte Abhängigkeit ${dep}`);
        assert.notEqual(dep, id, `${id}: Selbstbezug`);
      }
    }
    // Zyklen nur bei harten Abhängigkeiten problematisch
    const visit = (id: string, trail: string[]) => {
      assert.ok(!trail.includes(id), `Zyklus: ${[...trail, id].join(" → ")}`);
      const f = byId.get(id)!;
      for (const dep of "requires" in f ? f.requires : []) visit(dep, [...trail, id]);
    };
    ids.forEach((id) => visit(id, []));
  });

  it("Pflichtfunktionen hängen nur von Pflichtfunktionen ab und liegen in Pflichtmodulen", () => {
    for (const f of FEATURES) {
      if (!("required" in f && f.required)) continue;
      const mod = MODULES.find((m) => m.id === f.module)!;
      assert.ok("required" in mod && !!mod.required, `${featureKey(f)}: Pflichtfunktion in optionalem Modul`);
      for (const dep of (f as { requires?: readonly string[] }).requires ?? []) {
        const d = byId.get(dep)!;
        assert.ok("required" in d && !!d.required, `${featureKey(f)} verlangt ${dep}, das ausschaltbar ist`);
      }
    }
  });

  it("Namen, Beschreibungen und Navigationstexte sind auf Deutsch und Englisch vorhanden", () => {
    const keys = [
      ...MODULES.flatMap((m) => [m.nameKey, m.descriptionKey]),
      ...FEATURES.flatMap((f) => [f.nameKey, f.descriptionKey, ...f.nav.map((n) => n.labelKey)]),
    ];
    for (const key of keys) {
      for (const [lang, tree] of [["de", de], ["en", en]] as const) assert.equal(typeof lookup(tree, key), "string", `${lang}: Text ${key} fehlt`);
    }
  });

  it("Rechte und Rechte-Gruppen haben Beschriftungen", () => {
    for (const f of FEATURES) {
      for (const [lang, tree] of [["de", de], ["en", en]] as const) {
        assert.equal(typeof lookup(tree, `permissionGroups.${f.permissions.group}`), "string", `${lang}: permissionGroups.${f.permissions.group}`);
        for (const key of f.permissions.keys) assert.equal(typeof lookup(tree, `permissions.${key}`), "string", `${lang}: permissions.${key}`);
      }
    }
  });

  it("Standardrollen enthalten nur gültige Rechte, jedes höchstens einmal", () => {
    const valid = new Set<string>(ALL_PERMISSIONS);
    for (const role of DEFAULT_ROLES) {
      for (const p of role.permissions) assert.ok(valid.has(p), `${role.key}: ${p}`);
      assert.equal(new Set(role.permissions).size, role.permissions.length, `${role.key}: Recht doppelt (die Basisdaten würden an der Eindeutigkeit scheitern)`);
    }
  });

  it("adminOnly-Rechte gibt es, gehören zur eigenen Funktion und stecken in keiner Standardrolle (Regel 9)", () => {
    for (const f of FEATURES) {
      for (const p of (f.permissions as { adminOnly?: readonly string[] }).adminOnly ?? []) assert.ok((f.permissions.keys as readonly string[]).includes(p), `${p} nicht in der Gruppe`);
    }
    for (const p of ["users.manage", "roles.manage", "backup.manage", "updates.manage", "modules.manage", "settings.manage"]) assert.ok(ADMIN_ONLY_PERMISSIONS.has(p), `${p} muss adminOnly sein`);
    for (const role of DEFAULT_ROLES) for (const p of role.permissions) assert.ok(!ADMIN_ONLY_PERMISSIONS.has(p), `${role.key}: ${p} ist adminOnly`);
  });

  it("jede Audit-Aktion hat eine Beschriftung", () => {
    for (const action of AUDIT_ACTIONS) {
      for (const [lang, tree] of [["de", de], ["en", en]] as const) assert.equal(typeof lookup(tree, `audit.actions.${action}`), "string", `${lang}: audit.actions.${action}`);
    }
  });
});

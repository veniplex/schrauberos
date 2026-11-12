import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AUDIT_ACTIONS } from "@/lib/audit-actions";
import { de } from "@/i18n/messages/de";
import { en } from "@/i18n/messages/en";
import { ADMIN_ONLY_PERMISSIONS, ALL_PERMISSIONS, FEATURES, MARKED_PERMISSIONS, MODULES, fullFeatureId } from "./catalog";
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

  it("explicitOnly-Rechte (nur ausdrücklich, auch für Administratoren): echte Rechte der eigenen Funktion, gekennzeichnet, nie adminOnly, in keiner Standardrolle, keiner Rollenvorlage und keinem API-Token, und nie Teil dessen, was „Administrator“ bedeutet", async () => {
    const { EXPLICIT_ONLY_PERMISSIONS, ADMIN_IMPLIED_PERMISSIONS, isExplicitOnly } = await import("./catalog");
    const { ROLE_TEMPLATES, templatePermissions } = await import("./role-templates");
    const { isApiForbidden } = await import("@/lib/api/scope");
    assert.ok(EXPLICIT_ONLY_PERMISSIONS.size >= 2, "mindestens die beiden Tresor-Rechte");
    // Tippfehler fallen auf: jeder Eintrag in explicitOnly ist ein Recht derselben Funktion
    for (const f of FEATURES) {
      for (const p of (f.permissions as { explicitOnly?: readonly string[] }).explicitOnly ?? []) {
        assert.ok((f.permissions.keys as readonly string[]).includes(p), `${fullFeatureId(f)}: explicitOnly nennt ${p}, das es in der Gruppe nicht gibt (Tippfehler wirkt nie)`);
        assert.ok(!ADMIN_ONLY_PERMISSIONS.has(p), `${p}: zugleich adminOnly (ein Recht der Verwaltung vergibt nur der Administrator – „nur ausdrücklich“ meint das Gegenteil)`);
        assert.ok(MARKED_PERMISSIONS.has(p), `${p}: ausdrücklich zu vergebende Rechte brauchen eine Kennzeichnung (Regel 9)`);
        assert.ok(isApiForbidden(p), `${p}: nie in einem API-Token`);
      }
    }
    for (const p of EXPLICIT_ONLY_PERMISSIONS) {
      assert.ok(isExplicitOnly(p));
      assert.ok(!ADMIN_IMPLIED_PERMISSIONS.includes(p as never), `${p}: Administrator bedeutet alle Rechte außer diesen`);
      for (const role of DEFAULT_ROLES) assert.ok(!(role.permissions as readonly string[]).includes(p), `${role.key}: ${p}`);
      for (const template of ROLE_TEMPLATES) assert.ok(!(templatePermissions(template) as readonly string[]).includes(p), `Rollenvorlage ${template.id}: ${p}`);
    }
    assert.equal(ADMIN_IMPLIED_PERMISSIONS.length + EXPLICIT_ONLY_PERMISSIONS.size, ALL_PERMISSIONS.length, "Administrator = alle Rechte minus die ausdrücklichen");
  });

  it("gekennzeichnete Rechte (Export, Import …) gehören zur eigenen Funktion und stecken in keiner Standardrolle (Regel 9); jedes Recht mit Namen .export/.import ist gekennzeichnet", () => {
    for (const f of FEATURES) {
      const marked = (f.permissions as { marked?: Record<string, readonly string[]> }).marked ?? {};
      for (const [mark, keys] of Object.entries(marked)) for (const p of keys) assert.ok((f.permissions.keys as readonly string[]).includes(p), `${p} (${mark}) nicht in der Gruppe`);
    }
    assert.ok(MARKED_PERMISSIONS.size >= 8, "mindestens die Rechte für Export und Import je Datenart");
    for (const role of DEFAULT_ROLES) for (const p of role.permissions) assert.ok(!MARKED_PERMISSIONS.has(p), `${role.key}: ${p} ist gekennzeichnet (${MARKED_PERMISSIONS.get(p)}) und gehört in keine Standardrolle`);
    // Gegenprobe zum Namensmuster: die Kennzeichnung steht im Katalog, ein vergessenes Recht fällt trotzdem auf
    for (const p of ALL_PERMISSIONS) if (/\.(export|import)$/.test(p)) assert.ok(MARKED_PERMISSIONS.has(p), `${p} fehlt unter permissions.marked`);
  });

  it("jedes Recht hat Namen und Kurzbeschreibung (Rollenmaske) in beiden Sprachen – und es gibt keine Beschreibung ohne Recht", () => {
    for (const [lang, tree] of [["de", de], ["en", en]] as const) {
      for (const p of ALL_PERMISSIONS) {
        const [group, action] = p.split(".");
        assert.equal(typeof lookup(tree, `permissions.${group}.${action}`), "string", `${lang}: permissions.${p}`);
        const hint = lookup(tree, `permissionHints.${group}.${action}`);
        assert.ok(typeof hint === "string" && hint.trim().length >= 10, `${lang}: permissionHints.${p} fehlt oder ist zu kurz`);
      }
      const known = new Set<string>(ALL_PERMISSIONS);
      const hints = (tree as unknown as { permissionHints: Record<string, Record<string, string>> }).permissionHints;
      for (const [group, actions] of Object.entries(hints)) for (const action of Object.keys(actions)) assert.ok(known.has(`${group}.${action}`), `${lang}: permissionHints.${group}.${action} gehört zu keinem Recht`);
    }
  });

  it("jede Rechte-Gruppe hat einen Namen für die Rollenmaske", () => {
    for (const f of FEATURES) assert.equal(typeof lookup(de, `permissionGroups.${f.permissions.group}`), "string", f.permissions.group);
  });

  it("jede Audit-Aktion hat eine Beschriftung", () => {
    for (const action of AUDIT_ACTIONS) {
      for (const [lang, tree] of [["de", de], ["en", en]] as const) assert.equal(typeof lookup(tree, `audit.actions.${action}`), "string", `${lang}: audit.actions.${action}`);
    }
  });
});

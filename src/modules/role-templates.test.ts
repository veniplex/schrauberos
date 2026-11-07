import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { de } from "@/i18n/messages/de";
import { en } from "@/i18n/messages/en";
import { ADMIN_ONLY_PERMISSIONS, ALL_PERMISSIONS, MARKED_PERMISSIONS } from "./catalog";
import { DEFAULT_ROLES } from "./default-roles";
import { ROLE_TEMPLATES, isRuleNinePermission, templatePermissions } from "./role-templates";

const lookup = (tree: unknown, key: string) => key.split(".").reduce<unknown>((node, part) => (node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined), tree);

describe("Rollenvorlagen", () => {
  it("Mechaniker, Büro und Leitung – abgeleitet von vorhandenen Standardrollen, mit Namen in beiden Sprachen", () => {
    assert.deepEqual(ROLE_TEMPLATES.map((t) => t.id), ["mechanic", "office", "management"]);
    for (const template of ROLE_TEMPLATES) {
      assert.ok(DEFAULT_ROLES.some((r) => r.key === template.from), `${template.id}: Standardrolle fehlt`);
      for (const [lang, tree] of [["de", de], ["en", en]] as const) {
        assert.equal(typeof lookup(tree, template.nameKey), "string", `${lang}: ${template.nameKey}`);
        assert.equal(typeof lookup(tree, template.descriptionKey), "string", `${lang}: ${template.descriptionKey}`);
      }
    }
  });

  it("Vorlagen enthalten nur gültige Rechte, nicht leer – und nie ein Recht nach Regel 9 (Verwaltung, gekennzeichnet, sensible Mitarbeiterdaten)", () => {
    const valid = new Set<string>(ALL_PERMISSIONS);
    for (const template of ROLE_TEMPLATES) {
      const permissions = templatePermissions(template);
      assert.ok(permissions.length > 0, template.id);
      for (const p of permissions) {
        assert.ok(valid.has(p), `${template.id}: ${p}`);
        assert.ok(!ADMIN_ONLY_PERMISSIONS.has(p) && !MARKED_PERMISSIONS.has(p), `${template.id}: ${p} gehört nach Regel 9 in keine Vorlage`);
        assert.notEqual(p, "employees.sensitive", `${template.id}: sensible Mitarbeiterdaten`);
      }
    }
  });

  it("die Leitung hat gegenüber der Standardrolle „Geschäftsführung“ nur die sensiblen Mitarbeiterdaten weniger", () => {
    const management = DEFAULT_ROLES.find((r) => r.key === "management")!;
    const leitung = templatePermissions(ROLE_TEMPLATES.find((t) => t.id === "management")!);
    assert.deepEqual(management.permissions.filter((p) => !leitung.includes(p)), ["employees.sensitive"]);
    assert.ok(isRuleNinePermission("employees.sensitive") && isRuleNinePermission("customers.export") && isRuleNinePermission("users.manage") && !isRuleNinePermission("customers.view"));
  });
});

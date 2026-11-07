import type { MessageKey } from "@/i18n/translate";
import { ADMIN_ONLY_PERMISSIONS, MARKED_PERMISSIONS, type Permission } from "./catalog";
import { DEFAULT_ROLES } from "./default-roles";

/**
 * Rollenvorlagen der Rollenmaske (P2b-3): „Mechaniker“, „Büro“, „Leitung“ füllen die Auswahl vor. Sie sind **von den Standardrollen abgeleitet** (`default-roles.ts`, eine Quelle der Wahrheit)
 * und enthalten nie ein Recht nach Regel 9: keine Rechte der Verwaltung (`adminOnly`), keine gekennzeichneten (Export, Import, Versand …) und keine sensiblen Mitarbeiterdaten. Wer so etwas
 * vergeben will, wählt es bewusst in der Maske. Test: `role-templates.test.ts`.
 */
export type RoleTemplateDef = { id: string; /** Schlüssel der Standardrolle, aus der die Vorlage kommt */ from: string; nameKey: MessageKey; descriptionKey: MessageKey };

export const ROLE_TEMPLATES: readonly RoleTemplateDef[] = [
  { id: "mechanic", from: "mechanic", nameKey: "roles.templates.mechanic.name", descriptionKey: "roles.templates.mechanic.description" },
  { id: "office", from: "office", nameKey: "roles.templates.office.name", descriptionKey: "roles.templates.office.description" },
  { id: "management", from: "management", nameKey: "roles.templates.management.name", descriptionKey: "roles.templates.management.description" },
];

/** Sensible Mitarbeiterdaten stehen (noch) nicht unter `permissions.marked` im Katalog (siehe Produktentscheid in den offenen Punkten); Vorlagen lassen sie trotzdem immer weg. */
const SENSITIVE_WITHOUT_MARK: ReadonlySet<string> = new Set(["employees.sensitive"]);

/** Rechte, die nie in einer Vorlage stehen (Regel 9). */
export const isRuleNinePermission = (permission: string): boolean => ADMIN_ONLY_PERMISSIONS.has(permission) || MARKED_PERMISSIONS.has(permission) || SENSITIVE_WITHOUT_MARK.has(permission);

/** Rechte einer Vorlage: die der Standardrolle ohne Rechte nach Regel 9. */
export function templatePermissions(template: RoleTemplateDef): Permission[] {
  const role = DEFAULT_ROLES.find((r) => r.key === template.from);
  return (role?.permissions ?? []).filter((p) => !isRuleNinePermission(p));
}

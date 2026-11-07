"use client";

import { useState } from "react";
import { Checkbox, Field, Form, FormActions, Input } from "@/components/ui/form";
import { Button } from "@/components/ui/buttons";
import { Card } from "@/components/ui/layout";
import { togglePermission, toggleGroupPermissions } from "@/lib/role-mask";
import { useI18n } from "@/i18n/client";
import { saveRole } from "./actions";

export type RolePermissionSection = {
  moduleId: string;
  moduleName: string;
  groups: Array<{ group: string; label: string; keys: Array<{ key: string; label: string }>; inactive: boolean }>;
};

/** `sections` kommt vom Server (Katalog + Aktivierungsstand + Übersetzungen), das Formular kennt keine Fachlogik. */
export function RoleForm({
  initial,
  sections,
  lockedPermissions,
}: {
  initial: { id?: string; version?: string; name: string; description: string; isAdmin: boolean; permissions: string[] };
  sections: RolePermissionSection[];
  /** Rechte, die der angemeldete Benutzer nicht vergeben oder entziehen darf (nicht Teil seiner eigenen Rechte oder nur für Administratoren) */
  lockedPermissions: string[];
}) {
  const { t } = useI18n();
  const [selected, setSelected] = useState(() => new Set(initial.permissions));

  const locked = new Set(lockedPermissions);
  // Regeln der Maske („Bearbeiten“ setzt „Ansehen“ …): src/lib/role-mask.ts, getestet
  const toggle = (key: string, on: boolean, groupKeys: readonly string[]) => setSelected((s) => togglePermission(s, key, on, groupKeys, locked));
  const toggleGroup = (keys: readonly string[], on: boolean) => setSelected((s) => toggleGroupPermissions(s, keys, on, locked));

  return (
    <Form action={saveRole} className="flex max-w-4xl flex-col gap-5">
      {initial.id ? (
        <>
          <input type="hidden" name="id" value={initial.id} />
          <input type="hidden" name="version" value={initial.version ?? ""} />
        </>
      ) : null}
      <Card>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("roles.fields.name")} htmlFor="name" name="name" required>
            <Input id="name" name="name" defaultValue={initial.name} maxLength={60} required />
          </Field>
          <Field label={t("roles.fields.description")} htmlFor="description">
            <Input id="description" name="description" defaultValue={initial.description} maxLength={300} />
          </Field>
        </div>
      </Card>

      {initial.isAdmin ? (
        <p className="rounded-md bg-info-bg px-3.5 py-2.5 text-sm text-info-ink">{t("roles.adminNotice")}</p>
      ) : (
        <div className="flex flex-col gap-6">
          {sections.map((section) => (
            <section key={section.moduleId} aria-labelledby={`perm-module-${section.moduleId}`}>
              <h2 id={`perm-module-${section.moduleId}`} className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                {section.moduleName}
              </h2>
              <div className="grid gap-4 md:grid-cols-2">
                {section.groups.map((group) => {
                  const keys = group.keys.map((k) => k.key);
                  const free = keys.filter((k) => !locked.has(k));
                  const allOn = free.every((k) => selected.has(k));
                  return (
                    <Card
                      key={group.group}
                      title={group.label}
                      actions={
                        free.length > 0 ? (
                          <Button variant="ghost" size="sm" onClick={() => toggleGroup(keys, !allOn)}>
                            {allOn ? t("roles.selectNone") : t("roles.selectAll")}
                          </Button>
                        ) : null
                      }
                    >
                      {group.inactive ? <p className="mb-2 text-xs text-warning-ink">{t("roles.featureInactive")}</p> : null}
                      <ul className="flex flex-col gap-2">
                        {group.keys.map(({ key, label }) => (
                          <li key={key}>
                            <Checkbox
                              name={locked.has(key) ? undefined : "permission"}
                              value={key}
                              checked={selected.has(key)}
                              disabled={locked.has(key)}
                              onChange={(e) => toggle(key, e.target.checked, keys)}
                              label={label}
                              hint={locked.has(key) ? t("roles.lockedRight") : undefined}
                            />
                            {/* gesperrte, aber vorhandene Rechte bleiben erhalten (der Server prüft nur die Differenz) */}
                            {locked.has(key) && selected.has(key) ? <input type="hidden" name="permission" value={key} /> : null}
                          </li>
                        ))}
                      </ul>
                    </Card>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      <FormActions cancelHref="/admin/roles" />
    </Form>
  );
}

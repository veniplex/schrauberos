"use client";

import { useState } from "react";
import { Field, Form, FormActions, Input } from "@/components/ui/form";
import { Alert, Card } from "@/components/ui/layout";
import type { MaskSection, PreviewData } from "@/lib/role-mask";
import { useI18n } from "@/i18n/client";
import { saveRole } from "./actions";
import { RoleMask, type RoleTemplateOption } from "./role-mask";

export type RolePermissionSection = MaskSection;
export type { RoleTemplateOption };

/** Formular einer Rolle: Name, Beschreibung und die Rechte-Auswahl (`RoleMask`). */
export function RoleForm({
  initial,
  sections,
  lockedPermissions,
  templates,
  preview,
}: {
  initial: { id?: string; version?: string; name: string; description: string; isAdmin: boolean; permissions: string[] };
  sections: RolePermissionSection[];
  lockedPermissions: string[];
  templates: RoleTemplateOption[];
  preview: PreviewData;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);

  return (
    <Form action={saveRole} className="flex max-w-6xl flex-col gap-5">
      {initial.id ? (
        <>
          <input type="hidden" name="id" value={initial.id} />
          <input type="hidden" name="version" value={initial.version ?? ""} />
        </>
      ) : null}
      <Card>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t("roles.fields.name")} htmlFor="name" name="name" required>
            <Input id="name" name="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required />
          </Field>
          <Field label={t("roles.fields.description")} htmlFor="description">
            <Input id="description" name="description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} />
          </Field>
        </div>
      </Card>

      {initial.isAdmin ? (
        <Alert tone="info">{t("roles.adminNotice")}</Alert>
      ) : (
        <RoleMask
          initialPermissions={initial.permissions}
          sections={sections}
          lockedPermissions={lockedPermissions}
          templates={templates}
          preview={preview}
          onTemplate={(template) => {
            // eine Vorlage füllt leeren Namen und leere Beschreibung vor
            // aus dem aktuellen Zustand rechnen (Funktionsupdate), nicht aus dem Rückruf der letzten Darstellung
            setName((current) => (current.trim() ? current : template.name));
            setDescription((current) => (current.trim() ? current : template.description));
          }}
        />
      )}

      <FormActions cancelHref="/admin/roles" />
    </Form>
  );
}

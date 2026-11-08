"use server";

import { z } from "zod";
import type { MessageKey } from "@/i18n/translate";
import { claimRow } from "@/lib/concurrency";
import { formObject } from "@/lib/forms";
import { checkRoleChange, checkRoleDelete, type Denial } from "@/lib/rbac";
import { isPermission } from "@/modules/catalog";
import { defineAction, defineOperation, fail } from "@/server/operations";
import { auditRoleExplicitChange } from "@/server/rbac/explicit-audit";
import { loadActor, toRights } from "@/server/rbac/hierarchy";
import { secretHoldings } from "@/server/secret-holdings";

const deniedKey = (denial: Denial) => `rbac.denied.${denial}` as MessageKey;

const saveInput = z.object({
  id: z.string().optional(),
  version: z.string().optional(),
  name: z.string().trim().min(1).max(60),
  description: z.string().max(300).optional(),
  permissions: z.array(z.string()),
});

function slug(name: string) {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 30) || "rolle"
  );
}

const saveRoleOperation = defineOperation({
  name: "admin.roles.save",
  permission: "roles.manage",
  input: saveInput,
  audit: (input) => (input.id ? "role.update" : "role.create"),
  // abhängige Einträge (Tresor) vor der Transaktion zählen: für den Vermerk bei der Vergabe ausdrücklicher Rechte
  prepare: async () => ({ holdings: await secretHoldings() }),
  // Prüfen (Rechte-Hierarchie, Version) und Schreiben in einer Transaktion
  run: async ({ input: d, principal, prepared, tx, audit }) => {
    const submitted = d.permissions;
    let beforePermissions: readonly string[] = [];
    let afterPermissions: readonly string[] = submitted;
    const actor = await loadActor(tx, principal.user.id);
    let roleId: string;
    if (d.id) {
      const role = await tx.role.findUnique({ where: { id: d.id }, include: { permissions: true } });
      if (!role) fail("conflict");
      // Administrator-Rollen haben immer alle Rechte -> keine Einzelrechte speichern
      const next = role.isAdmin ? [] : submitted;
      const denied = checkRoleChange(actor, toRights(role), next);
      if (denied) fail("forbidden", deniedKey(denied));
      if (!(await claimRow(tx.role, role.id, d.version))) fail("conflict");
      beforePermissions = role.permissions.map((p) => p.permission);
      afterPermissions = next;
      await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
      await tx.role.update({
        where: { id: role.id },
        data: { name: d.name, description: d.description ?? null, permissions: { create: next.map((permission) => ({ permission })) } },
      });
      roleId = role.id;
    } else {
      const denied = checkRoleChange(actor, null, submitted);
      if (denied) fail("forbidden", deniedKey(denied));
      let key = slug(d.name);
      if (await tx.role.findUnique({ where: { key } })) key = `${key}-${Date.now().toString(36)}`;
      roleId = (await tx.role.create({ data: { key, name: d.name, description: d.description ?? null, permissions: { create: submitted.map((permission) => ({ permission })) } } })).id;
    }
    // Ausdrücklich zu vergebende Rechte (Tresor) hinzugefügt oder entzogen: eigener Audit-Eintrag je Recht (Rolle und Recht), nicht nur der Rollenname
    await auditRoleExplicitChange(tx, principal, { id: roleId, name: d.name }, beforePermissions, afterPermissions, prepared.holdings);
    audit({ target: d.name, entityId: roleId });
    return { roleId };
  },
});

export const saveRole = defineAction(saveRoleOperation, {
  form: (fd) => ({ ...formObject(fd), permissions: [...new Set(fd.getAll("permission").map(String).filter(isPermission))] }),
  revalidate: ["/admin/roles"],
  redirect: "/admin/roles",
  message: "common.saved", // der Toast meldet das Speichern (kein `?saved=` mehr in der Adresse)
});

const deleteRoleOperation = defineOperation({
  name: "admin.roles.delete",
  permission: "roles.manage",
  input: z.object({ id: z.string().min(1) }),
  audit: "role.delete",
  run: async ({ input, principal, tx, audit }) => {
    const role = await tx.role.findUnique({ where: { id: input.id }, include: { permissions: true } });
    if (!role) fail("notFound");
    if (role.isSystem || role.isAdmin) fail("forbidden", "roles.errors.protected");
    const denied = checkRoleDelete(await loadActor(tx, principal.user.id), toRights(role));
    if (denied) fail("forbidden", deniedKey(denied));
    await tx.role.delete({ where: { id: input.id } });
    audit({ target: role.name, entityId: input.id });
    return { id: input.id };
  },
});

export const deleteRole = defineAction(deleteRoleOperation, {
  revalidate: ["/admin/roles"],
  redirect: "/admin/roles",
  message: "common.deleted",
  redirectOnError: "/admin/roles",
});

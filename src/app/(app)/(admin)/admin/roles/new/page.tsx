import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/layout";
import { getI18n } from "@/i18n/server";
import { requirePermission } from "@/server/auth/session";
import { RoleForm } from "@/modules/admin/roles/forms";
import { permissionSections } from "@/modules/admin/roles/sections";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("roles.new") };
}

export default async function NewRolePage() {
  await requirePermission("roles.manage");
  const [{ t }, sections] = await Promise.all([getI18n(), permissionSections()]);
  return (
    <>
      <PageHeader title={t("roles.new")} />
      <RoleForm sections={sections} initial={{ name: "", description: "", isAdmin: false, permissions: [] }} />
    </>
  );
}

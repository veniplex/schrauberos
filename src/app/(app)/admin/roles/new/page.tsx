import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/layout";
import { getI18n } from "@/i18n/server";
import { requirePermission } from "@/server/auth/session";
import { RoleForm } from "@/modules/core/forms";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("roles.new") };
}

export default async function NewRolePage() {
  await requirePermission("roles.manage");
  const { t } = await getI18n();
  return (
    <>
      <PageHeader title={t("roles.new")} />
      <RoleForm initial={{ name: "", description: "", isAdmin: false, permissions: [] }} />
    </>
  );
}

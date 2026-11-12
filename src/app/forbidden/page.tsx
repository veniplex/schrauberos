import { ShieldAlert } from "lucide-react";
import { LinkButton } from "@/components/ui/buttons";
import { getI18n } from "@/i18n/server";
import { getSession } from "@/server/auth/session";

export default async function ForbiddenPage() {
  const [{ t }, session] = await Promise.all([getI18n(), getSession()]);
  // Administratoren haben „alle Rechte“ – außer den ausdrücklich zu vergebenden (IT-Tresor): Wer abgewiesen wird, soll den Grund und den Weg kennen (Z6-5 M8)
  const admin = Boolean(session?.user.isAdmin && session.can("roles.manage"));
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <ShieldAlert className="size-10 text-warning-ink" aria-hidden />
        <h1 className="text-xl font-semibold">{t("auth.forbiddenTitle")}</h1>
        <p className="text-sm text-ink-muted">{t("auth.forbiddenText")}</p>
        {admin ? <p className="text-sm text-ink-muted">{t("auth.forbiddenAdminText")}</p> : null}
        <div className="flex flex-wrap justify-center gap-2">
          <LinkButton href="/" variant="primary">
            {t("common.toDashboard")}
          </LinkButton>
          {admin ? (
            <LinkButton href="/admin/roles" variant="secondary">
              {t("auth.forbiddenAdminRoles")}
            </LinkButton>
          ) : null}
        </div>
      </div>
    </main>
  );
}

import { ShieldAlert } from "lucide-react";
import { LinkButton } from "@/components/ui/buttons";
import { getI18n } from "@/i18n/server";

export default async function ForbiddenPage() {
  const { t } = await getI18n();
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <ShieldAlert className="size-10 text-warning-ink" aria-hidden />
        <h1 className="text-xl font-semibold">{t("auth.forbiddenTitle")}</h1>
        <p className="text-sm text-ink-muted">{t("auth.forbiddenText")}</p>
        <LinkButton href="/" variant="primary">
          {t("common.toDashboard")}
        </LinkButton>
      </div>
    </main>
  );
}

import type { Metadata } from "next";
import { Wrench } from "lucide-react";
import { getI18n } from "@/i18n/server";
import { hasPendingLogin } from "@/server/auth/session";
import { safeNext } from "@/lib/safe-next";
import { Alert, Card } from "@/components/ui/layout";
import { LinkButton } from "@/components/ui/buttons";
import { VerifyForm } from "./verify-form";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("auth.secondFactor.title") };
}

/**
 * Zweiter Schritt der Anmeldung (öffentlich erreichbar, wie die Anmeldung): Code der Authenticator-App oder Sicherungscode. Die Seite gibt es nur mit dem
 * Zwischenzustand der Passwort-Eingabe (Cookie `so_2fa`, 5 Minuten); ohne ihn steht hier ein Hinweis mit Weg zurück – kein Rückschluss auf Konten.
 */
export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const [{ t }, { next }, pending] = await Promise.all([getI18n(), searchParams, hasPendingLogin()]);
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <span className="grid size-12 place-items-center rounded-lg bg-accent text-accent-ink">
            <Wrench className="size-6" aria-hidden />
          </span>
          <div>
            <h1 className="text-xl font-semibold">{t("auth.secondFactor.title")}</h1>
            <p className="text-sm text-ink-muted">{t("auth.secondFactor.intro")}</p>
          </div>
        </div>
        <Card as="div">
          {pending ? (
            <VerifyForm next={safeNext(next)} />
          ) : (
            <div className="flex flex-col gap-4">
              <Alert tone="info">{t("auth.secondFactor.expired")}</Alert>
              <LinkButton href="/login" className="w-full">
                {t("auth.secondFactor.toLogin")}
              </LinkButton>
            </div>
          )}
        </Card>
      </div>
    </main>
  );
}

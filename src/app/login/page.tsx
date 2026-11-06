import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Wrench } from "lucide-react";
import { getI18n } from "@/i18n/server";
import { db } from "@/server/db";
import { getSession } from "@/server/auth/session";
import { safeNext } from "@/lib/safe-next";
import { getWorkshop } from "@/server/workshop";
import { LoginForm } from "./login-form";
import { Card } from "@/components/ui/layout";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("auth.signIn") };
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  // Frische Installation: erst den Administrator einrichten
  if ((await db.user.count()) === 0) redirect("/setup");
  const [{ t }, workshop, { next }] = await Promise.all([getI18n(), getWorkshop(), searchParams]);
  // Die Anmeldeseite prüft die Sitzung selbst (der Proxy sieht nur, ob ein Cookie da ist): Ein totes Cookie führt hierher, nicht im Kreis.
  if (await getSession()) redirect(safeNext(next));
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          {workshop.logoDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- Data-URL aus dem Werkstatt-Profil
            <img src={workshop.logoDataUrl} alt="" className="size-14 object-contain" />
          ) : (
            <span className="grid size-12 place-items-center rounded-lg bg-accent text-accent-ink">
              <Wrench className="size-6" aria-hidden />
            </span>
          )}
          <div>
            <h1 className="text-xl font-semibold">{workshop.name}</h1>
            {workshop.tagline ? <p className="text-sm text-ink-muted">{workshop.tagline}</p> : null}
          </div>
        </div>
        <Card as="div">
          <h2 className="mb-4 text-base font-semibold">{t("auth.signIn")}</h2>
          <LoginForm next={safeNext(next)} />
          <p className="mt-4 text-center text-sm">
            <Link href="/login/recover" className="text-accent-text underline-offset-2 hover:underline">
              {t("recovery.link")}
            </Link>
          </p>
        </Card>
      </div>
    </main>
  );
}

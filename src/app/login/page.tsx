import type { Metadata } from "next";
import { Wrench } from "lucide-react";
import { getI18n } from "@/i18n/server";
import { getWorkshop } from "@/server/workshop";
import { LoginForm } from "./login-form";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("auth.signIn") };
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const [{ t }, workshop, { next }] = await Promise.all([getI18n(), getWorkshop(), searchParams]);
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
        <div className="card card-pad">
          <h2 className="mb-4 text-base font-semibold">{t("auth.signIn")}</h2>
          <LoginForm next={next ?? "/"} />
        </div>
      </div>
    </main>
  );
}

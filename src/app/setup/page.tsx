import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Wrench } from "lucide-react";
import { getI18n } from "@/i18n/server";
import { db } from "@/server/db";
import { SetupForm } from "./setup-form";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("setup.title") };
}

/** Ersteinrichtung im Browser: nur erreichbar, solange noch kein Benutzer existiert. */
export default async function SetupPage() {
  if ((await db.user.count()) > 0) redirect("/login");
  const { t } = await getI18n();
  const timezones = Intl.supportedValuesOf("timeZone");

  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <span className="grid size-12 place-items-center rounded-lg bg-accent text-accent-ink">
            <Wrench className="size-6" aria-hidden />
          </span>
          <div>
            <h1 className="text-xl font-semibold">{t("setup.title")}</h1>
            <p className="text-sm text-ink-muted">{t("setup.intro")}</p>
          </div>
        </div>
        <div className="card card-pad">
          <SetupForm timezones={timezones.includes("Europe/Berlin") ? timezones : ["Europe/Berlin", ...timezones]} />
        </div>
        <p className="mt-4 text-center text-xs text-ink-muted">{t("setup.warning")}</p>
      </div>
    </main>
  );
}

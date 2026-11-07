import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Wrench } from "lucide-react";
import { getI18n } from "@/i18n/server";
import { db } from "@/server/db";
import { getSession } from "@/server/auth/session";
import { ensureSetupToken } from "@/server/setup-token";
import { SetupForm } from "./setup-form";
import { SetupRestore } from "./setup-restore";
import { Card } from "@/components/ui/layout";
import { FEATURES, MODULES } from "@/modules/catalog";
import { PRESETS, presetChoices } from "@/modules/presets";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("setup.title") };
}

/** Ersteinrichtung im Browser: nur erreichbar, solange noch kein Benutzer existiert. */
export default async function SetupPage() {
  // Direkt nach der Einrichtung rendert Next die Seite mit der neuen Sitzung noch einmal: Solange der Code des angemeldeten
  // Administrators nicht bestätigt ist, bleibt die Seite (und der Code-Bildschirm im Formular) bestehen.
  const finished = (await db.user.count()) > 0;
  if (finished) {
    const session = await getSession();
    const pending = session ? await db.recoveryCode.findFirst({ where: { userId: session.user.id, confirmedAt: null }, select: { id: true } }) : null;
    if (!pending) redirect("/login");
  } else {
    ensureSetupToken(true); // falls die Datei fehlt (z. B. Entwicklung): neu anlegen und loggen
  }
  const { t } = await getI18n();
  // Funktionsumfang nur anbieten, wenn es eine echte Wahl gibt (mindestens ein Preset schaltet etwas ein)
  const choices = presetChoices(PRESETS, MODULES, FEATURES);
  const presets = choices.length > 1 ? choices.map((p) => ({ id: p.id, name: t(p.nameKey), description: t(p.descriptionKey) })) : [];
  const timezones = Intl.supportedValuesOf("timeZone");

  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center gap-3 text-center print:hidden">
          <span className="grid size-12 place-items-center rounded-lg bg-accent text-accent-ink">
            <Wrench className="size-6" aria-hidden />
          </span>
          <div>
            <h1 className="text-xl font-semibold">{t("setup.title")}</h1>
            <p className="text-sm text-ink-muted">{t("setup.intro")}</p>
          </div>
        </div>
        <Card as="div">
          <SetupForm timezones={timezones.includes("Europe/Berlin") ? timezones : ["Europe/Berlin", ...timezones]} presets={presets} done={finished} />
        </Card>
        {finished ? null : <SetupRestore />}
        <p className="mt-4 text-center text-xs text-ink-muted print:hidden">{t("setup.warning")}</p>
      </div>
    </main>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { SubmitButton } from "@/components/ui/buttons";
import { Input } from "@/components/ui/form";
import { Card, EmptyState, NavLink, PageHeader } from "@/components/ui/layout";
import { Markdown } from "@/components/ui/markdown";
import { getI18n } from "@/i18n/server";
import type { HelpGroup } from "@/modules/help";
import { platformTopics, readHelpPage, type HelpPage, type HelpTopicRef } from "./docs";
import { Disclosure } from "@/components/ui/disclosure";

type Section = { key: string; title: string; topics: Array<HelpTopicRef & { page: HelpPage }> };

const fold = (text: string) => text.toLocaleLowerCase("de");

/**
 * Hilfe (Anwendungsdokumentation): links die Kapitel, gegliedert in „Allgemein“ und die Module; rechts das Kapitel mit
 * Inhaltsverzeichnis – oder die Suchergebnisse. Für alle angemeldeten Benutzer; `groups` enthält nur, was die Funktionen
 * für diese Anmeldung freigeben (aktive Funktion, Recht).
 */
export async function HelpView({ groups, topicId, query }: { groups: HelpGroup[]; topicId?: string; query?: string }) {
  const { t } = await getI18n();
  const sections = await loadSections(groups, t("help.general"), (g) => t(g.nameKey));
  const all = sections.flatMap((s) => s.topics.map((topic) => ({ ...topic, section: s })));

  const search = query?.trim() ?? "";
  const current = search ? undefined : (all.find((x) => x.id === (topicId ?? all[0]?.id)) ?? notFound());
  const hits = search ? all.filter((x) => fold(`${x.page.title}\n${x.page.body}`).includes(fold(search))) : [];

  const nav = (
    <nav aria-label={t("help.contents")} className="flex flex-col gap-4">
      {sections.map((s) => (
        <div key={s.key}>
          <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">{s.title}</p>
          <ul className="flex flex-col gap-0.5">
            {s.topics.map((topic) => (
              <li key={topic.id}>
                <NavLink href={`/help/${topic.id}`} active={topic.id === current?.id} className="min-h-0 py-1.5">
                  {topic.page.title}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <>
      <PageHeader title={t("help.title")} description={t("help.description")} />
      <form action="/help" role="search" className="mb-4 flex flex-wrap items-center gap-3">
        <Input name="q" defaultValue={search} placeholder={t("help.searchPlaceholder")} aria-label={t("help.searchPlaceholder")} className="min-w-56 flex-1 sm:max-w-sm" />
        <SubmitButton variant="secondary">{t("common.search")}</SubmitButton>
      </form>

      <div className="grid gap-6 lg:grid-cols-[14rem_minmax(0,1fr)] xl:grid-cols-[14rem_minmax(0,1fr)_14rem]">
        <Disclosure title={t("help.contents")} className="lg:hidden">
          <div className="mt-3">{nav}</div>
        </Disclosure>
        <div className="hidden lg:block">{nav}</div>

        {current ? (
          <>
            <Card as="article" className="min-w-0">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">{current.section.title}</p>
              <h2 className="mb-4 text-xl font-semibold">{current.page.title}</h2>
              <Markdown source={current.page.body} />
            </Card>

            {current.page.headings.length > 0 ? (
              <aside className="hidden xl:block">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">{t("help.onThisPage")}</p>
                <ul className="sticky top-6 flex flex-col gap-1 text-sm">
                  {current.page.headings.map((h) => (
                    <li key={h.id} className={h.level === 3 ? "pl-3" : undefined}>
                      <a href={`#${h.id}`} className="text-ink-muted hover:text-ink">
                        {h.text}
                      </a>
                    </li>
                  ))}
                </ul>
              </aside>
            ) : null}
          </>
        ) : (
          <Card className="min-w-0 xl:col-span-2" aria-label={t("help.results")}>
            <h2 className="mb-4 text-xl font-semibold">{t("help.results")}</h2>
            {hits.length === 0 ? (
              <EmptyState title={t("help.noResults")} />
            ) : (
              <ul className="flex flex-col gap-3">
                {hits.map((hit) => (
                  <li key={hit.id}>
                    <Link href={`/help/${hit.id}`} className="font-medium text-accent-text hover:underline">
                      {hit.page.title}
                    </Link>
                    <span className="ml-2 text-sm text-ink-muted">{hit.section.title}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>
    </>
  );
}

/** Lädt die Kapitel („Allgemein“ zuerst, dann die Module); Kapitel, deren Datei fehlt, werden übersprungen. */
async function loadSections(groups: HelpGroup[], generalTitle: string, titleOf: (g: HelpGroup) => string): Promise<Section[]> {
  const raw = [
    { key: "platform", title: generalTitle, topics: await platformTopics() },
    ...groups.map((g) => ({ key: g.module, title: titleOf(g), topics: g.topics })),
  ];
  const sections = await Promise.all(
    raw.map(async (s) => ({
      ...s,
      topics: (await Promise.all(s.topics.map(async (topic) => ({ ...topic, page: await readHelpPage(topic.doc) })))).filter(
        (x): x is HelpTopicRef & { page: HelpPage } => x.page !== null,
      ),
    })),
  );
  return sections.filter((s) => s.topics.length > 0);
}

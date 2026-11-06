import clsx from "clsx";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Markdown } from "@/components/ui/markdown";
import { PageHeader } from "@/components/ui/layout";
import { getI18n } from "@/i18n/server";
import { listHelp, readHelpPage } from "./docs";

/** Hilfe-Seite (Anwendungsdokumentation) mit Kapitelliste links und Inhaltsverzeichnis der Seite. Für alle angemeldeten Benutzer. */
export async function HelpView({ slug }: { slug?: string }) {
  const { t } = await getI18n();
  const chapters = await listHelp();
  const current = slug ?? chapters[0]?.slug;
  const page = current ? await readHelpPage(current) : null;
  if (!page) notFound();

  return (
    <>
      <PageHeader title={t("help.title")} description={t("help.description")} />
      <div className="grid gap-6 lg:grid-cols-[14rem_minmax(0,1fr)] xl:grid-cols-[14rem_minmax(0,1fr)_14rem]">
        <nav aria-label={t("help.contents")} className="flex gap-1 overflow-x-auto lg:flex-col">
          {chapters.map((c) => (
            <Link
              key={c.slug}
              href={`/help/${c.slug}`}
              aria-current={c.slug === current ? "page" : undefined}
              className={clsx(
                "whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium",
                c.slug === current ? "bg-accent-subtle text-accent-text" : "text-ink-muted hover:bg-surface-hover hover:text-ink",
              )}
            >
              {c.title}
            </Link>
          ))}
        </nav>

        <article className="card card-pad min-w-0">
          <h2 className="mb-4 text-xl font-semibold">{page.title}</h2>
          <Markdown source={page.body} />
        </article>

        {page.headings.length > 0 ? (
          <aside className="hidden xl:block">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">{t("help.onThisPage")}</p>
            <ul className="sticky top-6 flex flex-col gap-1 text-sm">
              {page.headings.map((h) => (
                <li key={h.id} className={h.level === 3 ? "pl-3" : undefined}>
                  <a href={`#${h.id}`} className="text-ink-muted hover:text-ink">
                    {h.text}
                  </a>
                </li>
              ))}
            </ul>
          </aside>
        ) : null}
      </div>
    </>
  );
}

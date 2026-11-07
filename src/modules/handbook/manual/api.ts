import { z } from "zod";
import type { DocCategory, DocPage } from "@/generated/prisma/client";
import { pageFilter } from "@/capabilities/docs/visibility";
import { versionOf } from "@/lib/concurrency";
import { iso, nullableString } from "@/server/api/format";
import { defineResource, type Delegate } from "@/server/api/resource";
import { db } from "@/server/db";
import { contains } from "@/server/search";

/**
 * API-Ressource „Handbuch“ (`/api/v1/manual-pages`) – **nur lesend**: die Seiten des Handbuchs (Markdown) für Werkzeuge, die es woanders anzeigen oder durchsuchen. Recht `handbook.view`.
 *
 *  - **Kapitel mit Rollenbeschränkung gibt es für die API nicht**: Ein Token trägt keine Rollen, also sieht es nur Seiten ohne Kapitel und Seiten in Kapiteln, die allen mit Leserecht offenstehen
 *    (`pageFilter` ohne Rollen – dieselbe Regel wie in der Oberfläche für jemanden ohne passende Rolle).
 *  - Schreiben (Seiten, Kapitel, Versionen, Bilder) gibt es nicht über die API (redaktionelle Inhalte für Menschen, `api-exceptions.ts`); Bilder im Text lädt nur der Browser. Die **IT-Dokumentation** ist keine
 *    API-Ressource (sie kann Zugangswissen enthalten).
 */
type Row = DocPage & { category: Pick<DocCategory, "name"> | null };

const item = z.object({
  id: z.string(),
  version: z.string(),
  title: z.string(),
  slug: z.string(),
  category: nullableString,
  pinned: z.boolean(),
  /** Markdown-Text der Seite */
  content: z.string(),
  updatedAt: z.string(),
});

/** Nur Seiten des Handbuchs, die auch jemand ohne passende Rolle sehen darf. */
const SCOPE = { area: "handbook", ...pageFilter({ unrestricted: false, roleIds: [] }) };

export const endpoints = defineResource({
  feature: "handbook.manual",
  tag: "Manual",
  name: "manual-pages",
  singular: "manual page",
  path: "/manual-pages",
  read: "handbook.view",
  model: db.docPage as unknown as Delegate<Row>,
  include: { category: { select: { name: true } } },
  scope: SCOPE,
  item,
  version: versionOf,
  toItem: (page): z.input<typeof item> => ({ id: page.id, version: versionOf(page), title: page.title, slug: page.slug, category: page.category?.name ?? null, pinned: page.pinned, content: page.content, updatedAt: iso(page.updatedAt) }),
  list: {
    filters: z.strictObject({ q: z.string().max(100).optional(), slug: z.string().max(120).optional() }),
    where: ({ q, slug }) => ({ ...(slug ? { slug } : {}), ...(q ? { OR: [{ title: contains(q) }, { content: contains(q) }] } : {}) }),
    sorts: { title: (dir) => ({ title: dir }), updatedAt: (dir) => ({ updatedAt: dir }) },
    defaultSort: [{ key: "title", dir: "asc" }],
  },
});

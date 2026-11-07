import { CodeBlock } from "@/components/ui/code-block";
import { Disclosure } from "@/components/ui/disclosure";
import { Alert, Badge, Card, CardLink, Table, TextLink } from "@/components/ui/layout";
import { PageToc, type TocItem } from "@/components/ui/toc";
import { getI18n } from "@/i18n/server";
import { API_DOC_VERSION } from "@/server/api/openapi";
import type { DocField, DocGroup, DocOperation } from "./docs";
import { DOWNLOAD_EXAMPLE, ERROR_EXAMPLE, FETCH_AFTER_EVENT, NODE_VERIFY, PAGING_EXAMPLE, PHP_VERIFY, PYTHON_VERIFY, UPLOAD_EXAMPLE, WEBHOOK_REQUEST_EXAMPLE } from "./docs-examples";

/**
 * Doku-Seite der Programmierschnittstelle – **serverseitig gerendert** (kein Swagger-UI, kein Redoc: Content-Security-Policy und Gewicht). Sie nennt die Konventionen, die Versionierung, die Webhooks
 * (Signatur samt Prüfcode für Node, Python und PHP) und alle Endpunkte der aktiven Funktionen mit Recht, Parametern, Feldern und curl-Beispiel. Beispiele zeigen nur Platzhalter. Lange Codezeilen scrollen im Block
 * (`CodeBlock`), nie die Seite.
 */
const METHOD_TONE = { GET: "info", POST: "success", PATCH: "warning", DELETE: "danger" } as const;

function Fields({ fields, caption }: { fields: DocField[]; caption: string }) {
  return (
    <Table className="text-xs" caption={caption}>
        <tbody>
          {fields.map((field) => (
            <tr key={field.name}>
              <td className="whitespace-nowrap font-mono">
                {field.name}
                {field.required ? <span aria-hidden className="ml-0.5 text-danger-ink">*</span> : null}
              </td>
              <td className="break-words text-ink-muted">{field.type}</td>
            </tr>
          ))}
        </tbody>
      </Table>
  );
}

async function Operation({ op }: { op: DocOperation }) {
  const { t } = await getI18n();
  return (
    <Disclosure
      variant="panel"
      title={
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <Badge tone={METHOD_TONE[op.method as keyof typeof METHOD_TONE] ?? "neutral"}>{op.method}</Badge>
          <code className="break-all text-xs">{op.path}</code>
          <span className="text-xs font-normal text-ink-muted">{op.summary}</span>
        </span>
      }
    >
      <div className="flex flex-col gap-3 p-2">
        <p className="text-xs text-ink-muted">
          {t("api.docs.endpoint.permission")}: <code>{op.permission}</code> · {t("api.docs.endpoint.success")}: <code>{op.success}</code>
          {op.download ? ` · ${t("api.docs.endpoint.download")}` : ""}
          {op.bodyKind === "multipart" ? ` · ${t("api.docs.endpoint.upload")}` : ""}
        </p>
        {op.downloadNote ? <p className="text-xs text-ink-muted">{op.downloadNote}</p> : null}
        {op.params.length > 0 ? (
          <div>
            <p className="mb-1 text-xs font-semibold">{t("api.docs.endpoint.parameters")}</p>
            <Table className="text-xs" caption={t("api.docs.endpoint.parameters")}>
                <tbody>
                  {op.params.map((param) => (
                    <tr key={`${param.where}-${param.name}`}>
                      <td className="whitespace-nowrap font-mono">
                        {param.name}
                        {param.required ? <span aria-hidden className="ml-0.5 text-danger-ink">*</span> : null}
                      </td>
                      <td className="whitespace-nowrap text-ink-muted">{param.where}</td>
                      <td className="break-words text-ink-muted">
                        {param.type}
                        {param.description ? ` – ${param.description}` : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
          </div>
        ) : null}
        {op.body ? (
          <div>
            <p className="mb-1 text-xs font-semibold">{op.bodyKind === "multipart" ? t("api.docs.endpoint.bodyMultipart") : t("api.docs.endpoint.body")}</p>
            <Fields fields={op.body} caption={t("api.docs.endpoint.body")} />
          </div>
        ) : null}
        {op.response ? (
          <div>
            <p className="mb-1 text-xs font-semibold">{op.list ? t("api.docs.endpoint.responseList") : t("api.docs.endpoint.response")}</p>
            <Fields fields={op.response} caption={t("api.docs.endpoint.response")} />
          </div>
        ) : null}
        <CodeBlock code={op.curl} language="curl" label={`curl ${op.method} ${op.path}`} />
      </div>
    </Disclosure>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <Card title={title} id={id} className="scroll-mt-20">
      <div className="flex flex-col gap-3 text-sm">{children}</div>
    </Card>
  );
}

export async function DocsView({ groups, events, base, jsonHref, tag }: { groups: DocGroup[]; events: Array<{ type: string; label: string; resource: string }>; base: string; jsonHref: string; tag?: string }) {
  const { t } = await getI18n();
  // Eine Ressource je Seite (`?tag=`): hält die Seite klein – alle Endpunkte zusammen wären mehrere Megabyte
  const selected = tag ? groups.find((g) => g.tag === tag) : undefined;
  if (selected) {
    return (
      <div className="flex min-w-0 max-w-5xl flex-col gap-4">
        <p>
          <TextLink href="/admin/api/docs#endpoints">{t("api.docs.endpoints.back")}</TextLink>
        </p>
        <section aria-labelledby="resource-title">
          <h2 id="resource-title" className="mb-1 text-base font-semibold">
            {selected.tag} <span className="font-normal text-ink-muted">({selected.operations.length})</span>
          </h2>
          <p className="mb-3 text-sm text-ink-muted">{t("api.docs.endpoints.resourceIntro")}</p>
          <div className="flex flex-col gap-1.5">
            {selected.operations.map((op) => (
              <Operation key={op.id} op={op} />
            ))}
          </div>
        </section>
      </div>
    );
  }
  const tocItems: TocItem[] = [
    { id: "overview", text: t("api.docs.overview.title"), level: 2 },
    { id: "conventions", text: t("api.docs.conventions.title"), level: 2 },
    { id: "versioning", text: t("api.docs.versioning.title"), level: 2 },
    { id: "files", text: t("api.docs.files.title"), level: 2 },
    { id: "webhooks", text: t("api.docs.webhooks.title"), level: 2 },
    { id: "endpoints", text: t("api.docs.endpoints.title"), level: 2 },
  ];
  const total = groups.reduce((sum, g) => sum + g.operations.length, 0);
  const fill = (text: string) => text.replaceAll("<BASE_URL>", base);

  return (
    <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_14rem] xl:gap-8">
      <div className="flex min-w-0 flex-col gap-5">
        <PageToc title={t("api.docs.toc")} items={tocItems} placement="inline" />

        <Section id="overview" title={t("api.docs.overview.title")}>
          <p>{t("api.docs.overview.intro", { version: API_DOC_VERSION })}</p>
          <p>
            {t("api.docs.overview.base")}: <code className="break-all">{base}/api/v1</code>
          </p>
          <Alert tone="warning">{t("api.docs.overview.https")}</Alert>
          <p>{t("api.docs.overview.auth")}</p>
          <CodeBlock code={`curl -H "Authorization: Bearer <TOKEN>" \\\n  ${base}/api/v1/customers?limit=10`} language="curl" label={t("api.docs.overview.exampleLabel")} />
          <p>{t("api.docs.overview.rights")}</p>
          <p>
            {t("api.docs.overview.json")}: <TextLink href={jsonHref} external>{jsonHref}</TextLink> – {t("api.docs.overview.jsonHint")}
          </p>
        </Section>

        <Section id="conventions" title={t("api.docs.conventions.title")}>
          <p>
            <strong>{t("api.docs.conventions.listTitle")}.</strong> {t("api.docs.conventions.list")}
          </p>
          <CodeBlock code={PAGING_EXAMPLE} language="http" label={t("api.docs.conventions.listTitle")} />
          <p>
            <strong>{t("api.docs.conventions.writeTitle")}.</strong> {t("api.docs.conventions.write")}
          </p>
          <p>
            <strong>{t("api.docs.conventions.etagTitle")}.</strong> {t("api.docs.conventions.etag")}
          </p>
          <p>
            <strong>{t("api.docs.conventions.idempotencyTitle")}.</strong> {t("api.docs.conventions.idempotency")}
          </p>
          <p>
            <strong>{t("api.docs.conventions.rateTitle")}.</strong> {t("api.docs.conventions.rate")}
          </p>
          <p>
            <strong>{t("api.docs.conventions.errorTitle")}.</strong> {t("api.docs.conventions.error")}
          </p>
          <CodeBlock code={ERROR_EXAMPLE} language="http" label={t("api.docs.conventions.errorTitle")} />
          <p>
            <strong>{t("api.docs.conventions.valuesTitle")}.</strong> {t("api.docs.conventions.values")}
          </p>
        </Section>

        <Section id="versioning" title={t("api.docs.versioning.title")}>
          <p>{t("api.docs.versioning.intro")}</p>
          <ul className="list-disc pl-5">
            <li>{t("api.docs.versioning.additive")}</li>
            <li>{t("api.docs.versioning.breaking")}</li>
            <li>{t("api.docs.versioning.deprecation")}</li>
          </ul>
        </Section>

        <Section id="files" title={t("api.docs.files.title")}>
          <p>{t("api.docs.files.upload")}</p>
          <CodeBlock code={fill(UPLOAD_EXAMPLE)} language="curl" label={t("api.docs.files.uploadLabel")} />
          <p>{t("api.docs.files.download")}</p>
          <CodeBlock code={fill(DOWNLOAD_EXAMPLE)} language="curl" label={t("api.docs.files.downloadLabel")} />
        </Section>

        <Section id="webhooks" title={t("api.docs.webhooks.title")}>
          <p>{t("api.docs.webhooks.intro")}</p>
          <p className="font-semibold">{t("api.docs.webhooks.eventsTitle")}</p>
          <Table className="text-xs" caption={t("api.docs.webhooks.eventsTitle")}>
              <tbody>
                {events.map((event) => (
                  <tr key={event.type}>
                    <td className="whitespace-nowrap font-mono">{event.type}</td>
                    <td>{event.label}</td>
                    <td className="font-mono text-ink-muted">/{event.resource}/&lt;id&gt;</td>
                  </tr>
                ))}
                <tr>
                  <td className="whitespace-nowrap font-mono">webhook.test</td>
                  <td>{t("api.docs.webhooks.testEvent")}</td>
                  <td className="text-ink-muted">–</td>
                </tr>
              </tbody>
            </Table>
          <p>{t("api.docs.webhooks.payload")}</p>
          <CodeBlock code={WEBHOOK_REQUEST_EXAMPLE} language="http" label={t("api.docs.webhooks.requestLabel")} />
          <CodeBlock code={fill(FETCH_AFTER_EVENT)} language="curl" label={t("api.docs.webhooks.fetchLabel")} />
          <p className="font-semibold">{t("api.docs.webhooks.signatureTitle")}</p>
          <p>{t("api.docs.webhooks.signature")}</p>
          <p>{t("api.docs.webhooks.replay")}</p>
          <p>{t("api.docs.webhooks.retries")}</p>
          <p>{t("api.docs.webhooks.target")}</p>
          <CodeBlock code={NODE_VERIFY} language="Node.js" label={t("api.docs.webhooks.verifyNode")} />
          <CodeBlock code={PYTHON_VERIFY} language="Python" label={t("api.docs.webhooks.verifyPython")} />
          <CodeBlock code={PHP_VERIFY} language="PHP" label={t("api.docs.webhooks.verifyPhp")} />
        </Section>

        <section id="endpoints" className="scroll-mt-20">
          <h2 className="mb-1 text-base font-semibold">{t("api.docs.endpoints.title")}</h2>
          <p className="mb-3 text-sm text-ink-muted">{t("api.docs.endpoints.intro", { count: total })}</p>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {groups.map((group) => (
              <li key={group.tag} className="min-w-0">
                <CardLink href={`/admin/api/docs?tag=${encodeURIComponent(group.tag)}`} className="h-full">
                  <span className="block font-medium">{group.tag}</span>
                  <span className="block text-xs text-ink-muted">{t("api.docs.endpoints.count", { count: group.operations.length })}</span>
                </CardLink>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <PageToc title={t("api.docs.toc")} items={tocItems} placement="aside" />
    </div>
  );
}

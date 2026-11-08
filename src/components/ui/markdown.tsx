import type { ComponentPropsWithoutRef, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { isInternalHref, isLocalImageSrc } from "@/lib/markdown-url";
import { slugify } from "@/lib/slug";
import { MarkdownScroll } from "./markdown-scroll";

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (node && typeof node === "object" && "props" in node) return textOf((node as { props: { children?: ReactNode } }).props.children);
  return "";
}

/**
 * Rendert Markdown (GitHub-Variante: Tabellen, Aufgabenlisten, durchgestrichen).
 * Sicherheit: react-markdown gibt kein rohes HTML aus und entschärft gefährliche URLs (javascript: usw.). Interne Links sind nur Pfade der eigenen Herkunft (`//host` ist extern),
 * externe Bilder werden nicht geladen (`lib/markdown-url.ts`).
 * Funktioniert in Server- und Client-Komponenten (Vorschau im Editor). `taskLabels`: Namen für die Kästchen von Aufgabenlisten („erledigt“/„offen“).
 */
export function Markdown({ source, taskLabels }: { source: string; taskLabels?: { done: string; open: string } }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h2: ({ children }) => <h2 id={slugify(textOf(children))}>{children}</h2>,
          h3: ({ children }) => <h3 id={slugify(textOf(children))}>{children}</h3>,
          a: ({ href, children }: ComponentPropsWithoutRef<"a">) =>
            isInternalHref(href) ? (
              <a href={href}>{children}</a>
            ) : (
              <a href={href} target="_blank" rel="noopener noreferrer nofollow">
                {children}
              </a>
            ),
          // Tabellen und Codeblöcke horizontal scrollbar machen (per Tastatur erreichbar, wenn sie überlaufen)
          table: ({ children }) => (
            <div className="md-table">
              <MarkdownScroll kind="table">
                <table>{children}</table>
              </MarkdownScroll>
            </div>
          ),
          pre: ({ children }) => (
            <div className="md-pre">
              <MarkdownScroll kind="code">
                <pre>{children}</pre>
              </MarkdownScroll>
            </div>
          ),
          // Kästchen einer Aufgabenliste (nur Anzeige): ohne Name wären sie ein unbeschriftetes Formularfeld; der Zustand wird angesagt, der Text der Aufgabe folgt direkt dahinter
          input: ({ type, checked }: ComponentPropsWithoutRef<"input">) =>
            type === "checkbox" ? <input type="checkbox" checked={Boolean(checked)} disabled readOnly aria-label={taskLabels ? (checked ? taskLabels.done : taskLabels.open) : undefined} /> : null,
          // Bilder nur von der eigenen Herkunft (Doku-Bilder unter /api/docs/images): ein fremdes Bild würde beim Lesen eine Anfrage an einen fremden Server auslösen, die
          // Content-Security-Policy blockiert es ohnehin. Statt des Bildes steht dessen Beschreibung.
          // eslint-disable-next-line @next/next/no-img-element -- Bilder kommen aus der geschützten Datenbank
          img: ({ src, alt }) => (typeof src === "string" && isLocalImageSrc(src) ? <img src={src} alt={alt ?? ""} loading="lazy" /> : alt ? <span className="text-ink-muted">[{alt}]</span> : null),
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}

import type { ComponentPropsWithoutRef, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { slugify } from "@/lib/slug";

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (node && typeof node === "object" && "props" in node) return textOf((node as { props: { children?: ReactNode } }).props.children);
  return "";
}

/**
 * Rendert Markdown (GitHub-Variante: Tabellen, Aufgabenlisten, durchgestrichen).
 * Sicherheit: react-markdown gibt kein rohes HTML aus und entschärft gefährliche URLs (javascript: usw.).
 * Funktioniert in Server- und Client-Komponenten (Vorschau im Editor).
 */
export function Markdown({ source }: { source: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h2: ({ children }) => <h2 id={slugify(textOf(children))}>{children}</h2>,
          h3: ({ children }) => <h3 id={slugify(textOf(children))}>{children}</h3>,
          a: ({ href, children }: ComponentPropsWithoutRef<"a">) =>
            href?.startsWith("/") || href?.startsWith("#") ? (
              <a href={href}>{children}</a>
            ) : (
              <a href={href} target="_blank" rel="noopener noreferrer nofollow">
                {children}
              </a>
            ),
          // Tabellen horizontal scrollbar machen
          table: ({ children }) => (
            <div className="md-table">
              <table>{children}</table>
            </div>
          ),
          // eslint-disable-next-line @next/next/no-img-element -- Bilder kommen aus der geschützten Datenbank
          img: ({ src, alt }) => (typeof src === "string" ? <img src={src} alt={alt ?? ""} loading="lazy" /> : null),
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}

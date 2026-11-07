import type { NextConfig } from "next";
import { PERMISSIONS_POLICY, contentSecurityPolicy } from "./src/lib/csp";

/**
 * Basis-Header für alle Antworten – auch für Statik und den Service Worker. `X-Frame-Options` ist die Entsprechung von `frame-ancestors` für ältere Browser.
 * Die Content-Security-Policy steckt **nicht** darin (siehe `CSP_FALLBACK_HEADERS` und `src/lib/csp.ts`).
 */
export const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Permissions-Policy", value: PERMISSIONS_POLICY },
];

/**
 * Pfade außerhalb des Proxys (`matcher` in `src/proxy.ts`): Statik, Icons, Manifest, Service Worker, Health, Upload von Sicherungen. Dort setzt `next.config` die
 * Content-Security-Policy ohne Nonce (`script-src 'self'`); alles, was durch den Proxy läuft, bekommt sie vom Proxy mit Nonce – **nie beides**, denn Next hängt die Kopfzeile
 * einer Route nur an, wenn der Name noch fehlt, und zwei CSP-Köpfe verschärfen sich im Browser gegenseitig. `src/lib/csp.test.ts` prüft, dass sich beide Seiten ergänzen.
 */
export const PROXY_FREE_PATHS = ["/_next/static/:path*", "/_next/image", "/favicon.ico", "/manifest.webmanifest", "/sw.js", "/icon.:ext", "/apple-icon.:ext", "/icons/:path*", "/api/health", "/api/backups/upload"];
export const CSP_FALLBACK_HEADERS = [{ key: "Content-Security-Policy", value: contentSecurityPolicy({ dev: process.env.NODE_ENV !== "production" }) }];

/** Grenzen für Anfrage-Bodies in Byte-Schreibweise von Next; der Proxy-Puffer muss größer sein als das Limit der Server Actions. */
export const SERVER_ACTION_BODY_LIMIT = "12mb";
export const PROXY_BODY_LIMIT = "13mb";

const nextConfig: NextConfig = {
  // Das Dashboard ist komplett eingeloggt und datengetrieben -> klassisches dynamisches Rendering.
  cacheComponents: false,
  partialPrefetching: false,
  output: "standalone",
  experimental: {
    // Rechnungs-Uploads (bis 10 MB) laufen über Server Actions (Datei + Formularfelder, mit Rand < 12 MB)
    serverActions: { bodySizeLimit: SERVER_ACTION_BODY_LIMIT },
    // Der Proxy läuft vor jeder Anfrage; Next puffert dafür den Body und schneidet ihn bei diesem Limit **stumm** ab (Standard 10 MiB:
    // ein Beleg nahe 10 MB samt Formular käme abgeschnitten an). Etwas über dem Limit der Server Actions, nicht global hoch (Speicher je Anfrage).
    // Die Sicherungs-Uploads (beliebig groß) laufen gar nicht durch den Proxy (`src/proxy.ts`, Matcher).
    proxyClientMaxBodySize: PROXY_BODY_LIMIT,
  },
  async headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
      ...PROXY_FREE_PATHS.map((source) => ({ source, headers: CSP_FALLBACK_HEADERS })),
    ];
  },
  serverExternalPackages: ["@prisma/client", "@prisma/adapter-better-sqlite3", "better-sqlite3"],
  // better-sqlite3 lädt seine native Datei dynamisch (bindings) – die Ablaufverfolgung findet sie nicht von selbst
  outputFileTracingIncludes: { "/*": ["./node_modules/better-sqlite3/build/Release/*.node", "./node_modules/better-sqlite3/package.json"] },
  // Wegen process.cwd()-Zugriffen würde die Ablaufverfolgung sonst das ganze Projekt einpacken; Migrationen und Handbuch kommen separat ins Paket
  outputFileTracingExcludes: { "/*": ["./src/**", "./scripts/**", "./docker/**", "./prisma/**", "./docs/**", "./.github/**", "./*.md", "./*.mjs", "./*.ts", "./tsconfig*", "./package-lock.json"] },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;

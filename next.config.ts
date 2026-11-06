import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Das Dashboard ist komplett eingeloggt und datengetrieben -> klassisches dynamisches Rendering.
  cacheComponents: false,
  partialPrefetching: false,
  output: "standalone",
  experimental: {
    // Rechnungs-Uploads (bis 10 MB) und Doku-Bilder laufen über Server Actions / Route Handler
    serverActions: { bodySizeLimit: "12mb" },
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

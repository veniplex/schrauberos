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
  serverExternalPackages: [
    "@prisma/client",
    "@prisma/adapter-better-sqlite3",
    "@prisma/adapter-pg",
    "better-sqlite3",
    "pg",
  ],
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

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Das Dashboard ist komplett eingeloggt und datengetrieben -> klassisches dynamisches Rendering.
  cacheComponents: false,
  partialPrefetching: false,
  output: "standalone",
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

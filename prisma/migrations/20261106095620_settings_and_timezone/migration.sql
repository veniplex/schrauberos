-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Workshop" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "name" TEXT NOT NULL DEFAULT 'Meine Werkstatt',
    "tagline" TEXT,
    "street" TEXT,
    "zip" TEXT,
    "city" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "logoDataUrl" TEXT,
    "accentColor" TEXT NOT NULL DEFAULT '#2459c9',
    "openingHours" TEXT NOT NULL DEFAULT '{}',
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Berlin',
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Workshop" ("accentColor", "city", "email", "id", "logoDataUrl", "name", "openingHours", "phone", "street", "tagline", "updatedAt", "website", "zip") SELECT "accentColor", "city", "email", "id", "logoDataUrl", "name", "openingHours", "phone", "street", "tagline", "updatedAt", "website", "zip" FROM "Workshop";
DROP TABLE "Workshop";
ALTER TABLE "new_Workshop" RENAME TO "Workshop";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- Kapitel (DocCategory) lassen sich auf Rollen einschränken: ohne Eintrag sehen alle mit Leserecht das Kapitel.
CREATE TABLE "DocCategoryRole" (
    "categoryId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,

    PRIMARY KEY ("categoryId", "roleId"),
    CONSTRAINT "DocCategoryRole_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "DocCategory" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DocCategoryRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Das Handbuch ersetzt die Dokumentation von Werkstatt und Büro: Inhalte (Kapitel, Seiten, Bilder) bleiben erhalten und
-- wandern ins Handbuch; die Kapitelnamen bekommen den bisherigen Bereich als Präfix. Bei gleichem Seitenkürzel bekommt die
-- Büro-Seite den Präfix "buero-". Bilddateien bleiben an ihrem Ort.
UPDATE "DocCategory" SET "area" = 'handbook', "name" = 'Werkstatt: ' || "name" WHERE "area" = 'workshop';
UPDATE "DocCategory" SET "area" = 'handbook', "name" = 'Büro: ' || "name" WHERE "area" = 'office';
UPDATE "DocPage" SET "area" = 'handbook' WHERE "area" = 'workshop';
UPDATE "DocPage"
   SET "area" = 'handbook',
       "slug" = CASE WHEN EXISTS (SELECT 1 FROM "DocPage" d WHERE d."area" = 'handbook' AND d."slug" = "DocPage"."slug") THEN 'buero-' || "slug" ELSE "slug" END
 WHERE "area" = 'office';
UPDATE "DocImage" SET "area" = 'handbook' WHERE "area" IN ('workshop', 'office');

-- Rechte: die alten Dokumentationsrechte von Werkstatt und Büro werden zu den Handbuch-Rechten.
INSERT OR IGNORE INTO "RolePermission" ("roleId", "permission")
  SELECT "roleId", 'handbook.view' FROM "RolePermission" WHERE "permission" IN ('docsWorkshop.view', 'docsOffice.view');
INSERT OR IGNORE INTO "RolePermission" ("roleId", "permission")
  SELECT "roleId", 'handbook.edit' FROM "RolePermission" WHERE "permission" IN ('docsWorkshop.edit', 'docsOffice.edit');
DELETE FROM "RolePermission" WHERE "permission" IN ('docsWorkshop.view', 'docsWorkshop.edit', 'docsOffice.view', 'docsOffice.edit');
DELETE FROM "FeatureSetting" WHERE "key" IN ('workshop.docs', 'office.docs');

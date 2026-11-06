-- Belege und Dokumentationsbilder liegen nicht mehr in der Datenbank, sondern als Dateien unter <Datenverzeichnis>/files.
-- Hinweis: Bereits in der Datenbank gespeicherte Belege/Bilder werden nicht übernommen (die Anwendung war bis hierhin nicht im
-- Produktivbetrieb; es existieren nur Demodaten). Ab dieser Migration enthält `path` den relativen Dateipfad.

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_InvoiceFile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "invoiceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "path" TEXT NOT NULL,
    "uploadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InvoiceFile_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
DROP TABLE "InvoiceFile";
ALTER TABLE "new_InvoiceFile" RENAME TO "InvoiceFile";
CREATE UNIQUE INDEX "InvoiceFile_invoiceId_key" ON "InvoiceFile"("invoiceId");
CREATE UNIQUE INDEX "InvoiceFile_path_key" ON "InvoiceFile"("path");
CREATE TABLE "new_DocImage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "area" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "path" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
DROP TABLE "DocImage";
ALTER TABLE "new_DocImage" RENAME TO "DocImage";
CREATE UNIQUE INDEX "DocImage_path_key" ON "DocImage"("path");
CREATE INDEX "DocImage_area_idx" ON "DocImage"("area");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;


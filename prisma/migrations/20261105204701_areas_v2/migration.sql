-- CreateTable
CREATE TABLE "VehicleOwnership" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vehicleId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "fromDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "toDate" DATETIME,
    "note" TEXT,
    CONSTRAINT "VehicleOwnership_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "VehicleOwnership_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "personnelNumber" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "jobTitle" TEXT,
    "department" TEXT NOT NULL DEFAULT 'other',
    "email" TEXT,
    "phone" TEXT,
    "mobile" TEXT,
    "hireDate" DATETIME,
    "leaveDate" DATETIME,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "vacationDaysPerYear" INTEGER,
    "notes" TEXT,
    "emergencyName" TEXT,
    "emergencyPhone" TEXT,
    "emergencyRelation" TEXT,
    "userId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Employee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Absence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "employeeId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Absence_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Qualification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "employeeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "issuedAt" DATETIME,
    "expiresAt" DATETIME,
    "note" TEXT,
    CONSTRAINT "Qualification_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FleetVehicle" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "plate" TEXT NOT NULL,
    "make" TEXT,
    "model" TEXT,
    "vin" TEXT,
    "year" INTEGER,
    "fuelType" TEXT,
    "color" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "driverId" TEXT,
    "location" TEXT,
    "huDue" DATETIME,
    "serviceDue" DATETIME,
    "serviceDueKm" INTEGER,
    "insuranceCompany" TEXT,
    "insurancePolicy" TEXT,
    "insuranceUntil" DATETIME,
    "leasingProvider" TEXT,
    "leasingUntil" DATETIME,
    "leasingRateCents" INTEGER,
    "fuelCardNo" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FleetVehicle_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Employee" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FleetMileage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fleetVehicleId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "km" INTEGER NOT NULL,
    "note" TEXT,
    CONSTRAINT "FleetMileage_fleetVehicleId_fkey" FOREIGN KEY ("fleetVehicleId") REFERENCES "FleetVehicle" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FleetCost" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fleetVehicleId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "category" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "km" INTEGER,
    "note" TEXT,
    CONSTRAINT "FleetCost_fleetVehicleId_fkey" FOREIGN KEY ("fleetVehicleId") REFERENCES "FleetVehicle" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FleetLicenseCheck" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "employeeId" TEXT NOT NULL,
    "checkedAt" DATETIME NOT NULL,
    "nextDue" DATETIME NOT NULL,
    "method" TEXT,
    "note" TEXT,
    "checkedByName" TEXT,
    CONSTRAINT "FleetLicenseCheck_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "direction" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "partyName" TEXT NOT NULL,
    "customerId" TEXT,
    "issueDate" DATETIME NOT NULL,
    "dueDate" DATETIME,
    "netCents" INTEGER,
    "vatCents" INTEGER,
    "grossCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "paidAt" DATETIME,
    "category" TEXT,
    "reference" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InvoiceFile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "invoiceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BLOB NOT NULL,
    "uploadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InvoiceFile_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DocCategory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "area" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "DocPage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "area" TEXT NOT NULL,
    "categoryId" TEXT,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "createdByName" TEXT,
    "updatedByName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DocPage_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "DocCategory" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DocVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pageId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "savedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "savedByName" TEXT,
    CONSTRAINT "DocVersion_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "DocPage" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DocImage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "area" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BLOB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Vehicle" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT,
    "plateNorm" TEXT NOT NULL,
    "plate" TEXT NOT NULL,
    "make" TEXT,
    "model" TEXT,
    "vin" TEXT,
    "year" INTEGER,
    "notes" TEXT,
    "externalSource" TEXT,
    "externalId" TEXT,
    "syncedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Vehicle_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Vehicle" ("createdAt", "customerId", "externalId", "externalSource", "id", "make", "model", "notes", "plate", "plateNorm", "syncedAt", "updatedAt", "vin", "year") SELECT "createdAt", "customerId", "externalId", "externalSource", "id", "make", "model", "notes", "plate", "plateNorm", "syncedAt", "updatedAt", "vin", "year" FROM "Vehicle";
DROP TABLE "Vehicle";
ALTER TABLE "new_Vehicle" RENAME TO "Vehicle";
CREATE INDEX "Vehicle_plateNorm_idx" ON "Vehicle"("plateNorm");
CREATE INDEX "Vehicle_customerId_idx" ON "Vehicle"("customerId");
CREATE UNIQUE INDEX "Vehicle_externalSource_externalId_key" ON "Vehicle"("externalSource", "externalId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "VehicleOwnership_vehicleId_idx" ON "VehicleOwnership"("vehicleId");

-- CreateIndex
CREATE INDEX "VehicleOwnership_customerId_idx" ON "VehicleOwnership"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_personnelNumber_key" ON "Employee"("personnelNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_userId_key" ON "Employee"("userId");

-- CreateIndex
CREATE INDEX "Employee_lastName_idx" ON "Employee"("lastName");

-- CreateIndex
CREATE INDEX "Absence_employeeId_startDate_idx" ON "Absence"("employeeId", "startDate");

-- CreateIndex
CREATE INDEX "Absence_startDate_idx" ON "Absence"("startDate");

-- CreateIndex
CREATE INDEX "Qualification_employeeId_idx" ON "Qualification"("employeeId");

-- CreateIndex
CREATE INDEX "Qualification_expiresAt_idx" ON "Qualification"("expiresAt");

-- CreateIndex
CREATE INDEX "FleetVehicle_driverId_idx" ON "FleetVehicle"("driverId");

-- CreateIndex
CREATE INDEX "FleetMileage_fleetVehicleId_date_idx" ON "FleetMileage"("fleetVehicleId", "date");

-- CreateIndex
CREATE INDEX "FleetCost_fleetVehicleId_date_idx" ON "FleetCost"("fleetVehicleId", "date");

-- CreateIndex
CREATE INDEX "FleetLicenseCheck_employeeId_checkedAt_idx" ON "FleetLicenseCheck"("employeeId", "checkedAt");

-- CreateIndex
CREATE INDEX "Invoice_direction_status_idx" ON "Invoice"("direction", "status");

-- CreateIndex
CREATE INDEX "Invoice_issueDate_idx" ON "Invoice"("issueDate");

-- CreateIndex
CREATE INDEX "Invoice_dueDate_idx" ON "Invoice"("dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceFile_invoiceId_key" ON "InvoiceFile"("invoiceId");

-- CreateIndex
CREATE INDEX "DocCategory_area_idx" ON "DocCategory"("area");

-- CreateIndex
CREATE INDEX "DocPage_area_idx" ON "DocPage"("area");

-- CreateIndex
CREATE UNIQUE INDEX "DocPage_area_slug_key" ON "DocPage"("area", "slug");

-- CreateIndex
CREATE INDEX "DocVersion_pageId_savedAt_idx" ON "DocVersion"("pageId", "savedAt");

-- CreateIndex
CREATE INDEX "DocImage_area_idx" ON "DocImage"("area");

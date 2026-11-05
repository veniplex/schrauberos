-- DropForeignKey
ALTER TABLE "Vehicle" DROP CONSTRAINT "Vehicle_customerId_fkey";

-- AlterTable
ALTER TABLE "Vehicle" ALTER COLUMN "customerId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "VehicleOwnership" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "fromDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "toDate" TIMESTAMP(3),
    "note" TEXT,

    CONSTRAINT "VehicleOwnership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "personnelNumber" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "jobTitle" TEXT,
    "department" TEXT NOT NULL DEFAULT 'other',
    "email" TEXT,
    "phone" TEXT,
    "mobile" TEXT,
    "hireDate" TIMESTAMP(3),
    "leaveDate" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "vacationDaysPerYear" INTEGER,
    "notes" TEXT,
    "emergencyName" TEXT,
    "emergencyPhone" TEXT,
    "emergencyRelation" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Absence" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Absence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Qualification" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "note" TEXT,

    CONSTRAINT "Qualification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FleetVehicle" (
    "id" TEXT NOT NULL,
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
    "huDue" TIMESTAMP(3),
    "serviceDue" TIMESTAMP(3),
    "serviceDueKm" INTEGER,
    "insuranceCompany" TEXT,
    "insurancePolicy" TEXT,
    "insuranceUntil" TIMESTAMP(3),
    "leasingProvider" TEXT,
    "leasingUntil" TIMESTAMP(3),
    "leasingRateCents" INTEGER,
    "fuelCardNo" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FleetVehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FleetMileage" (
    "id" TEXT NOT NULL,
    "fleetVehicleId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "km" INTEGER NOT NULL,
    "note" TEXT,

    CONSTRAINT "FleetMileage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FleetCost" (
    "id" TEXT NOT NULL,
    "fleetVehicleId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "category" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "km" INTEGER,
    "note" TEXT,

    CONSTRAINT "FleetCost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FleetLicenseCheck" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL,
    "nextDue" TIMESTAMP(3) NOT NULL,
    "method" TEXT,
    "note" TEXT,
    "checkedByName" TEXT,

    CONSTRAINT "FleetLicenseCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "partyName" TEXT NOT NULL,
    "customerId" TEXT,
    "issueDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3),
    "netCents" INTEGER,
    "vatCents" INTEGER,
    "grossCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "paidAt" TIMESTAMP(3),
    "category" TEXT,
    "reference" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceFile" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocCategory" (
    "id" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DocCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocPage" (
    "id" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "categoryId" TEXT,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "createdByName" TEXT,
    "updatedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocVersion" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "savedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "savedByName" TEXT,

    CONSTRAINT "DocVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocImage" (
    "id" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocImage_pkey" PRIMARY KEY ("id")
);

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

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleOwnership" ADD CONSTRAINT "VehicleOwnership_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleOwnership" ADD CONSTRAINT "VehicleOwnership_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Absence" ADD CONSTRAINT "Absence_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Qualification" ADD CONSTRAINT "Qualification_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FleetVehicle" ADD CONSTRAINT "FleetVehicle_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FleetMileage" ADD CONSTRAINT "FleetMileage_fleetVehicleId_fkey" FOREIGN KEY ("fleetVehicleId") REFERENCES "FleetVehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FleetCost" ADD CONSTRAINT "FleetCost_fleetVehicleId_fkey" FOREIGN KEY ("fleetVehicleId") REFERENCES "FleetVehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FleetLicenseCheck" ADD CONSTRAINT "FleetLicenseCheck_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceFile" ADD CONSTRAINT "InvoiceFile_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocPage" ADD CONSTRAINT "DocPage_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "DocCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocVersion" ADD CONSTRAINT "DocVersion_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "DocPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

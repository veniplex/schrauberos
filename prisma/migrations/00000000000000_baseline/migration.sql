-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "passwordHash" TEXT,
    "authSource" TEXT NOT NULL DEFAULT 'local',
    "externalId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "failedLogins" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" DATETIME,
    "locale" TEXT,
    "theme" TEXT,
    "lastLoginAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "isSystem" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "roleId" TEXT NOT NULL,
    "permission" TEXT NOT NULL,

    PRIMARY KEY ("roleId", "permission"),
    CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UserRole" (
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,

    PRIMARY KEY ("userId", "roleId"),
    CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userAgent" TEXT,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Workshop" (
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
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AppointmentSettings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "dayStartHour" INTEGER NOT NULL DEFAULT 7,
    "dayEndHour" INTEGER NOT NULL DEFAULT 18,
    "slotMinutes" INTEGER NOT NULL DEFAULT 30,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "TireSettings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "treadWarnMm" REAL NOT NULL DEFAULT 4.0,
    "treadReplaceMm" REAL NOT NULL DEFAULT 3.0,
    "tireAgeWarnYears" INTEGER NOT NULL DEFAULT 6,
    "tireAgeReplaceYears" INTEGER NOT NULL DEFAULT 10,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerNumber" TEXT,
    "firstName" TEXT,
    "lastName" TEXT NOT NULL,
    "company" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "street" TEXT,
    "zip" TEXT,
    "city" TEXT,
    "notes" TEXT,
    "externalSource" TEXT,
    "externalId" TEXT,
    "syncedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Vehicle" (
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
CREATE TABLE "Bay" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "AppointmentType" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#2459c9',
    "defaultMinutes" INTEGER NOT NULL DEFAULT 60,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "kind" TEXT NOT NULL DEFAULT 'general'
);

-- CreateTable
CREATE TABLE "Appointment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "startsAt" DATETIME NOT NULL,
    "endsAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "notes" TEXT,
    "typeId" TEXT,
    "bayId" TEXT,
    "customerId" TEXT,
    "vehicleId" TEXT,
    "tireSetId" TEXT,
    "assigneeId" TEXT,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Appointment_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "AppointmentType" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Appointment_bayId_fkey" FOREIGN KEY ("bayId") REFERENCES "Bay" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Appointment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Appointment_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Appointment_tireSetId_fkey" FOREIGN KEY ("tireSetId") REFERENCES "TireSet" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Appointment_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Appointment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TireSet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vehicleId" TEXT NOT NULL,
    "season" TEXT NOT NULL,
    "brand" TEXT,
    "model" TEXT,
    "width" INTEGER,
    "aspect" INTEGER,
    "rim" INTEGER,
    "loadIndex" TEXT,
    "speedIndex" TEXT,
    "rimType" TEXT NOT NULL DEFAULT 'none',
    "status" TEXT NOT NULL DEFAULT 'stored',
    "storageLocation" TEXT,
    "storedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TireSet_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Tire" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tireSetId" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "dot" TEXT,
    "producedYear" INTEGER,
    "producedWeek" INTEGER,
    "treadDepthMm" REAL,
    "condition" TEXT NOT NULL DEFAULT 'good',
    "notes" TEXT,
    "measuredAt" DATETIME,
    CONSTRAINT "Tire_tireSetId_fkey" FOREIGN KEY ("tireSetId") REFERENCES "TireSet" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NetLocation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "NetVlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vlanId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT
);

-- CreateTable
CREATE TABLE "NetSubnet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "cidr" TEXT NOT NULL,
    "gateway" TEXT,
    "dnsServers" TEXT,
    "dhcpStart" TEXT,
    "dhcpEnd" TEXT,
    "description" TEXT,
    "vlanId" TEXT,
    CONSTRAINT "NetSubnet_vlanId_fkey" FOREIGN KEY ("vlanId") REFERENCES "NetVlan" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NetDevice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "manufacturer" TEXT,
    "model" TEXT,
    "serialNumber" TEXT,
    "locationId" TEXT,
    "rackInfo" TEXT,
    "portCount" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'active',
    "assignedTo" TEXT,
    "purchaseDate" DATETIME,
    "warrantyUntil" DATETIME,
    "monitorEnabled" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "NetDevice_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "NetLocation" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NetIp" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "address" TEXT NOT NULL,
    "subnetId" TEXT NOT NULL,
    "deviceId" TEXT,
    "hostname" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'static',
    "mac" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "NetIp_subnetId_fkey" FOREIGN KEY ("subnetId") REFERENCES "NetSubnet" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "NetIp_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "NetDevice" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NetConnection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fromDeviceId" TEXT NOT NULL,
    "fromPort" TEXT,
    "toDeviceId" TEXT NOT NULL,
    "toPort" TEXT,
    "cableLabel" TEXT,
    "notes" TEXT,
    CONSTRAINT "NetConnection_fromDeviceId_fkey" FOREIGN KEY ("fromDeviceId") REFERENCES "NetDevice" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "NetConnection_toDeviceId_fkey" FOREIGN KEY ("toDeviceId") REFERENCES "NetDevice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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

-- CreateTable
CREATE TABLE "FeatureSetting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "enabled" BOOLEAN NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    "updatedByName" TEXT
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target" TEXT,
    "entityId" TEXT
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_authSource_externalId_key" ON "User"("authSource", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Role_key_key" ON "Role"("key");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "Customer_lastName_idx" ON "Customer"("lastName");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_externalSource_externalId_key" ON "Customer"("externalSource", "externalId");

-- CreateIndex
CREATE INDEX "Vehicle_plateNorm_idx" ON "Vehicle"("plateNorm");

-- CreateIndex
CREATE INDEX "Vehicle_customerId_idx" ON "Vehicle"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_externalSource_externalId_key" ON "Vehicle"("externalSource", "externalId");

-- CreateIndex
CREATE INDEX "VehicleOwnership_vehicleId_idx" ON "VehicleOwnership"("vehicleId");

-- CreateIndex
CREATE INDEX "VehicleOwnership_customerId_idx" ON "VehicleOwnership"("customerId");

-- CreateIndex
CREATE INDEX "Appointment_startsAt_idx" ON "Appointment"("startsAt");

-- CreateIndex
CREATE INDEX "Appointment_vehicleId_idx" ON "Appointment"("vehicleId");

-- CreateIndex
CREATE INDEX "Appointment_tireSetId_idx" ON "Appointment"("tireSetId");

-- CreateIndex
CREATE INDEX "TireSet_vehicleId_idx" ON "TireSet"("vehicleId");

-- CreateIndex
CREATE INDEX "TireSet_status_idx" ON "TireSet"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Tire_tireSetId_position_key" ON "Tire"("tireSetId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "NetVlan_vlanId_key" ON "NetVlan"("vlanId");

-- CreateIndex
CREATE UNIQUE INDEX "NetSubnet_cidr_key" ON "NetSubnet"("cidr");

-- CreateIndex
CREATE INDEX "NetDevice_type_idx" ON "NetDevice"("type");

-- CreateIndex
CREATE INDEX "NetDevice_locationId_idx" ON "NetDevice"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "NetIp_address_key" ON "NetIp"("address");

-- CreateIndex
CREATE INDEX "NetIp_subnetId_idx" ON "NetIp"("subnetId");

-- CreateIndex
CREATE INDEX "NetIp_deviceId_idx" ON "NetIp"("deviceId");

-- CreateIndex
CREATE INDEX "NetConnection_fromDeviceId_idx" ON "NetConnection"("fromDeviceId");

-- CreateIndex
CREATE INDEX "NetConnection_toDeviceId_idx" ON "NetConnection"("toDeviceId");

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

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");


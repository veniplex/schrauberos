-- schrauberos:baseline unreleased (erzeugt mit npm run db:baseline aus prisma/schema.prisma – nicht von Hand ändern)
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
CREATE TABLE "RecoveryCode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" DATETIME,
    CONSTRAINT "RecoveryCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RecoveryNotice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "userName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RecoveryNotice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RecoveryNoticeAck" (
    "noticeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("noticeId", "userId"),
    CONSTRAINT "RecoveryNoticeAck_noticeId_fkey" FOREIGN KEY ("noticeId") REFERENCES "RecoveryNotice" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RecoveryNoticeAck_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
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
    "ipHint" TEXT,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "KnownDevice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userAgent" TEXT,
    "ipHint" TEXT,
    "useCount" INTEGER NOT NULL DEFAULT 1,
    "failedLogins" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" DATETIME,
    CONSTRAINT "KnownDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TwoFactor" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "secret" TEXT,
    "enabledAt" DATETIME,
    "lastStep" INTEGER NOT NULL DEFAULT 0,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resetReason" TEXT,
    "resetAt" DATETIME,
    CONSTRAINT "TwoFactor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TwoFactorBackupCode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usedAt" DATETIME,
    CONSTRAINT "TwoFactorBackupCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Berlin',
    "taxNumber" TEXT,
    "vatId" TEXT,
    "smallBusiness" BOOLEAN NOT NULL DEFAULT false,
    "bankName" TEXT,
    "iban" TEXT,
    "bic" TEXT,
    "paymentTermDays" INTEGER NOT NULL DEFAULT 14,
    "managingDirector" TEXT,
    "registerCourt" TEXT,
    "registerNumber" TEXT,
    "hourlyRateCents" INTEGER,
    "workUnitMinutes" INTEGER NOT NULL DEFAULT 5,
    "invoiceNumberFormat" TEXT NOT NULL DEFAULT '{YYYY}-{NNNN}',
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "HolidaySettings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "region" TEXT NOT NULL DEFAULT '',
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "HolidayDay" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "ruleKey" TEXT,
    "mode" TEXT,
    "name" TEXT,
    "month" INTEGER,
    "day" INTEGER,
    "year" INTEGER,
    "half" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
    "winterStartMonth" INTEGER NOT NULL DEFAULT 10,
    "winterEndMonth" INTEGER NOT NULL DEFAULT 3,
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
    "nameKey" TEXT NOT NULL DEFAULT '',
    "cityKey" TEXT NOT NULL DEFAULT '',
    "phoneKey" TEXT NOT NULL DEFAULT '',
    "archivedAt" DATETIME,
    "processingRestrictedAt" DATETIME,
    "restrictionNote" TEXT,
    "anonymizedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "PrivacySettings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "retentionInvoiceYears" INTEGER NOT NULL DEFAULT 8,
    "retentionBooksYears" INTEGER NOT NULL DEFAULT 10,
    "retentionConfirmedAt" DATETIME,
    "retentionConfirmedByName" TEXT,
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
    "mileageKm" INTEGER,
    "fuel" TEXT,
    "hsn" TEXT,
    "tsn" TEXT,
    "firstRegistration" DATETIME,
    "inspectionDue" TEXT,
    "extraInspectionKind" TEXT,
    "extraInspectionDue" DATETIME,
    "notes" TEXT,
    "searchKey" TEXT NOT NULL DEFAULT '',
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Vehicle_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VehicleOwnership" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vehicleId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "fromDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "toDate" DATETIME,
    "note" TEXT,
    CONSTRAINT "VehicleOwnership_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "VehicleOwnership_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
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
    "workWeekdays" TEXT NOT NULL DEFAULT '1,2,3,4,5',
    "vacationCarryYear" INTEGER,
    "vacationCarryDays" REAL,
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
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Qualification_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EmployeeSettings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "vacationCarryMonth" INTEGER NOT NULL DEFAULT 3,
    "vacationCarryDay" INTEGER NOT NULL DEFAULT 31,
    "updatedAt" DATETIME NOT NULL
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
    "outgoingKey" TEXT,
    "partyName" TEXT NOT NULL,
    "partyKey" TEXT NOT NULL DEFAULT '',
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
    "finalizedAt" DATETIME,
    "finalizedByName" TEXT,
    "cancelsInvoiceId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Invoice_cancelsInvoiceId_fkey" FOREIGN KEY ("cancelsInvoiceId") REFERENCES "Invoice" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InvoiceFile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "invoiceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "path" TEXT NOT NULL,
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
CREATE TABLE "DocCategoryRole" (
    "categoryId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,

    PRIMARY KEY ("categoryId", "roleId"),
    CONSTRAINT "DocCategoryRole_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "DocCategory" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DocCategoryRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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
    "path" TEXT NOT NULL,
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

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "entityId" TEXT,
    "payload" TEXT NOT NULL DEFAULT '{}',
    "actorId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "availableAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "processedAt" DATETIME,
    "failedAt" DATETIME
);

-- CreateTable
CREATE TABLE "OutboxDelivery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "handler" TEXT NOT NULL,
    "deliveredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OutboxDelivery_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "OutboxEvent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "JobState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "nextRunAt" DATETIME,
    "lastRunAt" DATETIME,
    "lastStatus" TEXT,
    "lastMessage" TEXT,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" DATETIME,
    "lockOwner" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "JobRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "status" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "durationMs" INTEGER,
    "message" TEXT
);

-- CreateTable
CREATE TABLE "ApiToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "hint" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByName" TEXT,
    "lastUsedAt" DATETIME,
    "revokedAt" DATETIME,
    "rateLimitPerMinute" INTEGER NOT NULL DEFAULT 120,
    CONSTRAINT "ApiToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ApiTokenScope" (
    "tokenId" TEXT NOT NULL,
    "permission" TEXT NOT NULL,

    PRIMARY KEY ("tokenId", "permission"),
    CONSTRAINT "ApiTokenScope_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "ApiToken" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ApiIdempotencyKey" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "bodyHash" TEXT NOT NULL,
    "status" INTEGER,
    "response" TEXT,
    "headers" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "MailMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "userName" TEXT NOT NULL,
    "toAddresses" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "deliveredTo" TEXT,
    "sentAt" DATETIME,
    "purpose" TEXT,
    "entityId" TEXT,
    "body" TEXT,
    "attachments" TEXT
);

-- CreateTable
CREATE TABLE "Counter" (
    "key" TEXT NOT NULL,
    "year" INTEGER NOT NULL DEFAULT 0,
    "value" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("key", "year")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "number" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'accepted',
    "vehicleId" TEXT NOT NULL,
    "customerId" TEXT,
    "appointmentId" TEXT,
    "request" TEXT,
    "mileageKm" INTEGER,
    "acceptedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" DATETIME,
    "createdByName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Order_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Order_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'labor',
    "description" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT '',
    "quantityMilli" INTEGER NOT NULL,
    "unitCents" INTEGER NOT NULL,
    "taxBp" INTEGER NOT NULL,
    "discountBp" INTEGER NOT NULL DEFAULT 0,
    "refType" TEXT,
    "refId" TEXT,
    CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OrderFinding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrderFinding_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OrderApproval" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "approverName" TEXT NOT NULL,
    "signaturePath" TEXT,
    "recordedByName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrderApproval_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OrderEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT,
    "byName" TEXT NOT NULL,
    "note" TEXT,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrderEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Article" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "number" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "searchKey" TEXT NOT NULL DEFAULT '',
    "unit" TEXT NOT NULL DEFAULT 'Stk',
    "supplier" TEXT,
    "purchaseCents" INTEGER,
    "saleCents" INTEGER,
    "taxBp" INTEGER NOT NULL DEFAULT 1900,
    "stockMilli" INTEGER NOT NULL DEFAULT 0,
    "minStockMilli" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "articleId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "quantityMilli" INTEGER NOT NULL,
    "stockAfterMilli" INTEGER NOT NULL,
    "orderId" TEXT,
    "orderNumber" TEXT,
    "reference" TEXT,
    "note" TEXT,
    "byName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StockMovement_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_authSource_externalId_key" ON "User"("authSource", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "RecoveryCode_userId_key" ON "RecoveryCode"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "RecoveryCode_codeHash_key" ON "RecoveryCode"("codeHash");

-- CreateIndex
CREATE UNIQUE INDEX "Role_key_key" ON "Role"("key");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "KnownDevice_tokenHash_key" ON "KnownDevice"("tokenHash");

-- CreateIndex
CREATE INDEX "KnownDevice_userId_idx" ON "KnownDevice"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TwoFactorBackupCode_codeHash_key" ON "TwoFactorBackupCode"("codeHash");

-- CreateIndex
CREATE INDEX "TwoFactorBackupCode_userId_idx" ON "TwoFactorBackupCode"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "HolidayDay_ruleKey_key" ON "HolidayDay"("ruleKey");

-- CreateIndex
CREATE INDEX "Customer_lastName_idx" ON "Customer"("lastName");

-- CreateIndex
CREATE INDEX "Customer_archivedAt_idx" ON "Customer"("archivedAt");

-- CreateIndex
CREATE INDEX "Customer_processingRestrictedAt_idx" ON "Customer"("processingRestrictedAt");

-- CreateIndex
CREATE INDEX "Vehicle_plateNorm_idx" ON "Vehicle"("plateNorm");

-- CreateIndex
CREATE INDEX "Vehicle_customerId_idx" ON "Vehicle"("customerId");

-- CreateIndex
CREATE INDEX "Vehicle_inspectionDue_idx" ON "Vehicle"("inspectionDue");

-- CreateIndex
CREATE INDEX "Vehicle_archivedAt_idx" ON "Vehicle"("archivedAt");

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
CREATE INDEX "Appointment_customerId_idx" ON "Appointment"("customerId");

-- CreateIndex
CREATE INDEX "Appointment_bayId_idx" ON "Appointment"("bayId");

-- CreateIndex
CREATE INDEX "Appointment_typeId_idx" ON "Appointment"("typeId");

-- CreateIndex
CREATE INDEX "Appointment_assigneeId_idx" ON "Appointment"("assigneeId");

-- CreateIndex
CREATE INDEX "TireSet_vehicleId_idx" ON "TireSet"("vehicleId");

-- CreateIndex
CREATE INDEX "TireSet_status_idx" ON "TireSet"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Tire_tireSetId_position_key" ON "Tire"("tireSetId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "NetVlan_vlanId_key" ON "NetVlan"("vlanId");

-- CreateIndex
CREATE INDEX "NetSubnet_cidr_idx" ON "NetSubnet"("cidr");

-- CreateIndex
CREATE INDEX "NetSubnet_vlanId_idx" ON "NetSubnet"("vlanId");

-- CreateIndex
CREATE INDEX "NetDevice_type_idx" ON "NetDevice"("type");

-- CreateIndex
CREATE INDEX "NetDevice_locationId_idx" ON "NetDevice"("locationId");

-- CreateIndex
CREATE INDEX "NetIp_deviceId_idx" ON "NetIp"("deviceId");

-- CreateIndex
CREATE INDEX "NetIp_address_idx" ON "NetIp"("address");

-- CreateIndex
CREATE UNIQUE INDEX "NetIp_subnetId_address_key" ON "NetIp"("subnetId", "address");

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
CREATE UNIQUE INDEX "Invoice_outgoingKey_key" ON "Invoice"("outgoingKey");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_cancelsInvoiceId_key" ON "Invoice"("cancelsInvoiceId");

-- CreateIndex
CREATE INDEX "Invoice_direction_status_idx" ON "Invoice"("direction", "status");

-- CreateIndex
CREATE INDEX "Invoice_issueDate_idx" ON "Invoice"("issueDate");

-- CreateIndex
CREATE INDEX "Invoice_dueDate_idx" ON "Invoice"("dueDate");

-- CreateIndex
CREATE INDEX "Invoice_customerId_idx" ON "Invoice"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceFile_invoiceId_key" ON "InvoiceFile"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceFile_path_key" ON "InvoiceFile"("path");

-- CreateIndex
CREATE INDEX "DocCategory_area_idx" ON "DocCategory"("area");

-- CreateIndex
CREATE INDEX "DocPage_area_idx" ON "DocPage"("area");

-- CreateIndex
CREATE INDEX "DocPage_categoryId_idx" ON "DocPage"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "DocPage_area_slug_key" ON "DocPage"("area", "slug");

-- CreateIndex
CREATE INDEX "DocVersion_pageId_savedAt_idx" ON "DocVersion"("pageId", "savedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DocImage_path_key" ON "DocImage"("path");

-- CreateIndex
CREATE INDEX "DocImage_area_idx" ON "DocImage"("area");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");

-- CreateIndex
CREATE INDEX "OutboxEvent_processedAt_failedAt_availableAt_idx" ON "OutboxEvent"("processedAt", "failedAt", "availableAt");

-- CreateIndex
CREATE INDEX "OutboxEvent_type_idx" ON "OutboxEvent"("type");

-- CreateIndex
CREATE UNIQUE INDEX "OutboxDelivery_eventId_handler_key" ON "OutboxDelivery"("eventId", "handler");

-- CreateIndex
CREATE INDEX "JobRun_jobId_startedAt_idx" ON "JobRun"("jobId", "startedAt");

-- CreateIndex
CREATE INDEX "JobRun_startedAt_idx" ON "JobRun"("startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApiToken_tokenHash_key" ON "ApiToken"("tokenHash");

-- CreateIndex
CREATE INDEX "ApiToken_userId_idx" ON "ApiToken"("userId");

-- CreateIndex
CREATE INDEX "ApiToken_expiresAt_idx" ON "ApiToken"("expiresAt");

-- CreateIndex
CREATE INDEX "ApiIdempotencyKey_expiresAt_idx" ON "ApiIdempotencyKey"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApiIdempotencyKey_tokenId_scope_key_key" ON "ApiIdempotencyKey"("tokenId", "scope", "key");

-- CreateIndex
CREATE INDEX "MailMessage_createdAt_idx" ON "MailMessage"("createdAt");

-- CreateIndex
CREATE INDEX "MailMessage_status_createdAt_idx" ON "MailMessage"("status", "createdAt");

-- CreateIndex
CREATE INDEX "MailMessage_userId_createdAt_idx" ON "MailMessage"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Order_number_key" ON "Order"("number");

-- CreateIndex
CREATE INDEX "Order_status_acceptedAt_idx" ON "Order"("status", "acceptedAt");

-- CreateIndex
CREATE INDEX "Order_vehicleId_idx" ON "Order"("vehicleId");

-- CreateIndex
CREATE INDEX "Order_customerId_idx" ON "Order"("customerId");

-- CreateIndex
CREATE INDEX "Order_appointmentId_idx" ON "Order"("appointmentId");

-- CreateIndex
CREATE INDEX "Order_acceptedAt_idx" ON "Order"("acceptedAt");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_position_idx" ON "OrderItem"("orderId", "position");

-- CreateIndex
CREATE INDEX "OrderItem_refType_refId_idx" ON "OrderItem"("refType", "refId");

-- CreateIndex
CREATE INDEX "OrderFinding_orderId_createdAt_idx" ON "OrderFinding"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "OrderApproval_orderId_createdAt_idx" ON "OrderApproval"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "OrderEvent_orderId_at_idx" ON "OrderEvent"("orderId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "Article_number_key" ON "Article"("number");

-- CreateIndex
CREATE INDEX "Article_archivedAt_idx" ON "Article"("archivedAt");

-- CreateIndex
CREATE INDEX "Article_name_idx" ON "Article"("name");

-- CreateIndex
CREATE INDEX "StockMovement_articleId_createdAt_idx" ON "StockMovement"("articleId", "createdAt");

-- CreateIndex
CREATE INDEX "StockMovement_orderId_idx" ON "StockMovement"("orderId");

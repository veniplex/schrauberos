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

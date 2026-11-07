import type { ColumnDef } from "@/server/csv/columns";

/** Spalten des Fahrzeug-Exports und -Imports. Die Schlüssel sind die Felder des Fahrzeugformulars; `customerNumber` (Halter) gibt es nur mit dem Recht, Kunden zu sehen. */
export const VEHICLE_COLUMNS: readonly ColumnDef[] = [
  { key: "plate", labelKey: "vehicles.exchange.cols.plate", aliases: ["Kfz-Kennzeichen", "Amtliches Kennzeichen", "License plate", "Plate"], required: true },
  { key: "make", labelKey: "vehicles.exchange.cols.make", aliases: ["Marke", "Make", "Brand"] },
  { key: "model", labelKey: "vehicles.exchange.cols.model", aliases: ["Typ", "Modell", "Model"] },
  { key: "vin", labelKey: "vehicles.exchange.cols.vin", aliases: ["FIN", "VIN", "Fahrgestellnummer", "Fahrzeug-Identifizierungsnummer"] },
  { key: "year", labelKey: "vehicles.exchange.cols.year", aliases: ["Baujahr", "Year"] },
  { key: "mileageKm", labelKey: "vehicles.exchange.cols.mileageKm", aliases: ["Kilometerstand", "km", "Mileage"] },
  { key: "fuel", labelKey: "vehicles.exchange.cols.fuel", aliases: ["Kraftstoff", "Fuel"] },
  { key: "hsn", labelKey: "vehicles.exchange.cols.hsn", aliases: ["Herstellerschlüssel", "Schlüsselnummer zu 2.1"] },
  { key: "tsn", labelKey: "vehicles.exchange.cols.tsn", aliases: ["Typschlüssel", "Schlüsselnummer zu 2.2"] },
  { key: "firstRegistration", labelKey: "vehicles.exchange.cols.firstRegistration", aliases: ["Erstzulassung", "First registration"] },
  { key: "inspectionDue", labelKey: "vehicles.exchange.cols.inspectionDue", aliases: ["HU", "HU fällig", "Prüfung fällig", "Inspection due"] },
  { key: "extraInspectionKind", labelKey: "vehicles.exchange.cols.extraInspectionKind", aliases: ["Weitere Prüfung", "Extra inspection"] },
  { key: "extraInspectionDue", labelKey: "vehicles.exchange.cols.extraInspectionDue", aliases: ["Weitere Prüfung fällig", "Extra inspection due"] },
  { key: "notes", labelKey: "vehicles.exchange.cols.notes", aliases: ["Bemerkung", "Bemerkungen", "Notes"], multiline: true },
  { key: "customerNumber", labelKey: "vehicles.exchange.cols.customerNumber", aliases: ["Kundennummer", "Kundennr", "Kd-Nr", "Customer number", "Customer no"] },
];

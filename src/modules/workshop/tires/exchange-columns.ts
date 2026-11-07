import type { ColumnDef } from "@/server/csv/columns";
import { TIRE_POSITIONS, type TirePosition } from "./constants";

/** Spalte je Position und Angabe: `dotFL` (DOT-Kürzel), `treadFL` (Profiltiefe in mm), `conditionFL` (Zustand). */
export const positionKey = (kind: "dot" | "tread" | "condition", position: TirePosition) => `${kind}${position}` as const;

const POSITION_COLUMNS: readonly ColumnDef[] = TIRE_POSITIONS.flatMap((position): ColumnDef[] => [
  { key: positionKey("dot", position), labelKey: `tires.exchange.cols.dot${position}` },
  { key: positionKey("tread", position), labelKey: `tires.exchange.cols.tread${position}` },
  { key: positionKey("condition", position), labelKey: `tires.exchange.cols.condition${position}` },
]);

/**
 * Spalten des Reifen-Exports und -Imports: eine Zeile je Reifensatz, das Fahrzeug über das Kennzeichen. Je Position (vorne links … Ersatzrad) drei Spalten für DOT, Profiltiefe
 * und Zustand. Ein Ersatzrad entsteht, sobald eine seiner Spalten gefüllt ist.
 */
export const TIRE_COLUMNS: readonly ColumnDef[] = [
  { key: "plate", labelKey: "tires.exchange.cols.plate", aliases: ["Kfz-Kennzeichen", "Fahrzeug", "License plate", "Plate"], required: true },
  { key: "season", labelKey: "tires.exchange.cols.season", aliases: ["Saison", "Jahreszeit", "Season"], required: true },
  { key: "status", labelKey: "tires.exchange.cols.status", aliases: ["Zustand des Satzes", "Status"] },
  { key: "brand", labelKey: "tires.exchange.cols.brand", aliases: ["Hersteller", "Marke", "Brand"] },
  { key: "model", labelKey: "tires.exchange.cols.model", aliases: ["Modell", "Typ", "Model"] },
  { key: "width", labelKey: "tires.exchange.cols.width", aliases: ["Breite", "Width"] },
  { key: "aspect", labelKey: "tires.exchange.cols.aspect", aliases: ["Querschnitt", "Höhe", "Aspect"] },
  { key: "rim", labelKey: "tires.exchange.cols.rim", aliases: ["Zoll", "Felgendurchmesser", "Felge (Zoll)", "Rim"] },
  { key: "loadIndex", labelKey: "tires.exchange.cols.loadIndex", aliases: ["LI", "Tragfähigkeit", "Load index"] },
  { key: "speedIndex", labelKey: "tires.exchange.cols.speedIndex", aliases: ["SI", "Geschwindigkeitsindex", "Speed index"] },
  { key: "rimType", labelKey: "tires.exchange.cols.rimType", aliases: ["Felgenart", "Felgen", "Rim type"] },
  { key: "storageLocation", labelKey: "tires.exchange.cols.storageLocation", aliases: ["Lagerort", "Lager", "Storage location"] },
  { key: "storedAt", labelKey: "tires.exchange.cols.storedAt", aliases: ["Eingelagert am", "Einlagerung", "Stored on"] },
  { key: "notes", labelKey: "tires.exchange.cols.notes", aliases: ["Bemerkung", "Bemerkungen", "Notes"], multiline: true },
  ...POSITION_COLUMNS,
];

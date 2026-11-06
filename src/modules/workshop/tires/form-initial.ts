import { toDateInput } from "@/lib/dates";
import { TIRE_POSITIONS, type TirePosition } from "@/modules/workshop/tires/constants";
import { toVehicleOption } from "@/modules/workshop/vehicles/public";
import type { TireSetFormInitial } from "./tire-set-form";

type VehicleArg = Parameters<typeof toVehicleOption>[0];

const emptyRows = (): TireSetFormInitial["tires"] =>
  Object.fromEntries(TIRE_POSITIONS.map((p) => [p, { dot: "", tread: "", condition: "good" }])) as TireSetFormInitial["tires"];

export function newTireSetInitial(vehicle: VehicleArg | null): TireSetFormInitial {
  return {
    vehicle: vehicle ? toVehicleOption(vehicle) : null,
    season: "winter",
    status: "stored",
    brand: "",
    model: "",
    width: "",
    aspect: "",
    rim: "",
    loadIndex: "",
    speedIndex: "",
    rimType: "none",
    storageLocation: "",
    storedAt: toDateInput(new Date()),
    notes: "",
    spare: false,
    tires: emptyRows(),
  };
}

export function editTireSetInitial(set: {
  id: string;
  vehicle: VehicleArg;
  season: string;
  status: string;
  brand: string | null;
  model: string | null;
  width: number | null;
  aspect: number | null;
  rim: number | null;
  loadIndex: string | null;
  speedIndex: string | null;
  rimType: string;
  storageLocation: string | null;
  storedAt: Date;
  notes: string | null;
  tires: Array<{ position: string; dot: string | null; treadDepthMm: number | null; condition: string }>;
}): TireSetFormInitial {
  const rows = emptyRows();
  for (const t of set.tires) {
    rows[t.position as TirePosition] = {
      dot: t.dot ?? "",
      tread: t.treadDepthMm != null ? String(t.treadDepthMm) : "",
      condition: t.condition,
    };
  }
  return {
    id: set.id,
    vehicle: toVehicleOption(set.vehicle),
    season: set.season,
    status: set.status,
    brand: set.brand ?? "",
    model: set.model ?? "",
    width: set.width != null ? String(set.width) : "",
    aspect: set.aspect != null ? String(set.aspect) : "",
    rim: set.rim != null ? String(set.rim) : "",
    loadIndex: set.loadIndex ?? "",
    speedIndex: set.speedIndex ?? "",
    rimType: set.rimType,
    storageLocation: set.storageLocation ?? "",
    storedAt: toDateInput(set.storedAt),
    notes: set.notes ?? "",
    spare: set.tires.some((t) => t.position === "SPARE"),
    tires: rows,
  };
}

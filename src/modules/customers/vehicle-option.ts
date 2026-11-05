import { customerDisplayName } from "@/lib/domain/vehicles";
import type { VehicleOption } from "./vehicle-combobox";

type VehicleWithCustomer = {
  id: string;
  plate: string;
  make: string | null;
  model: string | null;
  /** Fahrzeuge können ohne Halter existieren */
  customer: { firstName: string | null; lastName: string; company: string | null } | null;
};

export function toVehicleOption(v: VehicleWithCustomer): VehicleOption {
  return {
    id: v.id,
    plate: v.plate,
    description: [v.make, v.model].filter(Boolean).join(" "),
    customer: v.customer ? customerDisplayName(v.customer) : "",
  };
}

import { customerDisplayName } from "@/modules/workshop/customers/public";
import type { VehicleOption } from "./vehicle-picker";

type VehicleWithCustomer = {
  id: string;
  plate: string;
  make: string | null;
  model: string | null;
  /** Fahrzeuge können ohne Halter existieren */
  customer: { firstName: string | null; lastName: string; company: string | null } | null;
};

export function toVehicleOption(v: VehicleWithCustomer): VehicleOption {
  const description = [v.make, v.model].filter(Boolean).join(" ");
  const customer = v.customer ? customerDisplayName(v.customer) : "";
  return { id: v.id, label: v.plate, sublabel: [description, customer].filter(Boolean).join(" · "), plate: v.plate, description, customer };
}

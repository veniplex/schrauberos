/**
 * Neutrales Austauschformat zwischen SchrauberOS und Werbas.
 *
 * Wie Werbas die Daten tatsächlich bereitstellt (REST-Schnittstelle, Datenbank-Sicht, Export-Dateien …)
 * ist noch offen. Sobald das geklärt ist, genügt ein `WerbasClient`, der diese Typen liefert –
 * die Synchronisierung (sync.ts) und alle Seiten bleiben unverändert.
 */
export type ExternalCustomer = {
  /** Eindeutige Kennung in Werbas (stabil, wird zum Abgleich verwendet) */
  externalId: string;
  customerNumber?: string;
  firstName?: string;
  lastName: string;
  company?: string;
  email?: string;
  phone?: string;
  street?: string;
  zip?: string;
  city?: string;
};

export type ExternalVehicle = {
  externalId: string;
  /** externalId des zugehörigen Kunden */
  customerExternalId: string;
  plate: string;
  make?: string;
  model?: string;
  vin?: string;
  year?: number;
};

export interface WerbasClient {
  /** Alle Kunden (oder nur seit `since` geänderte, falls die Schnittstelle das unterstützt). */
  customers(since?: Date): AsyncIterable<ExternalCustomer>;
  vehicles(since?: Date): AsyncIterable<ExternalVehicle>;
}

export type SyncStats = {
  customersCreated: number;
  customersUpdated: number;
  vehiclesCreated: number;
  vehiclesUpdated: number;
  /** Fahrzeuge, deren Kunde (noch) nicht vorhanden ist */
  vehiclesSkipped: number;
};

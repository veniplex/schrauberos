import type { Readable } from "node:stream";
import type { RemoteEntry } from "@/lib/offsite/target";

export type { RemoteEntry };

export type OffsiteErrorCode =
  /** Keine Verbindung (Adresse, Anschluss, Zeitüberschreitung, Zertifikat) */
  | "connect"
  /** Anmeldung abgelehnt */
  | "auth"
  /** SFTP: Der Hostschlüssel stimmt nicht mit dem hinterlegten Fingerabdruck überein – Abbruch, nie weiterverbinden */
  | "hostKey"
  /** Das Ziel hat die Anfrage abgelehnt oder unerwartet beantwortet (Berechtigung, Platz, Weiterleitung …) */
  | "server"
  /** Datei oder Verzeichnis gibt es am Ziel nicht */
  | "notFound"
  /** Zeitüberschreitung (keine Daten mehr) */
  | "timeout"
  /** Zugangsdaten oder Einstellungen fehlen */
  | "config"
  /** Die Adresse (oder eine ihrer aufgelösten Adressen) ist als Ziel verboten: der eigene Rechner, Verbindungs-lokal, Metadaten-Dienst */
  | "forbiddenHost";

/** Fehler beim Zugriff auf das Ziel. `detail` ist eine kurze technische Angabe ohne Geheimnisse (Statuscode, Fehlername); `fingerprint` nennt bei `hostKey` den gesehenen Wert. */
export class OffsiteError extends Error {
  constructor(
    readonly code: OffsiteErrorCode,
    readonly detail?: string,
    readonly fingerprint?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
  }
}

/**
 * Zugriff auf das Ziel – die Dienste (Hochladen, Auflisten, Aufbewahrung, Rückweg) kennen nur diese Schnittstelle; SFTP und WebDAV sind austauschbare Umsetzungen
 * (Tests setzen eine Umsetzung im Speicher ein). Alle Namen sind einfache Dateinamen im konfigurierten Verzeichnis.
 */
export interface OffsiteTransport {
  /** Dateien im Verzeichnis (legt das Verzeichnis an, wenn es fehlt) */
  list(): Promise<RemoteEntry[]>;
  /** Schreibt die Datei unter `<name>.part` und benennt sie erst nach vollständiger Übertragung in `name` um (nie eine halbe Datei unter dem endgültigen Namen) */
  put(name: string, data: Readable, signal?: AbortSignal): Promise<void>;
  get(name: string, signal?: AbortSignal): Promise<Readable>;
  remove(name: string): Promise<void>;
  close(): Promise<void>;
}

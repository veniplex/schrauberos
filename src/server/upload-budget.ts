import { ByteBudget, RateLimiter, type RateDecision } from "@/lib/rate-limit";

/**
 * Gemeinsame Drossel aller Uploads je Konto und Stunde (im Arbeitsspeicher, ein Prozess): höchstens 200 Dateien und 500 MB – für die Foto-Galerie (`/api/files`), die Bilder der
 * Dokumentation (`/api/docs/images`), die Belege der Rechnungsverwaltung (Formular und CSV/E-Rechnung) und die Datei-Uploads der Programmierschnittstelle (je Token-Besitzer).
 * Ein fehlerhaftes Skript oder ein Dauerlauf (hochladen, entfernen, wiederholen) kann das Volume so nicht in Minuten füllen. Gezählt wird die **angekündigte** Größe jeder Anfrage;
 * abgewiesen wird mit der Wartezeit (HTTP 429 mit `Retry-After`, Formular: Meldung „zu viele Uploads“).
 *
 * Der Zähler liegt am globalen Objekt, nicht im Modul: Der gebaute Server enthält dieses Modul mehrfach (Seiten, Routen), und alle sollen dasselbe Konto gemeinsam zählen.
 */
export const UPLOADS_PER_HOUR = 200;
export const UPLOAD_BYTES_PER_HOUR = 500 * 1024 * 1024;

type Budget = { rate: RateLimiter; bytes: ByteBudget };
const shared = globalThis as typeof globalThis & { __sosUploadBudget?: Budget };

function budget(): Budget {
  return (shared.__sosUploadBudget ??= {
    rate: new RateLimiter({ max: UPLOADS_PER_HOUR, windowMs: 3_600_000 }),
    bytes: new ByteBudget({ maxBytes: UPLOAD_BYTES_PER_HOUR, windowMs: 3_600_000 }),
  });
}

/** Einen Upload von `bytes` für dieses Konto verbuchen: erlaubt oder abgewiesen mit der Wartezeit. */
export function takeUploadBudget(accountId: string, bytes: number): RateDecision {
  const { rate, bytes: size } = budget();
  const decision = rate.take(accountId);
  return decision.allowed ? size.take(accountId, Math.max(0, bytes)) : decision;
}

/** Nur für Tests: Zähler zurücksetzen. */
export function resetUploadBudget(): void {
  shared.__sosUploadBudget = undefined;
}

/** `Retry-After` in ganzen Sekunden (mindestens 1). */
export const retryAfterSeconds = (decision: Extract<RateDecision, { allowed: false }>): number => Math.max(1, Math.ceil(decision.retryAfterMs / 1000));

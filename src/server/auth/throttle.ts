import "server-only";
import { createHash } from "node:crypto";
import { FailureBudget, Gate, RateWindow } from "@/lib/login-throttle";
import { authRuntime } from "./runtime";

/**
 * Der Zustand der Anmeldedrosselung im Prozess (Logik: `src/lib/login-throttle.ts`). Ein Prozess, eine Datenbank – deshalb genügt
 * Speicher im Prozess für die schnelle, rennbahnfreie Vorprüfung; die Datenbank hält die Zähler zusätzlich dauerhaft
 * (`User.failedLogins`/`lockedUntil`), damit ein Neustart nichts zurücksetzt.
 */
const CAP_MS = 90_000;
const now = () => authRuntime.now();

function create() {
  return {
    /** Je Konto (auch unbekannte Namen): 3 freie Versuche, dann 2 s, 4 s, 8 s … bis 90 s. */
    accounts: new Gate({ free: 3, baseMs: 2_000, capMs: CAP_MS, decayMs: 15 * 60_000, maxEntries: 5_000, now }),
    /** Je Client-Adresse (nur hinter Reverse-Proxy): großzügig, 20 freie Versuche in 10 Minuten. */
    ips: new Gate({ free: 20, baseMs: 2_000, capMs: CAP_MS, decayMs: 10 * 60_000, maxEntries: 5_000, now }),
    /**
     * Je **bekanntem Gerät** (gültiges Geräte-Cookie des Kontos, siehe `devices.ts`): 5 freie Versuche, dann 2 s, 4 s … bis 90 s. Dieses
     * Gate ersetzt für das Gerät die Konto-Wartezeit; ein Angreifer ohne das Cookie kann sie nicht auslösen. Der Schlüssel ist die
     * Geräte-Id (nur gültige Geräte kommen hierher), deshalb ist die Tabelle durch Konten × 10 begrenzt.
     */
    devices: new Gate({ free: 5, baseMs: 2_000, capMs: CAP_MS, decayMs: 15 * 60_000, maxEntries: 2_000, now }),
    /**
     * Zweiter Faktor bei der Anmeldung (Schlüssel: Konto-Id): 5 freie Versuche, dann 2 s, 4 s … bis 90 s. Der Code ist billig zu prüfen (kein Hash), die Drosselung
     * hält das Raten trotzdem aussichtslos (6 Ziffern, 3 gültige Werte). Ein Erfolg gleicht nur den eigenen Versuch aus (`forgive`), er setzt die Zählung nicht zurück.
     * Dazu zählt `TwoFactor.failedAttempts/lockedUntil` dauerhaft (überlebt einen Neustart).
     */
    totp: new Gate({ free: 5, baseMs: 2_000, capMs: CAP_MS, decayMs: 15 * 60_000, maxEntries: 2_000, now }),
    /** Code-Eingabe bei der **Einrichtung** des zweiten Faktors im Konto (Schlüssel: Konto-Id): eine gestohlene Sitzung darf dort nicht unbegrenzt raten. */
    totpSetup: new Gate({ free: 5, baseMs: 5_000, capMs: CAP_MS, decayMs: 15 * 60_000, maxEntries: 1_000, now }),
    /** Passwortwechsel im Konto: eigenes Limit (die Prüfung des aktuellen Passworts darf kein Rate-Orakel für gestohlene Sitzungen sein). */
    passwordChange: new Gate({ free: 5, baseMs: 5_000, capMs: CAP_MS, decayMs: 15 * 60_000, maxEntries: 1_000, now }),
    /** Alle Fehlversuche zusammen: ab 30 pro Minute wird jede Anmeldung bis zu 3 s langsamer, aber nie abgewiesen. */
    budget: new FailureBudget({ limit: 30, windowMs: 60_000, stepMs: 50, maxDelayMs: 3_000, maxStamps: 5_000, now }),
    /**
     * Notzugang (Wiederherstellungs-Code): **nur global**, nie pro Konto – sonst könnte jemand den Notweg für alle sperren. Das Budget
     * verlangsamt (ab 10 Versuchen pro Minute je 200 ms mehr, höchstens 5 s), weist aber nie ab. Pro Client-Adresse (nur hinter dem
     * Reverse-Proxy) gibt es zusätzlich ein Limit. Versuche werden synchron belegt und bei Erfolg zurückgenommen.
     */
    recovery: {
      budget: new FailureBudget({ limit: 10, windowMs: 60_000, stepMs: 200, maxDelayMs: 5_000, maxStamps: 5_000, now }),
      ips: new Gate({ free: 10, baseMs: 2_000, capMs: CAP_MS, decayMs: 10 * 60_000, maxEntries: 5_000, now }),
      /** Audit für Fehlversuche: insgesamt höchstens einer alle 10 s und 6 pro Minute */
      audit: new RateWindow({ perKeyMs: 10_000, globalLimit: 6, globalWindowMs: 60_000, maxKeys: 4, now }),
    },
    /**
     * Eingabe des Wiederherstellungsschlüssels beim Restore (Verwaltung und Einrichtung): **nur global**, nie pro Konto. Das Budget verlangsamt (ab dem siebten Versuch pro Minute je 500 ms mehr, höchstens
     * 8 s), weist aber nie ab. Der Schlüssel hat 256 Bit – Raten ist aussichtslos; die Drosselung hält Dauerbeschuss klein. Eigener Pfad, nicht die scrypt-Semaphoren der Anmeldung.
     */
    recoveryKey: new FailureBudget({ limit: 5, windowMs: 60_000, stepMs: 500, maxDelayMs: 8_000, maxStamps: 2_000, now }),
    /** Audit-Einträge für Fehlversuche beim zweiten Faktor: je Konto höchstens einer pro Minute, insgesamt höchstens 30 pro Minute. */
    audit2fa: new RateWindow({ perKeyMs: 60_000, globalLimit: 30, globalWindowMs: 60_000, maxKeys: 2_000, now }),
    /** Audit-Einträge für Fehlversuche: je Konto höchstens einer pro Minute, insgesamt höchstens 30 pro Minute. */
    audit: new RateWindow({ perKeyMs: 60_000, globalLimit: 30, globalWindowMs: 60_000, maxKeys: 2_000, now }),
  };
}

const globalForThrottle = globalThis as unknown as { __loginThrottle?: ReturnType<typeof create> };
export const loginThrottle = (globalForThrottle.__loginThrottle ??= create());

/** Für Tests: alles auf Anfang (frische Gates mit der aktuellen `authRuntime`). */
export function resetLoginThrottle(): void {
  globalForThrottle.__loginThrottle = undefined;
  Object.assign(loginThrottle, create());
}

/** Gleiche Schreibweise für Schlüssel und Datenbank-Suche. */
export const normalizeUsername = (username: string): string => username.trim().toLowerCase().slice(0, 100);

/** Kurzer Fingerabdruck eines Namens für das Audit-Log (kein Klartext unbekannter Namen). */
export const nameFingerprint = (username: string): string => createHash("sha256").update(normalizeUsername(username)).digest("hex").slice(0, 8);

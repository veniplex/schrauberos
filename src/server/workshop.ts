import "server-only";
import { cache } from "react";
import { db } from "@/server/db";
import { LOGO_TYPES } from "@/lib/logo";
import { parseOpeningHours } from "@/lib/opening-hours";
import { setWorkshopZone } from "@/lib/zone";

/**
 * Werkstatt-Profil (Singleton, Plattform): Name, Adresse, Branding, Öffnungszeiten.
 * Funktionsspezifische Einstellungen (Kalender, Reifenregeln …) liegen bei der jeweiligen Funktion.
 *
 * **Drei Zugriffe, damit nicht jede Anfrage alles liest** (Z6-3 M-3; sensible Spalten „gar nicht erst aus der Datenbank lesen“):
 *  - `getWorkshop()`: Profil für Layout, Seiten und Zeiten – **ohne** das Logo (bis zu ≈ 270 KB Base64, es kommt über `/api/logo`) und **ohne** Bank- und Steuerdaten (IBAN, BIC, Bank, USt-IdNr., Steuernummer);
 *    `logoMime` nennt den Typ des Logos (nur den Kopf der Daten-URL), `logoSrc` baut daraus die Adresse.
 *  - `getWorkshopBilling()`: wie `getWorkshop()` **mit** Bank- und Steuerdaten – nur für Rechnungsfunktionen, die Einstellungsseite und die Prüfliste des Profils.
 *  - `getWorkshopLogo()`: die Daten-URL des Logos – nur für `/api/logo` und das PDF.
 * Jeder Aufruf gilt je Anfrage einmal (`cache`).
 */
const NO_LOGO = { logoDataUrl: true } as const;
const NO_BILLING = { ...NO_LOGO, taxNumber: true, vatId: true, bankName: true, iban: true, bic: true } as const;

// Die Werkstatt-Zone gehört der Einstellung: wer das Profil liest, hat sie (auch in einem Prozess, in dem Start und Einrichtung nicht gelaufen sind)
const applyZone = <T extends { timezone: string }>(row: T): T => {
  setWorkshopZone(row.timezone);
  return row;
};

// upsert statt find+create: robust, falls zwei erste Anfragen gleichzeitig eintreffen
const readProfile = async () =>
  applyZone((await db.workshop.findUnique({ where: { id: "default" }, omit: NO_BILLING })) ?? (await db.workshop.upsert({ where: { id: "default" }, update: {}, create: { id: "default" }, omit: NO_BILLING })));
const readBilling = async () =>
  applyZone((await db.workshop.findUnique({ where: { id: "default" }, omit: NO_LOGO })) ?? (await db.workshop.upsert({ where: { id: "default" }, update: {}, create: { id: "default" }, omit: NO_LOGO })));

/** Typ des gespeicherten Logos aus dem Kopf der Daten-URL (nur ein Teilstück der Spalte wird gelesen); `null`, wenn es keins (oder kein erlaubtes Rasterbild) gibt. */
async function logoMimeOf(): Promise<(typeof LOGO_TYPES)[number] | null> {
  const rows = await db.$queryRaw<Array<{ head: string | null }>>`SELECT substr("logoDataUrl", 1, 40) AS head FROM "Workshop" WHERE "id" = 'default'`;
  const head = rows[0]?.head ?? "";
  return LOGO_TYPES.find((type) => head.startsWith(`data:${type};base64,`)) ?? null;
}

export const getWorkshop = cache(async () => {
  const [row, logoMime] = await Promise.all([readProfile(), logoMimeOf()]);
  return { ...row, logoMime, hours: parseOpeningHours(row.openingHours) };
});

export const getWorkshopBilling = cache(async () => {
  const [row, logoMime] = await Promise.all([readBilling(), logoMimeOf()]);
  return { ...row, logoMime, hours: parseOpeningHours(row.openingHours) };
});

export const getWorkshopLogo = cache(async (): Promise<string | null> => (await db.workshop.findUnique({ where: { id: "default" }, select: { logoDataUrl: true } }))?.logoDataUrl ?? null);

export type Workshop = Awaited<ReturnType<typeof getWorkshop>>;
export type WorkshopBilling = Awaited<ReturnType<typeof getWorkshopBilling>>;

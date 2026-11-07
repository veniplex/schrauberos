/** Art einer Datei (Beschriftung `files.categories.*`); die Werte sind API-Vertrag. */
export const FILE_CATEGORIES = ["photo", "intake", "damage", "work", "document", "other"] as const;
export type FileCategory = (typeof FILE_CATEGORIES)[number];

/** Angenommene Typen (am Inhalt erkannt): Fotos als JPEG/PNG (werden bereinigt), Dokumente als PDF. HEIC, SVG, GIF und WebP nimmt der Upload nicht an. */
export const FILE_TYPES = ["image/jpeg", "image/png", "application/pdf"] as const;

/**
 * Größe der hochgeladenen Datei (10 MB); der Browser verkleinert Fotos zuvor auf höchstens 1600 px. Die Grenze liegt bewusst unter dem Puffer des Proxys (`proxyClientMaxBodySize` 13 MB in `next.config.ts`):
 * Next puffert jeden Body für den Proxy und schneidet ihn bei diesem Limit **stumm** ab – Datei und Formularfelder müssen darunter bleiben.
 */
export const FILE_MAX_BYTES = 10 * 1024 * 1024;

export const CAPTION_MAX = 200;

/** Woran eine Datei hängt. */
export const FILE_OWNER_TYPES = ["vehicle", "order"] as const;
export type FileOwnerType = (typeof FILE_OWNER_TYPES)[number];

/** Höchstens so viele Dateien je Fahrzeug bzw. Auftrag (schützt Speicher und Seite). */
export const MAX_FILES_PER_OWNER = 300;

export const FILE_EXTENSIONS: Record<(typeof FILE_TYPES)[number], string> = { "image/jpeg": "jpg", "image/png": "png", "application/pdf": "pdf" };

export const isImageType = (mime: string): boolean => mime === "image/jpeg" || mime === "image/png";

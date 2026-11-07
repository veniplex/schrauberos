/** Gültigkeit der Abo-Adresse bei der Erzeugung: unbegrenzt oder Tage. Eigene Datei ohne Node-Module, damit die Oberfläche (Browserbündel) sie importieren darf. */
export const FEED_EXPIRY_CHOICES = ["never", "90", "365"] as const;
export type FeedExpiryChoice = (typeof FEED_EXPIRY_CHOICES)[number];

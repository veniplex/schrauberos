/** Kilometerstand für die Anzeige („123.456 km“); `number` ist der Zahlenformatierer der Oberfläche (Sprache). */
export const formatMileage = (km: number, number: (n: number) => string): string => `${number(km)} km`;

/**
 * Die wählbaren Laufzeiten eines API-Tokens in Tagen – **eine** Liste für Formular, Hilfe und Server: Die Oberfläche bietet genau diese an, der Server nimmt genau diese an
 * (sonst ließe sich über einen eigenen Aufruf jede Zahl von 1 bis 365 setzen, die Hilfe nennt aber 30/90/180/365). „Unbegrenzt“ gibt es nur für Dienstkonten (`unlimited`).
 */
export const TOKEN_EXPIRY_DAYS = [30, 90, 180, 365] as const;

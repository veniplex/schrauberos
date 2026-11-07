import type { PrismaClient } from "@/generated/prisma/client";
import { docSeeder } from "@/capabilities/docs/seed";
import type { SeedDef } from "@/modules/types";

/** Beispielseiten des Handbuchs (Werkstatt: Arbeitsanweisungen und Sicherheit, Büro: Abläufe, Vorlagen und Kontakte). */
async function demo(db: PrismaClient) {
  if ((await db.docPage.count({ where: { area: "handbook" } })) > 0) return;
  console.log("Demo-Seiten (Handbuch) werden angelegt …");
  const { cat, page } = docSeeder(db);

  const wArbeit = await cat("handbook", "Werkstatt: Arbeitsanweisungen", 1);
  const wSicher = await cat("handbook", "Werkstatt: Sicherheit", 2);
  await page("handbook", "Reifenwechsel – Ablauf", wArbeit, [
    "## Vorbereitung", "", "- Auftrag prüfen: Kennzeichen, Reifensatz, Felgenart", "- Reifenlager: Satz anhand des Lagerorts bereitstellen", "- Fahrzeug auf der Hebebühne aufnehmen (Aufnahmepunkte beachten)", "",
    "## Durchführung", "", "1. Räder abnehmen, Bremsen und Radlager auf Sicht prüfen", "2. Profiltiefe und DOT-Alter der neuen Räder messen und in der **Reifenliste** eintragen", "3. Räder montieren, Radschrauben **über Kreuz** vorziehen", "4. Mit Drehmomentschlüssel anziehen", "", "| Felgenart | Anzugsdrehmoment |", "| --- | --- |", "| Stahlfelge | laut Herstellerangabe |", "| Alufelge | laut Herstellerangabe |", "",
    "> Das Anzugsdrehmoment steht in der Fahrzeugdokumentation – hier ist bewusst kein Wert hinterlegt.", "",
    "## Nachbereitung", "", "- [ ] Alte Räder mit Lagerort etikettieren", "- [ ] Reifensatz in der Reifenliste auf *eingelagert* setzen", "- [ ] Nach 50 km Radschrauben nachziehen (kundeninformation)",
  ].join("\n"));
  await page("handbook", "Hebebühne: Sicherheitscheck", wSicher, [
    "Vor jeder Schicht kurz prüfen:", "", "- [ ] Aufnahmeteller und Tragarme unbeschädigt", "- [ ] Sicherungen rasten hörbar ein", "- [ ] Bereich um die Bühne frei", "- [ ] Mängel sofort der Werkstattleitung melden und Bühne sperren", "",
  ].join("\n"));
  await page("handbook", "Notfall: Verletzung in der Werkstatt", wSicher, [
    "## Sofortmaßnahmen", "", "1. **Ruhe bewahren**, Unfallstelle sichern", "2. Notruf **112**", "3. Erste Hilfe leisten (Verbandskasten: Eingang Werkstatt)", "4. Ersthelfer rufen", "5. Vorfall im Verbandbuch dokumentieren", "",
    "## Wichtige Orte", "", "- Verbandskasten und Augenspülung: am Eingang", "- Feuerlöscher: neben dem Hallentor", "",
  ].join("\n"), true);

  const bProzess = await cat("handbook", "Büro: Abläufe", 3);
  const bVorlagen = await cat("handbook", "Büro: Vorlagen & Kontakte", 4);
  await page("handbook", "Rechnungsprozess", bProzess, [
    "## Eingangsrechnungen", "", "1. Rechnung im **Rechnungsarchiv → Eingang** erfassen (Beleg hochladen)", "2. Sachlich prüfen lassen (Werkstattleitung bei Material)", "3. Zur Fälligkeit bezahlen und als *bezahlt* markieren", "",
    "## Ausgangsrechnungen", "", "1. Rechnung wird im Warenwirtschaftssystem erstellt", "2. Im Archiv unter **Ausgang** erfassen und dem Kunden zuordnen", "3. Zahlungseingang prüfen – überfällige Rechnungen erscheinen auf der Übersicht", "",
  ].join("\n"), true);
  await page("handbook", "Urlaub & Abwesenheiten", bProzess, [
    "Urlaub, Schulungen und Krankheit werden unter **Büro → Abwesenheiten** eingetragen.", "", "- Urlaub bitte **2 Wochen** vorher mit der Geschäftsführung abstimmen", "- Krankmeldungen am ersten Tag bis 8 Uhr telefonisch melden", "- Der Kalender zeigt die Abwesenheiten aller Mitarbeiter im Monat", "",
  ].join("\n"));
  await page("handbook", "Wichtige Ansprechpartner", bVorlagen, [
    "| Thema | Ansprechpartner |", "| --- | --- |", "| Steuerberater | *hier eintragen* |", "| Versicherung | *hier eintragen* |", "| IT-Störung | IT-Administration |", "",
  ].join("\n"));
}

export const seeds: SeedDef[] = [{ id: "manual", feature: "handbook.manual", order: 130, demo }];

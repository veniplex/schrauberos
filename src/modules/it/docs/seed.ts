import type { PrismaClient } from "@/generated/prisma/client";
import { docSeeder } from "@/capabilities/docs/seed";
import type { SeedDef } from "@/modules/types";

/** Beispielseiten der IT-Dokumentation. */
async function demo(db: PrismaClient) {
  if ((await db.docPage.count({ where: { area: "it" } })) > 0) return;
  console.log("Demo-Seiten (IT-Dokumentation) werden angelegt …");
  const { cat, page } = docSeeder(db);

  const iAnl = await cat("it", "Anleitungen", 1);
  const iBetrieb = await cat("it", "Betrieb", 2);
  await page("it", "Netzwerk-Übersicht", iBetrieb, [
    "Die aktuelle Dokumentation von Geräten, IP-Adressen und Verkabelung steht im Bereich **IT & Netzwerk** dieser Anwendung.", "",
    "## Grundaufbau", "", "- Internet → Firewall → Core-Switch → Server, Access Points, Arbeitsplätze", "- Getrennte VLANs für Büro, Werkstatt, Gäste und Management", "",
    "## Regeln", "", "- Neue Geräte bekommen **immer** einen Eintrag im Geräte-Inventar", "- Statische Adressen nur außerhalb des DHCP-Bereichs", "- Änderungen an der Firewall werden hier dokumentiert", "",
  ].join("\n"), true);
  await page("it", "Neuer Mitarbeiter – Onboarding", iAnl, [
    "## Checkliste", "", "- [ ] Benutzerkonto in **Verwaltung → Benutzer** anlegen und Rolle zuweisen", "- [ ] Mitarbeiter unter **Büro → Mitarbeiter** anlegen und mit dem Konto verknüpfen", "- [ ] Arbeitsplatz-PC im Geräte-Inventar erfassen", "- [ ] Erstpasswort übergeben (muss beim ersten Login geändert werden)", "",
  ].join("\n"));
  await page("it", "Backup-Konzept", iBetrieb, [
    "## Was wird gesichert?", "", "| Was | Wie oft | Wohin |", "| --- | --- | --- |", "| Datenbank dieser Anwendung | täglich | NAS |", "| Server (Dateien) | täglich | NAS |", "", "Die Datenbank sichert **Verwaltung → Backups** automatisch jede Nacht; Sicherungen lassen sich dort herunterladen und wiederherstellen.", "",
    "Restore-Test: **vierteljährlich** durchführen und hier protokollieren.", "",
  ].join("\n"));
}

/**
 * Beispiel für die Oberfläche: ein Tresor-Eintrag **ohne Zugangsdaten** (Titel, Art, System) – Geheimnisse gehören nie in Beispieldaten, und der Seed berührt `secret.key` nicht. Zugangsdaten entstehen nur in der
 * Oberfläche, über die echte Verschlüsselung.
 */
async function demoVault(db: PrismaClient) {
  if ((await db.vaultEntry.count()) > 0) return;
  console.log("Demo-Eintrag (IT-Tresor) wird angelegt …");
  await db.vaultEntry.create({ data: { title: "Beispiel: Firewall fw-01 – Weboberfläche", kind: "network", system: "fw-01", createdByName: "Demo", updatedByName: "Demo" } });
}

export const seeds: SeedDef[] = [
  { id: "docs", feature: "it.docs", order: 140, demo },
  { id: "vault", feature: "it.docs", order: 141, demo: demoVault },
];

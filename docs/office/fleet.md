# Fuhrpark

Firmenfahrzeuge mit Fahrer (aus den Mitarbeitern) und allem, was fällig wird.

* **Fälligkeiten:** HU, Service (nach Datum oder Kilometern), Versicherung und Leasing. Die Anwendung warnt 60 Tage vorher; die
  nächsten Termine stehen auf der Übersicht.
* **Kilometerstand:** Der Verlauf lässt sich fortschreiben; ein Stand unter dem letzten wird abgelehnt.
* **Kosten:** Je Kategorie erfassen. **Kosten pro Kilometer** rechnet die Anwendung nur über den **Kostenzeitraum** – vom Tag des ersten bis zum Tag des letzten erfassten Kilometerstands: die Kosten dieses Zeitraums (beide Randtage eingeschlossen) geteilt durch die in diesem Zeitraum gefahrenen Kilometer. Kosten davor (etwa die Anschaffung) oder danach fließen nicht ein; der Zeitraum steht neben dem Wert. Dafür braucht es mindestens zwei Kilometerstände an verschiedenen Tagen. Die **Gesamtkosten** zählen weiterhin alle Einträge.
* **Führerscheinkontrolle:** Pflicht des Halters, alle 6 Monate. Fahrer, die noch nie kontrolliert wurden, sind rot markiert.

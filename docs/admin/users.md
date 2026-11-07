# Benutzer

Unter **Benutzer** werden Konten angelegt, geändert und deaktiviert.

* **Anlegen:** Benutzername (Kleinbuchstaben, Ziffern, Punkt, Binde- und Unterstrich; später nicht änderbar), Anzeigename, Rollen
  und ein Startpasswort. Mit „Passwort beim nächsten Login ändern“ muss die Person ein eigenes wählen.
* **Passwort zurücksetzen:** Neues Passwort eintragen (8 bis 128 Zeichen) – bestehende Anmeldungen der Person werden beendet.
* **Notzugang:** Haben alle Administratoren ihr Passwort verloren, hilft der **Wiederherstellungs-Code** (siehe „Erste Schritte“): Auf der Anmeldeseite „Zugang verloren? Wiederherstellungs-Code verwenden“ wählen. Nach jeder Verwendung sehen das Konto und alle Administratoren einen Hinweis.
* **Wartezeit nach Fehlversuchen:** Nach mehreren falschen Passwörtern muss ein Konto vor dem nächsten Versuch warten (höchstens 90
  Sekunden, keine Sperre). Die Liste zeigt „Anmeldung gedrosselt“; auf der Seite des Kontos hebt **Wartezeit aufheben** sie sofort auf.
  Die Wartezeit gilt nicht für **bekannte Geräte** des Kontos (Browser, mit denen sich die Person schon angemeldet hat): So kann ein
  Dauerbeschuss mit ihrem Namen sie nicht aussperren. Die Person merkt ein Gerät selbst bei der Anmeldung („Dieses Gerät merken“) und verwaltet ihre Geräte unter „Mein Konto“. Geräte werden
  vergessen, wenn Sie das Passwort der Person ändern, sie deaktivieren oder ihre Zwei-Faktor-Anmeldung zurücksetzen.
* **Zwei-Faktor-Anmeldung zurücksetzen:** Hat eine Person ihr Handy und die Sicherungscodes verloren, setzt die Karte **Zwei-Faktor-Anmeldung** auf der Seite des Kontos sie zurück. Sie müssen dafür
  Ihr **eigenes Passwort** eingeben, und es gilt dieselbe Regel wie beim Ändern des Kontos (nur Konten, deren Rechte Sie vollständig haben). Das Konto meldet sich danach nur mit dem Passwort an, sieht
  oben einen Hinweis und richtet den zweiten Faktor neu ein; alle seine Sitzungen, Geräte und API-Tokens enden. Das Audit-Log hält es fest. Die eigene Zwei-Faktor-Anmeldung schalten Sie unter „Mein Konto“ aus.
* **Schutzregeln:** Der letzte aktive Administrator kann weder gelöscht noch deaktiviert werden, das eigene Konto lässt sich nicht
  deaktivieren, und Administrator-Rollen vergeben nur Administratoren.
* **Wer wen ändern darf:** Ein Konto ohne Administrator-Rolle darf nur Konten ändern oder löschen, deren Rechte es **vollständig
  selbst besitzt** (Passwort, E-Mail, „aktiv“ und Rollen eingeschlossen), und nur Rollen vergeben oder entziehen, die es selbst
  vollständig hat. Rollen mit Rechten der Verwaltung (siehe „Rollen und Rechte“) vergeben nur Administratoren. Gesperrte Rollen sind in
  der Maske ausgegraut; Konten mit mehr Rechten lassen sich nur ansehen.
* **Warnung:** Hat ein Konto, das kein Administrator ist, Rechte der Verwaltung, kennzeichnet die Liste es mit „Verwaltungsrechte“.
  Das kann gewollt sein, sollte aber bewusst geschehen.

# Konto und Sicherheit

Unter **Mein Konto** schützen Sie Ihren Zugang: mit der Zwei-Faktor-Anmeldung, mit der Übersicht Ihrer Sitzungen und Geräte und mit „Überall abmelden“.

## Zwei-Faktor-Anmeldung (optional)

Zusätzlich zum Passwort verlangt die Anmeldung einen **Code aus einer Authenticator-App** auf Ihrem Handy (zum Beispiel Aegis, Google Authenticator, Microsoft Authenticator
oder 2FAS). Das schützt Ihr Konto, auch wenn jemand Ihr Passwort kennt.

**Einrichten** (Mein Konto → Zwei-Faktor-Anmeldung):

1. **Einrichtung beginnen** und das aktuelle Passwort eingeben.
2. In der App ein Konto hinzufügen und den **QR-Code scannen**. Geht das nicht, tippen Sie den angezeigten **Schlüssel** ein (zeitbasiert, 6 Stellen). Der QR-Code entsteht
   in Ihrer Installation – es wird nichts an einen fremden Dienst gesendet.
3. Die **Sicherungscodes** sichern: zehn Codes, die jeweils **einmal** gelten und den Code der App ersetzen, wenn das Handy fehlt. Ausdrucken (Knopf **Drucken**) und wie ein
   Passwort aufbewahren, nicht auf dem Handy mit der App. Sie werden nur jetzt angezeigt.
4. Den **Code aus der App** eingeben, bestätigen, dass die Sicherungscodes gesichert sind, und **einschalten**. Erst jetzt verlangt die Anmeldung den zweiten Faktor.

**Anmelden mit zweitem Faktor:** Erst Benutzername und Passwort, dann auf einer zweiten Seite der Code aus der App (oder ein Sicherungscode). Jeder Code gilt **nur einmal**: Wer
sich kurz nacheinander zweimal anmeldet, wartet auf den nächsten Code der App (alle 30 Sekunden). Nach fünf falschen Codes beginnt die Anmeldung von vorn, und das Konto muss
vor dem nächsten Versuch warten (wie bei falschen Passwörtern, höchstens 90 Sekunden). Der zweite Schritt gilt 5 Minuten.

**Das bekannte Gerät ersetzt den zweiten Faktor nie.** „Dieses Gerät merken“ (siehe unten) befreit nur von der Wartezeit nach Fehlversuchen, nicht vom Passwort und nicht vom Code.

**Sicherungscodes erneuern und ausschalten:** Beides steht auf derselben Karte und fragt das Passwort noch einmal ab. Neue Sicherungscodes machen die alten ungültig. Wenn nur
noch wenige übrig sind, weist die Karte darauf hin.

**Telefon verloren, keine Sicherungscodes mehr?** Eine Administratorin kann die Zwei-Faktor-Anmeldung Ihres Kontos zurücksetzen (Verwaltung → Benutzer; sie muss dafür ihr eigenes
Passwort eingeben). Danach melden Sie sich nur mit dem Passwort an, sehen oben einen Hinweis und richten den zweiten Faktor neu ein. Alle Ihre Sitzungen und Geräte enden dabei.
Administratoren können auch den **Wiederherstellungs-Code** (siehe „Erste Schritte“) benutzen – **er setzt die Zwei-Faktor-Anmeldung des Kontos zurück**, weil er sie umgeht; die
Seite sagt es Ihnen.

**Backup ohne Schlüssel wiederhergestellt?** Die Geheimnisse der Zwei-Faktor-Anmeldung sind mit dem Schlüssel Ihrer Installation verschlüsselt, der nicht in den Backups steht. Wird
ein Backup auf einer anderen Installation ohne diesen Schlüssel wiederhergestellt, wird die Zwei-Faktor-Anmeldung **für alle Konten zurückgesetzt**; beim ersten Anmelden erscheint ein Hinweis,
und Sie richten sie neu ein. Das Audit-Log hält es fest.

**Pflicht für Administratoren:** Die Administration kann die Zwei-Faktor-Anmeldung für Administrator-Konten verlangen (Einstellungen → Sicherheit, Standard: aus). Dann erreichen
Administratoren ohne eingerichteten zweiten Faktor nach der Anmeldung nur noch „Mein Konto“, bis sie ihn eingerichtet haben, und können ihn nicht mehr ausschalten.

## Meine Sitzungen

Die Karte zeigt alle Browser, in denen Ihr Konto angemeldet ist: Browser und System, wann zuletzt etwas getan wurde, seit wann die Sitzung besteht und – wenn die Anwendung hinter einem
Reverse-Proxy läuft – den **groben Teil der Adresse** (zum Beispiel `192.168.1.x`; die vollständige Adresse wird nicht gespeichert). Ihre **aktuelle Sitzung** ist markiert.
Eine fremde oder vergessene Sitzung beenden Sie mit **Beenden**.

**Überall abmelden** beendet alle Sitzungen des Kontos (auch diese), vergisst alle bekannten Geräte und widerruft die **API-Tokens** des Kontos. Danach melden Sie sich neu an.

**Abmelden nach Leerlauf:** Die Administration kann einstellen, dass Sitzungen nach einer Anzahl Stunden ohne Aufruf enden (Einstellungen → Sicherheit, Standard: aus). Nach der
erneuten Anmeldung geht es **auf derselben Seite** weiter, und nicht gespeicherte Eingaben in Formularen bleiben in Ihrem Browser erhalten (nie Passwörter). Beim ausdrücklichen **Abmelden**
werden sie gelöscht.

## Bekannte Geräte

Wer sich ohne Pause mit Ihrem Benutzernamen anzumelden versucht, löst eine Wartezeit für **das Konto** aus (höchstens 90 Sekunden), die auch Sie auf neuen Geräten abwarten müssen.
Auf einem **Gerät, das Sie bei der Anmeldung mit „Dieses Gerät merken“ gespeichert haben**, entfällt diese Wartezeit; für falsche Eingaben von dort gilt eine eigene Wartezeit (auch nach einem Neustart
des Servers).

* **Nur auf eigenen Geräten ankreuzen.** Das Merken ist ein Häkchen bei der Anmeldung und nie automatisch. Auf fremden oder gemeinsam genutzten Rechnern bleibt es aus.
* **Verwalten:** Die Karte **Bekannte Geräte** listet die gemerkten Browser (höchstens 10). Mit **Vergessen** nehmen Sie ein Gerät wieder heraus – auch das, an dem Sie gerade sitzen.
  **Abmelden und dieses Gerät vergessen** im Benutzer-Menü macht beides auf einmal.
* **Sie verdrängen sich nicht selbst:** Ein neues Gerät ersetzt nur ein Gerät, das nie wieder benutzt wurde. Sind alle 10 Plätze mit benutzten Geräten belegt, wird das neue nicht gemerkt –
  vergessen Sie dann ein altes.
* Geräte werden auch vergessen, wenn das Passwort geändert, das Konto deaktiviert oder der Notzugang benutzt wird.

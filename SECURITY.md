# Sicherheit – RojkoMoney

Diese Seite verarbeitet Börsendaten, steuert zwei Demo-Bots bei eToro und kennt auf Ihrem Gerät Ihr Portfolio.
Hier steht, wie das geschützt ist, was bei jeder Änderung automatisch geprüft wird und was Sie selbst tun können.

## Was geschützt ist

**Schlüssel und Kanal (eToro, Finnhub, ntfy)**
- Die Schlüssel (`ETORO_*`, `FINNHUB_API_KEY`), der ntfy-Kanal und die Push-Liste liegen nur als GitHub-Secrets, nie im Repository und nie in Protokollen.
- Jedes Skript schickt sie nur an seine eine erlaubte Adresse: public-api.etoro.com, finnhub.io bzw. ntfy.sh.
- Auch Abrufe ohne Schlüssel (EZB, FRED, die eigenen Daten auf GitHub) gehen nur an ihre festen Adressen.
- Das geschieht nur per HTTPS, ohne Weiterleitungen und mit Zeitlimit. Andere Adressen lehnt das Skript ab, bevor etwas gesendet wird.
- Der eToro-Schlüssel für Daten darf nur lesen. Die Bot-Schlüssel dürfen nur im Demokonto handeln („Trading – Demo“).

**Echtgeld ist gesperrt**
- In beiden Bots steht `REAL_MONEY_UNLOCKED = false`.
- Die Sicherheitsprüfung schlägt bei jeder Änderung fehl, falls das jemand ändert.

**Ihre persönlichen Daten**
- Portfolio, Journal, Merkliste, Kursalarme und Vermögensprofil bleiben im Browser.
- Die Push-Liste für das Handy liegt nur als Secret.
- Der Zwischenstand der Kursalarme ist verschlüsselt (AES-256-GCM).
- Die Umsatzlisten von Trade Republic und Scalable Capital liest die Seite nur im Browser. Der Import enthält keinen Code, der etwas sendet; der Sicherheits-Check prüft das.
- Öffentliche Daten und Protokolle enthalten keine Beträge und keine eigenen Positionen.

**Anmeldung und Synchronisierung (sobald eingerichtet, siehe LOGIN.md)**
- Anmelden können sich nur Eingeladene: Die Registrierung ist aus, die App ruft sie nie auf und fragt Codes mit `create_user: false` an.
- Anmelde-Passwort und Sync-Passwort sind getrennt. Das Anmelde-Passwort prüft Supabase, das Sync-Passwort verlässt das Gerät nie.
- Ein Anmelde-Link, den das Gerät nicht selbst angefordert hat, gilt erst nach einer Rückfrage, die das Konto nennt. So kann niemand jemanden unbemerkt in ein fremdes Konto schieben, in das dann dessen Daten wandern würden.
- Die eigenen Daten verlassen das Gerät nur verschlüsselt (AES-256-GCM). Der Schlüssel entsteht aus dem Sync-Passwort (PBKDF2-SHA-256, 310.000 Runden) und bleibt nicht exportierbar im Browser. Das Passwort selbst wird nie übertragen oder gespeichert.
- Die Zugriffsregeln in der Datenbank (Row Level Security) lassen jeden Nutzer nur seine eigenen Zeilen lesen und schreiben. Die Besitzer-Rolle kann ein Nutzer nicht selbst setzen.
- In `data/login.json` steht nur der öffentliche Schlüssel. Ein geheimer Schlüssel (service_role, sb_secret_) wird von der Seite ignoriert und vom Sicherheits-Check abgelehnt.
- Anmeldedaten kommen nie in eine Sicherungsdatei. Anfragen mit Zugang gehen nur an die eingerichtete Supabase-Adresse, ohne Weiterleitungen.
- Bots & Copy-Trading werden für andere ausgeblendet. Geheim sind sie dadurch nicht, denn die Bot-Daten liegen ohnehin öffentlich auf GitHub.

**GitHub-Abläufe**
- Kein Ablauf hat oben Rechte. Schreiben darf nur der Job, der Daten speichert.
- Fremde Bausteine sind mit fester Prüfsumme festgenagelt.
- Der Checkout hält kein Token, außer bei dem einen Job, der die Tagesempfehlung selbst pusht.
- Werte von außen gelangen nie direkt in Befehle.
- Jeder Job hat ein Zeitlimit. Es gibt keine Auslöser, mit denen fremder Code mit Rechten liefe.

**Die Seite**
- Eine Schutzregel (Content Security Policy) erlaubt Skripte nur von der Seite selbst und von TradingView.
- Eingeschleuster Code, Ereignis-Code und `javascript:`-Links werden blockiert.
- Alle Texte aus Daten (Namen, Schlagzeilen, Notizen) werden vor der Anzeige entschärft.
- Links zu Artikeln gibt es nur mit http- oder https-Adresse.

## Automatische Prüfungen (bei jeder Änderung)

- `tests/security.mjs` prüft:
  - die Abläufe: Prüfsummen, Rechte, Einschleusen, Zeitlimits und Token;
  - die Schutzregel der Seite, ob irgendwo `eval` steht und ob Links in neuen Fenstern sicher geöffnet werden;
  - die Zieladressen der Skripte, die Echtgeld-Sperre und ob ein Protokoll Schlüssel, ntfy-Kanal oder Push-Liste zeigt;
  - ob im Repository Schlüssel bekannter Formate oder fest eingetragene Secret-Werte stehen.
- `tests/browser/test-xss.js` speist präparierte HTML-Texte in alle Datenquellen und in den Browser-Speicher ein und öffnet dann alle Bereiche. Nirgends darf daraus HTML werden.
- `tests/browser/test-login.js` spielt die Anmeldung gegen ein nachgebautes Supabase durch:
  - Nur Eingeladene kommen hinein, mit Code oder mit Passwort, und das Anmelde-Passwort lässt sich ändern.
  - Ein untergeschobener Anmelde-Link meldet ohne Bestätigung nicht an.
  - Im Konto liegt nur Verschlüsseltes, und das Passwort wird nie übertragen.
  - Die Daten kommen auf einem zweiten Gerät an.
  - Bots sehen nur Besitzer.
  - Ein geheimer Schlüssel in der Einrichtung schaltet die Anmeldung ab.
- Dependabot schlägt einmal im Monat Sicherheitsupdates für die GitHub-Bausteine vor.

## Was Sie selbst tun sollten

1. **Zwei-Faktor-Anmeldung** einschalten: bei GitHub, eToro, Finnhub und Ihrem E-Mail-Konto.
2. **GitHub → Settings → Code security**: „Secret scanning“ und „Push protection“ einschalten. Dann lehnt GitHub ab, wenn versehentlich ein Schlüssel hochgeladen wird.
3. **GitHub → Settings → Actions → General**: nur von GitHub erstellte Bausteine erlauben („Allow actions created by GitHub“). Mehr braucht die Seite nicht.
4. **Schlüssel erneuern**: einmal im Jahr, und sofort bei jedem Verdacht.
   - Neuen Schlüssel bei eToro bzw. Finnhub erzeugen.
   - Unter GitHub → Settings → Secrets eintragen.
   - Den alten Schlüssel löschen.
5. **Keine weiteren GitHub-Pages-Seiten mit fremdem Code** unter diesem Konto. Alle Pages-Seiten eines Kontos teilen sich dieselbe Adresse und damit den Browser-Speicher. Fremder Code dort könnte Ihr Portfolio lesen.
6. **Sicherungsdateien nur aus eigener Hand laden**, und den **ntfy-Kanalnamen wie ein Passwort** behandeln. Wer ihn kennt, kann Ihre Handy-Meldungen mitlesen.
7. **Schlüssel nie in einen Chat, eine E-Mail oder ein Issue kopieren**, sondern nur in GitHub-Secrets.

## Grenzen

- GitHub Pages erlaubt keine eigenen Kopfzeilen. Deshalb steht die Schutzregel im Seitenkopf.
- Ein Verbot des Einbettens in fremde Seiten ist so nicht möglich. Moderne Browser geben eingebetteten fremden Seiten aber einen eigenen, leeren Speicher.
- TradingView-Diagramme laden Code von TradingView. Diesem Anbieter muss die Seite vertrauen.

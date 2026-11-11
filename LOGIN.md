# Anmeldung für Freunde einrichten (Supabase)

Einmalig, etwa 15 Minuten, kostenlos. Danach gilt in RojkoMoney:

- Anmeldung nur auf Einladung, mit E-Mail und einem Anmelde-Passwort, das Sie beim Einladen festlegen. Auf Wunsch geht es auch mit einem Code aus der E-Mail (Schritt 7).
- Portfolio, Journal, Merkliste, Kursalarme, Vermögen, Sparplan und Seiten-Einstellungen sind auf allen Geräten gleich.
- Diese Daten werden Ende-zu-Ende verschlüsselt, mit einem eigenen Sync-Passwort jedes Nutzers. Auch Supabase und Sie als Projektbesitzer sehen nur Zeichensalat.
- Bots & Copy-Trading sieht nur Ihr Konto.

Die App selbst und die Marktdaten bleiben öffentlich, das lässt GitHub Pages nicht anders zu. Ohne Anmeldung bleiben die Daten wie bisher nur im Browser.

## 1. Projekt anlegen

1. Auf supabase.com ein Konto anlegen, am besten gleich mit Zwei-Faktor-Anmeldung.
2. **New project**:
   - Name z. B. `rojkomoney`.
   - Region **Central EU (Frankfurt)**.
   - Ein starkes Datenbank-Passwort, nur in Ihrem Passwort-Manager.
   - Bei den Sicherheits-Optionen die **Data API** eingeschaltet lassen.

## 2. Nur auf Einladung

- **Authentication → Sign In / Providers**: „Allow new users to sign up“ **ausschalten**. E-Mail als Anmeldeweg bleibt an.
- **Authentication → URL Configuration**: als Site URL und unter Redirect URLs eintragen:
  `https://shg9d54y9j-langw.github.io/Anna-test/`

## 3. Tabellen und Zugriffsregeln anlegen

**SQL Editor → New query**, alles einfügen und auf **Run** drücken:

```sql
-- Verschlüsselte Daten je Nutzer: jeder liest und schreibt nur die eigenen Zeilen
create table if not exists public.user_data (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  k text not null check (char_length(k) between 1 and 64),
  v text not null check (char_length(v) <= 3000000),
  updated_at timestamptz not null default now(),
  primary key (user_id, k)
);
alter table public.user_data enable row level security;
create policy "eigene Daten lesen"   on public.user_data for select to authenticated using (auth.uid() = user_id);
create policy "eigene Daten anlegen" on public.user_data for insert to authenticated with check (auth.uid() = user_id);
create policy "eigene Daten ändern"  on public.user_data for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "eigene Daten löschen" on public.user_data for delete to authenticated using (auth.uid() = user_id);

-- Rolle je Nutzer (Besitzer sieht Bots & Copy-Trading): nur lesbar für den Nutzer selbst, ändern nur Sie hier im SQL-Editor
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  role text not null default 'user' check (role in ('user', 'owner'))
);
alter table public.profiles enable row level security;
create policy "eigene Rolle lesen" on public.profiles for select to authenticated using (auth.uid() = id);

-- Rechte ausdrücklich setzen: neue Projekte geben Tabellen nicht mehr von selbst frei.
-- Nicht angemeldete Besucher bekommen gar keinen Zugriff, Angemeldete nur das Nötige.
revoke all on public.user_data, public.profiles from anon, authenticated;
grant select, insert, update, delete on public.user_data to authenticated;
grant select on public.profiles to authenticated;
```

## 4. Sich selbst anlegen und Besitzer werden

1. **Authentication → Users → Add user → Create new user**:
   - Ihre E-Mail.
   - Ein starkes Anmelde-Passwort aus dem Passwort-Manager.
   - „Auto Confirm User“ anhaken.
2. Im **SQL Editor** ausführen, mit Ihrer E-Mail:

```sql
insert into public.profiles (id, role)
select id, 'owner' from auth.users where email = 'IHRE-EMAIL'
on conflict (id) do update set role = 'owner';
```

## 5. In die App eintragen

1. In Supabase die **Project URL** und den **öffentlichen** Schlüssel holen.
   - Beides zeigt der Knopf **Connect** oben im Projekt. Den Schlüssel gibt es auch unter **Project Settings → API Keys**.
   - Der öffentliche Schlüssel heißt „Publishable key“ (`sb_publishable_…`) oder „anon public“ (beginnt mit `eyJ…`).
   - **Nie** den Schlüssel „Secret key“ (`sb_secret_…`) oder „service_role“ nehmen. Der Sicherheits-Check der App lehnt ihn ab, und die Seite benutzt ihn nicht.
2. Auf GitHub die Datei `data/login.json` öffnen, auf das Stift-Symbol tippen und beide Werte eintragen:
   ```json
   "url": "https://xxxxxxxx.supabase.co",
   "anonKey": "sb_publishable_…"
   ```
   Dann **Commit changes**. Der öffentliche Schlüssel darf in die Datei, er steht ohnehin sichtbar in der Seite. Geschützt wird über die Regeln aus Schritt 3. Bitte trotzdem nicht in einen Chat kopieren.
3. Die App neu laden und oben rechts auf das Personen-Symbol tippen.
   - Mit E-Mail und Anmelde-Passwort anmelden.
   - Ein **Sync-Passwort** festlegen (mindestens 10 Zeichen, anders als das Anmelde-Passwort). Bitte gut merken oder im Passwort-Manager speichern.
   - Auf Ihren anderen Geräten genauso anmelden.

## 6. Freunde einladen

1. **Authentication → Users → Add user → Create new user**:
   - Die E-Mail des Freundes.
   - Ein Start-Passwort, mindestens 12 zufällige Zeichen.
   - „Auto Confirm User“ anhaken. Es geht keine E-Mail hinaus.
2. Den Link zur App schicken: Personen-Symbol → **Teilen**. Das Start-Passwort getrennt davon schicken, zum Beispiel in einem anderen Messenger oder persönlich.
3. Ihr Freund meldet sich mit E-Mail und Start-Passwort an und legt sein eigenes Sync-Passwort fest. Seine Daten kann niemand außer ihm lesen.
4. Danach ändert er unter **Anmelde-Passwort ändern** das Start-Passwort, das ja auch Sie kennen.

Entfernen: Authentication → Users → Nutzer löschen. Seine Daten verschwinden mit (`on delete cascade`).

## 7. Optional: Anmelden mit Code per E-Mail

Wer das Anmelde-Passwort nicht zur Hand hat, lässt das Feld leer und bekommt einen Code per E-Mail. Dafür:

1. **Authentication → Emails → Templates → Magic Link**: in den Text `{{ .Token }}` einfügen, zum Beispiel:
   > Ihr Anmelde-Code für RojkoMoney: **{{ .Token }}**

   Der Link in der Vorlage darf bleiben. Kommt ein Link auf einem Gerät an, das den Code nicht selbst angefordert hat, fragt die App vorher nach.
2. **Mailversand**: Der kostenlose Versand von Supabase schickt nur an Mitglieder Ihres Supabase-Teams und nur wenige Mails pro Stunde. Für Sie selbst reicht das, wenn Ihr Supabase-Konto dieselbe E-Mail hat.
   - Für Freunde braucht es einen eigenen Mailversand unter **Authentication → Emails → SMTP Settings**, zum Beispiel Brevo (kostenlos bis 300 Mails am Tag).
   - Dort eintragen: Host `smtp-relay.brevo.com`, Port `587`, den SMTP-Benutzer und SMTP-Schlüssel aus Brevo und als Absender eine bei Brevo bestätigte Adresse.
   - Den SMTP-Schlüssel nur dort eintragen, nie in einen Chat oder ins Repository.

Ohne eigenen Mailversand zeigt die App Freunden einen klaren Hinweis, sich mit dem Anmelde-Passwort anzumelden.

## Gut zu wissen

- **Zwei Passwörter, zwei Aufgaben:**
  - Das **Anmelde-Passwort** öffnet das Konto. Supabase prüft es, und anfangs kennt es auch der Einladende.
  - Das **Sync-Passwort** verschlüsselt die Daten. Es verlässt das Gerät nie, und nur der Nutzer kennt es.
- **Anmelde-Passwort vergessen:** Sie setzen im SQL Editor ein neues Start-Passwort, die Daten bleiben erhalten:
  ```sql
  update auth.users set encrypted_password = extensions.crypt('NEUES-START-PASSWORT', extensions.gen_salt('bf'))
  where email = 'freund@example.com';
  ```
- **Sync-Passwort vergessen:** Die verschlüsselten Daten im Konto lassen sich nicht wiederherstellen. Die Daten auf den Geräten bleiben, und eine Sicherungsdatei (Portfolio → Sicherung) hilft zusätzlich.
- **Erstes Anmelden auf einem Gerät, das schon eigene Daten hat:** Die App fragt, ob die Daten aus dem Konto oder die des Geräts gelten. Der bisherige Stand bleibt eine Woche lang über „Rückgängig“ erhalten.
- **Ruhepause:** Kostenlose Projekte pausieren nach etwa einer Woche ohne Nutzung. Mit einem Klick im Supabase-Dashboard läuft es wieder, die Daten bleiben erhalten.
- **Datenschutz:** Bei Supabase liegen nur E-Mail-Adressen und verschlüsselte Daten, auf EU-Servern. Für einen privaten Kreis eingeladener Freunde braucht es keine öffentliche Datenschutzerklärung. Sobald jeder sich anmelden könnte, schon.

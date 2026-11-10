#!/usr/bin/env bash
# Prüft scripts/publish-stock-data.sh gegen ein lokales Test-Repository: erster Lauf, die Papier-Bilanz wird übernommen,
# ein fehlschlagender Planer lässt den alten Plan stehen, ein nicht erreichbarer Zweig oder zu wenige Werte veröffentlichen nichts.
# Aufruf: bash tests/check-publish.sh <stocks.json>
set -euo pipefail
stocks=$1
root=$(cd "$(dirname "$0")/.." && pwd)
tmp=$(mktemp -d)
git init -q --bare "$tmp/remote.git"
export STOCKS_FILE="$stocks" REMOTE="file://$tmp/remote.git" PUSH_URL="file://$tmp/remote.git" REPO_DIR="$root"
fail() { echo "::error::Veröffentlichen: $1"; exit 1; }
started() { git --git-dir="$tmp/remote.git" show stock-data:swing.json | node -e 'let s = ""; process.stdin.on("data", d => s += d).on("end", () => console.log(JSON.parse(s).ledger.startedAt))'; }

# 1. Erster Lauf: Zweig entsteht mit beiden Dateien
bash "$root/scripts/publish-stock-data.sh" > "$tmp/1.log" || { cat "$tmp/1.log"; fail "erster Lauf fehlgeschlagen"; }
git --git-dir="$tmp/remote.git" show stock-data:stocks.json > /dev/null || fail "stocks.json fehlt"
[ -n "$(started)" ] || fail "swing.json ohne Bilanz"

# 2. Bisherige Bilanz (erfundener Start) muss übernommen werden
git clone -q -b stock-data "$tmp/remote.git" "$tmp/edit"
node -e 'const f = process.argv[1], fs = require("fs"), d = JSON.parse(fs.readFileSync(f, "utf8")); d.ledger.startedAt = "2020-01-01"; fs.writeFileSync(f, JSON.stringify(d));' "$tmp/edit/swing.json"
git -C "$tmp/edit" -c user.name=t -c user.email=t@example.com commit -qam "alte Bilanz"
git -C "$tmp/edit" push -q origin stock-data
bash "$root/scripts/publish-stock-data.sh" > "$tmp/2.log" || { cat "$tmp/2.log"; fail "zweiter Lauf fehlgeschlagen"; }
[ "$(started)" = "2020-01-01" ] || fail "Bilanz nicht übernommen (Start $(started))"

# 3. Planer schlägt fehl (kaputte Firmen-Datei): der bisherige Plan bleibt stehen, die Aktien-Daten kommen trotzdem
mkdir -p "$tmp/fake/scripts" "$tmp/fake/data"
cp "$root/scripts/swing-planner.mjs" "$tmp/fake/scripts/"
printf '{kaputt' > "$tmp/fake/data/firms.json"
REPO_DIR="$tmp/fake" bash "$root/scripts/publish-stock-data.sh" > "$tmp/3.log" 2>&1 || { cat "$tmp/3.log"; fail "Lauf mit kaputtem Planer abgebrochen"; }
grep -q "bisherige Plan bleibt stehen" "$tmp/3.log" || fail "keine Warnung bei kaputtem Planer"
[ "$(started)" = "2020-01-01" ] || fail "Plan bei kaputtem Planer verloren"

# 3b. Note-Bilanz: neue Dateien werden veröffentlicht, ohne neue bleibt der alte Stand, weniger Messtage oder kaputte Dateien
#     ersetzen ihn nicht
notes() { git --git-dir="$tmp/remote.git" show "stock-data:$1" 2> /dev/null | node -e 'let s = ""; process.stdin.on("data", d => s += d).on("end", () => { try { const d = JSON.parse(s); console.log(d.snaps ? d.snaps.length : d.days); } catch { console.log("fehlt"); } })'; }
mkdir -p "$tmp/n2" "$tmp/n1" "$tmp/nbad"
echo '{"v":1,"snaps":[{"d":"2026-11-09","n":{"A":50}},{"d":"2026-11-10","n":{"A":60}}]}' > "$tmp/n2/note-history.json"
echo '{"days":2,"horizons":[]}' > "$tmp/n2/note-track.json"
echo '{"dates":{"now":"2026-11-10"},"n":{"A":[60,50,null,null,null]}}' > "$tmp/n2/note-recent.json"
echo '{"v":1,"snaps":[{"d":"2026-11-10","n":{"A":60}}]}' > "$tmp/n1/note-history.json"
echo '{"days":1,"horizons":[]}' > "$tmp/n1/note-track.json"
printf '{kaputt' > "$tmp/nbad/note-history.json"
echo '{"days":9,"horizons":[]}' > "$tmp/nbad/note-track.json"
NOTES_DIR="$tmp/n2" bash "$root/scripts/publish-stock-data.sh" > "$tmp/n.log" || { cat "$tmp/n.log"; fail "Lauf mit Note-Bilanz fehlgeschlagen"; }
[ "$(notes note-history.json)" = 2 ] && [ "$(notes note-track.json)" = 2 ] || fail "Note-Bilanz nicht veröffentlicht ($(notes note-history.json))"
bash "$root/scripts/publish-stock-data.sh" > "$tmp/n.log" || fail "Lauf ohne neue Note-Bilanz fehlgeschlagen"
[ "$(notes note-history.json)" = 2 ] || fail "Note-Bilanz ohne neue Dateien verloren"
git --git-dir="$tmp/remote.git" show stock-data:note-recent.json > /dev/null 2>&1 || fail "Notenverlauf ohne neue Dateien verloren"
NOTES_DIR="$tmp/n1" bash "$root/scripts/publish-stock-data.sh" > "$tmp/n.log" || fail "Lauf mit geschrumpfter Note-Bilanz fehlgeschlagen"
[ "$(notes note-history.json)" = 2 ] && [ "$(notes note-track.json)" = 2 ] || fail "geschrumpfte Note-Bilanz hat die alte ersetzt"
grep -q "statt bisher 2 Messtage" "$tmp/n.log" || fail "keine Warnung bei geschrumpfter Note-Bilanz"
NOTES_DIR="$tmp/nbad" bash "$root/scripts/publish-stock-data.sh" > "$tmp/n.log" 2>&1 || fail "Lauf mit kaputter Note-Bilanz abgebrochen"
[ "$(notes note-history.json)" = 2 ] && [ "$(notes note-track.json)" = 2 ] || fail "kaputte Note-Bilanz hat die alte ersetzt"
[ "$(started)" = "2020-01-01" ] || fail "Swing-Bilanz bei den Note-Läufen verloren"

# 4. Zweig nicht erreichbar: nichts veröffentlichen
before=$(git --git-dir="$tmp/remote.git" rev-parse stock-data)
if REMOTE="file://$tmp/fehlt.git" PUSH_URL="file://$tmp/fehlt.git" bash "$root/scripts/publish-stock-data.sh" > "$tmp/4.log" 2>&1; then fail "nicht erreichbarer Zweig trotzdem veröffentlicht"; fi
grep -q "nicht erreichbar" "$tmp/4.log" || { cat "$tmp/4.log"; fail "keine Meldung bei nicht erreichbarem Zweig"; }

# 5. Zu wenige Werte: nichts veröffentlichen
node -e 'const d = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); d.items = d.items.slice(0, 10); process.stdout.write(JSON.stringify(d));' "$stocks" > "$tmp/small.json"
if STOCKS_FILE="$tmp/small.json" bash "$root/scripts/publish-stock-data.sh" > "$tmp/5.log" 2>&1; then fail "zu wenige Werte trotzdem veröffentlicht"; fi
[ "$(git --git-dir="$tmp/remote.git" rev-parse stock-data)" = "$before" ] || fail "Zweig trotz Abbruch verändert"
echo "Veröffentlichen geprüft: erster Lauf, Bilanz übernommen, kaputter Planer lässt den Plan stehen, Note-Bilanz nur vollständig und nie kürzer, Abbruch ohne Zweig und bei zu wenigen Werten."

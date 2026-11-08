#!/usr/bin/env bash
# Prüft scripts/publish-stock-data.sh gegen ein lokales Test-Repository: erster Lauf, die Papier-Bilanz wird übernommen,
# ein fehlschlagender Planer lässt den alten Plan stehen, ein nicht erreichbarer Zweig oder zu wenige Werte veröffentlichen nichts.
# Aufruf: bash tests/check-publish.sh <stocks.json>
set -euo pipefail
stocks=$1
root=$(cd "$(dirname "$0")/.." && pwd)
tmp=$(mktemp -d)
git init -q --bare "$tmp/remote.git"
STOCKS_B64=$(gzip -9c "$stocks" | base64 -w0)
export STOCKS_B64 REMOTE="file://$tmp/remote.git" PUSH_URL="file://$tmp/remote.git" REPO_DIR="$root"
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

# 4. Zweig nicht erreichbar: nichts veröffentlichen
before=$(git --git-dir="$tmp/remote.git" rev-parse stock-data)
if REMOTE="file://$tmp/fehlt.git" PUSH_URL="file://$tmp/fehlt.git" bash "$root/scripts/publish-stock-data.sh" > "$tmp/4.log" 2>&1; then fail "nicht erreichbarer Zweig trotzdem veröffentlicht"; fi
grep -q "nicht erreichbar" "$tmp/4.log" || { cat "$tmp/4.log"; fail "keine Meldung bei nicht erreichbarem Zweig"; }

# 5. Zu wenige Werte: nichts veröffentlichen
small=$(node -e 'const d = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); d.items = d.items.slice(0, 10); process.stdout.write(JSON.stringify(d));' "$stocks" | gzip -9c | base64 -w0)
if STOCKS_B64="$small" bash "$root/scripts/publish-stock-data.sh" > "$tmp/5.log" 2>&1; then fail "zu wenige Werte trotzdem veröffentlicht"; fi
[ "$(git --git-dir="$tmp/remote.git" rev-parse stock-data)" = "$before" ] || fail "Zweig trotz Abbruch verändert"
echo "Veröffentlichen geprüft: erster Lauf, Bilanz übernommen, kaputter Planer lässt den Plan stehen, Abbruch ohne Zweig und bei zu wenigen Werten."

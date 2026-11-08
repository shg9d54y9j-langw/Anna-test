#!/usr/bin/env bash
# Veröffentlicht die Aktien-Daten (stocks.json) und den Swing-Plan (swing.json) auf dem Zweig stock-data – ohne eToro-Schlüssel.
# Der Swing-Planer rechnet hier aus den frischen Kennzahlen und dem bisherigen Plan (mit der Papier-Bilanz) den neuen Plan.
# Ist der bisherige Plan nicht lesbar, wird nichts veröffentlicht – sonst ginge die Bilanz verloren.
# Erwartet: STOCKS_B64 (gzip + base64), REMOTE (zum Lesen), PUSH_URL (zum Schreiben), REPO_DIR (Checkout mit scripts/ und data/).
set -euo pipefail
work=$(mktemp -d)
cd "$work"
printf '%s' "$STOCKS_B64" | base64 -d | gunzip > stocks.json
# ${…} gehört zum JavaScript, nicht zur Shell:
# shellcheck disable=SC2016
node -e '
  const d = JSON.parse(require("fs").readFileSync("stocks.json", "utf8"));
  if (!Array.isArray(d.items) || d.items.length < 50) { console.log("::error::Zu wenige Werte – nichts veröffentlicht"); process.exit(1); }
  console.log(`${d.items.length} Werte`);
'
git init -q -b stock-data

# Bisherigen Swing-Plan holen: Zweig fehlt (Code 2) = erster Lauf; nicht erreichbar = abbrechen
code=0
git ls-remote --exit-code -q "$REMOTE" refs/heads/stock-data > /dev/null 2>&1 || code=$?
if [ "$code" = 0 ]; then
  for i in 1 2 3; do
    git fetch -q --depth=1 "$REMOTE" stock-data && break
    if [ "$i" = 3 ]; then echo "::error::Zweig stock-data nicht lesbar – nichts veröffentlicht, damit die Bilanz erhalten bleibt"; exit 1; fi
    sleep $((i * 4))
  done
  if ! git show FETCH_HEAD:swing.json > prev-swing.json 2> /dev/null; then
    rm -f prev-swing.json
    echo "Noch kein Swing-Plan – die Bilanz beginnt heute."
  fi
elif [ "$code" = 2 ]; then
  echo "Zweig stock-data gibt es noch nicht – die Bilanz beginnt heute."
else
  echo "::error::Zweig stock-data nicht erreichbar – nichts veröffentlicht"
  exit 1
fi

# Swing-Planer ohne Schreibrecht im Umfeld; schlägt er fehl, bleibt der bisherige Plan stehen
if env -u PUSH_URL -u GH_TOKEN STOCKS_IN=stocks.json FIRMS_IN="$REPO_DIR/data/firms.json" PREV_IN=prev-swing.json SWING_OUT=swing.json \
  node "$REPO_DIR/scripts/swing-planner.mjs"; then
  :
elif [ -f prev-swing.json ]; then
  echo "::warning::Swing-Planer fehlgeschlagen – der bisherige Plan bleibt stehen"
  cp prev-swing.json swing.json
else
  echo "::warning::Swing-Planer fehlgeschlagen – noch kein Plan"
fi
rm -f prev-swing.json

git add stocks.json
if [ -f swing.json ]; then git add swing.json; fi
git -c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" commit -qm "Aktien-Daten $(date -u +%FT%TZ)"
# GitHub lehnt Pushes selten vorübergehend ab („fatal error in commit_refs“) – dann bis zu fünfmal versuchen
for i in 1 2 3 4 5; do
  git push -fq "$PUSH_URL" HEAD:stock-data && break
  if [ "$i" = 5 ]; then exit 1; fi
  sleep $((i * 4))
done
echo "Veröffentlicht: stocks.json$([ -f swing.json ] && echo " und swing.json")"

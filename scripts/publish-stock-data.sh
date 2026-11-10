#!/usr/bin/env bash
# Veröffentlicht die Aktien-Daten (stocks.json) und den Swing-Plan (swing.json) auf dem Zweig stock-data – ohne eToro-Schlüssel.
# Der Swing-Planer rechnet hier aus den frischen Kennzahlen und dem bisherigen Plan (mit der Papier-Bilanz) den neuen Plan.
# Ist der bisherige Plan nicht lesbar, wird nichts veröffentlicht – sonst ginge die Bilanz verloren.
# Note-Bilanz (note-history.json, note-track.json aus scripts/note-track.mjs): neue Dateien aus NOTES_DIR, sonst bleibt der
# bisherige Stand; die gespeicherten Noten dürfen dabei nie weniger werden.
# Erwartet: STOCKS_FILE (die frischen Kennzahlen), REMOTE (zum Lesen), PUSH_URL (zum Schreiben), REPO_DIR (Checkout mit scripts/ und data/);
# optional NOTES_DIR (Ordner mit den neuen Dateien der Note-Bilanz).
set -euo pipefail
work=$(mktemp -d)
cp "$STOCKS_FILE" "$work/stocks.json"
cd "$work"
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
fetched=false
git ls-remote --exit-code -q "$REMOTE" refs/heads/stock-data > /dev/null 2>&1 || code=$?
if [ "$code" = 0 ]; then
  for i in 1 2 3; do
    git fetch -q --depth=1 "$REMOTE" stock-data && break
    if [ "$i" = 3 ]; then echo "::error::Zweig stock-data nicht lesbar – nichts veröffentlicht, damit die Bilanz erhalten bleibt"; exit 1; fi
    sleep $((i * 4))
  done
  fetched=true
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

# Note-Bilanz: neue Dateien nur, wenn beide lesbar sind und nicht weniger Messtage enthalten als bisher
prev_notes=""
if [ "$fetched" = true ] && git show FETCH_HEAD:note-history.json > prev-notes.json 2> /dev/null; then prev_notes=prev-notes.json; else rm -f prev-notes.json; fi
keep_notes() {
  if [ "$fetched" = true ] && git show FETCH_HEAD:note-history.json > note-history.json 2> /dev/null && git show FETCH_HEAD:note-track.json > note-track.json 2> /dev/null; then
    git show FETCH_HEAD:note-recent.json > note-recent.json 2> /dev/null || rm -f note-recent.json
    echo "Note-Bilanz: bisheriger Stand bleibt."
  else
    rm -f note-history.json note-track.json note-recent.json
  fi
}
if [ -n "${NOTES_DIR:-}" ] && [ -f "$NOTES_DIR/note-history.json" ] && [ -f "$NOTES_DIR/note-track.json" ]; then
  # shellcheck disable=SC2016
  if node -e '
    const fs = require("fs"), [h, t, p] = process.argv.slice(1);
    const H = JSON.parse(fs.readFileSync(h, "utf8")), T = JSON.parse(fs.readFileSync(t, "utf8"));
    if (!Array.isArray(H.snaps) || !Array.isArray(T.horizons)) { console.log("::warning::Note-Bilanz im falschen Format"); process.exit(1); }
    let prev = 0;
    if (p) { try { prev = JSON.parse(fs.readFileSync(p, "utf8")).snaps.length; } catch { prev = 0; } }
    if (H.snaps.length < Math.min(prev, 259)) { console.log(`::warning::Note-Bilanz: ${H.snaps.length} statt bisher ${prev} Messtage`); process.exit(1); }
    console.log(`Note-Bilanz: ${H.snaps.length} Messtage`);
  ' "$NOTES_DIR/note-history.json" "$NOTES_DIR/note-track.json" "$prev_notes"; then
    cp "$NOTES_DIR/note-history.json" "$NOTES_DIR/note-track.json" .
    if [ -f "$NOTES_DIR/note-recent.json" ]; then cp "$NOTES_DIR/note-recent.json" .; fi
  else
    keep_notes
  fi
else
  keep_notes
fi
rm -f prev-notes.json

git add stocks.json
if [ -f swing.json ]; then git add swing.json; fi
if [ -f note-history.json ] && [ -f note-track.json ]; then git add note-history.json note-track.json; fi
if [ -f note-recent.json ]; then git add note-recent.json; fi
git -c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" commit -qm "Aktien-Daten $(date -u +%FT%TZ)"
# GitHub lehnt Pushes selten vorübergehend ab („fatal error in commit_refs“) – dann bis zu fünfmal versuchen
for i in 1 2 3 4 5; do
  git push -fq "$PUSH_URL" HEAD:stock-data && break
  if [ "$i" = 5 ]; then exit 1; fi
  sleep $((i * 4))
done
echo "Veröffentlicht: stocks.json$([ -f swing.json ] && echo ", swing.json")$([ -f note-track.json ] && echo ", Note-Bilanz")"

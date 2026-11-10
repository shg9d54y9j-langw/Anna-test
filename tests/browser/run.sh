#!/usr/bin/env bash
# Browser-Tests (Playwright, Chromium) gegen die Seite aus diesem Checkout: Handy- und Computer-Ansicht, feste Testdaten,
# keine echten Schlüssel. Aufruf: bash tests/browser/run.sh [test.js …] – ohne Angabe alle check-*.js und test-*.js.
# Ein Test gilt als bestanden, wenn er ohne Fehler endet, kein „✗“ oder „FEHLER“ meldet und sein Erfolgszeichen ausgibt.
set -uo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
work=$(mktemp -d)
export FIXTURES_TMP="$work/fixtures"
node "$root/tests/browser/make-fixtures.mjs" "$FIXTURES_TMP" || exit 1

(cd "$root" && exec python3 -m http.server 8811 --bind 127.0.0.1 > /dev/null 2>&1) &
srv=$!
trap 'kill "$srv" 2> /dev/null' EXIT
for _ in $(seq 1 40); do curl -sf -o /dev/null http://127.0.0.1:8811/index.html && break; sleep 0.25; done

mkdir -p "$work/out" "$work/step3" "$work/nt" "$work/bk" "$work/reg"
cd "$work" || exit 1
if [ "$#" -gt 0 ]; then tests=("$@"); else mapfile -t tests < <(cd "$root/tests/browser" && ls check-*.js test-*.js); fi
fail=0
for t in "${tests[@]}"; do
  start=$(date +%s)
  out=$(timeout 300 node "$root/tests/browser/$t" 8811 out 2>&1)
  code=$?
  secs=$(( $(date +%s) - start ))
  if [ "$code" -eq 0 ] && ! grep -q "✗\|FEHLER" <<< "$out" && grep -qE "ALLES OK|Alle Prüfungen bestanden|JS-Fehler:? \[\]" <<< "$out"; then
    echo "✓ $t (${secs} s)"
  else
    echo "::error::Browser-Test $t fehlgeschlagen (Code $code, ${secs} s)"
    tail -40 <<< "$out"
    fail=$((fail + 1))
  fi
done
echo "Browser-Tests: ${#tests[@]} gelaufen, $fail fehlgeschlagen."
[ "$fail" -eq 0 ]

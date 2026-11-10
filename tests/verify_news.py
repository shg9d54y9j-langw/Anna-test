"""Unabhängige Gegenrechnung des Nachrichten-Laufs (scripts/news-data.mjs) gegen den Test-Server.

Holt dieselben Finnhub-Antworten direkt, filtert (Zeitfenster, nur http(s)-Links, ohne Doppelte, neueste zuerst, höchstens 6)
und prüft den erkannten Nachrichtentyp gegen eine eigene Liste der Testschlagzeilen.
Aufruf: python3 tests/verify_news.py <stocks.json> <news-ordner> <http://localhost:PORT>
"""
import datetime
import json
import os
import re
import sys
import time
import urllib.request

stocks = json.load(open(sys.argv[1], encoding="utf-8"))
folder = sys.argv[2]
base = sys.argv[3].rstrip("/")
news = json.load(open(os.path.join(folder, "news.json"), encoding="utf-8"))
errors = []
TYPES = {
    "{n} beats third-quarter estimates as revenue jumps 18%": "earnings_beat", "{n} misses profit estimates, shares slide": "earnings_miss",
    "{n} raises full-year guidance after strong demand": "guidance_up", "{n} cuts outlook on weaker orders": "guidance_down",
    "Analyst upgrades {n} to Buy, sees 25% upside": "upgrade", "{n} downgraded to Underperform at major bank": "downgrade",
    "{n} to acquire rival in $2 billion deal": "merger", "{n} announces $5 billion share buyback": "buyback",
    "{n} faces SEC probe over accounting": "legal", "FDA approves {n} drug for rare disease": "approval",
    "{n} announces layoffs of 1,200 jobs in restructuring": "layoffs", "{n} CEO steps down effective immediately": "management",
    "{n} launches new product line": "product", "{n} prices $500 million stock offering": "offering",
    "{n} raises quarterly dividend by 8%": "dividend", "{n} signs multi-year contract with government agency": "contract",
    "{n} shares are trading higher today": "general",
}
MARKET = {"Fed signals pause as officials weigh rate cuts": "macro_rates", "US inflation cools more than expected in October CPI report": "macro_inflation",
          "Payrolls beat forecasts as unemployment holds at 4.1%": "macro_jobs", "New tariffs on chip imports rattle markets": "tariffs",
          "Oil jumps as OPEC+ extends output cuts": "oil", "Acme Corp to buy Beta Inc for $3 billion": "merger"}


def get(path):
    with urllib.request.urlopen(f"{base}/finnhub{path}&token=test-finnhub-0000", timeout=20) as r:
        return json.loads(r.read().decode("utf-8"))


def expected(rows, lo, hi, n):
    ok = [r for r in rows if lo <= r["datetime"] <= hi and re.match(r"^https?://[^\s\"<>]+$", r.get("url", ""))]
    ok.sort(key=lambda r: -r["datetime"])
    seen, out = set(), []
    for r in ok:
        k = r["headline"].strip().lower()
        if k in seen:
            continue
        seen.add(k)
        out.append(r)
        if len(out) >= n:
            break
    return out


now = int(time.time())
day = lambda s: datetime.datetime.fromtimestamp(s, datetime.timezone.utc).strftime("%Y-%m-%d")
us = [x for x in stocks["items"] if x["type"] == "Aktie" and "." not in x["sym"]]
with_news = 0
for x in us:
    sym = x["sym"]
    rows = get(f"/company-news?symbol={sym}&from={day(now - 7 * 86400)}&to={day(now)}")
    want = expected(rows, now - 7 * 86400 - 120, now + 3600, 6)
    path = os.path.join(folder, "co", f"{sym}.json")
    if not want:
        if os.path.exists(path):
            errors.append(f"{sym}: Datei ohne Nachrichten beim Test-Server")
        continue
    with_news += 1
    if not os.path.exists(path):
        errors.append(f"{sym}: Nachrichten fehlen")
        continue
    got = json.load(open(path, encoding="utf-8"))["items"]
    if [n["t"] for n in got] != [r["headline"] for r in want]:
        errors.append(f"{sym}: Schlagzeilen {[n['t'][:20] for n in got]} statt {[r['headline'][:20] for r in want]}")
        continue
    for n, r in zip(got, want):
        key = r["headline"].replace(x["name"], "{n}") if x.get("name") else r["headline"]
        if key in TYPES and n["type"] != TYPES[key]:
            errors.append(f"{sym}: „{r['headline'][:40]}“ als {n['type']} statt {TYPES[key]}")
        if not n["u"].startswith(("https://", "http://")) or "<" in n["sum"] or "&amp;" in n["sum"]:
            errors.append(f"{sym}: Link oder Kurzfassung nicht bereinigt")
        if not n["rel"] or n["rel"][0] != sym:
            errors.append(f"{sym}: Bezug {n['rel']}")
if set(news["syms"]) != {x["sym"] for x in us if os.path.exists(os.path.join(folder, "co", f"{x['sym']}.json"))}:
    errors.append("Liste der Aktien mit Nachrichten passt nicht zu den Dateien")
# Marktnachrichten: allgemein und Übernahmen, 3 Tage, ohne Doppelte
mrows = get("/news?category=general") + get("/news?category=merger")
mwant = expected(mrows, now - 3 * 86400 - 120, now + 3600, 60)
if [n["t"] for n in news["market"]] != [r["headline"] for r in mwant]:
    errors.append(f"Marktnachrichten {[n['t'][:20] for n in news['market']]} statt {[r['headline'][:20] for r in mwant]}")
for n in news["market"]:
    if n["t"] in MARKET and n["type"] != MARKET[n["t"]]:
        errors.append(f"Marktnachricht „{n['t'][:40]}“ als {n['type']} statt {MARKET[n['t']]}")
if len(news["hot"]) > 40 or any(h["rel"][0] not in news["syms"] for h in news["hot"]):
    errors.append("Liste „bewegte Aktien“ fehlerhaft")
if errors:
    print(f"::error::Gegenrechnung Nachrichten fehlgeschlagen – {len(errors)} Abweichung(en):")
    for e in errors[:30]:
        print("  -", e)
    sys.exit(1)
print(f"Gegenrechnung Nachrichten bestanden: {with_news} Aktien mit Firmennachrichten, {len(news['market'])} Marktnachrichten, Typen und Filter stimmen.")

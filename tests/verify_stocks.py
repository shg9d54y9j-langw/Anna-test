"""Unabhängige Gegenrechnung der Aktien-Daten gegen den Test-Server (nur für die automatischen Tests).

Holt dieselben Tageskerzen direkt vom Test-Server und rechnet Trend, Momentum, ATR, Schwankung,
52-Wochen-Spanne, Rückgang und Beta in Python nach. Prüft außerdem Ränge, Filter und die Finnhub-Felder.
Aufruf: python3 tests/verify_stocks.py <stocks.json> <http://localhost:PORT>
"""
import json
import math
import os
import sys
import urllib.request

path, base = sys.argv[1], sys.argv[2].rstrip("/")
d = json.load(open(path, encoding="utf-8"))
HEAD = {"x-api-key": "test", "x-user-key": "test", "x-request-id": "00000000-0000-4000-8000-000000000000"}
errors = []


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=HEAD), timeout=20) as r:
        return json.loads(r.read().decode("utf-8"))


def mean(a):
    return sum(a) / len(a)


def sd(a):
    m = mean(a)
    return math.sqrt(sum((x - m) ** 2 for x in a) / (len(a) - 1))


def candles(iid):
    raw = get(f"{base}/api/v1/market-data/instruments/{iid}/history/candles/desc/OneDay/300")["candles"][0]["candles"]
    rows = [{"d": c["fromDate"][:10], "h": c["high"], "l": c["low"], "c": c["close"]} for c in raw]
    return sorted(rows, key=lambda r: r["d"])


def close(a, b, tol):
    if a is None or b is None:
        return a is None and b is None
    return abs(a - b) <= tol


# Universum vom Test-Server: Beliebtheit aus der Suche, Typ nur aus der offiziellen Instrumentenliste
universe = {it["internalSymbolFull"].upper(): it for it in get(f"{base}/api/v1/market-data/search?fields=x&pageSize=10000")["items"]}
official = {x["instrumentID"]: x for x in get(f"{base}/api/v1/market-data/instruments")["instrumentDisplayDatas"]}
syms = {x["sym"] for x in d["items"]}
if "BAD SYMBOL!" in syms:
    errors.append("ungültiges Symbol nicht herausgefiltert")
for sym, it in universe.items():
    if it.get("isDelisted") and sym in syms:
        errors.append(f"{sym}: nicht mehr gelistet, trotzdem enthalten")
TYPE = {"Aktie": 5, "ETF": 6}
for x in d["items"]:
    o = official.get(universe[x["sym"]]["instrumentId"])
    if not o or o["instrumentTypeID"] != TYPE.get(x["type"]):
        errors.append(f"{x['sym']}: als {x['type']} geführt, offiziell Typ {o and o['instrumentTypeID']}")
    elif o["isInternalInstrument"]:
        errors.append(f"{x['sym']}: nicht öffentlich, trotzdem enthalten")


# Genau die beliebtesten gültigen Werte je Typ, in der gewünschten Anzahl
def valid(it, t):
    o = official.get(it["instrumentId"])
    return (o and o["instrumentTypeID"] == t and not o["isInternalInstrument"] and not it.get("isDelisted")
            and it.get("isActiveInPlatform") is not False and not it.get("isHiddenFromClient")
            and all(ch.isalnum() or ch in ".-_" for ch in it["internalSymbolFull"]))


# Firmen der Theorie-Seite (FIRMS_IN): gültige Aktien darunter gehören immer dazu, auch jenseits der beliebtesten
always = set()
if os.environ.get("FIRMS_IN"):
    fd = json.load(open(os.environ["FIRMS_IN"], encoding="utf-8"))
    always = {s.upper() for s in list(fd.get("firms", {})) + [x for v in fd.get("sectors", {}).values() for x in v]
              + [x for m in fd.get("moon", {}).values() for x in m.get("firms", []) + m.get("saferSyms", [])]}

# Beliebtheit ist ein Rang: 1 = beliebteste, ohne Rang ans Ende
ranked = sorted(universe.values(), key=lambda it: ("popularityUniques7Day" not in it, it.get("popularityUniques7Day", 0), it["instrumentId"]))
for kind, t, env in (("Aktie", 5, "STOCK_COUNT"), ("ETF", 6, "ETF_COUNT")):
    want = {it["internalSymbolFull"].upper() for it in [it for it in ranked if valid(it, t)][:int(os.environ.get(env, "0") or 0)]}
    if kind == "Aktie":
        want |= {it["internalSymbolFull"].upper() for it in ranked if valid(it, t) and it["internalSymbolFull"].upper() in always}
    got = {x["sym"] for x in d["items"] if x["type"] == kind}
    if want and got != want:
        errors.append(f"{kind}: {len(got)} statt {len(want)} der beliebtesten gültigen Werte (fehlen {sorted(want - got)[:5]}, zu viel {sorted(got - want)[:5]})")

spx = get(f"{base}/api/v2/market-data/instruments?symbols=SPX500")["results"][0]["instrumentId"]
sc = candles(spx)
spx_ret = {sc[i]["d"]: math.log(sc[i]["c"] / sc[i - 1]["c"]) for i in range(1, len(sc))}

for x in d["items"]:
    c = candles(universe[x["sym"]]["instrumentId"])
    n = len(c)
    cl = [r["c"] for r in c]
    last = cl[-1]
    at = lambda k: cl[n - 1 - k] if n > k else None
    pct = lambda a, b: (a / b - 1) * 100 if a and b else None
    tr = [max(c[i]["h"] - c[i]["l"], abs(c[i]["h"] - c[i - 1]["c"]), abs(c[i]["l"] - c[i - 1]["c"])) for i in range(max(1, n - 14), n)]
    lr = [math.log(cl[i] / cl[i - 1]) for i in range(1, n)]
    yr = c[-252:]
    hi = max(r["h"] for r in yr)
    eq = peak = 1.0
    mdd = 0.0
    for i in range(max(1, n - 252), n):
        eq *= cl[i] / cl[i - 1]
        peak = max(peak, eq)
        mdd = max(mdd, 1 - eq / peak)
    xs, ys = [], []
    for i in range(max(1, n - 252), n):
        if c[i]["d"] in spx_ret:
            xs.append(spx_ret[c[i]["d"]])
            ys.append(math.log(cl[i] / cl[i - 1]))
    mx, my = mean(xs), mean(ys)
    beta = sum((a - mx) * (b - my) for a, b in zip(xs, ys)) / sum((a - mx) ** 2 for a in xs)
    want = {
        "last": (last, 1e-3), "chg1d": (pct(last, at(1)), 0.011), "ret12m": (pct(last, at(252)), 0.011),
        "mom": (pct(at(21), at(252)) if n > 252 else None, 0.011), "d200": ((last / mean(cl[-200:]) - 1) * 100, 0.011),
        "atr": (mean(tr), 1e-3), "vol20": (sd(lr[-20:]) * math.sqrt(252) * 100, 0.011), "dHi52": ((last / hi - 1) * 100, 0.011),
        "mdd": (mdd * 100, 0.011), "beta": (beta, 0.011),
    }
    for k, (v, tol) in want.items():
        if not close(v, x.get(k), tol):
            errors.append(f"{x['sym']} {k}: Daten {x.get(k)}, Gegenrechnung {v}")
    for k in ("momRank", "vol60Rank"):
        if x.get(k) is not None and not 0 <= x[k] <= 100:
            errors.append(f"{x['sym']} {k} außerhalb 0–100")
    if x["sym"].endswith(".DE") and not x["tv"].startswith("XETR:"):
        errors.append(f"{x['sym']}: TradingView-Symbol {x['tv']}")

# Ränge: höchstes Momentum = Rang 100, niedrigstes = 0
moms = [x for x in d["items"] if x.get("mom") is not None]
if moms:
    top = max(moms, key=lambda x: x["mom"])
    low = min(moms, key=lambda x: x["mom"])
    if top["momRank"] != 100 or low["momRank"] != 0:
        errors.append(f"Momentum-Ränge falsch ({top['momRank']}, {low['momRank']})")
if "an:" in d.get("finnhub", ""):
    us = [x for x in d["items"] if x["type"] == "Aktie" and "." not in x["sym"]]
    if not all("rec" in x for x in us):
        errors.append("Analysten-Übersicht fehlt bei US-Aktien")
    if not any("earn" in x for x in d["items"]):
        errors.append("keine Quartalszahlen-Termine übernommen")
    if not all("recPrev" in x for x in us):
        errors.append("Vormonat der Analysten fehlt (für Hoch- und Herabstufungen)")
    surprises = [x for x in d["items"] if "lastEarn" in x]
    if not surprises:
        errors.append("keine gemeldeten Quartalszahlen übernommen")
    for x in surprises:
        e = x["lastEarn"]
        want = (e["actual"] - e["estimate"]) / abs(e["estimate"]) * 100
        if abs(e["surprisePct"] - want) > 0.011:
            errors.append(f"{x['sym']}: Überraschung {e['surprisePct']} statt {want:.2f}")

if errors:
    print(f"::error::Gegenrechnung Aktien-Daten fehlgeschlagen – {len(errors)} Abweichung(en):")
    for e in errors[:30]:
        print("  -", e)
    sys.exit(1)
print(f"Gegenrechnung Aktien-Daten bestanden: {len(d['items'])} Werte, alle Kennzahlen, Ränge und Filter stimmen.")

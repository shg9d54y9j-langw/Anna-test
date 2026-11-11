"""Unabhängige Gegenrechnung der Aktien-Daten gegen den Test-Server (nur für die automatischen Tests).

Holt dieselben Tageskerzen direkt vom Test-Server und rechnet Trend, Momentum, ATR, Schwankung,
52-Wochen-Spanne, Rückgang und Beta in Python nach. Prüft außerdem Ränge, Filter und die Finnhub-Felder,
und die europäischen Werte: Europa-Quote (EUROPE_COUNT) und Europa-Liste (EUROPE_IN) mit Zusatznamen und Land.
Aufruf: python3 tests/verify_stocks.py <stocks.json> <http://localhost:PORT>
"""
import json
import math
import os
import re
import sys
import unicodedata
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
    rows = [{"d": c["fromDate"][:10], "o": c["open"], "h": c["high"], "l": c["low"], "c": c["close"]} for c in raw]
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
by_symbol = {x["symbolFull"].upper(): x["instrumentID"] for x in official.values()}


def id_of(sym):   # aus der Suche, sonst aus der offiziellen Liste (über das Kürzel nachgeschlagene Firmen)
    return universe[sym]["instrumentId"] if sym in universe else by_symbol.get(sym)


for x in d["items"]:
    o = official.get(id_of(x["sym"]))
    if not o or o["instrumentTypeID"] != TYPE.get(x["type"]):
        errors.append(f"{x['sym']}: als {x['type']} geführt, offiziell Typ {o and o['instrumentTypeID']}")
    elif o["isInternalInstrument"]:
        errors.append(f"{x['sym']}: nicht öffentlich, trotzdem enthalten")


# Genau die beliebtesten gültigen Werte je Typ, in der gewünschten Anzahl
def valid(it, t):
    o = official.get(it["instrumentId"])
    # „nicht aktiv“ (Börse gerade zu) zählt, solange der Wert einen Beliebtheits-Rang hat
    return (o and o["instrumentTypeID"] == t and not o["isInternalInstrument"] and not it.get("isDelisted")
            and (it.get("isActiveInPlatform") is not False or "popularityUniques7Day" in it) and not it.get("isHiddenFromClient")
            and all(ch.isalnum() or ch in ".-_" for ch in it["internalSymbolFull"]))


# Firmen der Theorie-Seite (FIRMS_IN): gültige Aktien darunter gehören immer dazu, auch jenseits der beliebtesten
always = set()
if os.environ.get("FIRMS_IN"):
    fd = json.load(open(os.environ["FIRMS_IN"], encoding="utf-8"))
    always = {s.upper() for s in list(fd.get("firms", {})) + [x for v in fd.get("sectors", {}).values() for x in v]
              + [x for m in fd.get("moon", {}).values() for x in m.get("firms", []) + m.get("saferSyms", [])]}

# Beliebtheit ist ein Rang: 1 = beliebteste, ohne Rang ans Ende
ranked = sorted(universe.values(), key=lambda it: ("popularityUniques7Day" not in it, it.get("popularityUniques7Day", 0), it["instrumentId"]))

# Europa: Börsen am Kürzel, Namen vergleichbar (Umlaute wie ae/oe/ue, ohne Akzente), Wörter ab Wortanfang (bis 3 Zeichen genau)
EU = ["DE", "VI", "PA", "NV", "AS", "BR", "LSB", "LS", "MI", "MC", "ZU", "SW", "ST", "CO", "HE", "OL", "IR", "L"]
UML = {"Ä": "Ae", "ä": "ae", "Ö": "Oe", "ö": "oe", "Ü": "Ue", "ü": "ue"}


def suffix(sym):
    m = re.search(r"\.([A-Z]+)$", str(sym).upper())
    return m.group(1) if m else ""


def norm_name(s):
    s = "".join(UML.get(c, c) for c in str(s or "")).replace("ß", "ss")
    s = "".join(c for c in unicodedata.normalize("NFD", s) if not "\u0300" <= c <= "\u036f").lower()
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def name_matches(name, key):
    n, k = norm_name(name).split(), norm_name(key).split()
    if not k:
        return False
    return any(all((n[i + j] == w) if len(w) <= 3 else n[i + j].startswith(w) for j, w in enumerate(k)) for i in range(len(n) - len(k) + 1))


eu_found, eu_open = {}, []   # Kürzel -> (Eintrag, Land)
if os.environ.get("EUROPE_IN"):
    ed = json.load(open(os.environ["EUROPE_IN"], encoding="utf-8"))
    vs = [(it["internalSymbolFull"].upper(), str(it.get("displayname") or it["internalSymbolFull"])[:60]) for it in ranked if valid(it, 5)]
    names = dict(vs)
    for g in ed["groups"].values():
        pref = g.get("pref") or []
        for e in g.get("items") or []:
            keys = e.get("match") or [e["name"]]
            fits = lambda nm: any(name_matches(nm, k) for k in keys)
            sym = str(e.get("sym") or "").upper()
            hit = sym if sym in names and fits(names[sym]) else None
            if not hit:
                cands = sorted([s for s, nm in vs if suffix(s) in EU and fits(nm)], key=lambda s: pref.index(suffix(s)) if suffix(s) in pref else len(pref))
                hit = cands[0] if cands else None
            if not hit:
                eu_open.append((e, e.get("cc") or g.get("cc")))
            elif hit not in eu_found:
                eu_found[hit] = (e, e.get("cc") or g.get("cc"))
    # was die Suche gar nicht liefert: über das Kürzel, nur mit passendem Namen
    for e, cc in eu_open:
        sym = str(e.get("sym") or "").upper()
        if not sym or sym in universe:
            continue
        hit = [r for r in get(f"{base}/api/v2/market-data/instruments?symbols={sym}")["results"] if r["symbol"].upper() == sym]
        o = hit and official.get(hit[0]["instrumentId"])
        if o and o["instrumentTypeID"] == 5 and not o["isInternalInstrument"] and any(name_matches(hit[0].get("displayName", ""), k) for k in (e.get("match") or [e["name"]])):
            eu_found[sym] = (e, cc)
    for s in ("MUV2.DE", "ABS2.DE", "TBAU.VI", "LKEU.DE"):
        if s not in eu_found:
            errors.append(f"Europa-Liste: {s} nicht aufgelöst (Gegenrechnung)")
    for s in ("WRONG.DE", "TBAU.DE", "LKX.DE", "GONE.DE"):
        if s in eu_found:
            errors.append(f"Europa-Liste: {s} fälschlich aufgelöst (Gegenrechnung)")

for kind, t, env in (("Aktie", 5, "STOCK_COUNT"), ("ETF", 6, "ETF_COUNT")):
    valid_syms = [it["internalSymbolFull"].upper() for it in ranked if valid(it, t)]
    want = set(valid_syms[:int(os.environ.get(env, "0") or 0)])
    if kind == "Aktie":
        # Europa-Quote: die nächsten EUROPE_COUNT europäischen jenseits der beliebtesten, dazu die Europa-Liste
        want |= set([s for s in valid_syms[int(os.environ.get(env, "0") or 0):] if suffix(s) in EU][:int(os.environ.get("EUROPE_COUNT", "0") or 0)])
        want |= set(eu_found)
        want |= {it["internalSymbolFull"].upper() for it in ranked if valid(it, t) and it["internalSymbolFull"].upper() in always}
        # Firmen, die die Suche gar nicht liefert: über das Kürzel nachschlagen, wenn die offizielle Liste sie als Aktie führt
        for sym in always - set(universe):
            hit = [r for r in get(f"{base}/api/v2/market-data/instruments?symbols={sym}")["results"] if r["symbol"].upper() == sym]
            o = hit and official.get(hit[0]["instrumentId"])
            if o and o["instrumentTypeID"] == 5 and not o["isInternalInstrument"]:
                want.add(sym)
    got = {x["sym"] for x in d["items"] if x["type"] == kind}
    if want and got != want:
        errors.append(f"{kind}: {len(got)} statt {len(want)} der beliebtesten gültigen Werte (fehlen {sorted(want - got)[:5]}, zu viel {sorted(got - want)[:5]})")

spx = get(f"{base}/api/v2/market-data/instruments?symbols=SPX500")["results"][0]["instrumentId"]
sc = candles(spx)
spx_ret = {sc[i]["d"]: math.log(sc[i]["c"] / sc[i - 1]["c"]) for i in range(1, len(sc))}

for x in d["items"]:
    c = candles(id_of(x["sym"]))
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
        "last": (last, 1e-3), "chg1d": (pct(last, at(1)), 0.011), "ret1w": (pct(last, at(5)), 0.011), "ret12m": (pct(last, at(252)), 0.011),
        "mom": (pct(at(21), at(252)) if n > 252 else None, 0.011), "d200": ((last / mean(cl[-200:]) - 1) * 100, 0.011),
        "atr": (mean(tr), 1e-3), "vol20": (sd(lr[-20:]) * math.sqrt(252) * 100, 0.011), "dHi52": ((last / hi - 1) * 100, 0.011),
        "mdd": (mdd * 100, 0.011), "beta": (beta, 0.011),
        # für den Swing-Planer: 20-Tage-Schnitt, letzte Kerze, Spanne der letzten 5 Kerzen
        "d20": ((last / mean(cl[-20:]) - 1) * 100, 0.011), "o1d": (c[-1]["o"], 1e-3), "hi1d": (c[-1]["h"], 1e-3), "lo1d": (c[-1]["l"], 1e-3),
        "hi5": (max(r["h"] for r in c[-5:]), 1e-3), "lo5": (min(r["l"] for r in c[-5:]), 1e-3),
    }
    if x.get("asOf") != c[-1]["d"]:
        errors.append(f"{x['sym']} asOf: Daten {x.get('asOf')}, letzte Kerze {c[-1]['d']}")
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
    # Termine: jede Aktie mit Termin beim Test-Server hat genau den frühesten (auch die in den nächsten Tagen)
    today = __import__("datetime").date.today()
    for x in us:
        iid = id_of(x["sym"])
        if iid % 3 == 0:
            want_d = (today + __import__("datetime").timedelta(days=iid % 40 + 3)).isoformat()
            if (x.get("earn") or {}).get("date") != want_d:
                errors.append(f"{x['sym']}: nächster Termin {(x.get('earn') or {}).get('date')} statt {want_d}")
        if iid % 3 == 1:
            want_p = (today - __import__("datetime").timedelta(days=iid % 50 + 2)).isoformat()
            if (x.get("lastEarn") or {}).get("date") != want_p:
                errors.append(f"{x['sym']}: letzte Zahlen {(x.get('lastEarn') or {}).get('date')} statt {want_p}")
    surprises = [x for x in d["items"] if "lastEarn" in x]
    if not surprises:
        errors.append("keine gemeldeten Quartalszahlen übernommen")
    for x in surprises:
        e = x["lastEarn"]
        want = (e["actual"] - e["estimate"]) / abs(e["estimate"]) * 100
        if abs(e["surprisePct"] - want) > 0.011:
            errors.append(f"{x['sym']}: Überraschung {e['surprisePct']} statt {want:.2f}")

syms = {x["sym"] for x in d["items"]}
# Zusatznamen (Suche) und Land nur für Werte der Europa-Liste – gleiche Regel wie in der Seite
for x in d["items"]:
    f = eu_found.get(x["sym"])
    if not f:
        if "aka" in x or "cc" in x:
            errors.append(f"{x['sym']}: Zusatzname oder Land ohne Europa-Liste")
        continue
    e, cc = f
    seen_a, aka = set(), []
    for a in [e["name"]] + (e.get("aka") or []):
        a = str(a).strip()
        if a and not name_matches(x["name"], a) and a not in seen_a:
            seen_a.add(a)
            aka.append(a)
    want_aka = " · ".join(aka)[:80] or None
    if x.get("aka") != want_aka or x.get("cc") != cc:
        errors.append(f"{x['sym']}: Zusatzname {x.get('aka')!r}/{x.get('cc')} statt {want_aka!r}/{cc}")
if os.environ.get("EUROPE_IN"):
    for s in ("MUV2.DE", "ABS2.DE", "TBAU.VI", "LKEU.DE", "EUQ1.PA"):
        if s not in syms:
            errors.append(f"{s} fehlt (Europa)")
    for s in ("WRONG.DE", "TBAU.DE", "LKX.DE", "GONE.DE", "EUQ3.L", "USX1"):
        if s in syms:
            errors.append(f"{s} zu viel (Europa)")
    if next((x for x in d["items"] if x["sym"] == "ABS2.DE"), {}).get("aka") != "POS" or next((x for x in d["items"] if x["sym"] == "MUV2.DE"), {}).get("cc") != "DE":
        errors.append("Porr ohne Wiener Kürzel POS oder Münchener Rück ohne Land DE")
if "STK008" not in syms:
    errors.append("STK008 fehlt – Börse gerade zu, aber mit Rang: gehört dazu")
if os.environ.get("FIRMS_IN") and "LOOKUP1" in always and "LOOKUP1" not in syms:
    errors.append("LOOKUP1 fehlt – liefert die Suche nicht, muss über das Kürzel nachgeschlagen werden")

if errors:
    print(f"::error::Gegenrechnung Aktien-Daten fehlgeschlagen – {len(errors)} Abweichung(en):")
    for e in errors[:30]:
        print("  -", e)
    sys.exit(1)
print(f"Gegenrechnung Aktien-Daten bestanden: {len(d['items'])} Werte, alle Kennzahlen, Ränge und Filter stimmen.")

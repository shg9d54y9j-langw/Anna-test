"""Unabhängige Gegenrechnung des Kennzahlen-Laufs (scripts/fund-data.mjs) gegen den Test-Server.

Holt dieselben Finnhub-Antworten direkt und rechnet Kennzahlen und die Insider-Zusammenfassung der letzten 90 Tage
in Python nach. Mit --forbidden <vorheriger Lauf>: Insider-Daten sind im Tarif gesperrt – dann darf keine Aktie
Insider-Daten haben, und Branchen kommen aus dem vorherigen Lauf, ohne neue Profil-Abfragen.
Aufruf: python3 tests/verify_fund.py <stocks.json> <fund.json> <http://localhost:PORT> [--forbidden <fund-vorher.json>]
"""
import datetime
import json
import sys
import urllib.request

stocks = json.load(open(sys.argv[1], encoding="utf-8"))
fund = json.load(open(sys.argv[2], encoding="utf-8"))
base = sys.argv[3].rstrip("/")
forbidden = "--forbidden" in sys.argv
prev = json.load(open(sys.argv[sys.argv.index("--forbidden") + 1], encoding="utf-8")) if forbidden else None
errors = []


def get(path):
    with urllib.request.urlopen(f"{base}/finnhub{path}&token=test-finnhub-0000", timeout=20) as r:
        return json.loads(r.read().decode("utf-8"))


def r2(x):
    return None if x is None else round(x + 0.0, 2)


us = [x["sym"] for x in stocks["items"] if x["type"] == "Aktie" and "." not in x["sym"]]
today = datetime.date.today()
cut = (today - datetime.timedelta(days=90)).isoformat()
for sym in us:
    it = fund["items"].get(sym, {})
    m = get(f"/stock/metric?symbol={sym}&metric=all").get("metric", {})
    want = {"pe": m.get("peTTM"), "ps": m.get("psTTM"), "pb": m.get("pbQuarterly"), "revG": m.get("revenueGrowthTTMYoy"), "epsG": m.get("epsGrowthTTMYoy"),
            "netM": m.get("netProfitMarginTTM"), "grossM": m.get("grossMarginTTM"), "roe": m.get("roeTTM"), "de": m.get("totalDebt/totalEquityQuarterly"),
            "div": m.get("currentDividendYieldTTM"), "mcap": m.get("marketCapitalization")}
    for k, v in want.items():
        if r2(v) != it.get(k):
            errors.append(f"{sym} {k}: Lauf {it.get(k)}, Gegenrechnung {r2(v)}")
    if forbidden:
        if "ins" in it:
            errors.append(f"{sym}: Insider-Daten trotz gesperrtem Tarif")
        if prev["items"].get(sym, {}).get("ind") != it.get("ind"):
            errors.append(f"{sym}: Branche nicht aus dem vorherigen Lauf übernommen")
        continue
    rows = [t for t in get(f"/stock/insider-transactions?symbol={sym}&from=2000-01-01&to={today.isoformat()}")["data"]
            if t["transactionCode"] in ("P", "S") and (t.get("transactionDate") or t.get("filingDate")) >= cut]
    buys = [t for t in rows if t["transactionCode"] == "P"]
    sells = [t for t in rows if t["transactionCode"] == "S"]
    ins = it.get("ins") or {}
    exp = {"buyers": len({t["name"] for t in buys}), "sellers": len({t["name"] for t in sells}), "buys": len(buys), "sells": len(sells),
           "buyVal": round(sum(abs(t["change"]) * t["transactionPrice"] for t in buys)), "sellVal": round(sum(abs(t["change"]) * t["transactionPrice"] for t in sells))}
    for k, v in exp.items():
        if ins.get(k) != v:
            errors.append(f"{sym} Insider {k}: Lauf {ins.get(k)}, Gegenrechnung {v}")
    p = get(f"/stock/profile2?symbol={sym}")
    if it.get("ind") != p.get("finnhubIndustry"):
        errors.append(f"{sym}: Branche {it.get('ind')} statt {p.get('finnhubIndustry')}")
    web_ok = p.get("weburl", "").startswith("https://")
    if web_ok != ("web" in it):
        errors.append(f"{sym}: Webseite {'fehlt' if web_ok else 'ohne https übernommen'}")

av = fund["available"]
if forbidden and (av["insider"] or not av["metric"]):
    errors.append(f"Tarif-Angabe falsch: {av}")
if not forbidden and not all(av.values()):
    errors.append(f"Tarif-Angabe falsch: {av}")
if errors:
    print(f"::error::Gegenrechnung Kennzahlen fehlgeschlagen – {len(errors)} Abweichung(en):")
    for e in errors[:30]:
        print("  -", e)
    sys.exit(1)
cluster = sum(1 for v in fund["items"].values() if (v.get("ins") or {}).get("buyers", 0) >= 2)
print(f"Gegenrechnung Kennzahlen bestanden: {len(us)} US-Aktien, {cluster} mit Käufen mehrerer Insider{', Insider gesperrt, Branchen übernommen' if forbidden else ''}.")

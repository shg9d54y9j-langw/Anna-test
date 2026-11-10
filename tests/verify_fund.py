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
        if prev["items"].get(sym, {}).get("ind") != it.get("ind") or prev["items"].get(sym, {}).get("cty") != it.get("cty"):
            errors.append(f"{sym}: Branche oder Sitzland nicht aus dem vorherigen Lauf übernommen")
        for k in ("earn", "peers", "earnAt", "peersAt"):
            if prev["items"].get(sym, {}).get(k) != it.get(k):
                errors.append(f"{sym}: {k} nicht aus dem vorherigen Lauf übernommen (wöchentlich)")
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
    # Quartalszahlen: neueste 4 vollständige, Überraschung in % gegen die Erwartung
    rows = [r for r in get(f"/stock/earnings?symbol={sym}") if r.get("actual") is not None and r.get("estimate") is not None]
    rows.sort(key=lambda r: r["period"], reverse=True)
    want_e = [{"p": r["period"], "a": r2(r["actual"]), "e": r2(r["estimate"]), "sp": r2((r["actual"] - r["estimate"]) / abs(r["estimate"]) * 100) if abs(r["estimate"]) >= 0.01 else None} for r in rows[:4]]
    got_e = [{k: q.get(k) for k in ("p", "a", "e", "sp")} for q in it.get("earn", [])]
    if got_e != want_e:
        errors.append(f"{sym}: Quartalszahlen {got_e} statt {want_e}")
    peers = []
    for q in get(f"/stock/peers?symbol={sym}"):
        q = q.upper()
        if q != sym and q not in peers:
            peers.append(q)
    if it.get("peers", []) != peers[:10]:
        errors.append(f"{sym}: Konkurrenten {it.get('peers')} statt {peers[:10]}")
    p = get(f"/stock/profile2?symbol={sym}")
    if it.get("ind") != p.get("finnhubIndustry"):
        errors.append(f"{sym}: Branche {it.get('ind')} statt {p.get('finnhubIndustry')}")
    if p.get("finnhubIndustry") and it.get("cty") != p.get("country", ""):
        errors.append(f"{sym}: Sitzland {it.get('cty')!r} statt {p.get('country', '')!r}")
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

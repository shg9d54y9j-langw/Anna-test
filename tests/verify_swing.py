"""Unabhängige Gegenrechnung des Swing-Planers (nur für die automatischen Tests).

Rechnet aus denselben Aktien-Daten in Python nach: Zustand je Firma, Kauf, Stop und Teilziel, Rückenwind je Theorie,
die Auswahl „Neu entdeckt“ und die ersten Signale der Papier-Bilanz.
Aufruf: python3 tests/verify_swing.py <stocks.json> <swing.json> <firms.json>
"""
import json
import sys

stocks = json.load(open(sys.argv[1], encoding="utf-8"))
swing = json.load(open(sys.argv[2], encoding="utf-8"))
firms = json.load(open(sys.argv[3], encoding="utf-8"))
items = {x["sym"].upper(): x for x in stocks["items"]}
errors = []
R = dict(zoneLow=-0.5, zoneHigh=2, extended=3, atHigh=-0.5, nearHigh=-3, stopAtr=3, targetR=2, maxStopPct=20, reclaimMax=-3)


def rnd(v):
    return round(v, 2) if v >= 1 else round(v, 4)


def trend(x):
    last, atr, d50, d200, mom = (x.get(k) for k in ("last", "atr", "d50", "d200", "mom"))
    if None in (last, atr, d50, d200) or atr <= 0 or last <= 0:
        return "nodata", None, None
    s50, s200 = last / (1 + d50 / 100), last / (1 + d200 / 100)
    if d200 > 0 and s50 > s200 and mom is not None and mom > 0:
        return "up", s50, s200
    if d200 < 0 and (s50 < s200 or (mom is not None and mom < 0)):
        return "down", s50, s200
    return "flat", s50, s200


def expect(x):
    kind, s50, _ = trend(x)
    if kind != "up":
        return {"state": {"nodata": "nodata", "down": "avoid", "flat": "watch"}[kind]}
    last, atr = x["last"], x["atr"]
    ext = (last - s50) / atr
    if ext >= R["zoneLow"] and (ext <= R["zoneHigh"] or (ext <= R["extended"] and x["dHi52"] >= R["atHigh"])):
        state, entry = "buy", last
    elif ext < R["reclaimMax"]:
        return {"state": "watch"}
    elif ext < R["zoneLow"]:
        state, entry = "alert", s50
    elif ext <= R["extended"] and x["dHi52"] >= R["nearHigh"]:
        state, entry = "alert", max(x["hi52"], last)
    else:
        state, entry = "wait", s50 + R["zoneHigh"] * atr
    risk = R["stopAtr"] * atr
    if risk / entry * 100 > R["maxStopPct"]:
        return {"state": "watch"}
    return {"state": state, "entry": rnd(entry), "stop": rnd(entry - risk), "target": rnd(entry + R["targetR"] * risk)}


def close(a, b):
    return a is not None and b is not None and abs(a - b) <= (0.011 if abs(b) >= 1 else 0.00011)


setups = {s["sym"]: s for s in swing["setups"]}
profiles = {s.upper() for s in firms["firms"]}
for sym in profiles:
    if sym in items and sym not in setups:
        errors.append(f"{sym}: Firma mit Daten fehlt im Plan")
    if sym not in items and sym not in swing["missing"]:
        errors.append(f"{sym}: Firma ohne Daten nicht als fehlend gemeldet")
for sym, s in setups.items():
    want = expect(items[sym])
    if s["state"] != want["state"]:
        errors.append(f"{sym}: Zustand {s['state']}, Gegenrechnung {want['state']}")
        continue
    for k in ("entry", "stop", "target"):
        if k in want and not close(s.get(k), want[k]):
            errors.append(f"{sym} {k}: Plan {s.get(k)}, Gegenrechnung {want[k]}")
    if s["src"] == "scan":
        x = items[sym]
        if sym in profiles or x["type"] != "Aktie" or x.get("momRank", 0) < 90 or not 1 <= x["atrPct"] <= 6 or x["dHi52"] < -10:
            errors.append(f"{sym}: erfüllt die Regeln für „Neu entdeckt“ nicht")
        if s["state"] not in ("buy", "wait", "alert"):
            errors.append(f"{sym}: entdeckt, aber nicht kaufbar ({s['state']})")
if len([s for s in setups.values() if s["src"] == "scan"]) > 8:
    errors.append("mehr als 8 Neu-Entdeckte")

# Rückenwind: Anteil im Aufwärtstrend je Sparte und Idee
groups = {f"sector:{k}": v for k, v in firms.get("sectors", {}).items()}
groups.update({f"moon:{k}": v.get("firms", []) for k, v in firms.get("moon", {}).items()})
for t in swing["themes"]:
    members = [s.upper() for s in groups.get(t["key"], [])]
    data = [items[s] for s in members if s in items and trend(items[s])[0] != "nodata"]
    up = sum(1 for x in data if trend(x)[0] == "up")
    if t["n"] != len(data) or t["up"] != up or t["total"] != len(members):
        errors.append(f"{t['key']}: {t['up']}/{t['n']} von {t['total']}, Gegenrechnung {up}/{len(data)} von {len(members)}")

# Papier-Bilanz (frisch): jedes offene Signal ist ein Kauf in der Kaufzone ohne Zahlen-Pause, zum aktuellen Kurs
for t in swing["ledger"]["open"]:
    s, x = setups.get(t["sym"]), items.get(t["sym"])
    if not s or s["state"] != "buy" or s.get("earnSoon"):
        errors.append(f"{t['sym']}: Signal ohne Kaufzone")
    elif not (close(t["entry"], rnd(x["last"])) and close(t["initStop"], rnd(x["last"] - 3 * x["atr"]))):
        errors.append(f"{t['sym']}: Signal {t['entry']}/{t['initStop']}, erwartet {rnd(x['last'])}/{rnd(x['last'] - 3 * x['atr'])}")
buys = [s for s in setups.values() if s["state"] == "buy" and not s.get("earnSoon")]
if len(swing["ledger"]["open"]) != min(20, len(buys)):
    errors.append(f"{len(swing['ledger']['open'])} Signale eröffnet, erwartet {min(20, len(buys))}")

if errors:
    print(f"::error::Gegenrechnung Swing-Planer fehlgeschlagen – {len(errors)} Abweichung(en):")
    for e in errors[:30]:
        print("  -", e)
    sys.exit(1)
states = {}
for s in setups.values():
    states[s["state"]] = states.get(s["state"], 0) + 1
print(f"Gegenrechnung Swing-Planer bestanden: {len(setups)} Werte {states}, {len(swing['themes'])} Theorien, {len(swing['ledger']['open'])} Signale.")

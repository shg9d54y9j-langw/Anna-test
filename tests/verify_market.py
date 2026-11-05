"""Unabhängige Gegenrechnung des Marktlage-Cockpits gegen den Test-Server (nur für die automatischen Tests).

Holt dieselben Tageskerzen und FRED-Reihen direkt vom Test-Server, rechnet Trend, Schwankung, Renditen und
Ampeln in Python nach und vergleicht mit market.json.
Aufruf: python3 tests/verify_market.py <market.json> <http://localhost:PORT>
"""
import json
import math
import sys
import urllib.request

market_path, base = sys.argv[1], sys.argv[2].rstrip("/")
m = json.load(open(market_path, encoding="utf-8"))
HEAD = {"x-api-key": "test", "x-user-key": "test", "x-request-id": "00000000-0000-4000-8000-000000000000"}
errors = []


def get(url, headers=None):
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read().decode("utf-8")


def stats(closes):
    n = len(closes)
    last = closes[-1]
    at = lambda k: closes[n - 1 - k] if n > k else None
    pct = lambda a, b: (a / b - 1) * 100 if a and b else None
    sma = sum(closes[-200:]) / 200 if n >= 200 else None
    rets = [math.log(closes[i] / closes[i - 1]) for i in range(max(1, n - 20), n)]
    mr = sum(rets) / len(rets)
    vol = math.sqrt(sum((r - mr) ** 2 for r in rets) / (len(rets) - 1)) * math.sqrt(252) * 100
    return {"last": last, "chg1d": pct(last, at(1)), "ret1m": pct(last, at(21)), "ret12m": pct(last, at(252)),
            "distSma200": (last / sma - 1) * 100 if sma else None, "vol20": vol}


def close(a, b, tol=1e-6):
    if a is None or b is None:
        return a is None and b is None
    return abs(a - b) <= tol * max(1, abs(a), abs(b))


for a in m["assets"]:
    if a.get("symbol") is None:
        errors.append(f"{a['name']}: keine Daten")
        continue
    found = json.loads(get(f"{base}/api/v2/market-data/instruments?symbols={a['symbol']}", HEAD))["results"]
    iid = found[0]["instrumentId"]
    data = json.loads(get(f"{base}/api/v1/market-data/instruments/{iid}/history/candles/desc/OneDay/300", HEAD))
    rows = sorted(data["candles"][0]["candles"], key=lambda c: c["fromDate"])
    s = stats([c["close"] for c in rows])
    for k, v in s.items():
        if not close(v, a.get(k)):
            errors.append(f"{a['name']} {k}: Cockpit {a.get(k)}, Gegenrechnung {v}")
    up = s["distSma200"] > 0
    mom = s["ret12m"] > 0 if s["ret12m"] is not None else up
    light = "green" if up and mom else "red" if not up and not mom else "yellow"
    if a["light"] != light:
        errors.append(f"{a['name']} Ampel {a['light']} statt {light}")


def fred(series):
    lines = get(f"{base}/fred?id={series}").strip().splitlines()[1:]
    out = []
    for line in lines:
        d, v = line.split(",")
        try:
            out.append((d, float(v)))
        except ValueError:
            pass
    return out


curve = fred("T10Y3M")[-1][1]
nfci = fred("NFCI")[-1][1]
if not close(curve, m["macro"]["curve"]["value"]):
    errors.append(f"Zinskurve {m['macro']['curve']['value']} statt {curve}")
if m["macro"]["curve"]["light"] != ("red" if curve < 0 else "yellow" if curve < 0.5 else "green"):
    errors.append("Ampel der Zinskurve falsch")
if not close(nfci, m["macro"]["nfci"]["value"]):
    errors.append(f"NFCI {m['macro']['nfci']['value']} statt {nfci}")
if m["macro"]["nfci"]["light"] != ("red" if nfci > 0 else "yellow" if nfci > -0.3 else "green"):
    errors.append("Ampel der Finanzbedingungen falsch")

spx = next(a for a in m["assets"] if a["key"] == "spx")
r = m["rules"]
score = (1 if spx["distSma200"] > 0 else -1) + (1 if spx["vol20"] < r["volCalm"] else -1 if spx["vol20"] > r["volHigh"] else 0) + (1 if nfci <= 0 else -1)
light = "green" if score >= 2 else "yellow" if score >= 0 else "red"
size = min(1, max(r["minSize"], r["targetVol"] / spx["vol20"]))
o = m["overall"]
if o["score"] != score or o["light"] != light or not close(o["sizeFactor"], size):
    errors.append(f"Gesamtampel {o} statt Punkte {score}, {light}, Größe {size:.4f}")

if errors:
    print(f"::error::Gegenrechnung Cockpit fehlgeschlagen – {len(errors)} Abweichung(en):")
    for e in errors:
        print("  -", e)
    sys.exit(1)
print(f"Gegenrechnung Cockpit bestanden: {len(m['assets'])} Kurse, Zinskurve, Finanzbedingungen und Gesamtampel stimmen.")

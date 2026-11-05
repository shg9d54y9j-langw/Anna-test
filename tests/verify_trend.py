"""Unabhängige Gegenrechnung der Trend-Bot-Signale gegen den Test-Server (nur für die automatischen Tests).

Holt dieselben Tages- und Wochenkerzen, rechnet Trend-Prüfungen, Schwankung, Zielanteile (Schwankungs- und
Verlustbremse) und den Rückblick-Test (wöchentliche Umschichtung, tägliche Ausstiege, Kosten) in Python nach.
Aufruf: python3 tests/verify_trend.py <trend-signals.json> <http://localhost:PORT>
"""
import datetime
import json
import math
import sys
import urllib.request

path, base = sys.argv[1], sys.argv[2].rstrip("/")
d = json.load(open(path, encoding="utf-8"))
HEAD = {"x-api-key": "test", "x-user-key": "test", "x-request-id": "00000000-0000-4000-8000-000000000000"}
errors = []
R = d["rules"]
CANDIDATES = [["SPY", "VOO", "IVV"], ["EFA", "VEA", "IEFA"], ["IEF", "GOVT", "TLT"], ["GLD", "IAU"], ["DBC", "PDBC", "GSG"], ["VNQ", "IYR", "XLRE"]]


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=HEAD), timeout=20) as r:
        return json.loads(r.read().decode("utf-8"))


def mean(a):
    return sum(a) / len(a)


def sd(a):
    m = mean(a)
    return math.sqrt(sum((x - m) ** 2 for x in a) / (len(a) - 1))


def near(a, b, tol):
    if a is None or b is None:
        return a is None and b is None
    return abs(a - b) <= tol


# ETFs wie der Bot auswählen: erster Kandidat mit Typ ETF
chosen = []
for cands in CANDIDATES:
    for sym in cands:
        res = get(f"{base}/api/v2/market-data/instruments?symbols={sym}")["results"]
        if res and "etf" in res[0].get("type", "").lower():
            chosen.append((sym, res[0]["instrumentId"]))
            break
if [a["sym"] for a in d["assets"]] != [c[0] for c in chosen]:
    errors.append(f"ETF-Auswahl {[a['sym'] for a in d['assets']]} statt {[c[0] for c in chosen]}")

now = datetime.datetime.fromisoformat(d["updated"].replace("Z", "+00:00"))
cut_day = now.date().isoformat()
cut_week = (now - datetime.timedelta(days=6)).date().isoformat()


def series(interval, cutoff):
    maps = []
    for _, iid in chosen:
        raw = get(f"{base}/api/v1/market-data/instruments/{iid}/history/candles/desc/{interval}/1000")["candles"][0]["candles"]
        maps.append({c["fromDate"][:10]: c["close"] for c in raw if c["fromDate"][:10] < cutoff})
    dates = sorted(set.intersection(*[set(m) for m in maps]))
    return dates, [[m[x] for x in dates] for m in maps]


def look(ppy):
    k = lambda days: max(1, round(days * ppy / 252))
    return k(R["months"][0]), k(R["months"][1]), k(R["months"][2]), k(R["sma"]), k(R["volDays"])


def signal(c, t, ppy):
    m1, m3, m12, sma_n, vol_n = look(ppy)
    if t < max(m12, sma_n, vol_n):
        return None
    last = c[t]
    sma = sum(c[t - sma_n + 1:t + 1]) / sma_n
    checks = [last / c[t - m1] > 1, last / c[t - m3] > 1, last / c[t - m12] > 1, last > sma]
    lr = [math.log(c[i] / c[i - 1]) for i in range(t - vol_n + 1, t + 1)]
    return {"score": sum(checks) / 4, "vol": sd(lr) * math.sqrt(ppy), "lr": lr, "last": last}


def dd_mult(dd):
    if dd <= R["ddStart"]:
        return 1.0
    if dd >= R["ddFull"]:
        return R["ddFloor"]
    return 1 - (1 - R["ddFloor"]) * (dd - R["ddStart"]) / (R["ddFull"] - R["ddStart"])


def weights(sigs, ppy, dd):
    inv = [1 / s["vol"] if s and s["vol"] > 0 else 0 for s in sigs]
    tot = sum(inv)
    w = [min(R["maxWeight"], inv[i] / tot * sigs[i]["score"]) if inv[i] else 0 for i in range(len(sigs))]
    var = 0.0
    for i in range(len(w)):
        for j in range(len(w)):
            if w[i] and w[j]:
                a, b = sigs[i]["lr"], sigs[j]["lr"]
                ma, mb = mean(a), mean(b)
                var += w[i] * w[j] * sum((a[k] - ma) * (b[k] - mb) for k in range(len(a))) / (len(a) - 1)
    pv = math.sqrt(max(var, 0) * ppy)
    vm = R["targetVol"] / 100 / pv if pv > R["targetVol"] / 100 else 1.0
    return [x * vm * dd_mult(dd) for x in w], pv * vm * dd_mult(dd)


def week(day):
    t = datetime.date.fromisoformat(day)
    return (t - datetime.timedelta(days=t.weekday())).isoformat()


def backtest(dates, closes, ppy):
    m1, m3, m12, sma_n, vol_n = look(ppy)
    start = max(m12, sma_n, vol_n) + 1
    A = len(closes)
    eq = peak = ew = spy = 1.0
    cur, pending, turnover, curve = [0.0] * A, None, 0.0, []
    eww = [1 / A] * A
    for t in range(start, len(dates)):
        if t > start:
            grow = [cur[i] * closes[i][t] / closes[i][t - 1] for i in range(A)]
            total = sum(grow) + 1 - sum(cur)
            eq *= total
            cur = [g / total for g in grow]
            eg = [eww[i] * closes[i][t] / closes[i][t - 1] for i in range(A)]
            ew *= sum(eg)
            eww = [1 / A] * A if (t - start) % round(ppy / 12) == 0 else [g / sum(eg) for g in eg]
            spy *= closes[0][t] / closes[0][t - 1]
        if pending:
            full = ppy < 100 or week(dates[t]) != week(dates[t - 1])
            traded = 0.0
            for i in range(A):
                g, c = pending[i], cur[i]
                if not full and not (g == 0 and c > 0):
                    continue
                if (g == 0 and c > 0) or (c == 0 and g > 0) or abs(g - c) > R["band"]:
                    traded += abs(g - c)
                    cur[i] = g
            eq *= 1 - traded * R["costPct"] / 100
            turnover += traded
        peak = max(peak, eq)
        pending, _ = weights([signal(c, t, ppy) for c in closes], ppy, (1 - eq / peak) * 100)
        curve.append((dates[t], eq, ew, spy))
    return curve, turnover / ((len(dates) - start) / ppy), (1 - eq / peak) * 100


def stats(vals, ppy):
    rets = [vals[i] / vals[i - 1] - 1 for i in range(1, len(vals))]
    peak, mdd = vals[0], 0.0
    for v in vals:
        peak = max(peak, v)
        mdd = max(mdd, 1 - v / peak)
    roll = [vals[i] / vals[i - ppy] - 1 for i in range(ppy, len(vals))]
    return {"cagr": ((vals[-1] / vals[0]) ** (ppy / len(rets)) - 1) * 100, "vol": sd(rets) * math.sqrt(ppy) * 100, "maxDD": mdd * 100,
            "pos12": sum(1 for x in roll if x > 0) / len(roll) * 100 if roll else None, "worst12": min(roll) * 100 if roll else None}


# Tagesdaten: heutige Ziele und Rückblick
dates, closes = series("OneDay", cut_day)
curve, turn, dd = backtest(dates, closes, 252)
t = len(dates) - 1
sigs = [signal(c, t, 252) for c in closes]
wb, _ = weights(sigs, 252, 0)
w, pv = weights(sigs, 252, dd)
if d["asOf"] != dates[t]:
    errors.append(f"Kursstand {d['asOf']} statt {dates[t]}")
for i, a in enumerate(d["assets"]):
    if not near(a["score"], sigs[i]["score"], 1e-9):
        errors.append(f"{a['sym']} Trend {a['score']} statt {sigs[i]['score']}")
    if not near(a["vol"], sigs[i]["vol"] * 100, 0.011):
        errors.append(f"{a['sym']} Schwankung {a['vol']} statt {sigs[i]['vol'] * 100:.2f}")
    if not near(a["weightBase"], wb[i], 1e-4) or not near(a["weight"], w[i], 1e-4):
        errors.append(f"{a['sym']} Anteil {a['weightBase']}/{a['weight']} statt {wb[i]:.4f}/{w[i]:.4f}")
    if a["weight"] > R["maxWeight"] + 1e-9:
        errors.append(f"{a['sym']} über der Obergrenze je ETF")
if not near(d["exposure"], sum(w), 1e-3) or sum(w) > 1 + 1e-9:
    errors.append(f"Investiert {d['exposure']} statt {sum(w):.4f}")
if not near(d["portVol"], pv * 100, 0.02) or pv * 100 > R["targetVol"] + 1e-6:
    errors.append(f"Depot-Schwankung {d['portVol']} statt {pv * 100:.2f}")
bd = d["backtest"]["daily"]
for key, col in (("bot", 1), ("ew", 2), ("spy", 3)):
    want = stats([c[col] for c in curve], 252)
    for k, v in want.items():
        if not near(bd[key][k], v, 0.051 if k == "pos12" else 0.011):
            errors.append(f"Rückblick täglich {key} {k}: {bd[key][k]} statt {v:.2f}")
if not near(bd["turnoverPerYear"], turn * 100, 0.6):
    errors.append(f"Umschlag {bd['turnoverPerYear']} statt {turn * 100:.0f}")
# Wochendaten
wd, wc = series("OneWeek", cut_week)
wcurve, _, _ = backtest(wd, wc, 52)
want = stats([c[1] for c in wcurve], 52)
for k, v in want.items():
    if not near(d["backtest"]["weekly"]["bot"][k], v, 0.051 if k == "pos12" else 0.011):
        errors.append(f"Rückblick wöchentlich {k}: {d['backtest']['weekly']['bot'][k]} statt {v:.2f}")
if [r[0] for r in d["recent"]] != dates[-15:]:
    errors.append("Letzte Schlusskurse für das Modell-Depot passen nicht")

if errors:
    print(f"::error::Gegenrechnung Trend-Bot fehlgeschlagen – {len(errors)} Abweichung(en):")
    for e in errors[:30]:
        print("  -", e)
    sys.exit(1)
print(f"Gegenrechnung Trend-Bot bestanden: {len(d['assets'])} ETFs, Trend, Schwankung, Anteile, Bremsen und Rückblick-Test stimmen.")

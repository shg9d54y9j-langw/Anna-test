"""Unabhängige Gegenrechnung des lernenden Trend-Bots gegen den Test-Server (nur für die automatischen Tests).

Holt dieselben Tages- und Wochenkerzen und die Finanzlage (NFCI), rechnet die fünf Regel-Varianten, die gemeinsame
Risiko-Schicht (Obergrenze je ETF, Schwankungs- und Verlustbremse), das monatliche Lernen der Gewichte und alle
Rückblick-Tests (wöchentliche Umschichtung, tägliche Ausstiege, Kosten) in Python nach und vergleicht.
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
R, LEARN = d["rules"], d["learning"]["rules"]
CANDIDATES = [["SPY", "VOO", "IVV"], ["EFA", "VEA", "IEFA"], ["IEF", "GOVT", "TLT"], ["GLD", "IAU"], ["DBC", "PDBC", "GSG", "COMT", "BCI"], ["VNQ", "IYR", "XLRE"]]
KEYS = ["us", "intl", "bonds", "gold", "commod", "reits"]
RISKY = {"us", "intl", "commod", "reits"}


def get(url, raw=False):
    with urllib.request.urlopen(urllib.request.Request(url, headers=HEAD), timeout=20) as r:
        body = r.read().decode("utf-8")
    return body if raw else json.loads(body)


def mean(a):
    return sum(a) / len(a)


def sd(a):
    m = mean(a)
    return math.sqrt(sum((x - m) ** 2 for x in a) / (len(a) - 1))


def jsround(x):
    return math.floor(x + 0.5)


def near(a, b, tol):
    if a is None or b is None:
        return a is None and b is None
    return abs(a - b) <= tol


# ---------- ETFs wie der Bot auswählen: erster Kandidat mit Typ ETF und mindestens 300 Tageskursen ----------
chosen = []
for keyi, cands in enumerate(CANDIDATES):
    for sym in cands:
        res = get(f"{base}/api/v2/market-data/instruments?symbols={sym}")["results"]
        if res and "etf" in res[0].get("type", "").lower():
            n = len(get(f"{base}/api/v1/market-data/instruments/{res[0]['instrumentId']}/history/candles/desc/OneDay/1000")["candles"][0]["candles"])
            if n >= 300:
                chosen.append((sym, res[0]["instrumentId"], KEYS[keyi]))
                break
if [a["sym"] for a in d["assets"]] != [c[0] for c in chosen]:
    errors.append(f"ETF-Auswahl {[a['sym'] for a in d['assets']]} statt {[c[0] for c in chosen]}")
keys = [c[2] for c in chosen]

now = datetime.datetime.fromisoformat(d["updated"].replace("Z", "+00:00"))
cut_day = now.date().isoformat()
cut_week = (now - datetime.timedelta(days=6)).date().isoformat()


def series(interval, cutoff):
    # Kalender des ersten (US-)ETF; Lücken mit dem letzten Kurs, vor dem ersten Kurs eines ETF leer (None)
    maps = []
    for _, iid, _k in chosen:
        raw = get(f"{base}/api/v1/market-data/instruments/{iid}/history/candles/desc/{interval}/1000")["candles"][0]["candles"]
        maps.append({c["fromDate"][:10]: c["close"] for c in raw if c["fromDate"][:10] < cutoff})
    dates = sorted(maps[0])
    out = []
    for m in maps:
        first, last, col = min(m) if m else "9999", None, []
        for x in dates:
            if x in m:
                last = m[x]
            col.append(last if x >= first else None)
        out.append(col)
    return dates, out


# Finanzlage: NFCI ab 2008, je Kurstag der letzte Wert, der mindestens 7 Tage alt ist
nfci_rows = []
for line in get(f"{base}/fred?id=NFCI&cosd=2008-01-01", raw=True).strip().splitlines()[1:]:
    day, val = line.split(",")
    try:
        nfci_rows.append((day, float(val)))
    except ValueError:
        pass
nfci_rows.sort()


def macro(dates):
    out, j = [], -1
    for x in dates:
        cutd = (datetime.date.fromisoformat(x) - datetime.timedelta(days=7)).isoformat()
        while j + 1 < len(nfci_rows) and nfci_rows[j + 1][0] <= cutd:
            j += 1
        out.append(nfci_rows[j][1] if j >= 0 else None)
    return out


# ---------- Kennzahlen, Varianten, Risiko-Schicht ----------
def features(c, t, ppy):
    k = lambda days: max(1, jsround(days * ppy / 252))
    r1, r3, r6, r12, sma_n, sma10_n, vol_n = k(21), k(63), k(126), k(252), k(200), k(210), k(60)
    need = max(r12, sma10_n, vol_n)
    if t < need or not c[t] or not c[t - need]:
        return None
    p = c[t]
    lr = [math.log(c[i] / c[i - 1]) for i in range(t - vol_n + 1, t + 1)]
    return {"p": p, "r1": p / c[t - r1] - 1, "r3": p / c[t - r3] - 1, "r6": p / c[t - r6] - 1, "r12": p / c[t - r12] - 1,
            "sma": sum(c[t - sma_n + 1:t + 1]) / sma_n, "sma10": sum(c[t - sma10_n + 1:t + 1]) / sma10_n, "vol": sd(lr) * math.sqrt(ppy), "lr": lr}


def inv_vol(F):
    inv = [1 / f["vol"] if f and f["vol"] > 0 else 0 for f in F]
    s = sum(inv)
    return [x / s if s > 0 else 0 for x in inv]


def frac(checks):
    return sum(1 for x in checks if x) / len(checks)


def v_t3612(F, b, nf):
    return [b[i] * frac([f["r3"] > 0, f["r6"] > 0, f["r12"] > 0, f["p"] > f["sma"]]) if f else 0 for i, f in enumerate(F)]


def v_t1312(F, b, nf):
    return [b[i] * frac([f["r1"] > 0, f["r3"] > 0, f["r12"] > 0, f["p"] > f["sma"]]) if f else 0 for i, f in enumerate(F)]


def v_faber(F, b, nf):
    return [b[i] if f and f["p"] > f["sma10"] else 0 for i, f in enumerate(F)]


def v_dual(F, b, nf):
    top = sorted([(-f["r12"], i) for i, f in enumerate(F) if f and f["r12"] > 0])[:3]
    idx = {i for _, i in top}
    s = sum(b[i] for i in idx)
    return [b[i] / s if s > 0 and i in idx else 0 for i in range(len(F))]


def v_macro(F, b, nf):
    w = v_t3612(F, b, nf)
    return [x / 2 if keys[i] in RISKY else x for i, x in enumerate(w)] if nf is not None and nf > 0 else w


VARIANTS = [v_t3612, v_t1312, v_faber, v_dual, v_macro]


def dd_mult(dd):
    if dd <= R["ddStart"]:
        return 1.0
    if dd >= R["ddFull"]:
        return R["ddFloor"]
    return 1 - (1 - R["ddFloor"]) * (dd - R["ddStart"]) / (R["ddFull"] - R["ddStart"])


def risk(raw, F, ppy, dd):
    w = [min(R["maxWeight"], max(0.0, x)) if F[i] else 0.0 for i, x in enumerate(raw)]
    var = 0.0
    for i in range(len(w)):
        for j in range(len(w)):
            if w[i] and w[j]:
                a, b = F[i]["lr"], F[j]["lr"]
                ma, mb = mean(a), mean(b)
                var += w[i] * w[j] * sum((a[q] - ma) * (b[q] - mb) for q in range(len(a))) / (len(a) - 1)
    pv = math.sqrt(max(var, 0) * ppy)
    vm = R["targetVol"] / 100 / pv if pv > R["targetVol"] / 100 else 1.0
    return [x * vm * dd_mult(dd) for x in w], pv * vm * dd_mult(dd)


def week(day):
    t = datetime.date.fromisoformat(day)
    return (t - datetime.timedelta(days=t.weekday())).isoformat()


def warmup(ppy):
    k = lambda days: max(1, jsround(days * ppy / 252))
    return max(k(252), k(210), k(60)) + 1


def run_bt(dates, closes, ppy, targets):
    start, A = warmup(ppy), len(closes)
    eq = peak = ew = spy = 1.0
    cur, pending, turnover, curve = [0.0] * A, None, 0.0, []

    def equal(t):
        ok = [bool(closes[i][t] and closes[i][t - 1]) for i in range(A)]
        return [1 / sum(ok) if x else 0.0 for x in ok]

    def ratio(i, t):
        return closes[i][t] / closes[i][t - 1] if closes[i][t] and closes[i][t - 1] else 1.0
    eww = equal(start)
    for t in range(start, len(dates)):
        if t > start:
            grow = [cur[i] * ratio(i, t) for i in range(A)]
            total = sum(grow) + 1 - sum(cur)
            eq *= total
            cur = [g / total for g in grow]
            eg = [eww[i] * ratio(i, t) for i in range(A)]
            ew *= sum(eg)
            eww = equal(t) if (t - start) % jsround(ppy / 12) == 0 else [g / sum(eg) for g in eg]
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
        pending = targets(t, (1 - eq / peak) * 100, len(curve))
        curve.append((dates[t], eq, ew, spy, sum(cur)))
    return curve, turnover / ((len(dates) - start) / ppy), (1 - eq / peak) * 100


def month_ends(curve, k):
    out = [curve[0][1]]
    for j in range(0, min(k, len(curve) - 1)):
        if curve[j][0][:7] != curve[j + 1][0][:7]:
            out.append(curve[j][1])
    return out


def learn(monthly, prev):
    V = len(monthly)
    if len(monthly[0]) - 1 < LEARN["minMonths"]:
        return [1 / V] * V
    scores = []
    for e in monthly:
        m = [e[q] / e[q - 1] - 1 for q in range(max(1, len(e) - LEARN["lookbackMonths"]), len(e))]
        v = sd(m) if len(m) > 1 else 0
        scores.append(mean(m) / v * math.sqrt(12) if v > 0 else 0)
    ex = [math.exp(LEARN["temp"] * s) for s in scores]
    goal = [LEARN["shrink"] / V + (1 - LEARN["shrink"]) * x / sum(ex) for x in ex]
    step = [prev[i] + max(-LEARN["maxStep"], min(LEARN["maxStep"], goal[i] - prev[i])) for i in range(V)]
    return [x / sum(step) for x in step]


def family(dates, closes, ppy):
    nf = macro(dates)
    F = [[features(c, t, ppy) for c in closes] for t in range(len(dates))]
    raws = []
    for t in range(len(dates)):
        b = inv_vol(F[t])
        raws.append([v(F[t], b, nf[t]) for v in VARIANTS])
    singles = [run_bt(dates, closes, ppy, lambda t, dd, k, v=v: risk(raws[t][v], F[t], ppy, dd)[0]) for v in range(len(VARIANTS))]
    state = {"lw": [1 / len(VARIANTS)] * len(VARIANTS), "month": None}

    def ens_targets(t, dd, k):
        if dates[t][:7] != state["month"]:
            state["lw"] = learn([month_ends(s[0], k) for s in singles], state["lw"])
            state["month"] = dates[t][:7]
        mix = [sum(state["lw"][v] * raws[t][v][i] for v in range(len(VARIANTS))) for i in range(len(closes))]
        return risk(mix, F[t], ppy, dd)[0]
    ens = run_bt(dates, closes, ppy, ens_targets)
    return ens, singles, state["lw"], F, raws


def stats(vals, ppy):
    rets = [vals[i] / vals[i - 1] - 1 for i in range(1, len(vals))]
    peak, mdd = vals[0], 0.0
    for v in vals:
        peak = max(peak, v)
        mdd = max(mdd, 1 - v / peak)
    roll = [vals[i] / vals[i - ppy] - 1 for i in range(ppy, len(vals))]
    return {"cagr": ((vals[-1] / vals[0]) ** (ppy / len(rets)) - 1) * 100, "vol": sd(rets) * math.sqrt(ppy) * 100, "maxDD": mdd * 100,
            "pos12": sum(1 for x in roll if x > 0) / len(roll) * 100 if roll else None, "worst12": min(roll) * 100 if roll else None}


def tol(k):
    return 0.051 if k == "pos12" else 0.011


# ---------- Tagesdaten: Lernen, Ziele heute, Rückblick ----------
dates, closes = series("OneDay", cut_day)
(curve, turn, dd), singles, lw, F, raws = family(dates, closes, 252)
t = len(dates) - 1
if d["asOf"] != dates[t]:
    errors.append(f"Kursstand {d['asOf']} statt {dates[t]}")
L = d["learning"]
for i, v in enumerate(L["variants"]):
    if not near(v["weight"], lw[i], 1e-4):
        errors.append(f"Lerngewicht {v['name']}: {v['weight']} statt {lw[i]:.4f}")
    want = stats([c[1] for c in singles[i][0]], 252)
    for k2 in ("cagr", "maxDD"):
        if not near(v["daily"][k2], want[k2], 0.011):
            errors.append(f"Variante {v['name']} {k2}: {v['daily'][k2]} statt {want[k2]:.2f}")
if abs(sum(lw) - 1) > 1e-9 or any(x <= 0 for x in lw):
    errors.append("Lerngewichte ergeben nicht 100 % oder sind nicht alle positiv")
mix = [sum(lw[v] * raws[t][v][i] for v in range(len(VARIANTS))) for i in range(len(closes))]
wb, _ = risk(mix, F[t], 252, 0)
w, pv = risk(mix, F[t], 252, dd)
for i, a in enumerate(d["assets"]):
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
    for k2, v2 in stats([c[col] for c in curve], 252).items():
        if not near(bd[key][k2], v2, tol(k2)):
            errors.append(f"Rückblick täglich {key} {k2}: {bd[key][k2]} statt {v2:.2f}")
if not near(bd["turnoverPerYear"], turn * 100, 0.6):
    errors.append(f"Umschlag {bd['turnoverPerYear']} statt {turn * 100:.0f}")

# ---------- Wochendaten: das lernende Depot über den langen Zeitraum ----------
wd, wc = series("OneWeek", cut_week)
(wcurve, _, _), wsingles, _, _, _ = family(wd, wc, 52)
for k2, v2 in stats([c[1] for c in wcurve], 52).items():
    if not near(d["backtest"]["weekly"]["bot"][k2], v2, tol(k2)):
        errors.append(f"Rückblick wöchentlich {k2}: {d['backtest']['weekly']['bot'][k2]} statt {v2:.2f}")
for i, v in enumerate(L["variants"]):
    want = stats([c[1] for c in wsingles[i][0]], 52)
    if not near(v["weekly"]["cagr"], want["cagr"], 0.011):
        errors.append(f"Variante {v['name']} wöchentlich: {v['weekly']['cagr']} statt {want['cagr']:.2f}")
if [r[0] for r in d["recent"]] != dates[-15:]:
    errors.append("Letzte Schlusskurse für das Modell-Depot passen nicht")
if L["nfci"]["asOf"] != nfci_rows[-1][0]:
    errors.append("Finanzlage (NFCI) nicht aktuell übernommen")

if errors:
    print(f"::error::Gegenrechnung Trend-Bot fehlgeschlagen – {len(errors)} Abweichung(en):")
    for e in errors[:30]:
        print("  -", e)
    sys.exit(1)
print(f"Gegenrechnung Trend-Bot bestanden: {len(d['assets'])} ETFs, 5 Regel-Varianten, Lerngewichte "
      f"({', '.join(f'{x * 100:.0f} %' for x in lw)}), Bremsen und alle Rückblick-Tests stimmen.")

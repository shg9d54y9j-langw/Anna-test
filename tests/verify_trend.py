"""Unabhängige Gegenrechnung des lernenden Trend-Bots gegen den Test-Server (nur für die automatischen Tests).

Holt dieselben Tages- und Wochenkerzen und die Finanzlage (NFCI), rechnet die fünf Regel-Varianten, die gemeinsame
Risiko-Schicht (Obergrenze je ETF, Schwankungs- und Verlustbremse), das monatliche Lernen der Gewichte und alle
Rückblick-Tests (wöchentliche Umschichtung, tägliche Ausstiege, Kosten) in Python nach und vergleicht.
Aufruf: python3 tests/verify_trend.py <trend-signals.json> <http://localhost:PORT>
"""
import datetime
import json
import math
import re
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


# ---------- Ausschüttungen und Zins (unabhängig nachgebaut) ----------
# eToro-Kurse enthalten keine Dividenden/Zinsen: Aktien mit fester Dividendenrendite, Anleihen mit der 10-jährigen
# Rendite (DGS10), Rohstoffe mit dem T-Bill-Zins (DTB3) – je Zeitschritt Kurs × (1 + Rendite × Tage/365), Rendite vom Vortag.
def fred_rows(series_id, cosd):
    rows = []
    for line in get(f"{base}/fred?id={series_id}&cosd={cosd}", raw=True).strip().splitlines()[1:]:
        day, val = line.split(",")
        try:
            rows.append((day, float(val)))
        except ValueError:
            pass
    rows.sort()
    return rows


DTB3, DGS10 = fred_rows("DTB3", "2009-01-01"), fred_rows("DGS10", "2009-01-01")
YLD = {"us": 0.018, "intl": 0.03, "bonds": DGS10, "gold": 0.0, "commod": DTB3, "reits": 0.038}
CORE_SHARE, CORE_W = 0.5, {"us": 0.6, "bonds": 0.4}


def as_of(rows, day):
    lo, hi, ans = 0, len(rows) - 1, None
    while lo <= hi:
        m = (lo + hi) // 2
        if rows[m][0] <= day:
            ans, lo = rows[m][1], m + 1
        else:
            hi = m - 1
    return ans


def gap(a, b):
    return (datetime.date.fromisoformat(b) - datetime.date.fromisoformat(a)).days


def with_dist(dates, closes):
    out = []
    for i, col in enumerate(closes):
        y, acc, prev, prev_d, res = YLD[keys[i]], None, None, None, []
        for t, c in enumerate(col):
            if c is None:
                res.append(None)
                continue
            if acc is None:
                acc, prev, prev_d = c, c, dates[t]
            else:
                yy = (as_of(y, prev_d) or 0) / 100 if isinstance(y, list) else y
                acc = acc * (c / prev) * (1 + yy * gap(prev_d, dates[t]) / 365)
                prev, prev_d = c, dates[t]
            res.append(acc)
        out.append(res)
    return out


def cash_ret(dates):
    return [0.0] + [(as_of(DTB3, dates[t - 1]) or 0) / 100 * gap(dates[t - 1], dates[t]) / 365 for t in range(1, len(dates))]


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


def run_bt(dates, closes, ppy, targets, cash=None, bench=None):
    start, A = warmup(ppy), len(closes)
    eq = peak = ew = spy = 1.0
    cur, pending, turnover, curve = [0.0] * A, None, 0.0, []

    def equal(t):
        ok = [bool(closes[i][t] and closes[i][t - 1]) for i in range(A)]
        if bench:   # festes Vergleichsdepot: fehlt ein ETF noch, liegt sein Anteil als Geld da
            return [bench[i] if ok[i] else 0.0 for i in range(A)]
        return [1 / sum(ok) if x else 0.0 for x in ok]

    def ratio(i, t):
        return closes[i][t] / closes[i][t - 1] if closes[i][t] and closes[i][t - 1] else 1.0
    eww = equal(start)
    for t in range(start, len(dates)):
        if t > start:
            cr = 1 + (cash[t] if cash else 0.0)
            grow = [cur[i] * ratio(i, t) for i in range(A)]
            total = sum(grow) + (1 - sum(cur)) * cr
            eq *= total
            cur = [g / total for g in grow]
            eg = [eww[i] * ratio(i, t) for i in range(A)]
            et = sum(eg) + (1 - sum(eww)) * cr
            ew *= et
            eww = equal(t) if (t - start) % jsround(ppy / 12) == 0 else [g / et for g in eg]
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


def family(dates, closes, ppy, cash):
    nf = macro(dates)
    F = [[features(c, t, ppy) for c in closes] for t in range(len(dates))]
    raws = []
    for t in range(len(dates)):
        b = inv_vol(F[t])
        raws.append([v(F[t], b, nf[t]) for v in VARIANTS])
    singles = [run_bt(dates, closes, ppy, lambda t, dd, k, v=v: risk(raws[t][v], F[t], ppy, dd)[0], cash) for v in range(len(VARIANTS))]
    state = {"lw": [1 / len(VARIANTS)] * len(VARIANTS), "month": None}
    rec = {}

    def ens_targets(t, dd, k):
        if dates[t][:7] != state["month"]:
            state["lw"] = learn([month_ends(s[0], k) for s in singles], state["lw"])
            state["month"] = dates[t][:7]
        mix = [sum(state["lw"][v] * raws[t][v][i] for v in range(len(VARIANTS))) for i in range(len(closes))]
        rec[t] = risk(mix, F[t], ppy, dd)[0]
        return rec[t]
    ens = run_bt(dates, closes, ppy, ens_targets, cash)
    return ens, singles, state["lw"], F, raws, rec


def combined(dates, closes, ppy, F, rec, cash):
    core = [CORE_W.get(k, 0.0) for k in keys]
    return run_bt(dates, closes, ppy, lambda t, dd, k: [CORE_SHARE * (core[i] if F[t][i] else 0) + (1 - CORE_SHARE) * rec[t][i]
                                                         for i in range(len(closes))] if t in rec else None, cash, core)


def port_vol(w, F, ppy):
    var = 0.0
    for i in range(len(w)):
        for j in range(len(w)):
            if w[i] and w[j] and F[i] and F[j]:
                a, b = F[i]["lr"], F[j]["lr"]
                ma, mb = mean(a), mean(b)
                var += w[i] * w[j] * sum((a[q] - ma) * (b[q] - mb) for q in range(len(a))) / (len(a) - 1)
    return math.sqrt(max(var, 0) * ppy)


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


# ---------- Tagesdaten: Lernen, Ziele heute, Rückblick (Kern + Trend) ----------
dates, raw_closes = series("OneDay", cut_day)
closes = with_dist(dates, raw_closes)
cash_d = cash_ret(dates)
(tcurve, _, tdd), singles, lw, F, raws, rec = family(dates, closes, 252, cash_d)
curve, turn, _ = combined(dates, closes, 252, F, rec, cash_d)
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
tw, _ = risk(mix, F[t], 252, tdd)   # Trend-Teil mit seiner eigenen Verlustbremse
core = [CORE_SHARE * CORE_W.get(k, 0.0) if F[t][i] else 0.0 for i, k in enumerate(keys)]
trend = [(1 - CORE_SHARE) * x for x in tw]
w = [core[i] + trend[i] for i in range(len(keys))]
for i, a in enumerate(d["assets"]):
    if not near(a["weight"], w[i], 1e-4) or not near(a["core"], core[i], 1e-4) or not near(a["trend"], trend[i], 1e-4):
        errors.append(f"{a['sym']} Anteil {a['core']}+{a['trend']}={a['weight']} statt {core[i]:.4f}+{trend[i]:.4f}={w[i]:.4f}")
    if a["trend"] > (1 - CORE_SHARE) * R["maxWeight"] + 1e-9:
        errors.append(f"{a['sym']}: Trend-Teil über der Obergrenze je ETF")
    if not near(a["last"], raw_closes[i][t], 1e-4):
        errors.append(f"{a['sym']}: letzter Kurs {a['last']} statt {raw_closes[i][t]} (echter Kurs, ohne Ausschüttungen)")
if not near(d["exposure"], sum(w), 1e-3) or sum(w) > 1 + 1e-9:
    errors.append(f"Investiert {d['exposure']} statt {sum(w):.4f}")
if not near(d["cash"]["weight"], max(0.0, 1 - sum(w)), 1e-3):
    errors.append(f"Geldmarkt {d['cash']['weight']} statt {1 - sum(w):.4f}")
if not near(d["portVol"], port_vol(w, F[t], 252) * 100, 0.02):
    errors.append(f"Depot-Schwankung {d['portVol']} statt {port_vol(w, F[t], 252) * 100:.2f}")
bd = d["backtest"]["daily"]
for key, col in (("bot", 1), ("ew", 2), ("spy", 3)):
    for k2, v2 in stats([c[col] for c in curve], 252).items():
        if not near(bd[key][k2], v2, tol(k2)):
            errors.append(f"Rückblick täglich {key} {k2}: {bd[key][k2]} statt {v2:.2f}")
if not near(bd["turnoverPerYear"], turn * 100, 0.6):
    errors.append(f"Umschlag {bd['turnoverPerYear']} statt {turn * 100:.0f}")
tp = stats([c[1] for c in tcurve], 252)
if not near(d["backtest"]["trendOnly"]["daily"]["cagr"], tp["cagr"], 0.011):
    errors.append(f"Trend-Teil allein: {d['backtest']['trendOnly']['daily']['cagr']} statt {tp['cagr']:.2f}")

# ---------- Wochendaten: Kern + Trend über den langen Zeitraum ----------
wd, wraw = series("OneWeek", cut_week)
wc = with_dist(wd, wraw)
cash_w = cash_ret(wd)
(_, _, _), wsingles, _, wF, _, wrec = family(wd, wc, 52, cash_w)
wcurve, _, _ = combined(wd, wc, 52, wF, wrec, cash_w)
for key, col in (("bot", 1), ("ew", 2), ("spy", 3)):
    for k2, v2 in stats([c[col] for c in wcurve], 52).items():
        if not near(d["backtest"]["weekly"][key][k2], v2, tol(k2)):
            errors.append(f"Rückblick wöchentlich {key} {k2}: {d['backtest']['weekly'][key][k2]} statt {v2:.2f}")
for i, v in enumerate(L["variants"]):
    want = stats([c[1] for c in wsingles[i][0]], 52)
    if not near(v["weekly"]["cagr"], want["cagr"], 0.011):
        errors.append(f"Variante {v['name']} wöchentlich: {v['weekly']['cagr']} statt {want['cagr']:.2f}")
# Modell-Depot: letzte 15 Schlusskurse mit Ausschüttungen und der Geldmarkt-Index
ci, cidx = 1.0, []
for x in cash_d:
    ci *= 1 + x
    cidx.append(ci)
if [r[0] for r in d["recent"]] != dates[-15:] or d["recentKeys"] != keys + ["cash"]:
    errors.append("Letzte Schlusskurse für das Modell-Depot passen nicht")
elif any(not near(d["recent"][-1][1 + i], closes[i][t], 1e-5 * max(1, closes[i][t])) for i in range(len(keys))) or not near(d["recent"][-1][-1], cidx[t], 1e-7):
    errors.append("Modell-Depot: Kurse mit Ausschüttungen oder Geldmarkt-Index weichen ab")
if L["nfci"]["asOf"] != nfci_rows[-1][0]:
    errors.append("Finanzlage (NFCI) nicht aktuell übernommen")

# ---------- Gegenstücke wie der Bot wählen: UCITS-ETFs aus der offiziellen Liste, zuletzt der US-ETF ----------
# Regeln (unabhängig nachgebaut): Kürzel-Stamm in Wunschreihenfolge, saubere Börsenendung, London vor Xetra; Name passt
# und ist keine andere Anlage; Kurs höchstens 7 Tage alt; 5-Tages-Renditen laufen mit dem Signal-ETF (Korrelation ≥ 0,3,
# ohne passenden Namen ≥ 0,8); höchstens drei je Markt.
TRADE = {
    "us": (["CSPX", "VUAA", "SXR8", "IUSA", "VUSA", "SPY5", "SPXS", "I500"], r"S&P\s*500",
           r"equal|esg|sri|paris|climate|screened|sector|info|tech|financ|health|energy|consumer|industr|utilit|material|communic|real estate|dividend|growth|value|momentum|quality|low vol|buyback|covered|premium"),
    "intl": (["EXUS", "IMEU", "SMEA", "VEUR", "MEUD", "EXSA", "XMEU"], r"ex[\s-]*US|EAFE|Europe|STOXX\s*600",
             r"ex[\s-]*Europe|emerging|small|esg|sri|paris|climate|dividend|value|momentum|quality|low vol|sector|bank|financ|health|energy|tech|real estate|property"),
    "bonds": (["IBTM", "CBU0", "IUSM", "SXRM", "VUTY", "VDTY"], r"treasur", r"0\s*-\s*1|1\s*-\s*3|3\s*-\s*7|20\s*\+|short|ultra|tips|inflation|float|esg"),
    "gold": (["IGLN", "SGLD", "PHAU", "SGLN", "PPFB", "8PSG", "4GLD", "EWG2"], r"gold", r"miner|mining|esg|silver|platin|precious metals|basket"),
    "commod": (["CMOD", "ICOM", "AIGC", "WCOA", "EXXY", "CRBL"], r"commodit|rohstoff|\bCRB\b", r"ex[\s-]*(agri|energy)|agricult|energy|precious|industrial metal|gold|esg|carbon"),
    "reits": (["IUSP", "IDUP", "IQQ7", "IWDP", "IQQ6", "GLRE", "SPYJ", "TRET"], r"property|real estate|REIT|EPRA|immobil", r"europe|asia|china|japan|\buk\b|esg|mortgage"),
}
BAD = re.compile(r"hedged|leverag|short|inverse|\b[23]x\b|daily|ultra|bear|bull", re.I)
etf_type = next(t["instrumentTypeID"] for t in get(f"{base}/api/v1/market-data/instrument-types")["instrumentTypes"] if "etf" in t["instrumentTypeDescription"].lower())
etfs = [x for x in get(f"{base}/api/v1/market-data/instruments?instrumentTypeIds={etf_type}")["instrumentDisplayDatas"]
        if not x.get("isInternalInstrument") and x.get("instrumentTypeID") in (None, etf_type)]


def daily_map(iid, n):
    raw = get(f"{base}/api/v1/market-data/instruments/{iid}/history/candles/desc/OneDay/{n}")["candles"][0]["candles"]
    return {c["fromDate"][:10]: c["close"] for c in raw if c["fromDate"][:10] < cut_day and c["close"] and c["close"] > 0}


def corr5(sig_map, veh_map):
    common = [x for x in sorted(veh_map) if x in sig_map][-121:]
    if len(common) < 45:
        return None
    a = [math.log(sig_map[common[i]] / sig_map[common[i - 5]]) for i in range(5, len(common))]
    b = [math.log(veh_map[common[i]] / veh_map[common[i - 5]]) for i in range(5, len(common))]
    ma, mb = mean(a), mean(b)
    ab = sum((x - ma) * (y - mb) for x, y in zip(a, b))
    aa, bb = sum((x - ma) ** 2 for x in a), sum((y - mb) ** 2 for y in b)
    return ab / math.sqrt(aa * bb) if aa > 0 and bb > 0 else None


for (sym, iid, key), a in zip(chosen, d["assets"]):
    bases, match, avoid = TRADE[key]
    cands = []
    for b in bases:
        hits = [x for x in etfs if x["symbolFull"].upper().split(".")[0] == b and re.fullmatch(r"[A-Z0-9]+\.[A-Z]{1,3}", x["symbolFull"].upper())]
        hits.sort(key=lambda x: ({".L": 0, ".DE": 1}.get(x["symbolFull"].upper()[x["symbolFull"].rfind("."):], 2), x["instrumentID"]))
        cands += [h for h in hits if h not in cands]
    sig_map, want = daily_map(iid, 1000), []
    for v in cands:
        if len(want) >= 3:
            break
        name = v["instrumentDisplayName"]
        if BAD.search(name) or re.search(avoid, name, re.I):
            continue
        m = daily_map(v["instrumentID"], 150)
        if not m or (now.date() - datetime.date.fromisoformat(max(m))).days > 7:
            continue
        c = corr5(sig_map, m)
        ok = re.search(match, name, re.I) is not None
        if (ok if c is None else c >= 0.3 and (ok or c >= 0.8)):
            want.append((v["symbolFull"].upper(), v["instrumentID"], m[max(m)], c))
    got = a.get("trade") or []
    if [t["sym"] for t in got] != [w[0] for w in want] + [sym]:
        errors.append(f"{key}: Gegenstücke {[t['sym'] for t in got]} statt {[w[0] for w in want] + [sym]}")
        continue
    for t, w in zip(got, want):
        if t["id"] != w[1] or not near(t["last"], round(w[2], 4), 1e-4) or (w[3] is not None and not near(t["corr"], w[3], 0.006)):
            errors.append(f"{key}: {t['sym']} Kurs/Gleichlauf {t['last']}/{t['corr']} statt {w[2]}/{w[3]}")
    if got[-1]["id"] != iid or not got[-1].get("us"):
        errors.append(f"{key}: letzte Wahl muss der US-ETF {sym} sein")

# Geldmarkt-ETF: nur nach Kürzel (IB01, BB3M, VDST, ZPR1, TBIL), Name (Treasury/T-Bill, Laufzeit bis 1 Jahr bzw. 0–3 Monate)
# und aktuellen Kursen, höchstens drei
cash_cands = []
for b in ["IB01", "BB3M", "VDST", "ZPR1", "TBIL"]:
    hits = [x for x in etfs if x["symbolFull"].upper().split(".")[0] == b and re.fullmatch(r"[A-Z0-9]+\.[A-Z]{1,3}", x["symbolFull"].upper())]
    hits.sort(key=lambda x: ({".L": 0, ".DE": 1}.get(x["symbolFull"].upper()[x["symbolFull"].rfind("."):], 2), x["instrumentID"]))
    cash_cands += [h for h in hits if h not in cash_cands]
cash_want = []
for h in cash_cands:
    if len(cash_want) >= 3:
        break
    nm = h["instrumentDisplayName"]
    if not (re.search(r"treasur|t-?bill", nm, re.I) and re.search(r"0\s*-\s*1|0\s*-\s*3\s*month|bill", nm, re.I)) \
            or re.search(r"1\s*-\s*3\s*y|3\s*-\s*7|7\s*-\s*10|20\s*\+|tips|inflation|float|esg", nm, re.I) or BAD.search(nm):
        continue
    m = daily_map(h["instrumentID"], 30)
    if not m or (now.date() - datetime.date.fromisoformat(max(m))).days > 7:
        continue
    cash_want.append(h["symbolFull"].upper())
if [v["sym"] for v in d["cash"]["trade"]] != cash_want:
    errors.append(f"Geldmarkt-ETF {[v['sym'] for v in d['cash']['trade']]} statt {cash_want}")

if errors:
    print(f"::error::Gegenrechnung Trend-Bot fehlgeschlagen – {len(errors)} Abweichung(en):")
    for e in errors[:30]:
        print("  -", e)
    sys.exit(1)
print(f"Gegenrechnung Trend-Bot bestanden: Kern + Trend, {len(d['assets'])} ETFs, Geldmarkt {', '.join(cash_want) or '–'}, Gegenstücke "
      f"({', '.join(t['sym'] for a in d['assets'] for t in a['trade'][:1])}), 5 Regel-Varianten, Lerngewichte "
      f"({', '.join(f'{x * 100:.0f} %' for x in lw)}), Bremsen und alle Rückblick-Tests stimmen.")

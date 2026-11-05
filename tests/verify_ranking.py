#!/usr/bin/env python3
"""Unabhängige Gegenrechnung der Tagesempfehlung.

Rechnet jede veröffentlichte Kennzahl in ranking.json aus den Monatsrenditen in returns.json
mit einer zweiten, eigenständigen Implementierung (nur Python-Standardbibliothek) nach und
prüft die Auswahlregeln. Bei der kleinsten Abweichung endet das Skript mit Fehler – dann wird
im GitHub-Job nichts veröffentlicht.

Aufruf: python3 tests/verify_ranking.py data/ranking.json data/returns.json
"""
import json
import math
import sys
from statistics import NormalDist

Z = NormalDist()
EULER = 0.5772156649015329
TOL = {"dsr": 5e-4, "cagr": 5e-3, "mdd": 5e-3, "sharpe": 5e-3, "nEff": 5e-2, "avgCorrelation": 5e-4,
       "postMean": 5e-4, "postSd": 5e-4, "sdMonthly": 5e-4, "score": 5e-4, "pDay": 5e-4, "priorMonthly": 5e-4, "tau2": 5e-4}


def metrics(returns_pct, rf, n_trials, mdd_input):
    n = len(returns_pct)
    r = [max(x, -99) / 100 for x in returns_pct]
    rfm = (1 + rf / 100) ** (1 / 12) - 1
    x = [v - rfm for v in r]
    mx = sum(x) / n
    m2 = sum((v - mx) ** 2 for v in x) / n
    sd = max(math.sqrt(m2 * n / (n - 1)), 1e-9)
    skew = (sum((v - mx) ** 3 for v in x) / n) / m2 ** 1.5 if m2 > 0 else 0.0
    kurt = (sum((v - mx) ** 4 for v in x) / n) / m2 ** 2 if m2 > 0 else 3.0
    sr = mx / sd
    eq = peak = 1.0
    mdd_m = 0.0
    for v in r:
        eq *= 1 + v
        peak = max(peak, eq)
        mdd_m = max(mdd_m, 1 - eq / peak)
    mdd = max(mdd_m * 100, abs(mdd_input) if mdd_input is not None else 0.0)
    cagr = (eq ** (12 / n) - 1) * 100
    if n_trials <= 1:
        bench = 0.0
    else:
        bench = math.sqrt(1 / (n - 1)) * ((1 - EULER) * Z.inv_cdf(1 - 1 / n_trials)
                                          + EULER * Z.inv_cdf(1 - 1 / (n_trials * math.e)))
    d = 1 - skew * sr + (kurt - 1) / 4 * sr * sr
    if not d > 0:
        d = 1 + sr * sr / 2
    dsr = Z.cdf((sr - bench) * math.sqrt(n - 1) / math.sqrt(d))
    return {"sharpe": sr * math.sqrt(12), "cagr": cagr, "mdd": mdd, "dsr": dsr}


def shrink(items):
    """Random-Effects-Schrumpfung (DerSimonian & Laird) – unabhängig von stats.js implementiert."""
    k = len(items)
    w = [1 / max(se2, 1e-12) for _, se2 in items]
    sw = sum(w)
    yw = sum(wi * m for wi, (m, _) in zip(w, items)) / sw
    q = sum(wi * (m - yw) ** 2 for wi, (m, _) in zip(w, items))
    c = sw - sum(wi * wi for wi in w) / sw
    tau2 = max(0.0, (q - (k - 1)) / c) if k > 1 and c > 0 else 0.0
    ws = [1 / (max(se2, 1e-12) + tau2) for _, se2 in items]
    prior = sum(wsi * m for wsi, (m, _) in zip(ws, items)) / sum(ws)
    post = []
    for m, se2 in items:
        b = tau2 / (tau2 + se2) if tau2 > 0 else 0.0
        post.append((prior + b * (m - prior), math.sqrt(b * se2)))
    return prior, tau2, post


def p_profit(post_mean, sd_monthly, post_sd, h, cost=0.0):
    expected = post_mean * h - cost
    sd = math.sqrt(sd_monthly ** 2 * h + (post_sd * h) ** 2)
    return Z.cdf(expected / sd) if sd > 0 else (1.0 if expected > 0 else 0.0)


def pearson(a, b):
    ma, mb = sum(a) / len(a), sum(b) / len(b)
    sab = sum((p - ma) * (q - mb) for p, q in zip(a, b))
    saa = sum((p - ma) ** 2 for p in a)
    sbb = sum((q - mb) ** 2 for q in b)
    return sab / math.sqrt(saa * sbb) if saa > 0 and sbb > 0 else 0.0


def main(ranking_file, returns_file):
    ranking = json.load(open(ranking_file, encoding="utf-8"))
    returns = json.load(open(returns_file, encoding="utf-8"))
    cfg = ranking["config"]
    errors = []

    def check(label, ours, published, key):
        if published is None or not math.isfinite(ours) or abs(ours - published) > TOL[key]:
            errors.append(f"{label}: veröffentlicht {published}, nachgerechnet {ours:.6f}")

    traders = returns["traders"]
    series = [dict((m, g) for m, g in t["months"]) for t in traders]
    corrs = []
    for i in range(len(series)):
        for j in range(i + 1, len(series)):
            common = [m for m in series[i] if m in series[j]]
            if len(common) >= 12:
                corrs.append(pearson([series[i][m] for m in common], [series[j][m] for m in common]))
    rho = sum(corrs) / len(corrs) if corrs else 0.0
    r = min(1.0, max(0.0, rho))
    n_eff = max(1.0, r + (1 - r) * len(traders))
    check("mittlere Korrelation", rho, ranking.get("avgCorrelation"), "avgCorrelation")
    check("effektive Trader-Zahl", n_eff, ranking.get("nEff"), "nEff")
    if ranking.get("evaluated") != len(traders):
        errors.append(f"Anzahl ausgewertet: {ranking.get('evaluated')} statt {len(traders)}")

    published = {row["userName"]: row for row in ranking.get("all", [])}
    if set(published) != {t["userName"] for t in traders}:
        errors.append("Die Trader in ranking.json und returns.json stimmen nicht überein")

    # Schrumpfung über alle Trader
    noise = 1 - min(0.95, max(0.0, rho))   # nur Zufall, der nicht alle Trader gemeinsam trifft
    basics = {}
    for t in traders:
        vals = [g for _, g in t["months"]]
        n = len(vals)
        mu = sum(vals) / n
        sd = math.sqrt(sum((x - mu) ** 2 for x in vals) / (n - 1))
        basics[t["userName"]] = (mu, sd, sd * sd / n * noise)
    names_order = [t["userName"] for t in traders]
    prior, tau2, post = shrink([(basics[nm][0], basics[nm][2]) for nm in names_order])
    post_by = dict(zip(names_order, post))
    shr = ranking.get("shrinkage") or {}
    check("Schrumpfung: gemeinsamer Mittelwert", prior, shr.get("priorMonthly"), "priorMonthly")
    check("Schrumpfung: τ²", tau2, shr.get("tau2"), "tau2")
    score_by = {}

    recomputed = {}
    for t in traders:
        name = t["userName"]
        values = [g for _, g in t["months"]]
        if len(values) < cfg["minMonths"]:
            errors.append(f"{name}: nur {len(values)} Monate, obwohl mindestens {cfg['minMonths']} verlangt sind")
            continue
        m = metrics(values, returns["rf"], ranking["nEff"], t.get("peakToValley"))
        recomputed[name] = m
        row = published.get(name)
        if not row:
            continue
        # Plausibilität der Eingangsdaten: ein Rückgang über 100 % ist unmöglich
        p2v = t.get("peakToValley")
        if p2v is not None and not (0 <= p2v <= 100):
            errors.append(f"{name}: unmöglicher eToro-Drawdown {p2v} % (Einheitenfehler?)")
        if row.get("mdd") is not None and not (0 <= row["mdd"] <= 100):
            errors.append(f"{name}: unmöglicher Drawdown {row['mdd']} %")
        for key in ("dsr", "cagr", "mdd", "sharpe"):
            check(f"{name} {key}", m[key], row.get(key), key)
        pm, psd = post_by[name]
        sdm = basics[name][1]
        score_by[name] = pm / sdm if sdm > 0 else 0.0
        check(f"{name} erwartete Monatsrendite", pm, row.get("postMean"), "postMean")
        check(f"{name} Unsicherheit", psd, row.get("postSd"), "postSd")
        check(f"{name} Monatsschwankung", sdm, row.get("sdMonthly"), "sdMonthly")
        check(f"{name} Bewertung", score_by[name], row.get("score"), "score")
        check(f"{name} Gewinntag-Chance", p_profit(pm, sdm, psd, 1 / 21), row.get("pDay"), "pDay")
        # Regeln: Grenzen und Sicherheitsschwelle
        risk = t.get("risk")
        in_limits = (risk is None or risk <= cfg["maxRisk"]) and m["mdd"] <= cfg["maxDd"] + 1e-9
        qualified = in_limits and m["dsr"] >= cfg["threshold"]
        if bool(row.get("inLimits")) != in_limits:
            errors.append(f"{name}: inLimits={row.get('inLimits')}, richtig wäre {in_limits}")
        if bool(row.get("qualified")) != qualified:
            errors.append(f"{name}: qualified={row.get('qualified')}, richtig wäre {qualified}")

    # Reihenfolge der Top 25: sichere Trader nach Rendite, danach übrige (innerhalb der Grenzen) nach Sicherheit
    rows = list(published.values())
    safe = sorted([x for x in rows if x["qualified"]], key=lambda x: -x["cagr"])
    rest = sorted([x for x in rows if not x["qualified"] and x["inLimits"]], key=lambda x: -x["dsr"])
    expected = [x["userName"] for x in (safe + rest)[: cfg["top"]]]
    actual = [x["userName"] for x in ranking.get("top", [])]
    if expected != actual:
        errors.append(f"Reihenfolge der Top-Liste weicht ab: erwartet {expected[:5]} …, veröffentlicht {actual[:5]} …")

    # Empfehlung: nur ein sicherer Trader, und nur wenn es überhaupt einen gibt
    rec = ranking.get("recommendation")
    if safe and not rec:
        errors.append("Es gibt sichere Trader, aber keine Empfehlung")
    if rec and rec["userName"] not in {x["userName"] for x in safe}:
        errors.append(f"Empfohlener Trader {rec['userName']} erfüllt nicht alle Bedingungen")
    if rec and rec.get("changed") is not False and safe and rec["userName"] != safe[0]["userName"]:
        errors.append(f"Neue Empfehlung {rec['userName']} ist nicht der sichere Trader mit der höchsten Rendite")

    # Tageswahl: grün nur mit gesichertem Trader; neue Wahl = höchste Bewertung; unveränderte Wahl höchstens Platz keepWithinTop
    pick = ranking.get("pick")
    positive = lambda x: score_by.get(x["userName"], 0) > 0   # nur positive erwartete Rendite kommt in Frage
    green = sorted([x for x in rows if x["qualified"] and positive(x)], key=lambda x: -score_by.get(x["userName"], 0))
    yellow = sorted([x for x in rows if x["inLimits"] and positive(x)], key=lambda x: -score_by.get(x["userName"], 0))
    pool = green or yellow
    if pool and not pick:
        errors.append("Es gibt Trader innerhalb der Grenzen mit positiver erwarteter Rendite, aber keine Tageswahl")
    if not pool and pick:
        errors.append("Tageswahl, obwohl kein Trader die Grenzen einhält")
    if pick and pool:
        light = "green" if green else "yellow"
        names = [x["userName"] for x in pool]
        if pick.get("light") != light:
            errors.append(f"Tageswahl-Ampel {pick.get('light')}, richtig wäre {light}")
        if pick["userName"] not in names:
            errors.append(f"Tageswahl {pick['userName']} ist nicht im zulässigen Kreis")
        elif pick.get("changed") and pick["userName"] != names[0]:
            errors.append(f"Neue Tageswahl {pick['userName']} ist nicht der Trader mit der besten Bewertung ({names[0]})")
        elif names.index(pick["userName"]) >= cfg["keepWithinTop"]:
            errors.append(f"Tageswahl {pick['userName']} liegt nur auf Platz {names.index(pick['userName']) + 1}")
        row = published.get(pick["userName"], {})
        # Kunden-ID (zum Kopieren über die API): muss eine positive ganze Zahl sein und zum selben Trader gehören
        if pick.get("cid") is not None:
            if not isinstance(pick["cid"], int) or isinstance(pick["cid"], bool) or pick["cid"] <= 0:
                errors.append(f"Tageswahl hat eine ungültige Kunden-ID {pick['cid']!r}")
            elif row.get("cid") != pick["cid"]:
                errors.append(f"Kunden-ID der Tageswahl {pick['cid']} passt nicht zu {pick['userName']} ({row.get('cid')})")
        want = row.get("amountPct", 0) * (1 if light == "green" else 0.5)
        if abs((pick.get("amountPct") or 0) - want) > 1e-3:
            errors.append(f"Tageswahl-Betrag {pick.get('amountPct')} statt {want}")

    if errors:
        print(f"::error::Gegenrechnung fehlgeschlagen – {len(errors)} Abweichung(en):")
        for e in errors[:40]:
            print("  -", e)
        sys.exit(1)
    print(f"Gegenrechnung bestanden: {len(recomputed)} Trader, alle Kennzahlen, Grenzen, Reihenfolge und Empfehlung stimmen "
          f"(effektiv N = {n_eff:.1f}, mittlere Korrelation {rho:.3f}); Schrumpfung und Tageswahl ebenfalls bestätigt.")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])

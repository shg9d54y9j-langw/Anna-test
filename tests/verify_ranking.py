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
TOL = {"dsr": 5e-4, "cagr": 5e-3, "mdd": 5e-3, "sharpe": 5e-3, "nEff": 5e-2, "avgCorrelation": 5e-4}


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
        for key in ("dsr", "cagr", "mdd", "sharpe"):
            check(f"{name} {key}", m[key], row.get(key), key)
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

    if errors:
        print(f"::error::Gegenrechnung fehlgeschlagen – {len(errors)} Abweichung(en):")
        for e in errors[:40]:
            print("  -", e)
        sys.exit(1)
    print(f"Gegenrechnung bestanden: {len(recomputed)} Trader, alle Kennzahlen, Grenzen, Reihenfolge und Empfehlung stimmen "
          f"(effektiv N = {n_eff:.1f}, mittlere Korrelation {rho:.3f}).")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])

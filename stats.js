// Gemeinsame Statistik für die Website (compare.js, daily.js) und den täglichen Job (scripts/daily-ranking.mjs).
// Probabilistic Sharpe Ratio (Bailey & López de Prado 2012) und Deflated Sharpe Ratio (2014).
(function (root) {
  "use strict";
  const EULER = 0.5772156649015329;
  const mean = a => a.reduce((s, x) => s + x, 0) / a.length;

  // Standardnormalverteilung Φ(z) (Abramowitz & Stegun 7.1.26, Fehler < 1,5e-7)
  function normCdf(z) {
    const x = Math.abs(z) / Math.SQRT2, t = 1 / (1 + 0.3275911 * x);
    const erf = 1 - (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) * Math.exp(-x * x);
    return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
  }

  // Umkehrfunktion Φ⁻¹(p) (Acklam, relativer Fehler < 1,2e-9)
  function normInv(p) {
    const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
    const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
    const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
    const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
    const tail = q => (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    if (p < 0.02425) return tail(Math.sqrt(-2 * Math.log(p)));
    if (p > 1 - 0.02425) return -tail(Math.sqrt(-2 * Math.log(1 - p)));
    const q = p - 0.5, r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }

  // P(wahre Sharpe-Quote > bench) – berücksichtigt Länge der Historie, Schiefe und Wölbung
  function psr(sr, n, skew, kurt, bench) {
    let d = 1 - skew * sr + (kurt - 1) / 4 * sr * sr;
    if (!(d > 0)) d = 1 + sr * sr / 2;
    return normCdf((sr - bench) * Math.sqrt(n - 1) / Math.sqrt(d));
  }

  // Erwartete beste Monats-Sharpe-Quote von N Tradern ganz ohne Können bei n Monaten Historie
  function luckBenchmark(n, N) {
    if (N <= 1) return 0;
    return Math.sqrt(1 / (n - 1)) * ((1 - EULER) * normInv(1 - 1 / N) + EULER * normInv(1 - 1 / (N * Math.E)));
  }

  // Monate Historie, die bei gleicher Leistung für die geforderte Sicherheit nötig wären
  function monthsNeeded(m, N, thr) {
    if (!(m.sr > 0)) return Infinity;
    for (let k = m.n + 1; k <= 600; k++) if (psr(m.sr, k, m.skew, m.kurt, luckBenchmark(k, N)) >= thr) return k;
    return Infinity;
  }

  // Kennzahlen aus Monatsrenditen in % (älteste zuerst).
  // opts: rf = Zins ohne Risiko in % p.a., N = Anzahl (effektiver) Versuche, mddInput = Drawdown-Angabe in %
  function metrics(returnsPct, opts = {}) {
    const n = returnsPct.length;
    if (n < 3) return null;
    const rf = opts.rf || 0, N = Math.max(1, opts.N || 1);
    const r = returnsPct.map(x => Math.max(x, -99) / 100);
    const rfm = Math.pow(1 + rf / 100, 1 / 12) - 1;
    const x = r.map(v => v - rfm);                           // Überrendite je Monat
    const mx = mean(x);
    const m2 = mean(x.map(v => (v - mx) ** 2));
    const sd = Math.max(Math.sqrt(m2 * n / (n - 1)), 1e-9);  // Stichproben-Standardabweichung
    const skew = m2 > 0 ? mean(x.map(v => (v - mx) ** 3)) / m2 ** 1.5 : 0;
    const kurt = m2 > 0 ? mean(x.map(v => (v - mx) ** 4)) / m2 ** 2 : 3;
    const sr = mx / sd;

    let eq = 1, peak = 1, mddM = 0;
    const curve = [100];
    for (const v of r) { eq *= 1 + v; peak = Math.max(peak, eq); mddM = Math.max(mddM, 1 - eq / peak); curve.push(eq * 100); }
    const down = Math.sqrt(mean(x.map(v => Math.min(0, v) ** 2)));
    const mdd = Math.max(mddM * 100, Number.isFinite(opts.mddInput) ? Math.abs(opts.mddInput) : 0);
    const cagr = (Math.pow(eq, 12 / n) - 1) * 100;
    return {
      n, curve, sr, skew, kurt, mdd, cagr,
      sharpe: sr * Math.sqrt(12),
      sortino: down > 0 ? mx / down * Math.sqrt(12) : Infinity,
      calmar: mdd > 0 ? cagr / mdd : Infinity,
      dsr: psr(sr, n, skew, kurt, luckBenchmark(n, N)),
      halfKelly: mx > 0 ? mx / (sd * sd) / 2 : 0,           // halbes Kelly-Kriterium, Anteil vom Konto
    };
  }

  // Kopier-Betrag als Anteil vom Konto: kleinster Wert aus Max. Anteil, Verlustbudget ÷ Copy Stop Loss und ½ Kelly.
  // lim: share = Max. Anteil (0–1), lossPct = Verlustbudget ÷ Kontostand (0–1)
  function allocation(m, lim) {
    const csl = Math.min(95, Math.max(5, Math.ceil(m.mdd * 1.25)));
    const options = [
      { key: "share", frac: lim.share },
      { key: "loss", frac: lim.lossPct / (csl / 100) },
      { key: "kelly", frac: m.halfKelly },
    ];
    const bind = options.reduce((best, o) => (o.frac < best.frac ? o : best));
    return { csl, frac: Math.max(0, bind.frac), bind: bind.key };
  }

  // Pearson-Korrelation zweier gleich langer Reihen
  function correlation(a, b) {
    const ma = mean(a), mb = mean(b);
    let sab = 0, saa = 0, sbb = 0;
    for (let i = 0; i < a.length; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; }
    return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : 0;
  }

  // Effektive Zahl unabhängiger Versuche bei M Kandidaten mit mittlerer Korrelation ρ̄: N = ρ̄ + (1 − ρ̄)·M
  function effectiveTrials(M, avgCorr) {
    const r = Math.min(1, Math.max(0, avgCorr || 0));
    return Math.max(1, r + (1 - r) * M);
  }

  // Schrumpfung über alle Trader (Random-Effects-Modell, Schätzer nach DerSimonian & Laird), im Sinne von
  // Jones & Shanken (2005) und Harvey & Liu (2018): Jeder Trader-Mittelwert wird zum gemeinsamen Mittel gezogen –
  // umso stärker, je kürzer und schwankender seine Historie ist. items: [{ mean, se2 }] (Monatsrendite in %, Varianz des Mittelwerts)
  function shrink(items) {
    const k = items.length;
    if (!k) return { prior: 0, tau2: 0, post: [] };
    const w = items.map(it => 1 / Math.max(it.se2, 1e-12));
    const sw = w.reduce((a, b) => a + b, 0);
    const yw = items.reduce((s, it, j) => s + w[j] * it.mean, 0) / sw;
    const Q = items.reduce((s, it, j) => s + w[j] * (it.mean - yw) ** 2, 0);
    const c = sw - w.reduce((s, x) => s + x * x, 0) / sw;
    const tau2 = k > 1 && c > 0 ? Math.max(0, (Q - (k - 1)) / c) : 0;
    const ws = items.map(it => 1 / (Math.max(it.se2, 1e-12) + tau2));
    const prior = items.reduce((s, it, j) => s + ws[j] * it.mean, 0) / ws.reduce((a, b) => a + b, 0);
    const post = items.map(it => {
      const B = tau2 > 0 ? tau2 / (tau2 + it.se2) : 0;   // Gewicht der eigenen Historie (0 = gar keins)
      return { mean: prior + B * (it.mean - prior), sd: Math.sqrt(B * it.se2), weight: B };
    });
    return { prior, tau2, post };
  }

  // Vorhersage für einen Zeitraum von h Monaten (Normalnäherung, Monatsrenditen als unabhängig angenommen):
  // erwartete Rendite nach Kosten und Wahrscheinlichkeit, nach Kosten im Plus zu liegen.
  // Die Unsicherheit über den wahren Mittelwert (postSd) geht in die Streuung ein.
  function horizon(postMean, sdMonthly, postSd, h, costPct = 0) {
    const expected = postMean * h - costPct;
    const sd = Math.sqrt(sdMonthly * sdMonthly * h + (postSd * h) ** 2);
    return { expected, pProfit: sd > 0 ? normCdf(expected / sd) : (expected > 0 ? 1 : 0) };
  }
  const HORIZONS = { m30: 1 / (21 * 13), d1: 1 / 21, w1: 5 / 21, m1: 1, m3: 3 };   // 21 Börsentage, 13 halbe Stunden je Handelstag (USA)

  root.TradeStats = { EULER, mean, normCdf, normInv, psr, luckBenchmark, monthsNeeded, metrics, allocation, correlation, effectiveTrials, shrink, horizon, HORIZONS };
})(typeof globalThis !== "undefined" ? globalThis : window);

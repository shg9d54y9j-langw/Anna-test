// Forschungs-Lauf für den Trend-Bot (nur von Hand, Workflow „Trend-Forschung“) – handelt nicht, ändert nichts.
//
// Vergleicht vorab festgelegte, in der Forschung begründete Verbesserungen mit der heutigen Regel auf echten
// eToro-Wochenkursen. Damit nichts auf Zufall getrimmt wird, zählt nur, was in BEIDEN Hälften (bis 2018 / ab 2019)
// besser ist. Die fünf Regeln und das Lernen sind dieselben wie im Bot (importiert), nur die Risiko-Schicht, das
// Universum und die Verzinsung des freien Geldes werden variiert.
//
// Ausschüttungen: eToro-Kurse enthalten vermutlich keine Dividenden und Zinsen. Für Anleihen (3–6 % im Jahr) wäre das
// ein grober Fehler. Deshalb gibt es jede Rechnung auch mit geschätzten Ausschüttungen: Aktien mit üblicher
// Dividendenrendite, Anleihen mit der jeweiligen Marktrendite von FRED, Rohstoffe mit dem T-Bill-Zins (Sicherheiten).
//
// Aufruf: node scripts/trend-research.mjs   (braucht den Lese-Schlüssel)   Ausgabe: Protokoll + data/trend-research.json
import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { log, warn, hasKeys } from "./etoro.mjs";
import { fredSeries } from "./fred.mjs";
import {
  VARIANTS, featuresAt, inverseVol, learnStep, monthEnds, ddMultiplier, weekOf, warmup, perf, align, macroAt,
  familyBacktest, resolve, candles, RULES,
} from "./trend-bot.mjs";

const OUT = process.env.RESEARCH_OUT || fileURLToPath(new URL("../data/trend-research.json", import.meta.url));
const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
const sd = a => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const r2 = x => (Number.isFinite(x) ? Math.round(x * 100) / 100 : null);

// Universum: die 6 Märkte des Bots und das 12er-Universum von Keller & Keuning 2018 („DAA“) plus mittlere Anleihen.
// yld = geschätzte Ausschüttung pro Jahr; fred = Marktrendite (%) als Ausschüttung
const ASSETS = [
  { key: "us", syms: ["SPY"], risky: true, yld: 0.018 },
  { key: "intl", syms: ["EFA", "VEA"], risky: true, yld: 0.03 },
  { key: "bonds", syms: ["IEF"], risky: false, fred: "DGS10" },
  { key: "gold", syms: ["GLD", "IAU"], risky: false, yld: 0 },
  { key: "commod", syms: ["DBC", "PDBC", "GSG"], risky: true, fred: "DTB3" },
  { key: "reits", syms: ["VNQ", "IYR"], risky: true, yld: 0.038 },
  { key: "small", syms: ["IWM"], risky: true, yld: 0.013 },
  { key: "nasdaq", syms: ["QQQ"], risky: true, yld: 0.007 },
  { key: "europe", syms: ["VGK"], risky: true, yld: 0.03 },
  { key: "japan", syms: ["EWJ"], risky: true, yld: 0.02 },
  { key: "em", syms: ["EEM", "VWO"], risky: true, yld: 0.025 },
  { key: "long", syms: ["TLT"], risky: false, fred: "DGS30" },
  { key: "hy", syms: ["HYG", "JNK"], risky: true, fred: "BAMLH0A0HYM2EY" },
  { key: "ig", syms: ["LQD"], risky: false, fred: "BAMLC0A0CMEY" },
];
const U6 = ["us", "intl", "bonds", "gold", "commod", "reits"];
const U13 = ["us", "small", "nasdaq", "europe", "japan", "em", "reits", "commod", "gold", "long", "hy", "ig", "bonds"];

// Vorab festgelegte Fälle (keine Suche nach dem besten Parameter)
const CASES = [
  { id: "A", text: "heute: 6 Märkte, Kurse ohne Ausschüttungen, Geld 0 %", uni: U6, tr: false, cash: false, scaleUp: false, target: 10, dd: true, cap: 0.35 },
  { id: "A1", text: "heute, mit Ausschüttungen (realistisch)", uni: U6, tr: true, cash: false, scaleUp: false, target: 10, dd: true, cap: 0.35 },
  { id: "B", text: "+ freies Geld in T-Bills", uni: U6, tr: true, cash: true, scaleUp: false, target: 10, dd: true, cap: 0.35 },
  { id: "C", text: "+ Schwankungsziel 10 % auch nach oben (bis 100 % investiert)", uni: U6, tr: true, cash: true, scaleUp: true, target: 10, dd: true, cap: 0.35 },
  { id: "D", text: "C mit Ziel 12 %", uni: U6, tr: true, cash: true, scaleUp: true, target: 12, dd: true, cap: 0.35 },
  { id: "E", text: "C mit 13 Märkten (Keller & Keuning 2018), je ETF höchstens 25 %", uni: U13, tr: true, cash: true, scaleUp: true, target: 10, dd: true, cap: 0.25 },
  { id: "F", text: "E mit Ziel 12 %", uni: U13, tr: true, cash: true, scaleUp: true, target: 12, dd: true, cap: 0.25 },
  { id: "G", text: "E ohne Verlustbremse", uni: U13, tr: true, cash: true, scaleUp: true, target: 10, dd: false, cap: 0.25 },
  { id: "H", text: "F ohne Verlustbremse", uni: U13, tr: true, cash: true, scaleUp: true, target: 12, dd: false, cap: 0.25 },
];
const SPLIT = "2019-01-01";
// Zweite Runde: bekannte Monatsregeln aus der Literatur (je Monatsanfang neu, dazwischen liegen lassen), mit Ausschüttungen,
// freies Geld in T-Bills, Kosten wie beim Bot. F = Kennzahlen je Markt, ctx.tb12 = T-Bill-Ertrag der letzten 12 Monate.
const above10 = f => Boolean(f && f.p > f.sma10);
const anyUp = f => Boolean(f && (f.r3 > 0 || f.r6 > 0 || f.r12 > 0 || f.p > f.sma));
const MONTHLY = [
  { id: "I", text: "Faber GTAA: 5 Märkte je 20 %, nur über der 10-Monats-Linie, sonst T-Bills", uni: ["us", "intl", "bonds", "reits", "commod"],
    fn: F => F.map(f => (above10(f) ? 0.2 : 0)) },
  { id: "I6", text: "GTAA mit Gold: 6 Märkte je 1/6, nur über der 10-Monats-Linie", uni: U6, fn: F => F.map(f => (above10(f) ? 1 / 6 : 0)) },
  { id: "J", text: "6 Märkte gleich, nur bei ganz gebrochenem Trend (0 von 4) in T-Bills", uni: U6, fn: F => F.map(f => (anyUp(f) ? 1 / 6 : 0)) },
  { id: "K", text: "60/40 mit Trendfilter: jeder Teil nur über der 10-Monats-Linie, sonst T-Bills", uni: ["us", "bonds"], fn: F => [above10(F[0]) ? 0.6 : 0, above10(F[1]) ? 0.4 : 0] },
  { id: "K2", text: "60/40 mit Trendfilter nur für Aktien (Anleihen immer)", uni: ["us", "bonds"], fn: F => [above10(F[0]) ? 0.6 : 0, F[1] ? 0.4 : 0] },
  { id: "L", text: "Antonacci GEM: stärkster von US/Welt, wenn besser als T-Bills, sonst Anleihen", uni: ["us", "intl", "bonds"],
    fn: (F, ctx) => (!F[0] ? [0, 0, F[2] ? 1 : 0] : F[0].r12 > ctx.tb12 ? (F[1] && F[1].r12 > F[0].r12 ? [0, 1, 0] : [1, 0, 0]) : [0, 0, F[2] ? 1 : 0]) },
  { id: "S", text: "S&P 500 mit Trendfilter: über der 10-Monats-Linie Aktien, sonst Anleihen", uni: ["us", "bonds"], fn: F => (above10(F[0]) ? [1, 0] : [0, F[1] ? 1 : 0]) },
];

// ---------- Risiko-Schicht mit Optionen (A entspricht genau dem Bot) ----------
function riskLayerX(raw, F, ppy, ddPct, o) {
  let w = raw.map((x, i) => (F[i] ? Math.min(o.cap, Math.max(0, x)) : 0));
  const pvOf = ws => {
    let pv = 0;
    for (let i = 0; i < ws.length; i++) for (let j = 0; j < ws.length; j++) {
      if (!ws[i] || !ws[j]) continue;
      const a = F[i].lr, b = F[j].lr, ma = mean(a), mb = mean(b);
      let c = 0;
      for (let q = 0; q < a.length; q++) c += (a[q] - ma) * (b[q] - mb);
      pv += ws[i] * ws[j] * c / (a.length - 1);
    }
    return Math.sqrt(Math.max(0, pv) * ppy);
  };
  const pv = pvOf(w), t = o.target / 100;
  let mult = pv > t ? t / pv : 1;
  if (o.scaleUp && pv > 0 && pv < t) mult = t / pv;   // auch nach oben – aber nie über 100 % und nie über die Obergrenze je ETF
  w = w.map(x => Math.min(o.cap, x * mult));
  const gross = w.reduce((a, b) => a + b, 0);
  if (gross > 1) w = w.map(x => x / gross);
  const dm = o.dd ? ddMultiplier(ddPct) : 1;
  return w.map(x => x * dm);
}
// ---------- Rückblick mit Zins auf das freie Geld (sonst wie runBacktest im Bot) ----------
function runBT(series, ppy, targetsAt, cashRet) {
  const { dates, closes } = series, n = dates.length, A = closes.length;
  const start = warmup(ppy);
  if (n < start + 2) return null;
  let eq = 1, peak = 1, cur = Array(A).fill(0), pending = null, turnover = 0;
  const curve = [];
  for (let t = start; t < n; t++) {
    if (t > start) {
      const ratio = i => (closes[i][t] > 0 && closes[i][t - 1] > 0 ? closes[i][t] / closes[i][t - 1] : 1);
      const grow = cur.map((w, i) => w * ratio(i));
      const total = grow.reduce((a, b) => a + b, 0) + (1 - cur.reduce((a, b) => a + b, 0)) * (1 + (cashRet ? cashRet[t] : 0));
      eq *= total;
      cur = grow.map(v => v / total);
    }
    if (pending) {
      let traded = 0;
      const full = ppy < 100 || weekOf(dates[t]) !== weekOf(dates[t - 1]);
      cur = cur.map((c, i) => {
        const g = pending[i];
        if (!full && !(g === 0 && c > 0)) return c;
        if ((g === 0 && c > 0) || (c === 0 && g > 0) || Math.abs(g - c) > RULES.band) { traded += Math.abs(g - c); return g; }
        return c;
      });
      eq *= 1 - traded * RULES.costPct / 100;
      turnover += traded;
    }
    peak = Math.max(peak, eq);
    pending = targetsAt(t, (1 - eq / peak) * 100, curve.length);
    curve.push({ d: dates[t], eq, exp: cur.reduce((a, b) => a + b, 0) });
  }
  return { curve, turnoverPerYear: turnover / Math.max((n - start) / ppy, 1e-9) };
}
function familyBT(series, ppy, ctxAt, o, cashRet) {
  const { dates, closes } = series;
  const F = dates.map((_, t) => closes.map(c => featuresAt(c, t, ppy)));
  const B = F.map(inverseVol);
  const raws = dates.map((_, t) => VARIANTS.map(v => v.raw(F[t], B[t], ctxAt(t))));
  const singles = VARIANTS.map((_, v) => runBT(series, ppy, (t, dd) => riskLayerX(raws[t][v], F[t], ppy, dd, o), cashRet));
  if (singles.some(x => !x)) return null;
  let lw = Array(VARIANTS.length).fill(1 / VARIANTS.length), lastMonth = null;
  const ens = runBT(series, ppy, (t, dd, k) => {
    const m = dates[t].slice(0, 7);
    if (m !== lastMonth) { lw = learnStep(singles.map(x => monthEnds(x.curve, k)), lw).w; lastMonth = m; }
    const raw = closes.map((_, i) => VARIANTS.reduce((sum, _v, v) => sum + lw[v] * raws[t][v][i], 0));
    return riskLayerX(raw, F[t], ppy, dd, o);
  }, cashRet);
  return { ens, weights: lw };
}
// Kennzahlen für einen Zeitraum (Kurve neu bei 1), Sharpe über dem T-Bill-Zins
function stats(curve, ppy, from, to, rf) {
  const c = curve.filter(x => x.d >= from && x.d < to);
  if (c.length < ppy) return null;
  const v = c.map(x => x.eq), d = c.map(x => x.d), p = perf(v, d, ppy);
  const ex = [];
  for (let i = 1; i < c.length; i++) ex.push(v[i] / v[i - 1] - 1 - (rf ? rf.get(d[i]) || 0 : 0));
  const s = sd(ex);
  return { cagr: p.cagr, vol: p.vol, sharpeEx: s > 0 ? r2(mean(ex) / s * Math.sqrt(ppy)) : null, maxDD: p.maxDD, worst12: p.worst12, pos12: p.pos12, exp: r2(mean(c.map(x => x.exp)) * 100) };
}

async function main() {
  if (!hasKeys) throw new Error("Lese-Schlüssel fehlt");
  const now = new Date(), today = now.toISOString().slice(0, 10), weekCut = new Date(now - 6 * 864e5).toISOString().slice(0, 10);
  // 1. Kurse
  const found = [];
  for (const a of ASSETS) {
    let hit = null;
    for (const sym of a.syms) {
      const r = await resolve({ symbols: [sym] });
      if (!r) continue;
      try {
        const weekly = await candles(r.id, "OneWeek", 1000), daily = await candles(r.id, "OneDay", 1000);
        if (weekly.length < 120) { log(`${a.key}: ${sym} nur ${weekly.length} Wochen – nächster Kandidat`); continue; }
        hit = { ...a, sym, id: r.id, weekly, daily };
        break;
      } catch (e) { warn(`${sym}: ${e.message}`); }
    }
    if (hit) { found.push(hit); log(`${a.key}: ${hit.sym} Wochen ab ${hit.weekly[0].d} (erster Schluss ${hit.weekly[0].c}), Tage ab ${hit.daily[0] && hit.daily[0].d}`); }
    else warn(`${a.key}: kein ETF mit Kursen`);
  }
  const spy = found.find(f => f.key === "us");
  if (!spy) throw new Error("SPY fehlt");
  // Prüfpunkt: SPY schloss am 19.11.2010 bei 119,96 $ (ohne Dividenden); mit Dividenden bereinigt läge der Wert deutlich tiefer
  const p2010 = spy.weekly.find(x => x.d >= "2010-11-15" && x.d <= "2010-11-22");
  log(`Prüfpunkt SPY Woche 2010-11-19: ${p2010 ? p2010.c : "–"} → ${p2010 && Math.abs(p2010.c - 120) < 4 ? "Kurse OHNE Ausschüttungen" : "Kurse vermutlich bereinigt"}`);

  // 2. FRED: T-Bill-Zins, Marktrenditen für Anleihen, Finanzlage
  const fred = {};
  for (const id of ["DTB3", "DGS10", "DGS30", "BAMLH0A0HYM2EY", "BAMLC0A0CMEY", "NFCI"]) {
    try { fred[id] = await fredSeries(id, "2009-01-01"); log(`FRED ${id}: ${fred[id].length} Werte bis ${fred[id].at(-1).d}`); }
    catch (e) { warn(`FRED ${id}: ${e.message}`); }
  }
  const asOf = (rows, d) => { if (!rows) return null; let lo = 0, hi = rows.length - 1, ans = null; while (lo <= hi) { const m = (lo + hi) >> 1; if (rows[m].d <= d) { ans = rows[m].v; lo = m + 1; } else hi = m - 1; } return ans; };

  // 3. Reihen: Kalender von SPY; mit Ausschüttungen = Kurs × (1 + Rendite/Jahr × Zeitanteil)
  function build(keys, interval, cutoff, tr) {
    const list = keys.map(k => found.find(f => f.key === k)).filter(Boolean);
    const S = align(list.map(f => (interval === "w" ? f.weekly : f.daily)), cutoff);
    if (tr) S.closes = S.closes.map((col, i) => {
      const a = list[i];
      let acc = null, prevD = null;
      return col.map((c, t) => {
        if (c === null) return null;
        if (acc === null) { acc = c; prevD = S.dates[t]; return acc; }
        const days = (Date.parse(S.dates[t]) - Date.parse(prevD)) / 864e5;
        const y = a.fred ? (asOf(fred[a.fred], prevD) ?? 0) / 100 : a.yld;
        acc = acc * (c / col[t - 1]) * (1 + y * days / 365);
        prevD = S.dates[t];
        return acc;
      });
    });
    return { S, keys: list.map(f => f.key), risky: new Set(list.filter(f => f.risky).map(f => f.key)) };
  }
  const cashRetOf = (dates, ppy) => dates.map((d, t) => (t ? ((asOf(fred.DTB3, dates[t - 1]) ?? 0) / 100) * (Date.parse(d) - Date.parse(dates[t - 1])) / 864e5 / 365 : 0));
  const rfMap = (dates) => { const m = new Map(), c = cashRetOf(dates); dates.forEach((d, t) => m.set(d, c[t])); return m; };

  const out = { updated: now.toISOString(), split: SPLIT, assets: found.map(f => ({ key: f.key, sym: f.sym, weeklyFrom: f.weekly[0].d, dailyFrom: f.daily[0] && f.daily[0].d })), cases: [], benchmarks: [] };
  const windows = [["gesamt", "0000", "9999"], ["bis 2018", "0000", SPLIT], ["ab 2019", SPLIT, "9999"], ["2022", "2022-01-01", "2023-01-01"]];
  let mixBase = {};
  for (const [mode, ppy, cutoff] of [["w", 52, weekCut], ["d", 252, today]]) {
    for (const cs of CASES) {
      const { S, keys, risky } = build(cs.uni, mode, cutoff, cs.tr);
      const m = macroAt(S.dates, fred.NFCI || null), ctx = t => ({ nfci: m[t], keys, risky });
      const res = familyBT(S, ppy, ctx, cs, cs.cash ? cashRetOf(S.dates, ppy) : null);
      if (!res) { warn(`${cs.id}/${mode}: zu wenig Daten`); continue; }
      const rf = rfMap(S.dates);
      const row = { id: cs.id, mode, text: cs.text, markets: keys.length, turnover: r2(res.ens.turnoverPerYear * 100), weights: res.weights.map(x => r2(x * 100)) };
      for (const [name, from, to] of windows) row[name] = stats(res.ens.curve, ppy, from, to, rf);
      out.cases.push(row);
      if (cs.id === "B") mixBase.B = res.ens.curve;
      // Abgleich: Fall A muss genau den Rückblick des Bots ergeben
      if (cs.id === "A") {
        const bot = familyBacktest(S, ppy, ctx);
        const a = perf(res.ens.curve.map(x => x.eq), res.ens.curve.map(x => x.d), ppy), b = perf(bot.ens.curve.map(x => x.eq), bot.ens.curve.map(x => x.d), ppy);
        log(`Abgleich ${mode}: Fall A ${a.cagr} % / −${a.maxDD} %, Bot ${b.cagr} % / −${b.maxDD} % → ${a.cagr === b.cagr && a.maxDD === b.maxDD ? "identisch ✓" : "ABWEICHUNG ✗"}`);
      }
    }
    // Monatsregeln aus der Literatur
    for (const mr of MONTHLY) {
      const { S, keys } = build(mr.uni, mode, cutoff, true);
      const F = S.dates.map((_, t) => S.closes.map(c => featuresAt(c, t, ppy)));
      const cr = cashRetOf(S.dates, ppy);
      let month = null;
      const res = runBT(S, ppy, t => {
        const m = S.dates[t].slice(0, 7);
        if (m === month) return null;   // nur zum Monatswechsel umschichten
        month = m;
        let tb = 1;
        for (let q = Math.max(1, t - ppy + 1); q <= t; q++) tb *= 1 + cr[q];
        return mr.fn(F[t], { tb12: tb - 1 }).map(x => Math.max(0, x));
      }, cr);
      if (!res) continue;
      const rf = rfMap(S.dates);
      const row = { id: mr.id, mode, text: mr.text, markets: keys.length, turnover: r2(res.turnoverPerYear * 100) };
      for (const [name, from, to] of windows) row[name] = stats(res.curve, ppy, from, to, rf);
      out.cases.push(row);
      if (mr.id === "K") mixBase.K = res.curve;
    }
    const bench = [["S&P 500", ["us"], [1]], ["60/40 (S&P 500 / 7–10-J.-Anleihen)", ["us", "bonds"], [0.6, 0.4]], ["6 Märkte gleich", U6, null], ["13 Märkte gleich", U13, null]];
    for (const [name, keys, wts] of bench) {
      const { S } = build(keys, mode, cutoff, true);
      const A = S.closes.length, start = warmup(ppy);
      let eq = 1, w = null;
      const curve = [];
      for (let t = start; t < S.dates.length; t++) {
        if (w) { const g = w.map((x, i) => x * (S.closes[i][t] > 0 && S.closes[i][t - 1] > 0 ? S.closes[i][t] / S.closes[i][t - 1] : 1)); const tot = g.reduce((a, b) => a + b, 0); eq *= tot; w = g.map(x => x / tot); }
        if (!w || (t - start) % Math.round(ppy / 12) === 0) { const ok = S.closes.map(c => c[t] > 0); const base = wts || ok.map(x => (x ? 1 : 0)); const s = base.reduce((a, b, i) => a + (ok[i] ? b : 0), 0); w = base.map((x, i) => (ok[i] ? x / s : 0)); }
        curve.push({ d: S.dates[t], eq, exp: 1 });
      }
      const rf = rfMap(S.dates), row = { name, mode };
      for (const [wn, from, to] of windows) row[wn] = stats(curve, ppy, from, to, rf);
      out.benchmarks.push(row);
      if (name.startsWith("60/40")) mixBase.static = curve;
    }
    // Mischungen: fester Kern + Trend (B) bzw. + 60/40 mit Trendfilter (K)
    for (const [id, text, a, b] of [["M", "Hälfte 60/40 fest, Hälfte Trend-Bot (B)", "static", "B"], ["N", "Hälfte 60/40 fest, Hälfte 60/40 mit Trendfilter (K)", "static", "K"]]) {
      const A1 = mixBase[a], B1 = mixBase[b];
      if (!A1 || !B1) continue;
      const mb = new Map(B1.map(x => [x.d, x.eq])), common = A1.filter(x => mb.has(x.d));
      let eq = 1;
      const curve = common.map((x, i) => { if (i) eq *= 0.5 * x.eq / common[i - 1].eq + 0.5 * mb.get(x.d) / mb.get(common[i - 1].d); return { d: x.d, eq, exp: 1 }; });
      const { S } = build(["us"], mode, cutoff, true), rf = rfMap(S.dates);
      const row = { id, mode, text, markets: 0, turnover: null };
      for (const [wn, from, to] of windows) row[wn] = stats(curve, ppy, from, to, rf);
      out.cases.push(row);
    }
    mixBase = {};
  }
  // 4. Bericht
  const fmt = s => (s ? `${String(s.cagr).padStart(6)} %  ${String(s.vol).padStart(5)} %  ${String(s.sharpeEx).padStart(5)}  −${String(s.maxDD).padStart(5)} %  ${String(s.worst12).padStart(7)} %  ${String(s.pos12).padStart(5)} %  ${String(s.exp).padStart(5)} %` : "–");
  for (const mode of ["w", "d"]) {
    log(`\n===== ${mode === "w" ? "Wochenkurse" : "Tageskurse"}: Rendite p. a. · Schwankung · Sharpe (über T-Bills) · größter Rückgang · schlechteste 12 Monate · 12-Monats-Zeiträume im Plus · investiert =====`);
    for (const [wn] of windows) {
      log(`--- ${wn} ---`);
      for (const r of out.cases.filter(x => x.mode === mode)) if (r[wn]) log(`${r.id.padEnd(3)} ${fmt(r[wn])}  Umschlag ${r.turnover} %  ${r.text}`);
      for (const r of out.benchmarks.filter(x => x.mode === mode)) if (r[wn]) log(`=   ${fmt(r[wn])}  ${r.name}`);
    }
  }
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(out));
}
main().catch(e => { console.log(`::error::Trend-Forschung: ${e.message}`); process.exit(1); });

// Trend-Bot (GitHub Actions, an US-Börsentagen einmal täglich während der Handelszeit) – NUR im Demokonto.
//
// Regel – gut erforscht, einfach und bewusst nicht „optimiert“ (Optimieren auf die Vergangenheit ist die häufigste
// Ursache, warum Handelssysteme später versagen: Bailey u. a. 2014, Sullivan, Timmermann & White 1999):
//  - Sechs breite ETFs: US-Aktien, Aktien anderer Industrieländer, US-Staatsanleihen, Gold, Rohstoffe, Immobilien.
//  - Trend je ETF aus vier Prüfungen: Rendite über 3, 6 und 12 Monate positiv, Kurs über dem 200-Tage-Schnitt
//    (Zeitreihen-Momentum: Moskowitz, Ooi & Pedersen 2012; Hurst, Ooi & Pedersen 2017; Faber 2007).
//    Anteil = Grundgewicht × erfüllte Prüfungen / 4. Grundgewicht nach Schwankung: ruhige Werte bekommen mehr.
//  - Schwankungsbremse: Das Bot-Depot soll höchstens etwa 10 % pro Jahr schwanken (Moreira & Muir 2017).
//  - Verlustbremse: Liegt das Modell-Depot mehr als 5 % unter seinem Hoch, sinkt der Einsatz schrittweise,
//    ab 15 % auf die Hälfte (Grossman & Zhou 1993).
//  - Kein Hebel, keine Leerverkäufe, Notbremse (Stop Loss) 30 % unter dem Kaufkurs jeder Position – falls der Bot
//    einmal nicht läuft. Täglich geprüft, voll umgeschichtet wird einmal pro Woche und erst ab 3 Prozentpunkten
//    Abweichung; ist ein Trend ganz gebrochen, verkauft der Bot sofort (spart Kosten, Barber & Odean 2000).
//
// Zwei Teile, damit kein Schritt mehr Rechte hat als nötig:
//   node scripts/trend-bot.mjs signals   Lese-Schlüssel: Kurse holen, Signale und Rückblick-Test rechnen
//   node scripts/trend-bot.mjs trade     Bot-Schlüssel (nur Demo): Demokonto mit den Zielanteilen abgleichen
// Echtgeld ist gesperrt: Der Bot kennt nur die Demo-Adressen der eToro-API.
// Datenschutz: Das Repository ist öffentlich. In trend-bot.json stehen nur Prozentwerte, keine Dollar-Beträge.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { call, send, field, num, findArray, log, warn, hasKeys, sleep } from "./etoro.mjs";

const here = p => fileURLToPath(new URL(p, import.meta.url));
export const REAL_MONEY_UNLOCKED = false;
// Finanzlage von FRED (Federal Reserve Bank of St. Louis, ohne Schlüssel) – nur an fred.stlouisfed.org
const FRED = (process.env.FRED_BASE || "https://fred.stlouisfed.org/graph/fredgraph.csv").replace(/\/$/, "");
if (!["fred.stlouisfed.org", "localhost", "127.0.0.1"].includes(new URL(FRED).hostname)) throw new Error(`Unzulässige FRED-Adresse ${new URL(FRED).hostname}`);
async function fredSeries(id, from) {
  const res = await fetch(`${FRED}?id=${encodeURIComponent(id)}&cosd=${from}`, { redirect: "error", signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`FRED ${id}: HTTP ${res.status}`);
  const rows = (await res.text()).trim().split(/\r?\n/).slice(1).map(l => l.split(",")).map(([d, v]) => ({ d, v: Number(v) }))
    .filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.d) && Number.isFinite(r.v)).sort((a, b) => (a.d < b.d ? -1 : 1));
  if (!rows.length) throw new Error(`FRED ${id}: keine Werte`);
  return rows;
}
// Wert je Kurstag: letzter NFCI-Stand, der mindestens 7 Tage alt ist (so spät wird er veröffentlicht – kein Blick in die Zukunft)
export function macroAt(dates, rows) {
  const out = [];
  let j = -1;
  for (const d of dates) {
    const cut = new Date(new Date(`${d}T12:00:00Z`) - 7 * 864e5).toISOString().slice(0, 10);
    while (rows && j + 1 < rows.length && rows[j + 1].d <= cut) j++;
    out.push(rows && j >= 0 ? rows[j].v : null);
  }
  return out;
}
const DEMO = {
  pnl: "/v1/trading/info/demo/pnl",
  open: "/v1/trading/execution/demo/market-open-orders/by-amount",
  close: id => `/v1/trading/execution/demo/market-close-orders/positions/${id}`,
  order: id => `/v1/trading/info/demo/orders/${id}`,
};

export const RULES = {
  months: [63, 126, 252],  // 3, 6 und 12 Monate in Handelstagen (langsame Signale = weniger Fehlsignale und Kosten)
  sma: 200,                // 200-Tage-Schnitt
  volDays: 60,             // Schwankung aus den letzten 60 Handelstagen
  targetVol: 10,           // Ziel-Schwankung des Bot-Depots in % pro Jahr (Obergrenze)
  maxWeight: 0.35,         // höchstens 35 % in einem ETF
  band: 0.03,              // erst ab 3 Prozentpunkten Abweichung umschichten
  // Täglich prüfen, aber nur einmal pro Woche voll umschichten; ist ein Trend ganz gebrochen (0 von 4 Prüfungen),
  // wird sofort verkauft – auch mitten in der Woche (Faber 2007 schichtet sogar nur monatlich um).
  ddStart: 5, ddFull: 15, ddFloor: 0.5,   // Verlustbremse
  stopLossPct: 30,         // Notbremse je Position
  costPct: 0.15,           // Annahme für Spread und Gebühren je umgeschichtetem Anteil (Rückblick-Test)
  minOrderUsd: 50,
  reservePct: 1,           // 1 % des Kontos bleiben immer frei
  maxOrdersPerRun: 12,
  staleDays: 4,            // ältere Kurse → kein Handel
  keepJournal: 400, keepEvents: 60,
};
export const ASSETS = [
  { key: "us", name: "US-Aktien (S&P 500)", symbols: ["SPY", "VOO", "IVV"] },
  { key: "intl", name: "Aktien anderer Industrieländer", symbols: ["EFA", "VEA", "IEFA"] },
  { key: "bonds", name: "US-Staatsanleihen 7–10 Jahre", symbols: ["IEF", "GOVT", "TLT"] },
  { key: "gold", name: "Gold", symbols: ["GLD", "IAU"] },
  { key: "commod", name: "Rohstoffe", symbols: ["DBC", "PDBC", "GSG", "COMT", "BCI"] },
  { key: "reits", name: "Immobilien (REITs)", symbols: ["VNQ", "IYR", "XLRE"] },
];
// NYSE-Feiertage (an diesen Tagen handelt der Bot nicht)
export const HOLIDAYS = new Set([
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
]);

const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
const sd = a => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const round = (x, d = 4) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : null);
const de = (x, d = 0) => Number(x).toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });
const nowDate = () => (process.env.TREND_NOW ? new Date(process.env.TREND_NOW) : new Date());

// ---------- Börsenzeit ----------
export function nyClock(d) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" })
    .formatToParts(d).map(p => [p.type, p.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, minutes: (Number(parts.hour) % 24) * 60 + Number(parts.minute), weekday: parts.weekday };
}
export function isTradingDay(day) {
  const wd = new Date(`${day}T12:00:00Z`).getUTCDay();
  return wd !== 0 && wd !== 6 && !HOLIDAYS.has(day);
}
// US-Börse offen (mit Abstand zu Eröffnung und Schluss): 9:45 bis 15:45 Uhr New Yorker Zeit
export function marketOpen(d) {
  const c = nyClock(d);
  return isTradingDay(c.day) && c.minutes >= 9 * 60 + 45 && c.minutes <= 15 * 60 + 45;
}

// ---------- Signale ----------
export function lookbacks(ppy) {
  const k = days => Math.max(1, Math.round(days * ppy / 252));
  return { m1: k(RULES.months[0]), m3: k(RULES.months[1]), m12: k(RULES.months[2]), sma: k(RULES.sma), vol: k(RULES.volDays) };
}
export const warmup = ppy => { const L = lookbacks(ppy); return Math.max(L.m12, L.sma, L.vol) + 1; };
// Signal eines ETF am Zeitpunkt t (nur Kurse bis einschließlich t)
export function signalAt(closes, t, ppy) {
  const L = lookbacks(ppy);
  if (t < warmup(ppy) - 1 || !(closes[t] > 0) || !(closes[t - Math.max(L.m12, L.sma, L.vol)] > 0)) return null;   // noch zu kurze Historie
  const last = closes[t];
  const r = k => last / closes[t - k] - 1;
  let s = 0;
  for (let i = t - L.sma + 1; i <= t; i++) s += closes[i];
  const sma = s / L.sma;
  const checks = [r(L.m1) > 0, r(L.m3) > 0, r(L.m12) > 0, last > sma];
  const lr = [];
  for (let i = t - L.vol + 1; i <= t; i++) lr.push(Math.log(closes[i] / closes[i - 1]));
  return { last, r3: r(L.m1), r6: r(L.m3), r12: r(L.m12), dSma: last / sma - 1, checks, score: checks.filter(Boolean).length / 4, vol: sd(lr) * Math.sqrt(ppy), lr };
}
export function ddMultiplier(ddPct) {
  if (ddPct <= RULES.ddStart) return 1;
  if (ddPct >= RULES.ddFull) return RULES.ddFloor;
  return 1 - (1 - RULES.ddFloor) * (ddPct - RULES.ddStart) / (RULES.ddFull - RULES.ddStart);
}
// ---------- Strategie-Familie: fünf erforschte Regeln, der Bot lernt, welche gerade besser trägt ----------
// Alle Varianten sind vorab festgelegt (nicht auf die Vergangenheit optimiert). Der Bot verteilt sein Geld auf alle und
// verschiebt die Gewichte einmal im Monat zu den Varianten mit mehr Rendite je Risiko in den letzten 36 Monaten –
// stark zur Gleichverteilung geschrumpft und höchstens 10 Prozentpunkte pro Monat. Grundlagen: Kombinieren schlägt
// Einzelmodelle (Rapach, Strauss & Zhou 2010), geschätzte Gewichte nur mit Schrumpfung (DeMiguel, Garlappi & Uppal 2009),
// Strategien mit gutem Lauf laufen eher weiter (Faktor-Momentum, Ehsani & Linnainmaa 2022).
export const LEARN = { lookbackMonths: 36, minMonths: 12, shrink: 0.5, temp: 2, maxStep: 0.10 };
const RISKY = new Set(["us", "intl", "commod", "reits"]);
const share = checks => checks.filter(Boolean).length / checks.length;
export const VARIANTS = [
  { key: "t3612", name: "Trend 3–6–12 Monate", src: "Moskowitz, Ooi & Pedersen 2012", doi: "10.1016/j.jfineco.2011.11.003",
    raw: (F, b) => F.map((f, i) => (f ? b[i] * share([f.r3 > 0, f.r6 > 0, f.r12 > 0, f.p > f.sma]) : 0)) },
  { key: "t1312", name: "Trend 1–3–12 Monate (schneller)", src: "Hurst, Ooi & Pedersen 2017", doi: "10.3905/jpm.2017.44.1.015",
    raw: (F, b) => F.map((f, i) => (f ? b[i] * share([f.r1 > 0, f.r3 > 0, f.r12 > 0, f.p > f.sma]) : 0)) },
  { key: "faber", name: "10-Monats-Linie", src: "Faber 2007", doi: "10.3905/jwm.2007.674809",
    raw: (F, b) => F.map((f, i) => (f && f.p > f.sma10 ? b[i] : 0)) },
  { key: "dual", name: "Dual Momentum: die 3 stärksten", src: "Antonacci 2012", url: "https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2042750",
    raw: (F, b) => {
      const top = F.map((f, i) => ({ i, r: f ? f.r12 : NaN })).filter(x => x.r > 0).sort((x, y) => y.r - x.r || x.i - y.i).slice(0, 3);
      const sum = top.reduce((t, x) => t + b[x.i], 0);
      return F.map((_, i) => (sum > 0 && top.some(x => x.i === i) ? b[i] / sum : 0));
    } },
  { key: "macro", name: "Trend + Finanzlage (NFCI)", src: "Adrian, Boyarchenko & Giannone 2019", doi: "10.1257/aer.20161923",
    raw: (F, b, ctx) => {
      const w = VARIANTS[0].raw(F, b, ctx);
      return Number.isFinite(ctx.nfci) && ctx.nfci > 0 ? w.map((x, i) => (RISKY.has(ctx.keys[i]) ? x / 2 : x)) : w;
    } },
];
// Kennzahlen eines ETF am Zeitpunkt t (nur Kurse bis einschließlich t)
export function featuresAt(closes, t, ppy) {
  const k = days => Math.max(1, Math.round(days * ppy / 252));
  const L = { r1: k(21), r3: k(63), r6: k(126), r12: k(252), sma: k(200), sma10: k(210), vol: k(60) };
  const need = Math.max(L.r12, L.sma10, L.vol);
  if (t < need || !(closes[t] > 0) || !(closes[t - need] > 0)) return null;
  const p = closes[t], r = n => p / closes[t - n] - 1;
  const avg = n => { let x = 0; for (let i = t - n + 1; i <= t; i++) x += closes[i]; return x / n; };
  const lr = [];
  for (let i = t - L.vol + 1; i <= t; i++) lr.push(Math.log(closes[i] / closes[i - 1]));
  return { p, r1: r(L.r1), r3: r(L.r3), r6: r(L.r6), r12: r(L.r12), sma: avg(L.sma), sma10: avg(L.sma10), vol: sd(lr) * Math.sqrt(ppy), lr };
}
export function inverseVol(F) {
  const inv = F.map(f => (f && f.vol > 0 ? 1 / f.vol : 0)), sum = inv.reduce((a, b) => a + b, 0);
  return inv.map(x => (sum > 0 ? x / sum : 0));
}
// Gemeinsame Risiko-Schicht: höchstens 35 % je ETF, Depot-Schwankung höchstens 10 % pro Jahr, Verlustbremse
export function riskLayer(raw, F, ppy, ddPct) {
  const w = raw.map((x, i) => (F[i] ? Math.min(RULES.maxWeight, Math.max(0, x)) : 0));
  let pv = 0;
  for (let i = 0; i < w.length; i++) for (let j = 0; j < w.length; j++) {
    if (!w[i] || !w[j]) continue;
    const a = F[i].lr, b = F[j].lr, ma = mean(a), mb = mean(b);
    let c = 0;
    for (let q = 0; q < a.length; q++) c += (a[q] - ma) * (b[q] - mb);
    pv += w[i] * w[j] * c / (a.length - 1);
  }
  pv = Math.sqrt(Math.max(0, pv) * ppy);
  const volMult = pv > RULES.targetVol / 100 ? RULES.targetVol / 100 / pv : 1, ddMult = ddMultiplier(ddPct);
  return { w: w.map(x => x * volMult * ddMult), portVol: pv * volMult * ddMult, volMult, ddMult };
}
// Ein Lernschritt: Rendite je Risiko der letzten 36 Monate → Gewichte (geschrumpft, Schritt gedeckelt)
export function learnStep(monthly, prev) {
  const V = monthly.length, n = monthly[0].length - 1;
  if (n < LEARN.minMonths) return { w: Array(V).fill(1 / V), scores: null };
  const scores = monthly.map(e => {
    const m = [];
    for (let q = Math.max(1, e.length - LEARN.lookbackMonths); q < e.length; q++) m.push(e[q] / e[q - 1] - 1);
    const v = m.length > 1 ? sd(m) : 0;
    return v > 0 ? mean(m) / v * Math.sqrt(12) : 0;
  });
  const ex = scores.map(x => Math.exp(LEARN.temp * x)), tot = ex.reduce((a, b) => a + b, 0);
  const goal = ex.map(x => LEARN.shrink / V + (1 - LEARN.shrink) * x / tot);
  const step = goal.map((g, i) => prev[i] + Math.max(-LEARN.maxStep, Math.min(LEARN.maxStep, g - prev[i])));
  const sum = step.reduce((a, b) => a + b, 0);
  return { w: step.map(x => x / sum), scores };
}
// Monatsend-Werte einer Kurve bis vor Index k (abgeschlossene Monate), mit dem Startwert vorneweg
function monthEnds(curve, k) {
  const out = [curve[0].eq];
  for (let j = 0; j < k && j + 1 < curve.length; j++) if (curve[j].d.slice(0, 7) !== curve[j + 1].d.slice(0, 7)) out.push(curve[j].eq);
  return out;
}

// ---------- Rückblick-Test ----------
const equal = (closes, t) => { const ok = closes.map(c => c[t] > 0 && c[t - 1] > 0), n = ok.filter(Boolean).length; return ok.map(x => (x ? 1 / n : 0)); };
export const weekOf = day => { const t = new Date(`${day}T12:00:00Z`); return new Date(t - ((t.getUTCDay() + 6) % 7) * 864e5).toISOString().slice(0, 10); };
// Gehandelt wird einen Zeitschritt nach dem Signal (wie im echten Betrieb: Signal aus dem Schlusskurs, Kauf am nächsten Tag).
export function runBacktest(series, ppy, targetsAt) {
  const { dates, closes } = series, n = dates.length, A = closes.length;
  const start = warmup(ppy);
  if (n < start + 2) return null;
  let eq = 1, peak = 1, ew = 1, spy = 1, cur = Array(A).fill(0), pending = null, turnover = 0;
  let ewW = equal(closes, start);
  const curve = [];
  for (let t = start; t < n; t++) {
    if (t > start) {
      // Wertentwicklung von t−1 nach t (ein ETF ohne Kurs zählt nicht)
      const ratio = i => (closes[i][t] > 0 && closes[i][t - 1] > 0 ? closes[i][t] / closes[i][t - 1] : 1);
      const grow = cur.map((w, i) => w * ratio(i));
      const total = grow.reduce((a, b) => a + b, 0) + (1 - cur.reduce((a, b) => a + b, 0));
      eq *= total;
      cur = grow.map(v => v / total);
      const ewGrow = ewW.map((w, i) => w * ratio(i)), ewTotal = ewGrow.reduce((a, b) => a + b, 0);
      ew *= ewTotal;
      // monatlich neu gleichgewichtet über alle ETFs, die schon Kurse haben
      ewW = (t - start) % Math.round(ppy / 12) === 0 ? equal(closes, t) : ewGrow.map(v => v / ewTotal);
      spy *= closes[0][t] / closes[0][t - 1];
    }
    // gestern berechnete Ziele heute umsetzen: volle Umschichtung am ersten Handelstag der Woche, sonst nur Ausstiege
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
    curve.push({ d: dates[t], eq, ew, spy, exp: cur.reduce((a, b) => a + b, 0) });
  }
  const years = (n - start) / ppy;
  return { curve, next: pending, dd: (1 - eq / peak) * 100, turnoverPerYear: turnover / Math.max(years, 1e-9) };
}
// Alle Varianten einzeln und das lernende Gesamt-Depot (Gewichte nur aus der Vergangenheit, monatlich neu)
export function familyBacktest(series, ppy, ctxAt) {
  const { dates, closes } = series;
  const F = dates.map((_, t) => closes.map(c => featuresAt(c, t, ppy)));
  const B = F.map(inverseVol);
  const raws = dates.map((_, t) => VARIANTS.map(v => v.raw(F[t], B[t], ctxAt(t))));
  const singles = VARIANTS.map((_, v) => runBacktest(series, ppy, (t, dd) => riskLayer(raws[t][v], F[t], ppy, dd).w));
  if (singles.some(x => !x)) return null;
  let lw = Array(VARIANTS.length).fill(1 / VARIANTS.length), lastMonth = null, scores = null;
  const history = [];
  const ens = runBacktest(series, ppy, (t, dd, k) => {
    const m = dates[t].slice(0, 7);
    if (m !== lastMonth) {
      const res = learnStep(singles.map(x => monthEnds(x.curve, k)), lw);
      lw = res.w; scores = res.scores; lastMonth = m;
      history.push([dates[t], ...lw.map(x => round(x, 4))]);
    }
    const raw = closes.map((_, i) => VARIANTS.reduce((sum, _v, v) => sum + lw[v] * raws[t][v][i], 0));
    return riskLayer(raw, F[t], ppy, dd).w;
  });
  return { ens, singles, history, weights: lw, scores, F, raws };
}
// Kombiniertes Rohziel mit festen Lerngewichten (für heute)
export const combine = (lw, rawsT) => rawsT[0].map((_, i) => rawsT.reduce((sum, r, v) => sum + lw[v] * r[i], 0));
export function perf(values, dates, ppy) {
  const rets = [];
  for (let i = 1; i < values.length; i++) rets.push(values[i] / values[i - 1] - 1);
  const n = rets.length;
  const total = values[values.length - 1] / values[0];
  let peak = values[0], mdd = 0;
  for (const v of values) { peak = Math.max(peak, v); mdd = Math.max(mdd, 1 - v / peak); }
  const roll = [];
  for (let i = ppy; i < values.length; i++) roll.push(values[i] / values[i - ppy] - 1);
  const byYear = new Map();
  for (let i = 0; i < values.length; i++) {
    const y = dates[i].slice(0, 4);
    if (!byYear.has(y)) byYear.set(y, { first: i, last: i }); else byYear.get(y).last = i;
  }
  const yearsList = [...byYear.entries()].map(([y, r]) => {
    const base = r.first > 0 ? values[r.first - 1] : values[r.first];
    return { year: y, ret: round((values[r.last] / base - 1) * 100, 2), partial: r.first === 0 || r.last === values.length - 1 && !/-12-(2[4-9]|3[01])$/.test(dates[r.last]) };
  });
  const v = n > 1 ? sd(rets) * Math.sqrt(ppy) : null;
  return {
    cagr: round((total ** (ppy / Math.max(n, 1)) - 1) * 100, 2), vol: round(v * 100, 2),
    sharpe: v ? round(mean(rets) * ppy / v, 2) : null, maxDD: round(mdd * 100, 2), total: round((total - 1) * 100, 2),
    pos12: roll.length ? round(roll.filter(x => x > 0).length / roll.length * 100, 1) : null,
    worst12: roll.length ? round(Math.min(...roll) * 100, 2) : null, best12: roll.length ? round(Math.max(...roll) * 100, 2) : null,
    years: yearsList,
  };
}
export function summarize(bt, ppy, every) {
  const c = bt.curve, d = c.map(x => x.d);
  const sample = c.filter((_, i) => i % every === 0 || i === c.length - 1).map(x => [x.d, round(x.eq), round(x.ew), round(x.spy), round(x.exp, 3)]);
  return {
    start: d[0], end: d[d.length - 1], points: c.length,
    bot: perf(c.map(x => x.eq), d, ppy), ew: perf(c.map(x => x.ew), d, ppy), spy: perf(c.map(x => x.spy), d, ppy),
    avgExposure: round(mean(c.map(x => x.exp)) * 100, 1), turnoverPerYear: round(bt.turnoverPerYear * 100, 0), curve: sample,
  };
}

// ---------- Kurse ----------
async function resolve(asset) {
  for (const sym of asset.symbols) {
    try {
      const d = await call("/v2/market-data/instruments", { symbols: sym });
      const hit = findArray(d).find(x => String(field(x, "symbol") || "").toUpperCase() === sym);
      const id = hit && num(field(hit, "instrumentId"));
      const type = String(field(hit || {}, "type") || "");
      if (Number.isInteger(id) && (!type || /etf/i.test(type))) return { id, sym };
      if (hit) log(`${sym}: Typ „${type}“ – kein ETF, nächster Kandidat.`);
    } catch (e) { warn(`${sym}: ${e.message}`); }
  }
  return null;
}
async function candles(id, interval, count) {
  const d = await call(`/v1/market-data/instruments/${id}/history/candles/desc/${interval}/${count}`);
  const groups = Array.isArray(field(d, "candles")) ? field(d, "candles") : [];
  const list = (groups.find(g => num(field(g, "instrumentId")) === id) || groups[0] || {}).candles || [];
  return list.map(x => ({ d: String(field(x, "fromDate") || "").slice(0, 10), c: num(field(x, "close")) }))
    .filter(x => /^\d{4}-\d{2}-\d{2}$/.test(x.d) && Number.isFinite(x.c) && x.c > 0)
    .sort((a, b) => (a.d < b.d ? -1 : 1));
}
// Kalender des US-Aktien-ETF; nur abgeschlossene Kerzen (die laufende Kerze von heute bzw. dieser Woche fällt weg).
// Fehlt ein Tag bei einem anderen ETF, gilt sein letzter Kurs; vor seinem ersten Kurs bleibt er leer (null) und nimmt nicht teil.
export function align(lists, cutoff) {
  const clean = lists.map(l => l.filter(x => x.d < cutoff));
  const dates = clean[0].map(x => x.d);
  const closes = clean.map(l => {
    const m = new Map(l.map(x => [x.d, x.c]));
    let lastC = null;
    const first = l.length ? l[0].d : "9999";
    return dates.map(d => { if (m.has(d)) lastC = m.get(d); return d >= first ? lastC : null; });
  });
  return { dates, closes };
}

async function signalsMain() {
  const OUT = process.env.TREND_SIGNALS_OUT || here("../data/trend-signals.json");
  const now = nowDate(), today = now.toISOString().slice(0, 10);
  const out = { updated: now.toISOString(), rules: RULES, assets: [], errors: [], source: "eToro-Marktdaten (Tages- und Wochenkerzen)" };
  if (!hasKeys) { warn("Keine eToro-Schlüssel – Trend-Signale übersprungen."); out.errors.push("keine Schlüssel"); }
  else {
    const found = [];
    for (const a of ASSETS) {
      let ok = null;
      for (const sym of a.symbols) {
        const r = await resolve({ symbols: [sym] });
        if (!r) continue;
        try {
          const daily = await candles(r.id, "OneDay", 1000);
          if (daily.length < 300) { log(`${a.name}: ${sym} (${r.id}) hat nur ${daily.length} Tageskurse – nächster Kandidat.`); continue; }
          const weekly = await candles(r.id, "OneWeek", 1000);
          ok = { ...a, ...r, daily, weekly };
          log(`${a.name}: ${r.sym} (${r.id}), ${daily.length} Tage ab ${daily[0].d}, ${weekly.length} Wochen ab ${weekly[0] && weekly[0].d}`);
          break;
        } catch (e) { log(`${a.name}: ${sym}: ${e.message}`); }
      }
      if (ok) found.push(ok); else out.errors.push(`${a.name}: kein ETF mit ausreichender Kurshistorie bei eToro – der Bot lässt diesen Markt weg.`);
    }
    if (found.length >= 4 && found[0].key === "us") {
      const weekCut = new Date(now - 6 * 864e5).toISOString().slice(0, 10);   // laufende Woche weglassen, egal ob Mo- oder So-datiert
      const D = align(found.map(f => f.daily), today), W = align(found.map(f => f.weekly), weekCut);
      // Finanzlage (Chicago Fed NFCI, wöchentlich) für die Variante „Trend + Finanzlage“
      let nfci = null;
      try { nfci = await fredSeries("NFCI", "2008-01-01"); } catch (e) { out.errors.push(`Finanzlage (FRED): ${e.message} – die Variante „Trend + Finanzlage“ rechnet vorerst wie die Grundregel.`); }
      const keys = found.map(f => f.key);
      const ctxOf = dates => { const m = macroAt(dates, nfci); return t => ({ nfci: m[t], keys }); };
      const fam = familyBacktest(D, 252, ctxOf(D.dates)), famW = familyBacktest(W, 52, ctxOf(W.dates));
      if (!fam) out.errors.push(`Zu wenige gemeinsame Handelstage (${D.dates.length}) für die Signale.`);
      else {
        const t = D.dates.length - 1, sigs = found.map((_, i) => signalAt(D.closes[i], t, 252)), F = fam.F[t];
        if (F.some(x => !x)) out.errors.push(`Zu kurze Historie für ${found.filter((_, i) => !F[i]).map(f => f.sym).join(", ")} – diese ETFs bleiben vorerst bei 0 %.`);
        const rawT = fam.raws[t], mix = combine(fam.weights, rawT);
        const base = riskLayer(mix, F, 252, 0), tw = riskLayer(mix, F, 252, fam.ens.dd);   // ohne / mit Verlustbremse laut Rückblick
        out.asOf = D.dates[t];
        out.assets = found.map((f, i) => sigs[i] && F[i] ? ({
          key: f.key, name: f.name, sym: f.sym, instrumentId: f.id, last: round(sigs[i].last, 4), r3: round(sigs[i].r3 * 100, 2), r6: round(sigs[i].r6 * 100, 2),
          r12: round(sigs[i].r12 * 100, 2), dSma: round(sigs[i].dSma * 100, 2), checks: sigs[i].checks, score: sigs[i].score, vol: round(sigs[i].vol * 100, 2),
          weightBase: round(base.w[i], 4), weight: round(tw.w[i], 4),
        }) : ({ key: f.key, name: f.name, sym: f.sym, instrumentId: f.id, last: null, checks: [false, false, false, false], score: 0, vol: null, weightBase: 0, weight: 0, short: true }));
        const m = D.dates.length, k0 = m - Math.min(15, m);
        out.recent = D.dates.slice(k0).map((d, k) => [d, ...D.closes.map(c => round(c[k0 + k], 6))]);   // für das Modell-Depot des Bots
        out.exposure = round(tw.w.reduce((a, b) => a + b, 0), 4);
        out.portVol = round(tw.portVol * 100, 2); out.volMult = round(tw.volMult, 3); out.ddMult = round(tw.ddMult, 3); out.modelDd = round(fam.ens.dd, 2);
        out.backtest = { daily: summarize(fam.ens, 252, 5), weekly: famW ? summarize(famW.ens, 52, 2) : null };
        const vstats = (fb, ppy) => (fb ? fb.singles.map(x => { const q = perf(x.curve.map(y => y.eq), x.curve.map(y => y.d), ppy); return { cagr: q.cagr, vol: q.vol, maxDD: q.maxDD, sharpe: q.sharpe, worst12: q.worst12, pos12: q.pos12 }; }) : null);
        const vd = vstats(fam, 252), vw = vstats(famW, 52);
        out.learning = {
          rules: LEARN,
          weights: Object.fromEntries(VARIANTS.map((v, i) => [v.key, round(fam.weights[i], 4)])),
          variants: VARIANTS.map((v, i) => ({
            key: v.key, name: v.name, src: v.src, doi: v.doi || null, url: v.url || null, weight: round(fam.weights[i], 4), score: fam.scores ? round(fam.scores[i], 3) : null,
            exposure: round(riskLayer(rawT[i], F, 252, 0).w.reduce((a, b) => a + b, 0), 4), daily: vd && vd[i], weekly: vw && vw[i],
          })),
          history: fam.history.slice(-24),
          historyWeekly: famW ? famW.history.filter((_, i, arr) => i % 3 === 0 || i === arr.length - 1) : null,
          nfci: nfci ? { value: nfci[nfci.length - 1].v, asOf: nfci[nfci.length - 1].d } : null,
        };
        log(`Signale ${out.asOf}: ${out.assets.map(a => `${a.sym} ${de(a.score * 4)}/4 → ${de(a.weight * 100, 1)} %`).join(", ")}; investiert ${de(out.exposure * 100, 0)} %`);
        log(`Gelernte Gewichte: ${VARIANTS.map((v, i) => `${v.name} ${de(fam.weights[i] * 100, 0)} %`).join(", ")}${out.learning.nfci ? `; NFCI ${out.learning.nfci.value} (${out.learning.nfci.asOf})` : ""}`);
        if (out.errors.length) log(`Hinweise: ${out.errors.join(" | ")}`);
        const b = out.backtest.daily.bot;
        log(`Rückblick täglich ${out.backtest.daily.start}–${out.backtest.daily.end}: ${de(b.cagr, 1)} % p. a., größter Rückgang ${de(b.maxDD, 1)} %, 12-Monats-Fenster im Plus ${de(b.pos12, 0)} %`);
        if (out.backtest.weekly) { const w = out.backtest.weekly.bot; log(`Rückblick wöchentlich ${out.backtest.weekly.start}–${out.backtest.weekly.end}: ${de(w.cagr, 1)} % p. a., größter Rückgang ${de(w.maxDD, 1)} %, 12-Monats-Fenster im Plus ${de(w.pos12, 0)} %`); }
      }
    } else if (!found.length || found[0].key !== "us") out.errors.push("US-Aktien-ETF fehlt – ohne ihn rechnet der Bot nicht.");
    else out.errors.push(`Nur ${found.length} von ${ASSETS.length} ETFs gefunden – zu wenig für eine breite Streuung.`);
  }
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(out));
  if (out.errors.length) warn(`Trend-Signale: ${out.errors.join(" | ")}`);
}

// ---------- Handel im Demokonto ----------
async function readJson(path) {
  if (!path) return null;
  try { return JSON.parse(await readFile(path, "utf8")); } catch { return null; }
}
function readAccount(d) {
  const cp = field(d, "clientPortfolio") || d || {};
  const credit = num(field(cp, "credit"));
  if (!Number.isFinite(credit)) throw new Error("Kontostand nicht lesbar (credit fehlt).");
  const positions = (Array.isArray(field(cp, "positions")) ? field(cp, "positions") : []).map(p => {
    const pnl = num(field(field(p, "unrealizedPnL") || {}, "pnL"));
    const amount = num(field(p, "amount")) || 0;
    return {
      positionID: num(field(p, "positionID")), instrumentID: num(field(p, "instrumentID")), orderID: num(field(p, "orderID")),
      mirrorID: num(field(p, "mirrorID")) || 0, units: num(field(p, "units")), amount, pnl: Number.isFinite(pnl) ? pnl : 0,
      value: amount + (Number.isFinite(pnl) ? pnl : 0), isBuy: field(p, "isBuy") !== false, opened: field(p, "openDateTime") || null,
    };
  }).filter(p => Number.isInteger(p.positionID));
  const mirrors = Array.isArray(field(cp, "mirrors")) ? field(cp, "mirrors") : [];
  const mirrorValue = mirrors.reduce((s, m) => s + (num(field(m, "availableAmount")) || 0) + (Array.isArray(field(m, "positions")) ? field(m, "positions") : [])
    .reduce((t, p) => t + (num(field(p, "amount")) || 0) + (num(field(field(p, "unrealizedPnL") || {}, "pnL")) || 0), 0), 0);
  const pending = (Array.isArray(field(cp, "ordersForOpen")) ? field(cp, "ordersForOpen") : []).map(o => num(field(o, "instrumentId", "instrumentID")));
  const own = positions.filter(p => p.mirrorID === 0);
  return { credit, positions: own, pendingInstruments: new Set(pending), equity: credit + own.reduce((s, p) => s + p.value, 0) + mirrorValue };
}

async function tradeMain() {
  const SIGNALS = process.env.TREND_SIGNALS_IN || here("../data/trend-signals.json");
  const STATE_IN = process.env.TREND_STATE_IN || "";
  const OUT = process.env.TREND_OUT || here("../data/trend-bot.json");
  const POLL_MS = Number(process.env.TREND_POLL_MS ?? 3000);
  const share = Math.min(0.9, Math.max(0.1, Number(process.env.TREND_BOT_SHARE || 0.5) || 0.5));
  const command = String(process.env.TREND_BOT_COMMAND || "status").trim().toLowerCase();
  const now = nowDate(), today = nyClock(now).day;
  const prev = (await readJson(STATE_IN)) || {};
  const sig = await readJson(SIGNALS);
  const st = {
    version: 1, enabled: false, positions: [], orders: [], uncertain: [], journal: [], events: [], notices: {},
    ...prev, updated: now.toISOString(), mode: "demo", share, newEvents: [],
  };
  const event = (kind, text, notify = true) => {
    const e = { at: now.toISOString(), kind, text };
    st.events = [...st.events, e].slice(-RULES.keepEvents);
    if (notify) st.newEvents.push(e);
    log(`${kind}: ${text}`);
  };
  const once = (key, kind, text, notify = true) => { if (st.notices[key] !== today) { st.notices[key] = today; event(kind, text, notify); } else log(`${kind}: ${text}`); };
  const save = async () => {
    for (const k of Object.keys(st.notices)) if (st.notices[k] !== today) delete st.notices[k];
    st.journal = st.journal.slice(-RULES.keepJournal);
    // Website: Signale und Rückblick-Test mitliefern (nur Prozentwerte)
    if (sig && sig.assets && sig.assets.length) st.signals = { asOf: sig.asOf, updated: sig.updated, assets: sig.assets, exposure: sig.exposure, portVol: sig.portVol, volMult: sig.volMult, ddMult: sig.ddMult, modelDd: sig.modelDd };
    if (sig && sig.backtest) st.backtest = sig.backtest;
    if (sig && sig.learning) st.learning = sig.learning;
    if (sig && sig.errors) st.signalErrors = sig.errors;
    await mkdir(dirname(OUT), { recursive: true });
    await writeFile(OUT, JSON.stringify(st));
  };

  if (command === "starten" && !st.enabled && !hasKeys) { event("fehler", "Start abgelehnt: Der Bot-Schlüssel fehlt. Bitte zuerst den Demo-Schlüssel als GitHub-Secret hinterlegen (Anleitung auf der Seite „Trend-Bot“), dann erneut starten."); }
  else if (command === "starten" && !st.enabled) { st.enabled = true; st.startedAt = now.toISOString(); st.model = null; st.lastFullWeek = null; delete st.stoppedAt; event("gestartet", `Trend-Bot gestartet (Demokonto, ${de(share * 100, 0)} % des Kontos). Er handelt ab jetzt an jedem US-Börsentag selbstständig.`); }
  if (command === "stoppen" && st.enabled) st.stopRequested = true;
  if (!hasKeys) { st.setup = false; log("Kein Bot-Schlüssel hinterlegt – Trend-Bot übersprungen."); return save(); }
  st.setup = true;

  // 1. Konto lesen und eigene Positionen abgleichen (nur Positionen, die der Bot selbst eröffnet hat)
  const pnlRaw = await call(DEMO.pnl);
  const acc = readAccount(pnlRaw);
  st.checkedAt = now.toISOString();
  { // Aufbau der Kontoantwort (nur Listen-Namen und Anzahlen, keine Beträge)
    const cp = field(pnlRaw, "clientPortfolio") || pnlRaw || {};
    log(`Kontoantwort: ${Object.entries(cp).map(([k, v]) => (Array.isArray(v) ? `${k}=${v.length}` : null)).filter(Boolean).join(", ")}`);
    const so = Array.isArray(field(cp, "stockOrders")) ? field(cp, "stockOrders") : [];
    if (so.length) log(`Ausstehende Aktien-Aufträge: ${so.slice(0, 8).map(o => `${num(field(o, "orderID", "orderId")) ?? "?"}/${num(field(o, "instrumentID", "instrumentId")) ?? "?"}/Status ${field(o, "statusID", "status") ?? "?"}`).join(", ")}`);
  }
  // Nur Anzahlen und Nummern ins (öffentliche) Protokoll – keine Beträge
  log(`Konto: ${acc.positions.length} eigene Positionen (Instrumente ${[...new Set(acc.positions.map(p => p.instrumentID))].join(", ") || "–"}; Auftragsnummern ${acc.positions.map(p => p.orderID).filter(Number.isInteger).slice(0, 12).join(", ") || "–"}), offene Kaufaufträge für ${[...acc.pendingInstruments].join(", ") || "–"}; vom Bot geführt ${st.positions.length}, unbestätigt ${st.orders.length}.`);
  const byId = new Map(acc.positions.map(p => [p.positionID, p]));
  for (const o of [...st.orders]) {   // bestätigte Aufträge → Positionen übernehmen
    let hits = acc.positions.filter(p => p.orderID === o.orderID && !st.positions.some(x => x.positionID === p.positionID));
    // Rückfallebene, falls eToro an der Position eine andere Auftragsnummer führt: gleiches Instrument, bis 30 Minuten nach dem Auftrag eröffnet
    if (!hits.length) {
      const t0 = new Date(o.at).getTime();
      hits = acc.positions.filter(p => p.instrumentID === o.instrumentID && !st.positions.some(x => x.positionID === p.positionID)
        && p.opened && new Date(p.opened).getTime() - t0 > -2 * 6e4 && new Date(p.opened).getTime() - t0 < 30 * 6e4).slice(0, 1);
      if (hits.length) log(`Auftrag ${o.orderID}: Position ${hits[0].positionID} über Instrument und Zeit zugeordnet.`);
    }
    for (const p of hits) st.positions.push({ positionID: p.positionID, instrumentID: p.instrumentID, key: o.key, since: today });
    if (hits.length || (now - new Date(o.at)) / 864e5 > 2) st.orders = st.orders.filter(x => x !== o);
  }
  for (const o of st.orders.slice(0, 6)) {   // Stand unbestätigter Aufträge bei eToro nachfragen
    try {
      const info = await call(DEMO.order(o.orderID));
      const ex = Array.isArray(field(info, "positionExecutions")) ? field(info, "positionExecutions") : [];
      // nur Zustandsfelder, bei verschachtelten Werten nur deren Namen und in Texten keine Zahlen – das Protokoll ist öffentlich
      const safe = (k, v) => (v === null || typeof v === "number" || typeof v === "boolean" ? v
        : typeof v === "string" ? (/message|reason/i.test(k) ? v.replace(/\d+(?:[.,]\d+)*/g, "#") : v).slice(0, 120)
        : Array.isArray(v) ? `[${v.length}]` : `{${Object.keys(v).join(",")}}`);
      const pick = Object.fromEntries(["status", "statusID", "state", "action", "type", "transaction", "requestType", "errorCode", "errorMessage", "reason", "lastUpdate"]
        .map(k => [k, field(info, k)]).filter(([, v]) => v !== undefined).map(([k, v]) => [k, safe(k, v)]));
      log(`Auftrag ${o.orderID} (${o.key}): Felder ${Object.keys(info || {}).join(", ").slice(0, 300)}; ${JSON.stringify(pick).slice(0, 300)}; Ausführungen ${ex.length}${ex.length ? ` (Position ${ex.map(e => num(field(e, "positionId", "positionID"))).join(", ")})` : ""}`);
      for (const e of ex) {
        const pid = num(field(e, "positionId", "positionID"));
        if (Number.isInteger(pid) && byId.has(pid) && !st.positions.some(x => x.positionID === pid)) {
          st.positions.push({ positionID: pid, instrumentID: o.instrumentID, key: o.key, since: today });
          st.orders = st.orders.filter(x => x !== o);
        }
      }
    } catch (e) { log(`Auftrag ${o.orderID}: ${e.message}`); }
  }
  for (const u of [...st.uncertain]) {  // unklare Aufträge: passende neue Position übernehmen, sonst nach einem Tag vergessen
    const t0 = new Date(u.at).getTime();
    const p = acc.positions.find(x => x.instrumentID === u.instrumentID && !st.positions.some(y => y.positionID === x.positionID)
      && x.opened && Math.abs(new Date(x.opened).getTime() - t0) < 30 * 6e4);
    if (p) { st.positions.push({ positionID: p.positionID, instrumentID: p.instrumentID, key: u.key, since: today }); st.uncertain = st.uncertain.filter(x => x !== u); event("übernommen", `Der unklare Kauf (${u.sym}) ist doch ausgeführt worden – der Bot führt die Position weiter.`, false); }
    else if ((now - t0) / 864e5 > 1) { st.uncertain = st.uncertain.filter(x => x !== u); event("unklar", `Für den Kauf von ${u.sym} gab es keine Bestätigung und keine passende Position – er gilt als nicht ausgeführt.`, false); }
  }
  for (const x of st.positions) if (byId.has(x.positionID) && x.closing && (now - new Date(x.closing)) / 36e5 > 6) delete x.closing;   // Verkauf nicht ausgeführt → wieder normal führen
  for (const x of [...st.positions]) if (!byId.has(x.positionID)) {
    st.positions = st.positions.filter(y => y !== x);
    if (!x.closing) event("geschlossen", `Eine Bot-Position (${(sig && sig.assets || []).find(a => a.key === x.key)?.sym || x.key}) ist nicht mehr im Konto – von Hand oder durch die Notbremse geschlossen.`, false);
  }
  const mine = () => st.positions.map(x => ({ ...x, ...byId.get(x.positionID) })).filter(p => Number.isFinite(p.value));

  // 2. Stoppen: alle Bot-Positionen schließen (Ihre eigenen bleiben unberührt)
  if (st.stopRequested) {
    let fails = 0;
    for (const p of mine()) {
      try { await send("POST", DEMO.close(p.positionID), { InstrumentID: p.instrumentID }); const x = st.positions.find(y => y.positionID === p.positionID); if (x) x.closing = now.toISOString(); }
      catch (e) { fails++; warn(`Schließen ${p.positionID}: ${e.message}`); }
    }
    if (!fails) { st.enabled = false; st.stopRequested = false; st.stoppedAt = now.toISOString(); event("gestoppt", "Trend-Bot gestoppt: Alle seine Positionen werden verkauft, das Geld geht zurück ins Demokonto. Ihre eigenen Positionen bleiben unberührt."); }
    else event("fehler", `${fails} Bot-Positionen ließen sich nicht schließen – der Bot versucht es beim nächsten Lauf erneut.`);
    return finish([{ key: "alle", sym: "alle", side: "verkauf", pct: round((st.exposure || 0) * 100, 2), reason: "Bot gestoppt" }], true);
  }

  // 3. Ziel und Ist
  const fresh = sig && sig.asOf && sig.assets && sig.assets.length >= 4 && (new Date(`${today}T12:00:00Z`) - new Date(`${sig.asOf}T12:00:00Z`)) / 864e5 <= RULES.staleDays;
  const sleeve = share * acc.equity;
  const holdings = new Map();
  for (const p of mine()) holdings.set(p.key, (holdings.get(p.key) || 0) + p.value);
  st.exposure = sleeve > 0 ? round([...holdings.values()].reduce((a, b) => a + b, 0) / sleeve, 4) : 0;
  const pnlOpen = mine().reduce((s, p) => s + p.pnl, 0), investedOpen = mine().reduce((s, p) => s + p.amount, 0);
  st.openPnlPct = investedOpen > 0 ? round(pnlOpen / investedOpen * 100, 2) : null;
  st.holdings = (sig && sig.assets || []).map(a => ({ key: a.key, sym: a.sym, pct: sleeve > 0 ? round((holdings.get(a.key) || 0) / sleeve, 4) : 0, target: a.weight }));

  if (!st.enabled) { log("Trend-Bot ist nicht gestartet – er rechnet nur die Signale."); return finish(); }
  if (!fresh) { once("stale", "warten", `Die Kurse sind nicht aktuell (Stand ${sig && sig.asOf || "unbekannt"}) – heute keine Käufe oder Verkäufe.`); return finish(); }

  // Modell-Depot seit dem Start (100 = Startwert): Grundlage für Tagebuch und Verlustbremse
  const keys = sig.assets.map(a => a.key);
  if (!st.model) st.model = { start: sig.asOf, lastDate: sig.asOf, index: 100, peak: 100, w: {} };
  const M = st.model, rows = (sig.recent || []).filter(r => r[0] > M.lastDate);
  let prevRow = (sig.recent || []).filter(r => r[0] <= M.lastDate).pop();
  if (rows.length && !prevRow) { M.lastDate = rows[rows.length - 1][0]; event("hinweis", "Der Bot ist länger nicht gelaufen – das Modell-Depot setzt ab heute fort.", false); }
  else for (const r of rows) {
    let grow = 0, inv = 0;
    keys.forEach((k, i) => { const w = M.w[k] || 0; inv += w; grow += w * r[i + 1] / prevRow[i + 1]; });
    const total = grow + (1 - inv);
    keys.forEach((k, i) => { if (M.w[k]) M.w[k] = M.w[k] * r[i + 1] / prevRow[i + 1] / total; });
    M.index *= total; M.peak = Math.max(M.peak, M.index); M.lastDate = r[0]; prevRow = r;
  }
  const liveDd = (1 - M.index / M.peak) * 100, ddMult = ddMultiplier(liveDd);
  const target = Object.fromEntries(sig.assets.map(a => [a.key, round((a.weightBase ?? a.weight) * ddMult, 4)]));
  st.liveDd = round(liveDd, 2); st.ddMult = round(ddMult, 3); st.target = target;
  st.holdings = st.holdings.map(h => ({ ...h, target: target[h.key] }));
  // Volle Umschichtung beim ersten Handelslauf der Woche (und gleich nach dem Start), sonst nur Ausstiege bei gebrochenem Trend
  const full = st.lastFullWeek !== weekOf(today);
  if (M.appliedFor !== sig.asOf && marketOpen(now) && st.lastTradeDay !== today) {   // Ziele einmal je Kursstand ins Modell (mit Band und Kosten)
    let traded = 0;
    for (const k of keys) {
      const c = M.w[k] || 0, g = target[k];
      if (!full && !(g === 0 && c > 0)) continue;
      if ((g === 0 && c > 0) || (c === 0 && g > 0) || Math.abs(g - c) > RULES.band) { traded += Math.abs(g - c); M.w[k] = g; }
    }
    M.index *= 1 - traded * RULES.costPct / 100; M.appliedFor = sig.asOf;
  }
  if (!marketOpen(now)) { log("US-Börse geschlossen – gehandelt wird beim nächsten Lauf während der Handelszeit."); st.waiting = "Börse geschlossen"; return finish(); }
  delete st.waiting;
  if (st.lastTradeDay === today) { log("Heute schon abgeglichen."); return finish(); }
  const busy = sig.assets.filter(a => acc.pendingInstruments.has(a.instrumentId));
  if (busy.length || st.orders.length) { once("pending", "warten", `Es gibt noch offene Aufträge (${busy.map(a => a.sym).join(", ") || "in Prüfung"}) – der Bot wartet, damit nichts doppelt gekauft wird.`, false); return finish(); }

  // 4. Umschichten: erst verkaufen (macht Geld frei), dann kaufen
  const trades = [];
  let orders = 0, credit = acc.credit - acc.equity * RULES.reservePct / 100;
  for (const a of sig.assets) {
    const g = target[a.key], have = holdings.get(a.key) || 0, want = g * sleeve, diff = want - have;
    if (!(have > 0) || orders >= RULES.maxOrdersPerRun) continue;
    if (g === 0 || (full && diff < -RULES.band * sleeve)) {
      const ps = mine().filter(p => p.key === a.key);
      let toSell = g === 0 ? Infinity : -diff, sold = 0;
      for (const p of ps.sort((x, y) => x.value - y.value)) {
        if (toSell <= 1 || orders >= RULES.maxOrdersPerRun) break;
        const full = toSell >= p.value * 0.98 || !(p.units > 0);
        const body = full ? { InstrumentID: p.instrumentID } : { InstrumentID: p.instrumentID, UnitsToDeduct: round(p.units * toSell / p.value, 6) };
        try {
          await send("POST", DEMO.close(p.positionID), body);
          orders++;
          const amt = full ? p.value : toSell;
          sold += amt; toSell -= amt; credit += amt;
          if (full) { const x = st.positions.find(y => y.positionID === p.positionID); if (x) x.closing = now.toISOString(); }
        } catch (e) { once(`close:${p.positionID}`, "fehler", `Verkauf von ${a.sym} fehlgeschlagen: ${e.message}`); }
      }
      if (sold > 0) trades.push({ key: a.key, sym: a.sym, side: "verkauf", pct: round(sold / sleeve * 100, 2), reason: g === 0 ? "Trend gebrochen – Ausstieg" : "Anteil verringert" });
    }
  }
  for (const a of sig.assets) {
    const g = target[a.key], have = holdings.get(a.key) || 0, want = g * sleeve, diff = want - have;
    if (!full || !(g > 0) || orders >= RULES.maxOrdersPerRun) continue;
    if (!(have === 0 || diff > RULES.band * sleeve)) continue;
    const amount = Math.floor(Math.min(diff, credit) * 100) / 100;
    if (!(amount >= RULES.minOrderUsd)) { if (diff >= RULES.minOrderUsd) once(`credit:${a.key}`, "hinweis", `Für ${a.sym} ist nicht genug freies Geld im Demokonto – der Kauf wird übersprungen.`, false); continue; }
    const at = new Date().toISOString();
    try {
      const r = await send("POST", DEMO.open, {
        InstrumentID: a.instrumentId, IsBuy: true, Leverage: 1, Amount: amount,
        StopLossRate: round(a.last * (1 - RULES.stopLossPct / 100), 4), IsNoStopLoss: false, IsNoTakeProfit: true, IsTslEnabled: false,
      });
      orders++; credit -= amount;
      const ofo = field(r, "orderForOpen") || {}, orderID = num(field(ofo, "orderID"));
      log(`Kauf ${a.sym}: Auftrag ${orderID ?? "?"}, Status ${field(ofo, "statusID") ?? "?"}, Antwort-Felder ${Object.keys(r || {}).join(", ")}`);
      if (Number.isInteger(orderID)) st.orders.push({ orderID, key: a.key, instrumentID: a.instrumentId, at });
      else st.uncertain.push({ key: a.key, sym: a.sym, instrumentID: a.instrumentId, at });
      trades.push({ key: a.key, sym: a.sym, side: "kauf", pct: round(amount / sleeve * 100, 2), reason: have === 0 ? "Trend intakt – Einstieg" : "Anteil erhöht" });
    } catch (e) {
      if (e.uncertain) { st.uncertain.push({ key: a.key, sym: a.sym, instrumentID: a.instrumentId, at }); event("unklar", `Kauf von ${a.sym} gesendet, aber ohne Bestätigung (${e.message}). Der Bot sendet ihn nicht noch einmal und prüft beim nächsten Lauf das Konto.`); }
      else once(`open:${a.key}`, "fehler", `eToro hat den Kauf von ${a.sym} abgewiesen: ${e.message}`);
    }
  }
  st.lastTradeDay = today;
  if (full) st.lastFullWeek = weekOf(today);

  // 5. Aufträge bestätigen lassen (Positionen übernehmen)
  for (let i = 0; i < 5 && st.orders.length; i++) {
    await sleep(POLL_MS);
    for (const o of [...st.orders]) {
      try {
        const info = await call(DEMO.order(o.orderID));
        const ex = Array.isArray(field(info, "positionExecutions")) ? field(info, "positionExecutions") : [];
        for (const e of ex) {
          const pid = num(field(e, "positionId", "positionID"));
          if (Number.isInteger(pid) && !st.positions.some(x => x.positionID === pid)) st.positions.push({ positionID: pid, instrumentID: o.instrumentID, key: o.key, since: today });
        }
        if (ex.length) st.orders = st.orders.filter(x => x !== o);
      } catch (e) { log(`Auftrag ${o.orderID}: ${e.message}`); }
    }
  }
  st.todayTrades = trades;
  if (trades.length) log(`Umgeschichtet: ${trades.map(t => `${t.side} ${t.sym} ${de(t.pct, 1)} %`).join(", ")}`);
  else log("Keine Umschichtung nötig – alle Anteile liegen im Band.");
  if (ddMult < 1) once("brake", "bremse", `Verlustbremse aktiv: Das Modell-Depot liegt ${de(liveDd, 1)} % unter seinem Hoch – der Bot setzt nur ${de(ddMult * 100, 0)} % des üblichen Anteils ein.`);
  return finish(trades);

  // Tagebuch: ein Eintrag pro Tag, solange der Bot läuft (nur Prozentwerte)
  async function finish(trades = null, force = false) {
    if ((st.enabled || force) && sig && sig.assets && sig.assets.length) {
      const old = st.journal.find(j => j.day === today) || {};
      // Lernen: geänderte Gewichte der Varianten im Tagebuch vermerken
      const lw = sig.learning && sig.learning.weights;
      let learnNote = old.learnNote || null;
      if (lw) {
        const prev = st.learnWeights, names = Object.fromEntries((sig.learning.variants || []).map(v => [v.key, v.name]));
        if (prev) {
          const ch = Object.keys(lw).map(k => [k, (lw[k] - (prev[k] || 0)) * 100]).filter(([, d]) => Math.abs(d) >= 0.5);
          if (ch.length) learnNote = `Gelernt: ${ch.map(([k, d]) => `${names[k] || k} ${d > 0 ? "+" : "−"}${de(Math.abs(d), 0)} Prozentpunkte`).join(", ")}`;
        }
        st.learnWeights = lw;
      }
      const entry = {
        day: today, enabled: st.enabled, asOf: sig.asOf, exposureTarget: st.target ? round(Object.values(st.target).reduce((a, b) => a + b, 0), 4) : sig.exposure,
        exposure: st.exposure ?? null, target: st.target || null, scores: Object.fromEntries(sig.assets.map(a => [a.key, a.score])),
        model: st.model ? round(st.model.index, 4) : null, liveDd: st.liveDd ?? null, ddMult: st.ddMult ?? null, openPnlPct: st.openPnlPct ?? null,
        trades: trades || old.trades || [], note: st.waiting || null, learn: lw || null, learnNote,
      };
      st.journal = [...st.journal.filter(j => j.day !== today), entry];
    }
    return save();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const mode = process.argv[2];
  (mode === "signals" ? signalsMain() : mode === "trade" ? tradeMain() : Promise.reject(new Error("Aufruf: trend-bot.mjs signals | trade")))
    .catch(e => { console.log(`::error::Trend-Bot (${mode}): ${e.message}`); process.exit(1); });
}

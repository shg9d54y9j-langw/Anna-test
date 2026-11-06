// Trend-Bot (GitHub Actions, an Börsentagen einmal täglich während der Handelszeit in London/Frankfurt) – NUR im Demokonto.
//
// Aufbau (Forschungs-Lauf „Trend-Forschung“ auf eToro-Kursen 2011–2026, beide Hälften geprüft):
//  - Die Hälfte des Spielgelds ist fester Kern, immer investiert: 60 % S&P 500, 40 % US-Staatsanleihen
//    (Faber & Richardson 2009, „The Ivy Portfolio“: halb kaufen und halten, halb Trend).
//  - Die andere Hälfte steuert der selbstlernende Trend-Teil (unten); sein freies Geld liegt im Geldmarkt-ETF (T-Bills).
//  - Signale und Rückblick rechnen Dividenden und Zinsen mit (eToro-Kurse enthalten sie nicht).
// Trend-Teil – gut erforscht, einfach und bewusst nicht „optimiert“ (Optimieren auf die Vergangenheit ist die häufigste
// Ursache, warum Handelssysteme später versagen: Bailey u. a. 2014, Sullivan, Timmermann & White 1999):
//  - Sechs breite Märkte: US-Aktien, Aktien anderer Industrieländer, US-Staatsanleihen, Gold, Rohstoffe, Immobilien.
//    Signale aus den langen Kursreihen der US-ETFs; gekauft werden gleichwertige europäische UCITS-ETFs (für EU-Kunden
//    gibt es US-ETFs nur als CFD). Was eToro für das Konto ablehnt, sperrt der Bot und nimmt das nächste Gegenstück.
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
import { fredSeries, eurUsdCached, budgetEur } from "./fred.mjs";

const here = p => fileURLToPath(new URL(p, import.meta.url));
export const REAL_MONEY_UNLOCKED = false;
// Spielgeld des Bots in Euro (Repository-Variable TREND_BOT_BUDGET_EUR, Standard 1.000 €); eToro rechnet in Dollar
export const BUDGET_EUR = budgetEur(process.env.TREND_BOT_BUDGET_EUR, 1000);
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
  minOrderUsd: 25,         // kleinere Käufe lohnen sich nicht (eToro-Mindestbetrag 10 $)
  reservePct: 1,           // 1 % des Kontos bleiben immer frei
  maxOrdersPerRun: 12,
  staleDays: 4,            // ältere Kurse → kein Handel
  keepJournal: 400, keepEvents: 60,
};
// symbols: US-ETFs mit langer Kurshistorie – aus ihnen kommen Signale und Rückblick-Test.
// trade: Gekauft werden gleichwertige europäische UCITS-ETFs als echte Anteile. US-ETFs haben kein Basisinformationsblatt
// (PRIIPs-Verordnung) und sind für Privatkunden in der EU und in Großbritannien nur als CFD zu haben; ist CFD-Handel im
// Konto gesperrt, lehnt eToro solche Käufe ab (Fehler 797). Kürzel ohne Börsenendung in Wunschreihenfolge – gesucht in
// der offiziellen ETF-Liste (CSPX → CSPX.L). match: so muss der Name lauten; avoid: Namen einer anderen Anlage.
export const ASSETS = [
  { key: "us", name: "US-Aktien (S&P 500)", symbols: ["SPY", "VOO", "IVV"], yld: 0.018,
    trade: ["CSPX", "VUAA", "SXR8", "IUSA", "VUSA", "SPY5", "SPXS", "I500"], match: /S&P\s*500/i,
    avoid: /equal|esg|sri|paris|climate|screened|sector|info|tech|financ|health|energy|consumer|industr|utilit|material|communic|real estate|dividend|growth|value|momentum|quality|low vol|buyback|covered|premium/i },
  { key: "intl", name: "Aktien anderer Industrieländer", symbols: ["EFA", "VEA", "IEFA"], yld: 0.03,
    trade: ["EXUS", "IMEU", "SMEA", "VEUR", "MEUD", "EXSA", "XMEU"], match: /ex[\s-]*US|EAFE|Europe|STOXX\s*600/i,
    avoid: /ex[\s-]*Europe|emerging|small|esg|sri|paris|climate|dividend|value|momentum|quality|low vol|sector|bank|financ|health|energy|tech|real estate|property/i },
  { key: "bonds", name: "US-Staatsanleihen 7–10 Jahre", symbols: ["IEF", "GOVT", "TLT"], fred: "DGS10",
    trade: ["IBTM", "CBU0", "IUSM", "SXRM", "VUTY", "VDTY"], match: /treasur/i,
    avoid: /0\s*-\s*1|1\s*-\s*3|3\s*-\s*7|20\s*\+|short|ultra|tips|inflation|float|esg/i },
  { key: "gold", name: "Gold", symbols: ["GLD", "IAU"], yld: 0,
    trade: ["IGLN", "SGLD", "PHAU", "SGLN", "PPFB", "8PSG", "4GLD", "EWG2"], match: /gold/i,
    avoid: /miner|mining|esg|silver|platin|precious metals|basket/i },
  { key: "commod", name: "Rohstoffe", symbols: ["DBC", "PDBC", "GSG", "COMT", "BCI"], fred: "DTB3",
    trade: ["CMOD", "ICOM", "AIGC", "WCOA", "EXXY", "CRBL"], match: /commodit|rohstoff|\bCRB\b/i,
    avoid: /ex[\s-]*(agri|energy)|agricult|energy|precious|industrial metal|gold|esg|carbon/i },
  { key: "reits", name: "Immobilien (REITs)", symbols: ["VNQ", "IYR", "XLRE"], yld: 0.038,
    trade: ["IUSP", "IDUP", "IQQ7", "IWDP", "IQQ6", "GLRE", "SPYJ", "TRET"], match: /property|real estate|REIT|EPRA|immobil/i,
    avoid: /europe|asia|china|japan|\buk\b|esg|mortgage/i },
];
// yld / fred: geschätzte Ausschüttung pro Jahr bzw. FRED-Marktrendite in % (siehe withDistributions)
// Aufbau (Forschungs-Lauf „Trend-Forschung“ 2011–2026, beide Hälften): die Hälfte als fester Kern, immer investiert –
// 60 % US-Aktien, 40 % US-Staatsanleihen (Faber & Richardson 2009, „The Ivy Portfolio“: halb kaufen und halten, halb Trend);
// die andere Hälfte steuert der selbstlernende Trend-Teil, sein freies Geld liegt verzinst im Geldmarkt-ETF.
export const CORE = { share: 0.5, weights: { us: 0.6, bonds: 0.4 } };
// Geldmarkt: kurzlaufende US-Staatsanleihen (bis 1 Jahr) – verzinst wie T-Bills, kaum Schwankung
export const CASH = { key: "cash", name: "Geldmarkt (US-Staatsanleihen bis 1 Jahr)", trade: ["IB01", "BB3M", "VDST", "ZPR1", "TBIL"],
  match: /treasur|t-?bill/i, need: /0\s*-\s*1|0\s*-\s*3\s*month|bill/i, avoid: /1\s*-\s*3\s*y|3\s*-\s*7|7\s*-\s*10|20\s*\+|tips|inflation|float|esg/i };
// nie: gehebelt, umgekehrt, währungsgesichert (dann wäre es eine andere Anlage als im Signal)
export const BAD_VEHICLE = /hedged|leverag|short|inverse|\b[23]x\b|daily|ultra|bear|bull/i;
export const VEHICLE = { keep: 3, minCorr: 0.3, nameFreeCorr: 0.8, freshDays: 7, corrDays: 120 };
// NYSE-Feiertage (keine neuen US-Kurse)
export const HOLIDAYS = new Set([
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
]);
// Börsenfeiertage in London und Frankfurt (Xetra), wo die UCITS-ETFs gehandelt werden: an diesen Tagen handelt der Bot nicht
export const EU_HOLIDAYS = new Set([
  "2026-01-01", "2026-04-03", "2026-04-06", "2026-05-01", "2026-05-04", "2026-05-25", "2026-08-31", "2026-12-24", "2026-12-25", "2026-12-28", "2026-12-31",
  "2027-01-01", "2027-03-26", "2027-03-29", "2027-05-03", "2027-05-31", "2027-08-30", "2027-12-24", "2027-12-27", "2027-12-28", "2027-12-31",
]);

const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
const sd = a => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const round = (x, d = 4) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : null);
const de = (x, d = 0) => Number(x).toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });
const nowDate = () => (process.env.TREND_NOW ? new Date(process.env.TREND_NOW) : new Date());

// ---------- Börsenzeit ----------
export function zoneClock(d, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" })
    .formatToParts(d).map(p => [p.type, p.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, minutes: (Number(parts.hour) % 24) * 60 + Number(parts.minute), weekday: parts.weekday };
}
export const nyClock = d => zoneClock(d, "America/New_York");
const weekend = day => [0, 6].includes(new Date(`${day}T12:00:00Z`).getUTCDay());
export const isTradingDay = day => !weekend(day) && !HOLIDAYS.has(day);
export const isEuTradingDay = day => !weekend(day) && !EU_HOLIDAYS.has(day);
// Börse offen (mit Abstand zu Eröffnung und Schluss): 8:15 bis 16:00 Uhr Londoner Zeit = 9:15 bis 17:00 Uhr deutscher Zeit
// (London 8:00–16:30, Xetra 9:00–17:30 Uhr deutscher Zeit)
export function marketOpen(d) {
  const c = zoneClock(d, "Europe/London");
  return isEuTradingDay(c.day) && c.minutes >= 8 * 60 + 15 && c.minutes <= 16 * 60;
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
      const risky = ctx.risky || RISKY;
      return Number.isFinite(ctx.nfci) && ctx.nfci > 0 ? w.map((x, i) => (risky.has(ctx.keys[i]) ? x / 2 : x)) : w;
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
// Schwankung eines Depots pro Jahr aus den Tagesrenditen der letzten 60 Handelstage (mit Zusammenhang der Märkte)
export function portfolioVol(w, F, ppy) {
  let pv = 0;
  for (let i = 0; i < w.length; i++) for (let j = 0; j < w.length; j++) {
    if (!w[i] || !w[j] || !F[i] || !F[j]) continue;
    const a = F[i].lr, b = F[j].lr, ma = mean(a), mb = mean(b);
    let c = 0;
    for (let q = 0; q < a.length; q++) c += (a[q] - ma) * (b[q] - mb);
    pv += w[i] * w[j] * c / (a.length - 1);
  }
  return Math.sqrt(Math.max(0, pv) * ppy);
}
export function riskLayer(raw, F, ppy, ddPct) {
  const w = raw.map((x, i) => (F[i] ? Math.min(RULES.maxWeight, Math.max(0, x)) : 0));
  const pv = portfolioVol(w, F, ppy);
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
export function monthEnds(curve, k) {
  const out = [curve[0].eq];
  for (let j = 0; j < k && j + 1 < curve.length; j++) if (curve[j].d.slice(0, 7) !== curve[j + 1].d.slice(0, 7)) out.push(curve[j].eq);
  return out;
}

// ---------- Rückblick-Test ----------
const equal = (closes, t) => { const ok = closes.map(c => c[t] > 0 && c[t - 1] > 0), n = ok.filter(Boolean).length; return ok.map(x => (x ? 1 / n : 0)); };
// Vergleichsdepot: feste Gewichte (fehlt ein ETF noch, liegt sein Anteil als Geld da) oder – ohne Angabe – alle gleich
const benchWeights = (closes, t, bench) => (bench ? bench.map((w, i) => (closes[i][t] > 0 && closes[i][t - 1] > 0 ? w : 0)) : equal(closes, t));
export const weekOf = day => { const t = new Date(`${day}T12:00:00Z`); return new Date(t - ((t.getUTCDay() + 6) % 7) * 864e5).toISOString().slice(0, 10); };
// Gehandelt wird einen Zeitschritt nach dem Signal (wie im echten Betrieb: Signal aus dem Schlusskurs, Kauf am nächsten Tag).
// cashRet: Zins auf freies Geld je Zeitschritt (T-Bills); bench: feste Gewichte des Vergleichsdepots (monatlich neu)
export function runBacktest(series, ppy, targetsAt, cashRet = null, bench = null) {
  const { dates, closes } = series, n = dates.length, A = closes.length;
  const start = warmup(ppy);
  if (n < start + 2) return null;
  let eq = 1, peak = 1, ew = 1, spy = 1, cur = Array(A).fill(0), pending = null, turnover = 0;
  let ewW = benchWeights(closes, start, bench);
  const curve = [];
  for (let t = start; t < n; t++) {
    if (t > start) {
      // Wertentwicklung von t−1 nach t (ein ETF ohne Kurs zählt nicht)
      const ratio = i => (closes[i][t] > 0 && closes[i][t - 1] > 0 ? closes[i][t] / closes[i][t - 1] : 1);
      const grow = cur.map((w, i) => w * ratio(i));
      const cash = 1 + (cashRet ? cashRet[t] : 0);
      const total = grow.reduce((a, b) => a + b, 0) + (1 - cur.reduce((a, b) => a + b, 0)) * cash;
      eq *= total;
      cur = grow.map(v => v / total);
      const ewGrow = ewW.map((w, i) => w * ratio(i)), ewTotal = ewGrow.reduce((a, b) => a + b, 0) + (1 - ewW.reduce((a, b) => a + b, 0)) * cash;
      ew *= ewTotal;
      // Vergleichsdepot monatlich neu gewichtet
      ewW = (t - start) % Math.round(ppy / 12) === 0 ? benchWeights(closes, t, bench) : ewGrow.map(v => v / ewTotal);
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
export function familyBacktest(series, ppy, ctxAt, cashRet = null) {
  const { dates, closes } = series;
  const F = dates.map((_, t) => closes.map(c => featuresAt(c, t, ppy)));
  const B = F.map(inverseVol);
  const raws = dates.map((_, t) => VARIANTS.map(v => v.raw(F[t], B[t], ctxAt(t))));
  const singles = VARIANTS.map((_, v) => runBacktest(series, ppy, (t, dd) => riskLayer(raws[t][v], F[t], ppy, dd).w, cashRet));
  if (singles.some(x => !x)) return null;
  let lw = Array(VARIANTS.length).fill(1 / VARIANTS.length), lastMonth = null, scores = null;
  const history = [], targets = [];
  const ens = runBacktest(series, ppy, (t, dd, k) => {
    const m = dates[t].slice(0, 7);
    if (m !== lastMonth) {
      const res = learnStep(singles.map(x => monthEnds(x.curve, k)), lw);
      lw = res.w; scores = res.scores; lastMonth = m;
      history.push([dates[t], ...lw.map(x => round(x, 4))]);
    }
    const raw = closes.map((_, i) => VARIANTS.reduce((sum, _v, v) => sum + lw[v] * raws[t][v][i], 0));
    return (targets[t] = riskLayer(raw, F[t], ppy, dd).w);
  }, cashRet);
  return { ens, singles, history, weights: lw, scores, F, raws, targets };
}
// Kern + Trend: Ziel je Zeitschritt = Anteil × fester Kern + Rest × Ziel des Trend-Teils (mit dessen eigener Verlustbremse);
// Vergleich: der Kern allein (60/40)
export function combinedBacktest(series, ppy, fam, coreW, cashRet = null) {
  return runBacktest(series, ppy, t => {
    const tw = fam.targets[t];
    return tw ? coreW.map((c, i) => CORE.share * (fam.F[t][i] ? c : 0) + (1 - CORE.share) * tw[i]) : null;
  }, cashRet, coreW);
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
export function summarize(bt, ppy, every, benchName = null) {
  const c = bt.curve, d = c.map(x => x.d);
  const sample = c.filter((_, i) => i % every === 0 || i === c.length - 1).map(x => [x.d, round(x.eq), round(x.ew), round(x.spy), round(x.exp, 3)]);
  return {
    start: d[0], end: d[d.length - 1], points: c.length,
    bot: perf(c.map(x => x.eq), d, ppy), ew: perf(c.map(x => x.ew), d, ppy), spy: perf(c.map(x => x.spy), d, ppy),
    avgExposure: round(mean(c.map(x => x.exp)) * 100, 1), turnoverPerYear: round(bt.turnoverPerYear * 100, 0), curve: sample, benchName,
  };
}

// ---------- Kurse ----------
export async function resolve(asset) {
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
export async function candles(id, interval, count) {
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

// Ausschüttungen: eToro-Kurse enthalten keine Dividenden und Zinsen (geprüft: SPY schloss laut eToro am 19.11.2010 bei
// 120,29 $ – der unbereinigte Kurs). Für Anleihen fehlten so 2–5 % im Jahr, ihre Trends sahen schlechter aus, als sie
// waren. Signale und Rückblick rechnen deshalb mit geschätzten Ausschüttungen: Aktien mit üblicher Dividendenrendite,
// Anleihen mit der Marktrendite (FRED), Rohstoff-ETFs mit dem T-Bill-Zins ihrer Sicherheiten.
const valueAsOf = (rows, d) => {
  if (!rows || !rows.length) return null;
  let lo = 0, hi = rows.length - 1, ans = null;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (rows[m].d <= d) { ans = rows[m].v; lo = m + 1; } else hi = m - 1; }
  return ans;
};
export function withDistributions(S, assets, fred) {
  const closes = S.closes.map((col, i) => {
    const a = assets[i];
    let acc = null, prev = null, prevD = null;
    return col.map((c, t) => {
      if (c === null) return null;
      if (acc === null) { acc = c; prev = c; prevD = S.dates[t]; return acc; }
      const days = (Date.parse(S.dates[t]) - Date.parse(prevD)) / 864e5;
      const y = a.fred ? (valueAsOf(fred[a.fred], prevD) ?? 0) / 100 : (a.yld || 0);
      acc = acc * (c / prev) * (1 + y * days / 365);
      prev = c; prevD = S.dates[t];
      return acc;
    });
  });
  return { dates: S.dates, closes };
}
// Zins auf freies Geld je Zeitschritt (T-Bill-Zins des Vortags, tageweise)
export const cashReturns = (dates, dtb3) => dates.map((d, t) => (t ? ((valueAsOf(dtb3, dates[t - 1]) ?? 0) / 100) * (Date.parse(d) - Date.parse(dates[t - 1])) / 864e5 / 365 : 0));

// ---------- Handelbare Gegenstücke (UCITS-ETFs) ----------
// Offizielle ETF-Liste von eToro (Typ laut Liste, ohne interne Instrumente)
async function etfList() {
  let typeId = 6;
  try {
    const d = await call("/v1/market-data/instrument-types");
    const t = findArray(field(d, "instrumentTypes") ? { items: field(d, "instrumentTypes") } : d).find(x => /etf/i.test(String(field(x, "instrumentTypeDescription") || "")));
    if (t && Number.isInteger(num(field(t, "instrumentTypeID")))) typeId = num(field(t, "instrumentTypeID"));
  } catch (e) { warn(`Instrument-Typen: ${e.message} – nehme Typ 6 für ETFs.`); }
  const d = await call("/v1/market-data/instruments", { instrumentTypeIds: String(typeId) });
  const list = [field(d, "instrumentDisplayDatas"), findArray(d)].find(a => Array.isArray(a) && a.length) || [];
  return list.map(x => ({
    id: num(field(x, "instrumentID", "instrumentId")), sym: String(field(x, "symbolFull", "internalSymbolFull", "symbol") || "").toUpperCase(),
    name: String(field(x, "instrumentDisplayName", "displayname", "displayName", "name") || ""), type: num(field(x, "instrumentTypeID", "instrumentTypeId")),
    internal: field(x, "isInternalInstrument") === true,
  })).filter(x => Number.isInteger(x.id) && x.sym && !x.internal && (x.type === null || x.type === typeId));
}
const SUFFIX_RANK = [".L", ".DE"];   // London zuerst (meist in US-Dollar wie das Signal), dann Xetra
const suffixRank = s => { const i = SUFFIX_RANK.indexOf(s.slice(s.lastIndexOf("."))); return i < 0 ? SUFFIX_RANK.length : i; };
// Kandidaten aus der Liste: gleicher Kürzel-Stamm mit sauberer Börsenendung (CSPX.L, SXR8.DE), in Wunschreihenfolge
export function vehicleCandidates(asset, list) {
  const out = [];
  for (const base of asset.trade || []) {
    const hits = list.filter(x => x.sym.split(".")[0] === base && /^[A-Z0-9]+\.[A-Z]{1,3}$/.test(x.sym))
      .sort((a, b) => suffixRank(a.sym) - suffixRank(b.sym) || a.id - b.id);
    for (const h of hits) if (!out.some(o => o.id === h.id)) out.push({ ...h, nameOk: asset.match.test(h.name), nameBad: BAD_VEHICLE.test(h.name) || Boolean(asset.avoid && asset.avoid.test(h.name)) });
  }
  return out;
}
// Gleichlauf mit dem Signal-ETF: Korrelation der 5-Tages-Renditen an den letzten gemeinsamen Handelstagen
// (5 Tage, weil London und New York zu verschiedenen Zeiten schließen)
export function trackCorr(sigList, vehList, days = VEHICLE.corrDays) {
  const m = new Map(sigList.map(x => [x.d, x.c]));
  const both = vehList.filter(x => m.has(x.d)).slice(-(days + 1)).map(x => [m.get(x.d), x.c]);
  if (both.length < 45) return null;
  const a = [], b = [];
  for (let i = 5; i < both.length; i++) { a.push(Math.log(both[i][0] / both[i - 5][0])); b.push(Math.log(both[i][1] / both[i - 5][1])); }
  const ma = mean(a), mb = mean(b);
  let ab = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { ab += (a[i] - ma) * (b[i] - mb); aa += (a[i] - ma) ** 2; bb += (b[i] - mb) ** 2; }
  return aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : null;
}
// Je Markt bis zu drei geeignete UCITS-ETFs: Name passt (oder läuft fast genau gleich), keine andere Anlage, aktuelle Kurse,
// läuft mit dem Signal-ETF. Der Handel nimmt das erste, das im Konto kaufbar ist.
async function resolveVehicles(found, today, list) {
  if (!list) return null;
  const byKey = {};
  for (const f of found) {
    const ok = [], sigDaily = f.daily.filter(x => x.d < today);
    for (const v of vehicleCandidates(f, list)) {
      if (ok.length >= VEHICLE.keep) break;
      if (v.nameBad) { log(`${f.name}: ${v.sym} („${v.name}“) ist eine andere Anlage – übersprungen.`); continue; }
      let daily;
      try { daily = (await candles(v.id, "OneDay", VEHICLE.corrDays + 30)).filter(x => x.d < today); }
      catch (e) { log(`${f.name}: ${v.sym}: ${e.message}`); continue; }
      const last = daily[daily.length - 1];
      if (!last || (Date.parse(`${today}T12:00:00Z`) - Date.parse(`${last.d}T12:00:00Z`)) / 864e5 > VEHICLE.freshDays) { log(`${f.name}: ${v.sym} hat keine aktuellen Kurse – übersprungen.`); continue; }
      const corr = trackCorr(sigDaily, daily);
      const pass = corr === null ? v.nameOk : corr >= VEHICLE.minCorr && (v.nameOk || corr >= VEHICLE.nameFreeCorr);
      log(`${f.name}: ${v.sym} („${v.name}“), Gleichlauf mit ${f.sym} ${corr === null ? "–" : de(corr, 2)}${v.nameOk ? "" : ", Name passt nicht"} → ${pass ? "geeignet" : "nicht geeignet"}`);
      if (pass) ok.push({ id: v.id, sym: v.sym, name: v.name, last: round(last.c, 4), asOf: last.d, corr: corr === null ? null : round(corr, 2) });
    }
    // Hilfe für Erweiterungen (Monats-Check): verwandte Namen in der eToro-Liste
    const kin = list.filter(x => x.sym.includes(".") && f.match.test(x.name) && !BAD_VEHICLE.test(x.name) && !ok.some(o => o.id === x.id)).slice(0, 12);
    log(`${f.name}: ${ok.length ? `gehandelt wird ${ok.map(o => o.sym).join(" / ")}` : "kein UCITS-Gegenstück gefunden"}; weitere mit passendem Namen: ${kin.map(x => `${x.sym} (${x.name})`).join(", ") || "keine"}`);
    byKey[f.key] = ok;
  }
  return byKey;
}
// Geldmarkt-ETF: nur nach Kürzel und Name (es gibt kein Signal, mit dem er laufen müsste), aktuelle Kurse
export function cashCandidates(list) {
  const out = [];
  for (const base of CASH.trade) {
    const hits = list.filter(x => x.sym.split(".")[0] === base && /^[A-Z0-9]+\.[A-Z]{1,3}$/.test(x.sym)).sort((a, b) => suffixRank(a.sym) - suffixRank(b.sym) || a.id - b.id);
    for (const h of hits) if (!out.some(o => o.id === h.id)) out.push({ ...h, ok: CASH.match.test(h.name) && CASH.need.test(h.name) && !CASH.avoid.test(h.name) && !BAD_VEHICLE.test(h.name) });
  }
  return out;
}
async function resolveCash(list, today) {
  if (!list) return [];
  const ok = [];
  for (const v of cashCandidates(list)) {
    if (ok.length >= VEHICLE.keep) break;
    if (!v.ok) { log(`Geldmarkt: ${v.sym} („${v.name}“) ist kein Geldmarkt-ETF – übersprungen.`); continue; }
    let daily;
    try { daily = (await candles(v.id, "OneDay", 30)).filter(x => x.d < today); } catch (e) { log(`Geldmarkt: ${v.sym}: ${e.message}`); continue; }
    const last = daily[daily.length - 1];
    if (!last || (Date.parse(`${today}T12:00:00Z`) - Date.parse(`${last.d}T12:00:00Z`)) / 864e5 > VEHICLE.freshDays) { log(`Geldmarkt: ${v.sym} hat keine aktuellen Kurse – übersprungen.`); continue; }
    ok.push({ id: v.id, sym: v.sym, name: v.name, last: round(last.c, 4), asOf: last.d, corr: null });
  }
  log(`Geldmarkt: ${ok.length ? `gehandelt wird ${ok.map(o => o.sym).join(" / ")}` : "kein passender ETF – freies Geld bleibt unverzinst im Konto"}`);
  return ok;
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
      const Draw = align(found.map(f => f.daily), today), Wraw = align(found.map(f => f.weekly), weekCut);
      // FRED: Finanzlage (NFCI) für „Trend + Finanzlage“, T-Bill-Zins (DTB3) für freies Geld, 10-jährige Rendite (DGS10) für Anleihen
      const fred = {};
      for (const [id, from] of [["NFCI", "2008-01-01"], ["DTB3", "2009-01-01"], ["DGS10", "2009-01-01"]]) {
        try { fred[id] = await fredSeries(id, from); }
        catch (e) { out.errors.push(`FRED ${id}: ${e.message} – ${id === "NFCI" ? "die Variante „Trend + Finanzlage“ rechnet vorerst wie die Grundregel" : "der Bot rechnet hier vorsichtig mit 0 %"}.`); }
      }
      const nfci = fred.NFCI || null;
      // Signale und Rückblick mit Ausschüttungen; freies Geld verzinst wie T-Bills
      const D = withDistributions(Draw, found, fred), W = withDistributions(Wraw, found, fred);
      const cashD = cashReturns(D.dates, fred.DTB3), cashW = cashReturns(W.dates, fred.DTB3);
      // Was der Bot tatsächlich kauft: UCITS-Gegenstücke, zuletzt der US-ETF selbst (für Konten, die ihn kaufen dürfen)
      let list = null;
      try { list = await etfList(); log(`ETF-Liste von eToro: ${list.length} ETFs`); } catch (e) { warn(`ETF-Liste: ${e.message}`); }
      const veh = await resolveVehicles(found, today, list), cashVeh = await resolveCash(list, today);
      if (!veh) out.errors.push("Die ETF-Liste von eToro war nicht lesbar – der Bot versucht vorerst die US-ETFs (in der EU nur als CFD erlaubt).");
      else if (found.some(f => !veh[f.key].length)) out.errors.push(`Ohne europäisches Gegenstück: ${found.filter(f => !veh[f.key].length).map(f => f.name).join(", ")} – dafür versucht der Bot den US-ETF.`);
      if (veh && !cashVeh.length) out.errors.push("Kein Geldmarkt-ETF gefunden – freies Geld bleibt vorerst unverzinst im Konto.");
      const keys = found.map(f => f.key);
      const ctxOf = dates => { const m = macroAt(dates, nfci); return t => ({ nfci: m[t], keys }); };
      const fam = familyBacktest(D, 252, ctxOf(D.dates), cashD), famW = familyBacktest(W, 52, ctxOf(W.dates), cashW);
      const coreArr = found.map(f => CORE.weights[f.key] || 0);
      if (!fam) out.errors.push(`Zu wenige gemeinsame Handelstage (${D.dates.length}) für die Signale.`);
      else {
        const comb = combinedBacktest(D, 252, fam, coreArr, cashD), combW = famW ? combinedBacktest(W, 52, famW, coreArr, cashW) : null;
        const t = D.dates.length - 1, F = fam.F[t];
        const sigs = found.map((_, i) => signalAt(D.closes[i], t, 252));        // Trend mit Ausschüttungen
        const raw = found.map((_, i) => Draw.closes[i][t]);                     // echte Kurse (Notbremse des US-ETF)
        if (F.some(x => !x)) out.errors.push(`Zu kurze Historie für ${found.filter((_, i) => !F[i]).map(f => f.sym).join(", ")} – diese ETFs bleiben vorerst bei 0 %.`);
        const rawT = fam.raws[t], mix = combine(fam.weights, rawT);
        const tw = riskLayer(mix, F, 252, fam.ens.dd);   // Trend-Teil mit seiner eigenen Verlustbremse (laut seinem Rückblick)
        const core = coreArr.map((c, i) => (F[i] ? CORE.share * c : 0)), trendW = tw.w.map(x => (1 - CORE.share) * x);
        const w = core.map((c, i) => c + trendW[i]);
        out.asOf = D.dates[t];
        out.core = { share: CORE.share, weights: CORE.weights };
        const trade = (f, i) => [...(veh ? veh[f.key] : []), { id: f.id, sym: f.sym, name: `${f.sym} (US-ETF)`, last: Number.isFinite(raw[i]) ? round(raw[i], 4) : null, asOf: D.dates[t], us: true }];
        out.assets = found.map((f, i) => sigs[i] && F[i] ? ({
          key: f.key, name: f.name, sym: f.sym, instrumentId: f.id, last: round(raw[i], 4), r3: round(sigs[i].r3 * 100, 2), r6: round(sigs[i].r6 * 100, 2),
          r12: round(sigs[i].r12 * 100, 2), dSma: round(sigs[i].dSma * 100, 2), checks: sigs[i].checks, score: sigs[i].score, vol: round(sigs[i].vol * 100, 2),
          core: round(core[i], 4), trend: round(trendW[i], 4), weightBase: round(w[i], 4), weight: round(w[i], 4), trade: trade(f, i),
        }) : ({ key: f.key, name: f.name, sym: f.sym, instrumentId: f.id, last: null, checks: [false, false, false, false], score: 0, vol: null, core: 0, trend: 0, weightBase: 0, weight: 0, short: true, trade: trade(f, i) }));
        const invested = out.assets.reduce((a, x) => a + x.weight, 0);
        const rate = fred.DTB3 ? fred.DTB3[fred.DTB3.length - 1] : null;
        out.cash = { key: "cash", name: CASH.name, weight: round(Math.max(0, 1 - invested), 4), trade: cashVeh, rate: rate ? { value: rate.v, asOf: rate.d } : null };
        // für das Modell-Depot des Bots: Schlusskurse mit Ausschüttungen und ein Geldmarkt-Index
        let ci = 1;
        const cashIdx = cashD.map(r => (ci *= 1 + r));
        const m = D.dates.length, k0 = m - Math.min(15, m);
        out.recentKeys = [...keys, "cash"];
        out.recent = D.dates.slice(k0).map((d, k) => [d, ...D.closes.map(c => round(c[k0 + k], 6)), round(cashIdx[k0 + k], 8)]);
        out.exposure = round(invested, 4);
        out.portVol = round(portfolioVol(w, F, 252) * 100, 2); out.volMult = round(tw.volMult, 3); out.ddMult = round(tw.ddMult, 3); out.modelDd = round(fam.ens.dd, 2);
        out.backtest = { daily: summarize(comb, 252, 5, "60/40"), weekly: combW ? summarize(combW, 52, 2, "60/40") : null };
        const trendPerf = fb => (fb ? perf(fb.ens.curve.map(y => y.eq), fb.ens.curve.map(y => y.d), fb === fam ? 252 : 52) : null);
        out.backtest.trendOnly = { daily: trendPerf(fam), weekly: trendPerf(famW) };
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
        log(`Signale ${out.asOf}: ${out.assets.map(a => `${a.sym} ${de(a.score * 4)}/4 → Kern ${de(a.core * 100, 1)} % + Trend ${de(a.trend * 100, 1)} %`).join(", ")}; Geldmarkt ${de(out.cash.weight * 100, 1)} %`);
        log(`Gelernte Gewichte: ${VARIANTS.map((v, i) => `${v.name} ${de(fam.weights[i] * 100, 0)} %`).join(", ")}${out.learning.nfci ? `; NFCI ${out.learning.nfci.value} (${out.learning.nfci.asOf})` : ""}${rate ? `; T-Bill-Zins ${rate.v} % (${rate.d})` : ""}`);
        if (out.errors.length) log(`Hinweise: ${out.errors.join(" | ")}`);
        const b = out.backtest.daily.bot;
        log(`Rückblick täglich ${out.backtest.daily.start}–${out.backtest.daily.end}: ${de(b.cagr, 1)} % p. a., größter Rückgang ${de(b.maxDD, 1)} %, 12-Monats-Fenster im Plus ${de(b.pos12, 0)} % (60/40: ${de(out.backtest.daily.ew.cagr, 1)} %)`);
        if (out.backtest.weekly) { const x = out.backtest.weekly.bot; log(`Rückblick wöchentlich ${out.backtest.weekly.start}–${out.backtest.weekly.end}: ${de(x.cagr, 1)} % p. a., größter Rückgang ${de(x.maxDD, 1)} %, 12-Monats-Fenster im Plus ${de(x.pos12, 0)} % (60/40: ${de(out.backtest.weekly.ew.cagr, 1)} %)`); }
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
  const command = String(process.env.TREND_BOT_COMMAND || "status").trim().toLowerCase();
  const now = nowDate(), today = nyClock(now).day;
  const prev = (await readJson(STATE_IN)) || {};
  const sig = await readJson(SIGNALS);
  const st = {
    version: 1, enabled: false, positions: [], orders: [], uncertain: [], journal: [], events: [], notices: {}, blocked: {},
    ...prev, updated: now.toISOString(), mode: "demo", budgetEur: BUDGET_EUR, newEvents: [],
  };
  delete st.share;
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
    if (sig && sig.assets && sig.assets.length) st.signals = { asOf: sig.asOf, updated: sig.updated, assets: sig.assets, cash: sig.cash || null, core: sig.core || null, exposure: sig.exposure, portVol: sig.portVol, volMult: sig.volMult, ddMult: sig.ddMult, modelDd: sig.modelDd };
    if (sig && sig.backtest) st.backtest = sig.backtest;
    if (sig && sig.learning) st.learning = sig.learning;
    if (sig && sig.errors) st.signalErrors = sig.errors;
    await mkdir(dirname(OUT), { recursive: true });
    await writeFile(OUT, JSON.stringify(st));
  };

  if (command === "starten" && !st.enabled && !hasKeys) { event("fehler", "Start abgelehnt: Der Bot-Schlüssel fehlt. Bitte zuerst den Demo-Schlüssel als GitHub-Secret hinterlegen (Anleitung auf der Seite „Trend-Bot“), dann erneut starten."); }
  else if (command === "starten" && !st.enabled) { st.enabled = true; st.startedAt = now.toISOString(); st.model = null; st.lastFullWeek = null; delete st.stoppedAt; event("gestartet", `Trend-Bot gestartet (Demokonto, ${de(BUDGET_EUR, 0)} € Spielgeld). Er handelt ab jetzt an jedem Börsentag selbstständig.`); }
  if (command === "stoppen" && st.enabled) st.stopRequested = true;
  if (!hasKeys) { st.setup = false; log("Kein Bot-Schlüssel hinterlegt – Trend-Bot übersprungen."); return save(); }
  st.setup = true;

  // Was der Bot kaufen darf: je Markt die UCITS-Gegenstücke aus den Signalen; was eToro für dieses Konto ablehnt, wird gesperrt
  const addDays = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
  const mask = s => String(s || "").replace(/\d{4,}(?:[.,]\d+)?|\d+[.,]\d+/g, "#").slice(0, 200);   // keine Beträge ins öffentliche Protokoll
  for (const [id, b] of Object.entries(st.blocked)) if (!b.until || b.until <= today) delete st.blocked[id];   // Sperre abgelaufen → wieder versuchen
  // Märkte und – als letzter Posten – der Geldmarkt für das freie Geld des Trend-Teils
  const cashAsset = sig && sig.cash && Array.isArray(sig.cash.trade) ? { ...sig.cash, sym: "Geldmarkt", instrumentId: null, score: null } : null;
  const assetList = [...((sig && sig.assets) || []), ...(cashAsset ? [cashAsset] : [])];
  const vehiclesOf = a => (Array.isArray(a.trade) && a.trade.length ? a.trade : a.instrumentId ? [{ id: a.instrumentId, sym: a.sym, last: a.last, us: true }] : []);
  const idsOf = a => new Set([a.instrumentId, ...vehiclesOf(a).map(v => v.id)].filter(Number.isInteger));
  const symOf = id => { for (const a of assetList) { const v = vehiclesOf(a).find(x => x.id === id); if (v) return v.sym; } return String(id); };
  // via: worüber der Bot diesen Markt hält bzw. als Nächstes kaufen würde (für die Website)
  const viaOf = a => { const held = [...new Set(st.positions.filter(p => p.key === a.key && !p.closing).map(p => symOf(p.instrumentID)))]; return held.length ? held.join(" / ") : (vehiclesOf(a).find(v => !st.blocked[v.id]) || {}).sym || null; };
  const isRejected = info => { const c = num(field(info, "errorCode")); return Number.isFinite(c) && c > 0; };
  const reject = (o, info) => {   // CFD-Sperre: ein halbes Jahr nicht mehr versuchen, sonst eine Woche
    const code = num(field(info, "errorCode")), msg = mask(field(info, "errorMessage")), sym = o.sym || symOf(o.instrumentID);
    const cfd = code === 797 || /CFD/i.test(msg);
    st.blocked[o.instrumentID] = { sym, key: o.key, code: Number.isFinite(code) ? code : null, msg, at: now.toISOString(), until: addDays(today, cfd ? 182 : 7) };
    st.orders = st.orders.filter(x => x !== o);
    event("abgelehnt", `eToro hat den Kauf von ${sym} abgelehnt${msg ? ` („${msg}“)` : ""}.${cfd ? " Ihr Konto darf keine CFDs handeln – und US-ETFs gibt es für Kunden in der EU nur als CFD." : ""} Der Bot versucht dieses Instrument ${cfd ? "ein halbes Jahr" : "eine Woche"} lang nicht mehr und weicht, wo es geht, auf ein gleichwertiges europäisches ETF aus.`);
  };

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
  let rejectedBefore = 0;
  for (const o of st.orders.slice(0, 6)) {   // Stand unbestätigter Aufträge bei eToro nachfragen
    try {
      const info = await call(DEMO.order(o.orderID));
      const ex = Array.isArray(field(info, "positionExecutions")) ? field(info, "positionExecutions") : [];
      if (!ex.length && isRejected(info)) { reject(o, info); rejectedBefore++; continue; }
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
  // Abgelehnte Käufe gelten als nie geschehen: heute voll neu abgleichen, mit gleichwertigen ETFs
  if (rejectedBefore) { st.lastFullWeek = null; delete st.lastTradeDay; }
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
    if (!x.closing) event("geschlossen", `Eine Bot-Position (${assetList.find(a => a.key === x.key)?.sym || x.key}) ist nicht mehr im Konto – von Hand oder durch die Notbremse geschlossen.`, false);
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
  // Kapital des Bots: das Euro-Budget in Dollar, mitgewachsen bzw. geschrumpft wie sein Modell-Depot seit dem Start;
  // nie mehr, als im Konto ist
  st.fx = await eurUsdCached(st.fx, now, e => warn(`Euro-Kurs: ${e.message} – nehme den letzten bekannten.`));
  const growth = st.model && st.model.index > 0 ? st.model.index / 100 : 1;
  const sleeve = Math.max(0, Math.min(BUDGET_EUR * st.fx.value * growth, acc.equity * 0.98));
  st.capitalEur = round(BUDGET_EUR * growth, 2);   // für die Website: Bot-Kapital laut Modell (aus Budget und Modell, nicht aus dem Konto)
  const holdings = new Map();
  for (const p of mine()) holdings.set(p.key, (holdings.get(p.key) || 0) + p.value);
  // investiert = in Märkten (ohne Geldmarkt); der Geldmarkt-Anteil getrennt
  st.exposure = sleeve > 0 ? round([...holdings.entries()].filter(([k]) => k !== "cash").reduce((a, [, v]) => a + v, 0) / sleeve, 4) : 0;
  st.cashPct = sleeve > 0 ? round((holdings.get("cash") || 0) / sleeve, 4) : 0;
  const pnlOpen = mine().reduce((s, p) => s + p.pnl, 0), investedOpen = mine().reduce((s, p) => s + p.amount, 0);
  st.openPnlPct = investedOpen > 0 ? round(pnlOpen / investedOpen * 100, 2) : null;
  st.holdings = assetList.map(a => ({ key: a.key, sym: a.sym, via: viaOf(a), pct: sleeve > 0 ? round((holdings.get(a.key) || 0) / sleeve, 4) : 0, target: a.weight }));

  if (!st.enabled) { log("Trend-Bot ist nicht gestartet – er rechnet nur die Signale."); return finish(); }
  if (!fresh) { once("stale", "warten", `Die Kurse sind nicht aktuell (Stand ${sig && sig.asOf || "unbekannt"}) – heute keine Käufe oder Verkäufe.`); return finish(); }

  // Modell-Depot seit dem Start (100 = Startwert): Grundlage für Tagebuch und Bot-Kapital (Kurse mit Ausschüttungen, Geldmarkt verzinst)
  const keys = sig.recentKeys || sig.assets.map(a => a.key);
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
  // Ziele: Kern + Trend-Teil (dessen Verlustbremse steckt schon in den Signalen) und der Geldmarkt für den Rest
  const liveDd = (1 - M.index / M.peak) * 100, ddMult = Number.isFinite(sig.ddMult) ? sig.ddMult : 1;
  const target = Object.fromEntries(assetList.map(a => [a.key, round(a.weight || 0, 4)]));
  // Für einen Markt ist im Konto kein ETF kaufbar (alle abgelehnt): sein Anteil kommt verzinst in den Geldmarkt
  if (cashAsset && vehiclesOf(cashAsset).some(v => !st.blocked[v.id])) for (const a of sig.assets) {
    if (target[a.key] > 0 && !vehiclesOf(a).some(v => !st.blocked[v.id])) { target.cash = round((target.cash || 0) + target[a.key], 4); target[a.key] = 0; }
  }
  st.liveDd = round(liveDd, 2); st.ddMult = round(ddMult, 3); st.target = target;
  st.holdings = st.holdings.map(h => ({ ...h, target: target[h.key] }));
  // Volle Umschichtung beim ersten Handelslauf der Woche (und gleich nach dem Start), sonst nur Ausstiege bei gebrochenem Trend
  const full = st.lastFullWeek !== weekOf(today);
  if (M.appliedFor !== sig.asOf && marketOpen(now) && st.lastTradeDay !== today) {   // Ziele einmal je Kursstand ins Modell (mit Band und Kosten)
    let traded = 0;
    for (const k of keys) {
      const c = M.w[k] || 0, g = target[k] || 0;
      if (!full && !(g === 0 && c > 0)) continue;
      if ((g === 0 && c > 0) || (c === 0 && g > 0) || Math.abs(g - c) > RULES.band) { traded += Math.abs(g - c); M.w[k] = g; }
    }
    M.index *= 1 - traded * RULES.costPct / 100; M.appliedFor = sig.asOf;
  }
  if (!marketOpen(now)) { log("Börse geschlossen (London/Frankfurt) – gehandelt wird beim nächsten Lauf während der Handelszeit."); st.waiting = "Börse geschlossen"; return finish(); }
  delete st.waiting;
  if (st.lastTradeDay === today) { log("Heute schon abgeglichen."); return finish(); }
  const busy = assetList.filter(a => [...idsOf(a)].some(id => acc.pendingInstruments.has(id)));
  if (busy.length || st.orders.length) { once("pending", "warten", `Es gibt noch offene Aufträge (${busy.map(a => a.sym).join(", ") || "in Prüfung"}) – der Bot wartet, damit nichts doppelt gekauft wird.`, false); return finish(); }

  // 4. Umschichten: erst verkaufen (macht Geld frei), dann kaufen
  const trades = [];
  let orders = 0, credit = acc.credit - acc.equity * RULES.reservePct / 100;
  // Kaufen über das erste kaufbare Gegenstück; Aufstocken möglichst im schon gehaltenen ETF
  const chooseVehicle = a => {
    const held = new Set(mine().filter(p => p.key === a.key).map(p => p.instrumentID)), list = vehiclesOf(a).filter(v => !st.blocked[v.id]);
    return list.find(v => held.has(v.id)) || list[0] || null;
  };
  const buy = async (a, amount, reason) => {
    for (let tries = 0; tries < 4 && orders < RULES.maxOrdersPerRun; tries++) {
      const v = chooseVehicle(a);
      if (!v) { once(`novehicle:${a.key}`, "hinweis", `Für ${a.name} ist in Ihrem Konto gerade kein ETF kaufbar – dieser Anteil kommt vorerst in den Geldmarkt.`); return; }
      const at = new Date().toISOString(), sl = v.last > 0 ? round(v.last * (1 - RULES.stopLossPct / 100), 4) : null;
      try {
        const r = await send("POST", DEMO.open, {
          InstrumentID: v.id, IsBuy: true, Leverage: 1, Amount: amount, ...(sl ? { StopLossRate: sl, IsNoStopLoss: false } : { IsNoStopLoss: true }), IsNoTakeProfit: true, IsTslEnabled: false,
        });
        orders++; credit -= amount;
        const ofo = field(r, "orderForOpen") || {}, orderID = num(field(ofo, "orderID"));
        log(`Kauf ${v.sym} für ${a.name}: Auftrag ${orderID ?? "?"}, Status ${field(ofo, "statusID") ?? "?"}`);
        if (Number.isInteger(orderID)) st.orders.push({ orderID, key: a.key, instrumentID: v.id, sym: v.sym, at, pct: round(amount / sleeve, 6) });
        else st.uncertain.push({ key: a.key, sym: v.sym, instrumentID: v.id, at });
        trades.push({ key: a.key, sym: v.sym, side: "kauf", pct: round(amount / sleeve * 100, 2), reason });
        return;
      } catch (e) {
        if (e.uncertain) { st.uncertain.push({ key: a.key, sym: v.sym, instrumentID: v.id, at }); event("unklar", `Kauf von ${v.sym} gesendet, aber ohne Bestätigung (${mask(e.message)}). Der Bot sendet ihn nicht noch einmal und prüft beim nächsten Lauf das Konto.`); return; }
        // sofort abgewiesen: dieses ETF eine Woche lang nicht mehr versuchen und gleich das nächste gleichwertige nehmen
        st.blocked[v.id] = { sym: v.sym, key: a.key, code: e.status || null, msg: mask(e.message), at: now.toISOString(), until: addDays(today, 7) };
        event("fehler", `eToro hat den Kauf von ${v.sym} abgewiesen: ${mask(e.message)} – der Bot versucht ein gleichwertiges ETF.`);
      }
    }
  };
  for (const a of assetList) {
    const g = target[a.key] || 0, have = holdings.get(a.key) || 0, want = g * sleeve, diff = want - have;
    if (!(have > 0) || orders >= RULES.maxOrdersPerRun) continue;
    if (g === 0 || (full && diff < -RULES.band * sleeve)) {
      const ps = mine().filter(p => p.key === a.key), soldSyms = new Set();
      let toSell = g === 0 ? Infinity : -diff, sold = 0;
      for (const p of ps.sort((x, y) => x.value - y.value)) {
        if (toSell <= 1 || orders >= RULES.maxOrdersPerRun) break;
        const full = toSell >= p.value * 0.98 || !(p.units > 0);
        const body = full ? { InstrumentID: p.instrumentID } : { InstrumentID: p.instrumentID, UnitsToDeduct: round(p.units * toSell / p.value, 6) };
        try {
          await send("POST", DEMO.close(p.positionID), body);
          orders++;
          const amt = full ? p.value : toSell;
          sold += amt; toSell -= amt; credit += amt; soldSyms.add(symOf(p.instrumentID));
          if (full) { const x = st.positions.find(y => y.positionID === p.positionID); if (x) x.closing = now.toISOString(); }
        } catch (e) { once(`close:${p.positionID}`, "fehler", `Verkauf von ${symOf(p.instrumentID)} fehlgeschlagen: ${mask(e.message)}`); }
      }
      const why = a.key === "cash" ? "Geldmarkt für Käufe aufgelöst" : g === 0 ? "Trend gebrochen – Ausstieg" : "Anteil verringert";
      if (sold > 0) trades.push({ key: a.key, sym: [...soldSyms].join(" / "), side: "verkauf", pct: round(sold / sleeve * 100, 2), reason: why });
    }
  }
  for (const a of assetList) {   // der Geldmarkt kommt zuletzt und bekommt, was übrig ist
    const g = target[a.key] || 0, have = holdings.get(a.key) || 0, want = g * sleeve, diff = want - have;
    if (!full || !(g > 0) || orders >= RULES.maxOrdersPerRun) continue;
    if (!(have === 0 || diff > RULES.band * sleeve)) continue;
    const amount = Math.floor(Math.min(diff, credit) * 100) / 100;
    if (!(amount >= RULES.minOrderUsd)) { if (diff >= RULES.minOrderUsd && a.key !== "cash") once(`credit:${a.key}`, "hinweis", `Für ${a.name} ist nicht genug freies Geld im Demokonto – der Kauf wird übersprungen.`, false); continue; }
    const reason = a.key === "cash" ? "freies Geld verzinst im Geldmarkt" : have > 0 ? "Anteil erhöht" : a.core > 0 ? "Kern-Anteil" + (a.trend > 0 ? " und Trend intakt" : "") : "Trend intakt – Einstieg";
    await buy(a, amount, reason);
  }
  st.lastTradeDay = today;
  if (full) st.lastFullWeek = weekOf(today);

  // 5. Aufträge bestätigen lassen: ausgeführte Positionen übernehmen; was eToro ablehnt, gleich mit dem nächsten gleichwertigen ETF kaufen
  for (let i = 0; i < 8 && st.orders.length; i++) {
    await sleep(POLL_MS);
    const retry = [];
    let positionsNow = null;
    for (const o of [...st.orders]) {
      try {
        const info = await call(DEMO.order(o.orderID));
        const ex = Array.isArray(field(info, "positionExecutions")) ? field(info, "positionExecutions") : [];
        if (!ex.length && isRejected(info)) {
          reject(o, info);
          const t = trades.find(x => x.side === "kauf" && x.key === o.key && x.sym === o.sym && !x.rejected);
          if (t) { t.rejected = true; t.reason = "von eToro abgelehnt"; }
          if (Number.isFinite(o.pct)) { credit += o.pct * sleeve; retry.push(o); }
          continue;
        }
        let pids = ex.map(e => num(field(e, "positionId", "positionID"))).filter(Number.isInteger);
        if (!pids.length) {   // steht die Ausführung nicht im Auftrag: im Konto nach der Auftragsnummer suchen
          positionsNow = positionsNow || readAccount(await call(DEMO.pnl)).positions;
          pids = positionsNow.filter(p => p.orderID === o.orderID).map(p => p.positionID);
        }
        for (const pid of pids) if (!st.positions.some(x => x.positionID === pid)) st.positions.push({ positionID: pid, instrumentID: o.instrumentID, key: o.key, since: today });
        if (pids.length) st.orders = st.orders.filter(x => x !== o);
      } catch (e) { log(`Auftrag ${o.orderID}: ${mask(e.message)}`); }
    }
    for (const o of retry) {
      const a = assetList.find(x => x.key === o.key), amount = Math.floor(Math.min(o.pct * sleeve, credit) * 100) / 100;
      if (a && amount >= RULES.minOrderUsd) await buy(a, amount, "Ersatz für einen abgelehnten Kauf");
    }
  }
  st.todayTrades = trades;
  if (trades.length) log(`Umgeschichtet: ${trades.map(t => `${t.side} ${t.sym} ${de(t.pct, 1)} %${t.rejected ? " (abgelehnt)" : ""}`).join(", ")}`);
  else log("Keine Umschichtung nötig – alle Anteile liegen im Band.");
  if (ddMult < 1) once("brake", "bremse", `Verlustbremse im Trend-Teil aktiv: Er liegt ${de(sig.modelDd || 0, 1)} % unter seinem Hoch und setzt nur ${de(ddMult * 100, 0)} % des üblichen Anteils ein – der feste Kern bleibt investiert.`);
  return finish(trades);

  // Tagebuch: ein Eintrag pro Tag, solange der Bot läuft (nur Prozentwerte)
  async function finish(trades = null, force = false) {
    if (Array.isArray(st.holdings)) st.holdings = st.holdings.map(h => { const a = assetList.find(x => x.key === h.key); return a ? { ...h, via: viaOf(a) } : h; });
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
        day: today, enabled: st.enabled, asOf: sig.asOf, exposureTarget: st.target ? round(Object.entries(st.target).filter(([k]) => k !== "cash").reduce((a, [, b]) => a + b, 0), 4) : sig.exposure,
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

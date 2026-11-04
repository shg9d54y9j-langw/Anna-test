// Täglicher Job (GitHub Actions): holt Live-Daten über die offizielle eToro-API,
// berechnet die Top 25 und die Tagesempfehlung und schreibt sie nach data/ranking.json.
// Zusätzlich: data/returns.json mit allen Monatsrenditen, damit jede Zahl unabhängig
// nachgerechnet werden kann (tests/verify_ranking.py).
// Benötigt die Repository-Secrets ETORO_API_KEY und ETORO_USER_KEY (nur Leserechte).
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { call, field, num, log, warn, fail, hasKeys, loadRankings } from "./etoro.mjs";

createRequire(import.meta.url)("../stats.js");
const S = globalThis.TradeStats;

// ---------- Einstellungen ----------
const CONFIG = {
  universe: 150,      // geprüft werden die meistkopierten Popular Investors …
  maxRisk: 5,         // … mit Risiko-Score bis 5
  minMonths: 24,      // mindestens 2 Jahre Monatsrenditen
  maxMonths: 60,      // ausgewertet werden höchstens die letzten 5 Jahre
  maxDd: 20,          // größter Rückgang höchstens 20 %
  threshold: 0.9,     // geforderte Können-Sicherheit
  rf: 2,              // Zins ohne Risiko in % p.a.
  share: 0.2,         // höchstens 20 % des Kontos pro Trader
  lossPct: 0.05,      // höchstens 5 % des Kontos Verlust pro Kopie
  top: 25,
  keepWithinTop: 5,   // Empfehlung wechselt erst, wenn der Trader aus den Top 5 der sicheren Trader fällt
  maxDataDeviation: 25, // Datenkontrolle: weichen unsere 2-Jahres-Renditen im Median um mehr als 25 Prozentpunkte von eToro ab → nichts veröffentlichen
};

const here = p => fileURLToPath(new URL(p, import.meta.url));
const OUT = process.env.RANKING_OUT || here("../data/ranking.json");
const RETURNS_OUT = process.env.RETURNS_OUT || here("../data/returns.json");

// ---------- Monatsrenditen ----------
function monthKey(tv) {
  const ym = typeof tv === "string" && /^(\d{4})-(\d{2})/.exec(tv);
  if (ym) return Number(ym[1]) * 12 + Number(ym[2]) - 1;
  const t = new Date(typeof tv === "number" && tv < 1e12 ? tv * 1000 : tv);
  return t.getUTCFullYear() * 12 + t.getUTCMonth();
}
const keyToMonth = k => `${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, "0")}`;
function findMonthly(d, depth = 0) {
  const m = field(d, "monthly", "monthlyGains", "months");
  if (Array.isArray(m)) return m;
  const inner = field(d, "data", "gain", "result");
  return inner && typeof inner === "object" && depth < 3 ? findMonthly(inner, depth + 1) : [];
}
// Abgeschlossene Monate (älteste zuerst, nur die jüngste lückenlose Folge) und der laufende Monat getrennt
async function monthlyReturns(userName) {
  const data = await call(`/v1/user-info/people/${encodeURIComponent(userName)}/gain`);
  const now = new Date();
  const current = now.getUTCFullYear() * 12 + now.getUTCMonth();
  const byMonth = new Map();
  let currentGain;
  for (const m of findMonthly(data)) {
    const k = monthKey(field(m, "timestamp", "date", "start", "month"));
    const g = num(field(m, "gain", "value", "return"));
    if (!Number.isFinite(k) || !Number.isFinite(g) || Math.abs(g) > 1000) continue;
    if (k < current) byMonth.set(k, g);
    else if (k === current) currentGain = g;
  }
  const keys = [...byMonth.keys()].sort((a, b) => a - b);
  let i = keys.length - 1;
  while (i > 0 && keys[i - 1] === keys[i] - 1) i--;
  const months = keys.slice(i).slice(-CONFIG.maxMonths).map(k => ({ k, g: byMonth.get(k) }));
  return { months, currentGain };
}

function avgCorrelation(series) {
  let sum = 0, cnt = 0;
  for (let i = 0; i < series.length; i++) for (let j = i + 1; j < series.length; j++) {
    const a = [], b = [];
    for (const [k, g] of series[i]) if (series[j].has(k)) { a.push(g); b.push(series[j].get(k)); }
    if (a.length >= 12) { sum += S.correlation(a, b); cnt++; }
  }
  return cnt ? sum / cnt : 0;
}

// Datenkontrolle: unsere aus Monatswerten verkettete 2-Jahres-Rendite gegen eToros eigene Angabe
function dataCheck(traders) {
  const comp = gs => (gs.reduce((e, g) => e * (1 + g / 100), 1) - 1) * 100;
  const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? (s[(s.length - 1) >> 1] + s[s.length >> 1]) / 2 : NaN; };
  const variants = {
    "24 abgeschlossene Monate": u => comp(u.months.slice(-24).map(m => m.g)),
    "23 abgeschlossene Monate + laufender Monat": u => Number.isFinite(u.currentGain) ? comp([...u.months.slice(-23).map(m => m.g), u.currentGain]) : NaN,
    "24 abgeschlossene Monate + laufender Monat": u => Number.isFinite(u.currentGain) ? comp([...u.months.slice(-24).map(m => m.g), u.currentGain]) : NaN,
  };
  const usable = traders.filter(u => Number.isFinite(u.periodGain) && u.months.length >= 24);
  for (const u of usable.slice(0, 4)) {
    log(`Datenkontrolle Beispiel ${u.userName}: eToro-Wert ${u.periodGain}, eigene 2-Jahres-Rendite ${variants["24 abgeschlossene Monate"](u).toFixed(2)} % ` +
      `(mit laufendem Monat ${Number.isFinite(u.currentGain) ? variants["23 abgeschlossene Monate + laufender Monat"](u).toFixed(2) : "–"} %), eToro p.a. ${u.annualizedReturn ?? "–"}`);
  }
  let best = null;
  // eToro könnte Renditen in Prozent (12,5) oder als Anteil (0,125) liefern – beides prüfen, das passende gewinnt
  for (const scale of [1, 100]) {
    for (const [name, f] of Object.entries(variants)) {
      const diffs = usable.map(u => Math.abs(f(u) - u.periodGain * scale)).filter(Number.isFinite);
      const med = median(diffs);
      log(`Datenkontrolle (${name}, eToro-Werte ${scale === 1 ? "in Prozent" : "als Anteil"}): Median-Abweichung ${Number.isFinite(med) ? med.toFixed(2) : "–"} Prozentpunkte bei ${diffs.length} Tradern`);
      if (Number.isFinite(med) && (!best || med < best.medianDeviationPp)) best = { variant: name, etoroScale: scale, medianDeviationPp: med, traders: diffs.length };
    }
  }
  return best;
}

// Einheit von eToros Drawdown: Er muss in der Größenordnung unseres eigenen Monats-Drawdowns
// der letzten 24 Monate liegen (Tageswerte sind meist etwas größer) – die passende Skala gewinnt.
function drawdownScale(traders) {
  const mddOf = gs => { let eq = 1, peak = 1, m = 0; for (const g of gs) { eq *= 1 + g / 100; peak = Math.max(peak, eq); m = Math.max(m, 1 - eq / peak); } return m * 100; };
  const pairs = traders.filter(u => Number.isFinite(u.peakToValley) && u.peakToValley > 0)
    .map(u => [u.peakToValley, mddOf(u.months.slice(-24).map(m => m.g))]).filter(([, m]) => m > 1);
  if (!pairs.length) return 1;
  const median = a => { const s = [...a].sort((x, y) => x - y); return (s[(s.length - 1) >> 1] + s[s.length >> 1]) / 2; };
  const dist = s => median(pairs.map(([p, m]) => Math.abs(Math.log(p * s / m))));
  const scale = dist(1) <= dist(100) ? 1 : 100;
  const ratio = median(pairs.map(([p, m]) => p * scale / m));
  log(`eToro-Einheit des Drawdowns: ${scale === 1 ? "Prozent" : "Anteil (×100 umgerechnet)"} – im Median ${ratio.toFixed(2)}-fach unser 24-Monats-Drawdown (${pairs.length} Trader)`);
  return scale;
}

// Auf 4 Nachkommastellen runden, ∞/NaN als null speichern
const clean = o => JSON.parse(JSON.stringify(o, (k, val) => (typeof val === "number" ? (Number.isFinite(val) ? Math.round(val * 1e4) / 1e4 : null) : val)));

function decide(prev, qualified, rows) {
  const today = new Date().toISOString().slice(0, 10);
  const prevRec = prev && prev.recommendation;
  const pick = r => ({ userName: r.userName, cagr: r.cagr, mdd: r.mdd, dsr: r.dsr, sharpe: r.sharpe, risk: r.risk, csl: r.csl, amountPct: r.amountPct, bind: r.bind });
  const pos = prevRec ? qualified.findIndex(r => r.userName === prevRec.userName) : -1;
  if (prevRec && pos >= 0 && pos < CONFIG.keepWithinTop) {
    return { ...pick(qualified[pos]), since: prevRec.since || today, changed: false, previous: null,
      note: `Unverändert – erfüllt weiterhin alle Bedingungen (Platz ${pos + 1} der sicheren Trader).` };
  }
  if (!qualified.length) return null;
  let note = "Erste Empfehlung.";
  if (prevRec) {
    const old = rows.find(r => r.userName === prevRec.userName);
    note = !old ? `${prevRec.userName} ist nicht mehr unter den geprüften Tradern.`
      : !old.qualified ? `${prevRec.userName} erfüllt die Bedingungen nicht mehr (${old.reason}).`
      : `${prevRec.userName} ist nicht mehr unter den besten ${CONFIG.keepWithinTop} sicheren Tradern.`;
  }
  return { ...pick(qualified[0]), since: today, changed: Boolean(prevRec), previous: prevRec ? prevRec.userName : null, note };
}

async function main() {
  if (!hasKeys) {
    warn("Die Secrets ETORO_API_KEY und ETORO_USER_KEY fehlen – Job übersprungen. Anleitung auf der Website unter „Tagesempfehlung“.");
    return;
  }
  let prev = null;
  try { prev = JSON.parse(await readFile(OUT, "utf8")); } catch {}

  const { source, total, traders: users } = await loadRankings({ maxRisk: CONFIG.maxRisk, limit: CONFIG.universe });
  log(`${users.length} Kandidaten aus ${source}${total ? ` (${total} Treffer insgesamt)` : ""}`);

  const evaluated = [];
  let denied = 0;
  for (const u of users) {
    try {
      const { months, currentGain } = await monthlyReturns(u.userName);
      if (!evaluated.length) log(`Beispiel ${u.userName}: ${months.length} Monate, zuletzt ${months.slice(-3).map(m => `${keyToMonth(m.k)}: ${m.g}`).join(", ")}`);
      evaluated.push({ ...u, months, currentGain });
    } catch (e) {
      // Fehlt dem Schlüssel die Berechtigung, sofort mit klarer Meldung abbrechen statt 150-mal abzufragen
      if (!evaluated.length && /HTTP 403/.test(e.message) && ++denied >= 3) {
        throw new Error("Dem eToro-Schlüssel fehlt die Leseberechtigung „Benutzerinfo“ (Monatsrenditen der Trader). " +
          "In eToro einen Schlüssel mit zusätzlichem „Read“ bei „Benutzerinfo“ erstellen und die Secrets ersetzen.");
      }
      warn(`${u.userName}: ${e.message}`);
    }
  }
  const withData = evaluated.filter(u => u.months.length >= CONFIG.minMonths);
  if (!withData.length) throw new Error(`Für keinen der ${evaluated.length} Kandidaten gab es mindestens ${CONFIG.minMonths} Monatswerte.`);

  // Datenkontrolle gegen eToros eigene Zahlen – bei grober Abweichung wird nichts veröffentlicht
  const check = dataCheck(withData);
  if (check && check.medianDeviationPp > CONFIG.maxDataDeviation) {
    throw new Error(`Datenkontrolle fehlgeschlagen: Unsere 2-Jahres-Renditen weichen im Median um ${check.medianDeviationPp.toFixed(1)} Prozentpunkte von eToros Angaben ab. Es wird nichts veröffentlicht.`);
  }
  log(`eToro-Einheit der Renditen: ${check && check.etoroScale === 100 ? "Anteil (×100 umgerechnet)" : "Prozent"}`);
  // eToro-Drawdown (peakToValley) hat eine eigene Einheit – separat bestimmen und unmögliche Werte verwerfen
  const ddScale = drawdownScale(withData);
  if (check) check.drawdownScale = ddScale;
  for (const u of withData) {
    if (!Number.isFinite(u.peakToValley)) continue;
    u.peakToValley *= ddScale;
    if (u.peakToValley > 100) u.peakToValley = undefined;   // ein Rückgang über 100 % ist unmöglich
  }

  // Glücks-Korrektur: effektive Zahl unabhängiger Trader aus der mittleren Korrelation
  const rho = avgCorrelation(withData.map(u => new Map(u.months.map(m => [m.k, m.g]))));
  const nEff = S.effectiveTrials(withData.length, rho);

  const rows = withData.map(u => {
    const m = S.metrics(u.months.map(x => x.g), { rf: CONFIG.rf, N: nEff, mddInput: u.peakToValley });
    const fails = [];
    if (u.risk !== undefined && u.risk > CONFIG.maxRisk) fails.push(`Risiko-Score ${u.risk} > ${CONFIG.maxRisk}`);
    if (m.mdd > CONFIG.maxDd) fails.push(`Drawdown ${m.mdd.toFixed(1).replace(".", ",")} % > ${CONFIG.maxDd} %`);
    const inLimits = fails.length === 0;
    const qualified = inLimits && m.dsr >= CONFIG.threshold;
    if (inLimits && !qualified) fails.push(`Können-Sicherheit ${m.dsr < 0.005 ? "unter 1" : Math.round(m.dsr * 100)} % < ${CONFIG.threshold * 100} %`);
    const alloc = S.allocation(m, { share: CONFIG.share, lossPct: CONFIG.lossPct });
    return {
      userName: u.userName, risk: u.risk ?? null, copiers: u.copiers ?? null,
      avgHoldHours: u.avgHoldHours ?? null, profitableMonthsPct: u.profitableMonthsPct ?? null,
      months: m.n, lastMonth: keyToMonth(u.months[u.months.length - 1].k),
      cagr: m.cagr, sharpe: m.sharpe, sortino: m.sortino, mdd: m.mdd, dsr: m.dsr, halfKelly: m.halfKelly,
      qualified, inLimits, reason: fails[0] || null, csl: alloc.csl, amountPct: alloc.frac, bind: alloc.bind,
    };
  });

  // Rangliste: erst alle sicheren Trader nach Rendite, dann die übrigen innerhalb der Grenzen nach Sicherheit
  const qualified = rows.filter(r => r.qualified).sort((a, b) => b.cagr - a.cagr);
  const rest = rows.filter(r => !r.qualified && r.inLimits).sort((a, b) => b.dsr - a.dsr);
  const top = [...qualified, ...rest].slice(0, CONFIG.top).map((r, i) => ({ rank: i + 1, ...r }));

  const recommendation = decide(prev, qualified, rows);
  const lastRecommended = recommendation ? { userName: recommendation.userName, since: recommendation.since } : (prev && prev.lastRecommended) || null;
  const notice = recommendation ? null
    : `Heute erfüllt kein Trader alle Bedingungen.` + (lastRecommended ? ` Wenn Sie ${lastRecommended.userName} kopieren: Kopie pausieren, bis wieder eine Empfehlung erscheint.` : "");
  const today = new Date().toISOString().slice(0, 10);
  const history = [...((prev && prev.history) || []).filter(h => h.date !== today), { date: today, userName: recommendation ? recommendation.userName : null }].slice(-60);
  const updated = new Date().toISOString();

  const out = clean({
    updated, source, totalAvailable: total ?? null,
    screened: users.length, evaluated: withData.length, avgCorrelation: rho, nEff,
    qualifiedCount: qualified.length, config: CONFIG, dataCheck: check,
    recommendation, notice, lastRecommended, top, history,
    // alle ausgewerteten Trader (kompakt) für die Abbildung auf der Website
    all: rows.map(r => ({ userName: r.userName, cagr: r.cagr, mdd: r.mdd, dsr: r.dsr, sharpe: r.sharpe, risk: r.risk, months: r.months, qualified: r.qualified, inLimits: r.inLimits })),
  });
  // Rohdaten für die unabhängige Gegenrechnung
  const returns = {
    updated, rf: CONFIG.rf,
    traders: withData.map(u => ({ userName: u.userName, risk: u.risk ?? null, peakToValley: u.peakToValley ?? null, months: u.months.map(m => [keyToMonth(m.k), m.g]) })),
  };
  for (const [file, data] of [[OUT, out], [RETURNS_OUT, returns]]) {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(data, null, file === OUT ? 2 : 0) + "\n");
  }

  log(`Ausgewertet: ${withData.length} Trader, mittlere Korrelation ${rho.toFixed(2)}, effektiv N = ${nEff.toFixed(1)}, sicher: ${qualified.length}`);
  for (const r of top.slice(0, 5)) log(`#${r.rank} ${r.userName}: Sicherheit ${(r.dsr * 100).toFixed(1)} %, Rendite p.a. ${r.cagr.toFixed(1)} %, Drawdown ${r.mdd.toFixed(1)} %${r.qualified ? " ✓" : ""}`);
  log(recommendation ? `Tagesempfehlung: ${recommendation.userName} (${recommendation.note})` : notice);
}

main().catch(e => fail(e.message));

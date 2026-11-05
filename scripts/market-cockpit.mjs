// Marktlage-Cockpit (GitHub Actions, in jeder Runde des Live-Wächters):
// berechnet wenige, wissenschaftlich belegte Lage-Signale und schreibt data/market.json.
//
//  - Trend: Kurs über/unter dem 200-Tage-Durchschnitt und Vorzeichen der 12-Monats-Rendite
//    (Trendfolge: Moskowitz, Ooi & Pedersen 2012; Hurst, Ooi & Pedersen 2017)
//  - Schwankung: 20-Tage-Volatilität; bei hoher Schwankung kleinere Positionen
//    (Volatility-Managed Portfolios: Moreira & Muir 2017)
//  - Zinskurve 10 Jahre minus 3 Monate: unter null = erhöhtes Rezessionsrisiko (Estrella & Mishkin 1998)
//  - Finanzbedingungen (NFCI der Chicago Fed): über null = straffer als im Durchschnitt
//
// Kurse von eToro (Schlüssel mit „Marktdaten → Read“), Makrodaten von FRED (Federal Reserve Bank of St. Louis, ohne Schlüssel).
// Veröffentlicht werden nur abgeleitete Kennzahlen, keine Kursreihen.
import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { call, field, findArray, num, log, warn, hasKeys } from "./etoro.mjs";

const here = p => fileURLToPath(new URL(p, import.meta.url));
const OUT = process.env.MARKET_OUT || here("../data/market.json");
const FRED = (process.env.FRED_BASE || "https://fred.stlouisfed.org/graph/fredgraph.csv").replace(/\/$/, "");
const fredHost = new URL(FRED).hostname;
if (!["fred.stlouisfed.org", "localhost", "127.0.0.1"].includes(fredHost)) throw new Error(`Unzulässige FRED-Adresse ${fredHost}`);

// Werte, ab denen die Ampel umspringt (in Prozent bzw. Prozentpunkten)
export const RULES = { volCalm: 15, volHigh: 25, targetVol: 15, minSize: 0.25 };

export const ASSETS = [
  { key: "spx", name: "S&P 500", symbols: ["SPX500"], tv: "FOREXCOM:SPXUSD", lead: true },
  { key: "ndx", name: "Nasdaq 100", symbols: ["NSDQ100"], tv: "FOREXCOM:NSXUSD" },
  { key: "dax", name: "DAX", symbols: ["GER40", "GER30"], tv: "XETR:DAX" },
  { key: "gold", name: "Gold", symbols: ["GOLD"], tv: "TVC:GOLD" },
  { key: "oil", name: "Öl (WTI)", symbols: ["OIL"], tv: "TVC:USOIL" },
  { key: "btc", name: "Bitcoin", symbols: ["BTC"], tv: "BITSTAMP:BTCUSD" },
];
export const MACRO = [
  { key: "curve", name: "Zinskurve 10 J. − 3 M.", series: "T10Y3M", unit: "Prozentpunkte" },
  { key: "nfci", name: "Finanzbedingungen (NFCI)", series: "NFCI", unit: "Standardabweichungen" },
  { key: "dollar", name: "US-Dollar (breiter Index)", series: "DTWEXBGS", unit: "Index" },
];

const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
// Kerzen pro Jahr: Krypto wird auch am Wochenende gehandelt (365), Börsenwerte nur werktags (252).
// Erkennung an Samstags-Kerzen – samstags ist jede Börse und jeder CFD-Markt geschlossen.
export function perYearOf(dates) {
  const sat = dates.filter(t => new Date(t).getUTCDay() === 6).length;
  return dates.length && sat / dates.length > 0.05 ? 365 : 252;
}
export function stats(closes, perYear = 252) {
  // closes: älteste zuerst. Fristen in Handelstagen, bei Krypto in Kalendertage umgerechnet (1 Monat = 30, 12 Monate = 365);
  // die 200-Tage-Linie bleibt bei 200 Kerzen – so zeigt sie auch TradingView.
  const n = closes.length;
  if (n < 30) return null;
  const k = d => Math.round(d * perYear / 252);
  const last = closes[n - 1];
  const at = j => (n > j ? closes[n - 1 - j] : null);
  const sma200 = n >= 200 ? mean(closes.slice(-200)) : null;
  const rets = [];
  for (let i = Math.max(1, n - k(20)); i < n; i++) rets.push(Math.log(closes[i] / closes[i - 1]));
  const mr = mean(rets);
  const vol20 = Math.sqrt(rets.reduce((s, r) => s + (r - mr) ** 2, 0) / (rets.length - 1)) * Math.sqrt(perYear) * 100;
  const pct = (a, b) => (a && b ? (a / b - 1) * 100 : null);
  return {
    last, chg1d: pct(last, at(1)), ret1m: pct(last, at(k(21))), ret12m: pct(last, at(k(252))),
    distSma200: sma200 ? (last / sma200 - 1) * 100 : null, vol20, points: n, perYear,
  };
}
export function trendLight(s) {
  if (!s || s.distSma200 === null) return "unknown";
  const up = s.distSma200 > 0, mom = s.ret12m === null ? up : s.ret12m > 0;
  return up && mom ? "green" : !up && !mom ? "red" : "yellow";
}
export function overall(spx, nfci) {
  // Punkte: Trend (+1/−1), Schwankung (+1/0/−1), Finanzbedingungen (+1/−1); fehlende Werte zählen 0
  let score = 0, parts = 0;
  if (spx && spx.distSma200 !== null) { score += spx.distSma200 > 0 ? 1 : -1; parts++; }
  if (spx && Number.isFinite(spx.vol20)) { score += spx.vol20 < RULES.volCalm ? 1 : spx.vol20 > RULES.volHigh ? -1 : 0; parts++; }
  if (nfci && Number.isFinite(nfci.value)) { score += nfci.value <= 0 ? 1 : -1; parts++; }
  const light = !parts ? "unknown" : score >= 2 ? "green" : score >= 0 ? "yellow" : "red";
  const sizeFactor = spx && Number.isFinite(spx.vol20) && spx.vol20 > 0 ? Math.min(1, Math.max(RULES.minSize, RULES.targetVol / spx.vol20)) : null;
  return { light, score, parts, sizeFactor };
}

async function resolveInstrument(symbols) {
  for (const sym of symbols) {
    try {
      const d = await call("/v2/market-data/instruments", { symbols: sym });
      const hit = findArray(d).find(x => String(field(x, "symbol") || "").toUpperCase() === sym);
      if (hit && Number.isInteger(num(field(hit, "instrumentId")))) return { id: num(field(hit, "instrumentId")), symbol: sym, name: field(hit, "displayName") };
    } catch (e) { warn(`Instrument ${sym}: ${e.message}`); }
  }
  return null;
}
async function dailyCloses(id) {
  const d = await call(`/v1/market-data/instruments/${id}/history/candles/desc/OneDay/420`);   // reicht auch für 365 Krypto-Tage
  const groups = Array.isArray(field(d, "candles")) ? field(d, "candles") : [];
  const list = (groups.find(g => num(field(g, "instrumentId")) === id) || groups[0] || {}).candles || [];
  const rows = list.map(c => ({ t: field(c, "fromDate"), c: num(field(c, "close")) })).filter(r => r.t && Number.isFinite(r.c) && r.c > 0);
  rows.sort((a, b) => new Date(a.t) - new Date(b.t));
  return { closes: rows.map(r => r.c), asOf: rows.length ? rows[rows.length - 1].t : null, perYear: perYearOf(rows.map(r => r.t)) };
}
async function fredSeries(id) {
  const from = new Date(Date.now() - 420 * 864e5).toISOString().slice(0, 10);
  const res = await fetch(`${FRED}?id=${encodeURIComponent(id)}&cosd=${from}`, { redirect: "error", signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`FRED ${id}: HTTP ${res.status}`);
  const lines = (await res.text()).trim().split(/\r?\n/).slice(1);
  const rows = lines.map(l => l.split(",")).map(([d, v]) => ({ d, v: Number(v) })).filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.d) && Number.isFinite(r.v));
  if (!rows.length) throw new Error(`FRED ${id}: keine Werte`);
  return rows;
}

async function main() {
  const out = { updated: new Date().toISOString(), rules: RULES, assets: [], macro: {}, errors: [],
    sources: ["eToro-Marktdaten (Tageskerzen)", "FRED, Federal Reserve Bank of St. Louis: T10Y3M (US-Finanzministerium/Fed), NFCI (Chicago Fed), DTWEXBGS (Fed)"] };
  if (hasKeys) {
    for (const a of ASSETS) {
      try {
        const inst = await resolveInstrument(a.symbols);
        if (!inst) { out.errors.push(`${a.name}: bei eToro nicht gefunden`); out.assets.push({ key: a.key, name: a.name, tv: a.tv, light: "unknown" }); continue; }
        const { closes, asOf, perYear } = await dailyCloses(inst.id);
        const s = stats(closes, perYear);
        out.assets.push({ key: a.key, name: a.name, tv: a.tv, symbol: inst.symbol, asOf, ...(s || {}), light: trendLight(s) });
      } catch (e) {
        out.errors.push(`${a.name}: ${e.message}`);
        out.assets.push({ key: a.key, name: a.name, tv: a.tv, light: "unknown" });
      }
    }
  } else warn("Keine eToro-Schlüssel – Kurse fürs Cockpit übersprungen.");

  for (const m of MACRO) {
    try {
      const rows = await fredSeries(m.series);
      const last = rows[rows.length - 1];
      const entry = { name: m.name, series: m.series, unit: m.unit, value: last.v, asOf: last.d };
      if (m.key === "dollar") {
        const s = stats(rows.map(r => r.v));
        Object.assign(entry, { distSma200: s && s.distSma200, ret1m: s && s.ret1m, trend: s && s.distSma200 !== null ? (s.distSma200 > 0 ? "steigt" : "fällt") : null });
      } else if (m.key === "curve") {
        const year = rows.filter(r => r.d >= new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10));
        Object.assign(entry, { light: last.v < 0 ? "red" : last.v < 0.5 ? "yellow" : "green", invertedDays12m: year.filter(r => r.v < 0).length, days12m: year.length });
      } else if (m.key === "nfci") {
        Object.assign(entry, { light: last.v > 0 ? "red" : last.v > -0.3 ? "yellow" : "green" });
      }
      out.macro[m.key] = entry;
    } catch (e) { out.errors.push(`${m.name}: ${e.message}`); }
  }

  const spx = out.assets.find(a => a.key === "spx");
  out.overall = overall(spx && Number.isFinite(spx.last) ? spx : null, out.macro.nfci);
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(out, null, 1));
  log(`Marktlage: ${out.overall.light} (Punkte ${out.overall.score} aus ${out.overall.parts}), Positionsgröße ${out.overall.sizeFactor ? Math.round(out.overall.sizeFactor * 100) + " %" : "–"}; ` +
    `${out.assets.filter(a => Number.isFinite(a.last)).length}/${ASSETS.length} Kurse, ${Object.keys(out.macro).length}/${MACRO.length} Makrowerte` +
    (out.errors.length ? `; Hinweise: ${out.errors.join(" | ")}` : ""));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(e => { console.log(`::warning::Marktlage-Cockpit: ${e.message}`); process.exit(0); });
}

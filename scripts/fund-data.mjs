// Kennzahlen und Insider-Geschäfte (GitHub Actions, nachts an Börsentagen) – für Screener, Aktien-Check und Werkzeuge.
// Quelle: Finnhub (Secret FINNHUB_API_KEY), nur US-Aktien aus den Aktien-Daten. Je Aktie: Bewertung (KGV, KUV, KBV),
// Wachstum, Margen, Eigenkapitalrendite, Verschuldung, Dividende, Börsenwert, Branche und die Insider-Käufe und -Verkäufe
// der letzten 90 Tage (SEC-Formular 4: Code P = Kauf am Markt, S = Verkauf am Markt). Branche, Webseite und Sitzland (cty –
// Firmen außerhalb der USA melden meist nicht nach Formular 4) werden zwischen den Läufen weitergetragen, damit nur neue
// Aktien nachgeschlagen werden. Dazu die letzten 4 Quartalszahlen (Ist gegen Erwartung) und die Konkurrenten laut Finnhub –
// beides wöchentlich erneuert (Quartalszahlen sofort, wenn neue gemeldet wurden). Der Schlüssel geht nur an finnhub.io.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const here = p => fileURLToPath(new URL(p, import.meta.url));
const KEY = process.env.FINNHUB_API_KEY || "";
const BASE = (process.env.FINNHUB_BASE || "https://finnhub.io/api/v1").replace(/\/$/, "");
const STOCKS = process.env.STOCKS_IN || here("../data/stocks.json");
const PREV = process.env.FUND_PREV || "";
const OUT = process.env.FUND_OUT || here("../data/fund.json");
const THROTTLE = Number(process.env.FINNHUB_THROTTLE_MS ?? 1100);   // kostenlos: 60 Abfragen pro Minute
const LIMIT = Number(process.env.FUND_LIMIT || 600);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(...a);
const r2 = x => (Number.isFinite(x) ? Math.round(x * 100) / 100 : null);
if (!["finnhub.io", "localhost", "127.0.0.1"].includes(new URL(BASE).hostname)) { console.log("::error::Unzulässige Finnhub-Adresse – der Schlüssel geht nur an finnhub.io."); process.exit(1); }

async function finnhub(path, params) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("token", KEY);
  for (let attempt = 0; attempt < 3; attempt++) {
    await sleep(THROTTLE);
    const res = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(20000) });
    if (res.status === 429) { await sleep(20000); continue; }   // Minutengrenze: kurz warten
    if (!res.ok) { const e = new Error(`Finnhub ${path}: HTTP ${res.status}`); e.status = res.status; throw e; }   // Adresse mit Schlüssel nie ausgeben
    return res.json();
  }
  throw new Error(`Finnhub ${path}: dauerhaft über der Minutengrenze`);
}

// Kennzahlen aus /stock/metric (Feldnamen wie bei Finnhub; fehlt eines, bleibt es leer)
export function pickMetric(m) {
  const g = (...keys) => { for (const k of keys) if (Number.isFinite(m && m[k])) return m[k]; return null; };
  return {
    pe: r2(g("peTTM", "peBasicExclExtraTTM", "peNormalizedAnnual")), ps: r2(g("psTTM", "psAnnual")), pb: r2(g("pbQuarterly", "pbAnnual")),
    revG: r2(g("revenueGrowthTTMYoy", "revenueGrowthQuarterlyYoy")), epsG: r2(g("epsGrowthTTMYoy", "epsGrowthQuarterlyYoy")),
    netM: r2(g("netProfitMarginTTM", "netProfitMarginAnnual")), grossM: r2(g("grossMarginTTM", "grossMarginAnnual")), roe: r2(g("roeTTM", "roeRfy")),
    de: r2(g("totalDebt/totalEquityQuarterly", "totalDebt/totalEquityAnnual")), div: r2(g("currentDividendYieldTTM", "dividendYieldIndicatedAnnual")),
    mcap: r2(g("marketCapitalization")),
  };
}
// Finanzkraft nach dem Piotroski-Prinzip (Piotroski 2000): die letzten zwei Geschäftsjahre aus den Jahreswerten (series.annual),
// die /stock/metric ohnehin mitliefert – kein zusätzlicher Abruf. Je Kennzahl [aktuelles Jahr, Vorjahr]; dazu Mittelzufluss und
// Gewinn je Aktie der letzten 12 Monate. Die Punkte rechnet die Seite (score.js), damit sich die Regel ohne neuen Lauf ändern lässt.
const r4 = x => (Number.isFinite(x) ? Math.round(x * 10000) / 10000 : null);
export function pickSeries(series, metric) {
  const A = (series && series.annual) || {};
  const years = k => (Array.isArray(A[k]) ? A[k] : []).filter(x => x && Number.isFinite(x.v) && /^\d{4}-\d{2}-\d{2}/.test(String(x.period || "")))
    .sort((a, b) => (a.period < b.period ? 1 : a.period > b.period ? -1 : 0));
  const pair = (...keys) => { for (const k of keys) { const l = years(k); if (l.length >= 2) return [r4(l[0].v), r4(l[1].v)]; } return null; };
  const g = (...keys) => { for (const k of keys) if (Number.isFinite(metric && metric[k])) return r4(metric[k]); return null; };
  const out = {
    roa: pair("roa"), cr: pair("currentRatio"), gm: pair("grossMargin"), lev: pair("longtermDebtTotalAsset", "totalDebtToTotalAsset"),
    at: pair("assetTurnover"), fcfm: pair("fcfMargin"), cfps: g("cashFlowPerShareTTM", "cashFlowPerShareAnnual"), eps: g("epsTTM", "epsAnnual", "epsBasicExclExtraItemsTTM"),
  };
  const latest = years("roa")[0] || years("currentRatio")[0] || years("grossMargin")[0];
  for (const k of Object.keys(out)) if (out[k] === null) delete out[k];
  if (Object.keys(out).filter(k => Array.isArray(out[k])).length < 3) return null;   // zu wenig für eine Aussage
  if (latest) out.y = String(latest.period).slice(0, 4);
  return out;
}
// Insider-Geschäfte der letzten 90 Tage zusammenfassen: nur echte Käufe und Verkäufe am Markt (Code P und S)
export function summarizeInsider(rows, today) {
  const from = new Date(Date.parse(`${today}T00:00:00Z`) - 90 * 864e5).toISOString().slice(0, 10);
  const list = (Array.isArray(rows) ? rows : []).filter(t => t && (t.transactionCode === "P" || t.transactionCode === "S") && String(t.transactionDate || t.filingDate || "") >= from);
  const buys = list.filter(t => t.transactionCode === "P"), sells = list.filter(t => t.transactionCode === "S");
  const value = l => l.reduce((s, t) => s + Math.abs(Number(t.change) || 0) * (Number(t.transactionPrice) || 0), 0);
  const names = l => new Set(l.map(t => String(t.name || "").trim()).filter(Boolean)).size;
  const last = l => l.map(t => String(t.transactionDate || t.filingDate || "")).sort().pop() || null;
  return { buyers: names(buys), sellers: names(sells), buys: buys.length, sells: sells.length, buyVal: Math.round(value(buys)), sellVal: Math.round(value(sells)), lastBuy: last(buys), lastSell: last(sells) };
}
// Letzte 4 Quartale: Gewinn je Aktie Ist (a) gegen Erwartung (e), Überraschung in % (sp), neueste zuerst
export function pickEarnings(rows) {
  return (Array.isArray(rows) ? rows : []).filter(r => r && /^\d{4}-\d{2}-\d{2}$/.test(String(r.period || "")) && Number.isFinite(r.actual) && Number.isFinite(r.estimate))
    .sort((a, b) => (a.period < b.period ? 1 : -1)).slice(0, 4)
    .map(r => ({ p: r.period, q: Number.isFinite(r.quarter) ? r.quarter : null, y: Number.isFinite(r.year) ? r.year : null, a: r2(r.actual), e: r2(r.estimate), sp: Math.abs(r.estimate) >= 0.01 ? r2((r.actual - r.estimate) / Math.abs(r.estimate) * 100) : null }));
}
// Finnhub-Kürzel einer europäischen eToro-Notierung (Amsterdam heißt bei eToro .NV, Zürich .ZU)
const FINN_SUFFIX = { DE: "DE", VI: "VI", PA: "PA", NV: "AS", AS: "AS", BR: "BR", MI: "MI", MC: "MC", ZU: "SW", SW: "SW", ST: "ST", CO: "CO", HE: "HE", OL: "OL", LS: "LS", IR: "IR", L: "L" };
export const finnhubSymbol = sym => { const m = /^([A-Z0-9-]+)\.([A-Z]+)$/.exec(String(sym || "")); return m && FINN_SUFFIX[m[2]] ? `${m[1]}.${FINN_SUFFIX[m[2]]}` : null; };
// Konkurrenten laut Finnhub (gleiches Land und gleiche Branche), ohne die Aktie selbst, höchstens 10
export const pickPeers = (rows, sym) => [...new Set((Array.isArray(rows) ? rows : []).map(s => String(s || "").toUpperCase()).filter(s => /^[A-Z0-9][A-Z0-9.\-]{0,11}$/.test(s) && s !== sym))].slice(0, 10);
const ageDays = iso => (iso ? (Date.now() - Date.parse(`${iso}T00:00:00Z`)) / 864e5 : Infinity);

async function main() {
  if (!KEY) { console.log("::warning::Kein FINNHUB_API_KEY – Kennzahlen übersprungen."); return; }
  const stocks = JSON.parse(await readFile(STOCKS, "utf8"));
  const syms = (stocks.items || []).filter(x => x.type === "Aktie" && typeof x.sym === "string" && !x.sym.includes(".")).map(x => x.sym).slice(0, LIMIT);
  if (syms.length < 20) throw new Error(`Zu wenige US-Aktien in den Aktien-Daten (${syms.length})`);
  let prev = null;
  if (PREV) { try { prev = JSON.parse(await readFile(PREV, "utf8")); } catch (e) { if (e.code !== "ENOENT") log(`::warning::Vorherige Kennzahlen unlesbar (${e.message}) – Branchen werden neu geholt.`); } }
  const today = new Date().toISOString().slice(0, 10), from = new Date(Date.now() - 95 * 864e5).toISOString().slice(0, 10);
  const avail = { metric: null, insider: null, profile: null, earnings: null, peers: null };   // null = noch unbekannt, false = Tarif erlaubt es nicht
  const lastEarn = new Map((stocks.items || []).map(x => [x.sym, x.lastEarn && x.lastEarn.date]));
  const items = {}, errors = [];
  const n = k => Object.values(items).filter(x => k(x)).length;
  for (const sym of syms) {
    const old = prev && prev.items && prev.items[sym];
    const it = {};
    if (avail.metric !== false) {
      try {
        const d = await finnhub("/stock/metric", { symbol: sym, metric: "all" });
        Object.assign(it, pickMetric(d && d.metric));
        const fsd = pickSeries(d && d.series, d && d.metric);
        if (fsd) it.fs = fsd;
        avail.metric = true;
      }
      catch (e) { if (e.status === 401 || e.status === 403) { avail.metric = false; log(`Kennzahlen: im Finnhub-Tarif nicht enthalten (HTTP ${e.status})`); } else errors.push(`${sym} Kennzahlen: ${e.message}`); }
    }
    if (avail.insider !== false) {
      try { const d = await finnhub("/stock/insider-transactions", { symbol: sym, from, to: today }); it.ins = summarizeInsider(d && d.data, today); avail.insider = true; }
      catch (e) { if (e.status === 401 || e.status === 403) { avail.insider = false; log(`Insider-Geschäfte: im Finnhub-Tarif nicht enthalten (HTTP ${e.status})`); } else errors.push(`${sym} Insider: ${e.message}`); }
    }
    if (old && old.ind && typeof old.cty === "string") { it.ind = old.ind; if (old.web) it.web = old.web; it.cty = old.cty; }
    else if (avail.profile !== false) {
      try {
        const d = await finnhub("/stock/profile2", { symbol: sym });
        if (d && d.finnhubIndustry) it.ind = String(d.finnhubIndustry).slice(0, 60);
        if (d && /^https:\/\/[^\s"<>]+$/.test(d.weburl || "")) it.web = d.weburl;
        if (d && it.ind) it.cty = /^[A-Za-z]{2}$/.test(d.country || "") ? d.country.toUpperCase() : "";
        avail.profile = true;
      } catch (e) { if (e.status === 401 || e.status === 403) avail.profile = false; else errors.push(`${sym} Profil: ${e.message}`); }
    }
    // Quartalszahlen: wöchentlich oder sobald neue gemeldet wurden; sonst aus dem letzten Lauf
    if (old && old.earnAt && ageDays(old.earnAt) < 7 && !(lastEarn.get(sym) && lastEarn.get(sym) > old.earnAt)) { if (old.earn) it.earn = old.earn; it.earnAt = old.earnAt; }
    else if (avail.earnings !== false) {
      try { const d = await finnhub("/stock/earnings", { symbol: sym }); const e = pickEarnings(d); if (e.length) it.earn = e; it.earnAt = today; avail.earnings = true; }
      catch (e) { if (e.status === 401 || e.status === 403) { avail.earnings = false; log(`Quartalszahlen-Historie: im Finnhub-Tarif nicht enthalten (HTTP ${e.status})`); } else errors.push(`${sym} Quartalszahlen: ${e.message}`); if (old && old.earn) { it.earn = old.earn; it.earnAt = old.earnAt; } }
    } else if (old && old.earn) { it.earn = old.earn; it.earnAt = old.earnAt; }
    // Konkurrenten: wöchentlich
    if (old && old.peersAt && ageDays(old.peersAt) < 7) { if (old.peers) it.peers = old.peers; it.peersAt = old.peersAt; }
    else if (avail.peers !== false) {
      try { const d = await finnhub("/stock/peers", { symbol: sym }); const p = pickPeers(d, sym); if (p.length) it.peers = p; it.peersAt = today; avail.peers = true; }
      catch (e) { if (e.status === 401 || e.status === 403) { avail.peers = false; log(`Konkurrenten: im Finnhub-Tarif nicht enthalten (HTTP ${e.status})`); } else errors.push(`${sym} Konkurrenten: ${e.message}`); if (old && old.peers) { it.peers = old.peers; it.peersAt = old.peersAt; } }
    } else if (old && old.peers) { it.peers = old.peers; it.peersAt = old.peersAt; }
    if (Object.keys(it).length) items[sym] = it;
  }
  const out = {
    updated: new Date().toISOString(), source: "Finnhub (Kennzahlen, Insider-Geschäfte nach SEC-Formular 4, Branche)",
    // Branchen aus dem letzten Lauf zählen als vorhanden, auch wenn heute kein Profil nachgeschlagen werden musste
    available: { metric: avail.metric === true, insider: avail.insider === true, profile: avail.profile === true || (avail.profile === null && n(x => x.ind) > 0),
      earnings: avail.earnings === true || (avail.earnings === null && n(x => x.earn) > 0), peers: avail.peers === true || (avail.peers === null && n(x => x.peers) > 0) },
    count: Object.keys(items).length, errors: errors.slice(0, 20), items,
  };
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(out));
  log(`Kennzahlen: ${n(x => Number.isFinite(x.pe) || Number.isFinite(x.mcap))} Aktien mit Bewertung, ${n(x => x.ins)} mit Insider-Daten (${n(x => x.ins && x.ins.buyers >= 2)} mit Käufen mehrerer Insider), ${n(x => x.ind)} mit Branche, ${n(x => x.fs)} mit Jahreswerten für die Finanzkraft; ${errors.length} Fehler`);
  log(`Quartalszahlen-Historie: ${n(x => x.earn)} Aktien, Konkurrenten: ${n(x => x.peers)} Aktien`);
  log(`Im Tarif: Kennzahlen ${out.available.metric ? "ja" : "nein"}, Insider ${out.available.insider ? "ja" : "nein"}, Profil ${out.available.profile ? "ja" : "nein"}, Quartalszahlen ${out.available.earnings ? "ja" : "nein"}, Konkurrenten ${out.available.peers ? "ja" : "nein"}`);
  // Europäische Aktien: liefert der Tarif auch dort Kennzahlen? Drei Proben, nur fürs Protokoll (Grundlage für eine Erweiterung)
  const euProbe = (stocks.items || []).filter(x => x.type === "Aktie" && finnhubSymbol(x.sym)).slice(0, 3);
  let euOk = 0;
  for (const x of euProbe) {
    try { const d = await finnhub("/stock/metric", { symbol: finnhubSymbol(x.sym), metric: "all" }); if (d && d.metric && Object.keys(d.metric).length >= 5) euOk++; } catch { /* nicht im Tarif */ }
  }
  if (euProbe.length) log(`Europäische Aktien: Finnhub liefert Kennzahlen für ${euOk} von ${euProbe.length} Proben${euOk ? "" : " – im Tarif nicht enthalten; die Gesamtnote rechnet dort mit Trend und Sicherheit"}.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(e => { console.log(`::error::Kennzahlen: ${e.message}`); process.exit(1); });
}

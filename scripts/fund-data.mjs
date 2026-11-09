// Kennzahlen und Insider-Geschäfte (GitHub Actions, nachts an Börsentagen) – für Screener, Aktien-Check und Werkzeuge.
// Quelle: Finnhub (Secret FINNHUB_API_KEY), nur US-Aktien aus den Aktien-Daten. Je Aktie: Bewertung (KGV, KUV, KBV),
// Wachstum, Margen, Eigenkapitalrendite, Verschuldung, Dividende, Börsenwert, Branche und die Insider-Käufe und -Verkäufe
// der letzten 90 Tage (SEC-Formular 4: Code P = Kauf am Markt, S = Verkauf am Markt). Branche, Webseite und Sitzland (cty –
// Firmen außerhalb der USA melden meist nicht nach Formular 4) werden zwischen den Läufen weitergetragen, damit nur neue
// Aktien nachgeschlagen werden. Der Schlüssel geht nur an finnhub.io.
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

async function main() {
  if (!KEY) { console.log("::warning::Kein FINNHUB_API_KEY – Kennzahlen übersprungen."); return; }
  const stocks = JSON.parse(await readFile(STOCKS, "utf8"));
  const syms = (stocks.items || []).filter(x => x.type === "Aktie" && typeof x.sym === "string" && !x.sym.includes(".")).map(x => x.sym).slice(0, LIMIT);
  if (syms.length < 20) throw new Error(`Zu wenige US-Aktien in den Aktien-Daten (${syms.length})`);
  let prev = null;
  if (PREV) { try { prev = JSON.parse(await readFile(PREV, "utf8")); } catch (e) { if (e.code !== "ENOENT") log(`::warning::Vorherige Kennzahlen unlesbar (${e.message}) – Branchen werden neu geholt.`); } }
  const today = new Date().toISOString().slice(0, 10), from = new Date(Date.now() - 95 * 864e5).toISOString().slice(0, 10);
  const avail = { metric: null, insider: null, profile: null };   // null = noch unbekannt, false = Tarif erlaubt es nicht
  const items = {}, errors = [];
  const n = k => Object.values(items).filter(x => k(x)).length;
  for (const sym of syms) {
    const old = prev && prev.items && prev.items[sym];
    const it = {};
    if (avail.metric !== false) {
      try { const d = await finnhub("/stock/metric", { symbol: sym, metric: "all" }); Object.assign(it, pickMetric(d && d.metric)); avail.metric = true; }
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
    if (Object.keys(it).length) items[sym] = it;
  }
  const out = {
    updated: new Date().toISOString(), source: "Finnhub (Kennzahlen, Insider-Geschäfte nach SEC-Formular 4, Branche)",
    // Branchen aus dem letzten Lauf zählen als vorhanden, auch wenn heute kein Profil nachgeschlagen werden musste
    available: { metric: avail.metric === true, insider: avail.insider === true, profile: avail.profile === true || (avail.profile === null && n(x => x.ind) > 0) },
    count: Object.keys(items).length, errors: errors.slice(0, 20), items,
  };
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(out));
  log(`Kennzahlen: ${n(x => Number.isFinite(x.pe) || Number.isFinite(x.mcap))} Aktien mit Bewertung, ${n(x => x.ins)} mit Insider-Daten (${n(x => x.ins && x.ins.buyers >= 2)} mit Käufen mehrerer Insider), ${n(x => x.ind)} mit Branche; ${errors.length} Fehler`);
  log(`Im Tarif: Kennzahlen ${out.available.metric ? "ja" : "nein"}, Insider ${out.available.insider ? "ja" : "nein"}, Profil ${out.available.profile ? "ja" : "nein"}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(e => { console.log(`::error::Kennzahlen: ${e.message}`); process.exit(1); });
}

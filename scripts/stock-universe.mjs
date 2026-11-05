// Aktien-Daten (GitHub Actions, an Börsentagen morgens und mittags):
// die beliebtesten Aktien und ETFs bei eToro mit Kennzahlen aus Tageskerzen – Grundlage für den Aktien-Check.
//  - Trend: Abstand zum 50- und 200-Tage-Durchschnitt; Momentum: Rendite von vor 12 bis vor 1 Monat
//    (Jegadeesh & Titman 1993); Nähe zum 52-Wochen-Hoch (George & Hwang 2004)
//  - Schwankung (20 und 60 Tage), ATR(14) für Stop-Abstände, größter Rückgang im Jahr, Beta zum S&P 500
// Optional mit Secret FINNHUB_API_KEY: nächster Quartalszahlen-Termin und Analysten-Empfehlungen (US-Aktien).
// Veröffentlicht werden nur abgeleitete Kennzahlen, keine Kursreihen.
import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { call, field, findArray, num, log, warn, fail, hasKeys, sleep } from "./etoro.mjs";

const here = p => fileURLToPath(new URL(p, import.meta.url));
const OUT = process.env.STOCKS_OUT || here("../data/stocks.json");
export const CONFIG = { stocks: Number(process.env.STOCK_COUNT || 400), etfs: Number(process.env.ETF_COUNT || 100), candles: 300 };
const FINNHUB_KEY = process.env.FINNHUB_API_KEY || "";
const FINNHUB = (process.env.FINNHUB_BASE || "https://finnhub.io/api/v1").replace(/\/$/, "");
if (!["finnhub.io", "localhost", "127.0.0.1"].includes(new URL(FINNHUB).hostname)) fail("Unzulässige Finnhub-Adresse – der Schlüssel geht nur an finnhub.io.");

const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
const sd = a => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const r2 = x => (Number.isFinite(x) ? Math.round(x * 100) / 100 : null);
const r4 = x => (Number.isFinite(x) ? Math.round(x * 10000) / 10000 : null);

// TradingView-Symbol aus dem eToro-Symbol ableiten (beste Schätzung; ohne Präfix sucht TradingView selbst)
const SUFFIX = { DE: "XETR", L: "LSE", PA: "EURONEXT", AS: "EURONEXT", BR: "EURONEXT", LSB: "EURONEXT", MI: "MIL", MC: "BME", ZU: "SIX", SW: "SIX", HK: "HKEX", OL: "OSL", ST: "OMXSTO", CO: "OMXCOP", HE: "OMXHEX", VI: "VIE", LS: "EURONEXT" };
export function tvSymbol(sym) {
  const m = /^([A-Z0-9-]+)\.([A-Z]+)$/.exec(sym || "");
  if (m && SUFFIX[m[2]]) return `${SUFFIX[m[2]]}:${m[1].replace(/-/g, "_")}`;
  return (sym || "").replace(/\./g, "_");
}

export function stockStats(candles, spxByDay) {
  const c = candles, n = c.length;
  if (n < 60) return null;
  const close = c.map(x => x.c), last = close[n - 1];
  const at = k => (n > k ? close[n - 1 - k] : null);
  const pct = (a, b) => (a && b ? (a / b - 1) * 100 : null);
  const sma = k => (n >= k ? mean(close.slice(-k)) : null);
  const tr = [];
  for (let i = Math.max(1, n - 14); i < n; i++) tr.push(Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i - 1].c), Math.abs(c[i].l - c[i - 1].c)));
  const atr = mean(tr);
  const lr = []; for (let i = 1; i < n; i++) lr.push(Math.log(close[i] / close[i - 1]));
  const vol = k => (lr.length >= k ? sd(lr.slice(-k)) * Math.sqrt(252) * 100 : null);
  const yr = c.slice(-252);
  const hi52 = Math.max(...yr.map(x => x.h)), lo52 = Math.min(...yr.map(x => x.l));
  let eq = 1, peak = 1, mdd = 0;
  for (let i = Math.max(1, n - 252); i < n; i++) { eq *= close[i] / close[i - 1]; peak = Math.max(peak, eq); mdd = Math.max(mdd, 1 - eq / peak); }
  let beta = null;
  if (spxByDay) {
    const xs = [], ys = [];
    for (let i = Math.max(1, n - 252); i < n; i++) {
      const s = spxByDay.get(c[i].d);
      if (s !== undefined) { xs.push(s); ys.push(Math.log(close[i] / close[i - 1])); }
    }
    if (xs.length >= 120) {
      const mx = mean(xs), my = mean(ys);
      let cov = 0, vx = 0;
      for (let k = 0; k < xs.length; k++) { cov += (xs[k] - mx) * (ys[k] - my); vx += (xs[k] - mx) ** 2; }
      beta = vx > 0 ? cov / vx : null;
    }
  }
  const s50 = sma(50), s200 = sma(200);
  return {
    last: r4(last), chg1d: r2(pct(last, at(1))), ret1m: r2(pct(last, at(21))), ret3m: r2(pct(last, at(63))), ret12m: r2(pct(last, at(252))),
    mom: r2(n > 252 ? pct(at(21), at(252)) : null), d50: r2(s50 ? (last / s50 - 1) * 100 : null), d200: r2(s200 ? (last / s200 - 1) * 100 : null),
    atr: r4(atr), atrPct: r2(atr / last * 100), vol20: r2(vol(20)), vol60: r2(vol(60)),
    hi52: r4(hi52), lo52: r4(lo52), dHi52: r2((last / hi52 - 1) * 100), mdd: r2(mdd * 100), beta: r2(beta), asOf: c[n - 1].d,
  };
}

async function instrumentTypes() {
  const d = await call("/v1/market-data/instrument-types");
  const list = findArray(field(d, "instrumentTypes") ? { items: field(d, "instrumentTypes") } : d);
  const ids = { stock: null, etf: null };
  for (const t of list) {
    const desc = String(field(t, "instrumentTypeDescription") || ""), id = num(field(t, "instrumentTypeID"));
    if (/^stocks?$/i.test(desc) || /stock/i.test(desc) && ids.stock === null) ids.stock = id;
    if (/etf/i.test(desc)) ids.etf = id;
  }
  return ids;
}
async function popular(typeId, count) {
  const out = [], seen = new Set();
  const fields = "instrumentId,internalSymbolFull,displayname,instrumentTypeID,exchangeID,internalExchangeName,buyHoldingPct,popularityUniques7Day,isDelisted,isActiveInPlatform,isHiddenFromClient";
  for (let page = 1; out.length < count && page <= Math.ceil(count / 100) + 3; page++) {
    const d = await call("/v1/market-data/search", { fields, instrumentTypeID: typeId, sort: "-popularityUniques7Day", pageSize: 100, pageNumber: page });
    const items = findArray(d);
    if (page === 1) log(`Suche Typ ${typeId}: ${items.length} Einträge, Felder: ${Object.keys(items[0] || {}).join(", ")}`);
    if (!items.length) break;
    for (const it of items) {
      const id = num(field(it, "instrumentId")), sym = field(it, "internalSymbolFull");
      if (!Number.isInteger(id) || seen.has(id) || typeof sym !== "string" || !/^[A-Za-z0-9.\-_]{1,20}$/.test(sym)) continue;
      if (num(field(it, "instrumentTypeID")) !== typeId) continue;
      if (field(it, "isDelisted") === true || field(it, "isHiddenFromClient") === true || field(it, "isActiveInPlatform") === false) continue;
      seen.add(id);
      out.push({ id, sym: sym.toUpperCase(), name: String(field(it, "displayname") || sym).slice(0, 60), crowd: num(field(it, "buyHoldingPct")) ?? null, pop: num(field(it, "popularityUniques7Day")) ?? null });
      if (out.length >= count) break;
    }
  }
  return out;
}
async function dailyCandles(id) {
  const d = await call(`/v1/market-data/instruments/${id}/history/candles/desc/OneDay/${CONFIG.candles}`);
  const groups = Array.isArray(field(d, "candles")) ? field(d, "candles") : [];
  const list = (groups.find(g => num(field(g, "instrumentId")) === id) || groups[0] || {}).candles || [];
  return list.map(x => ({ d: String(field(x, "fromDate") || "").slice(0, 10), o: num(field(x, "open")), h: num(field(x, "high")), l: num(field(x, "low")), c: num(field(x, "close")) }))
    .filter(x => /^\d{4}-\d{2}-\d{2}$/.test(x.d) && [x.h, x.l, x.c].every(v => Number.isFinite(v) && v > 0))
    .sort((a, b) => (a.d < b.d ? -1 : 1));
}
async function finnhub(path, params = {}) {
  const url = new URL(FINNHUB + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("token", FINNHUB_KEY);
  await sleep(Number(process.env.FINNHUB_THROTTLE_MS ?? 1100));
  const res = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`Finnhub ${path}: HTTP ${res.status}`);
  return res.json();
}
const rankPct = (list, key) => {
  const vals = list.map(x => x[key]).filter(Number.isFinite).sort((a, b) => a - b);
  for (const x of list) if (Number.isFinite(x[key])) {
    let lo = 0, hi = vals.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (vals[mid] < x[key]) lo = mid + 1; else hi = mid; }
    x[`${key}Rank`] = Math.round(lo / Math.max(1, vals.length - 1) * 100);
  }
};

async function main() {
  if (!hasKeys) { warn("Keine eToro-Schlüssel – Aktien-Daten übersprungen."); return; }
  const types = await instrumentTypes();
  log(`Instrument-Typen: Aktien ${types.stock}, ETFs ${types.etf}`);
  if (!Number.isInteger(types.stock)) throw new Error("Instrument-Typ „Aktien“ nicht gefunden.");
  const universe = [
    ...(await popular(types.stock, CONFIG.stocks)).map(x => ({ ...x, type: "Aktie" })),
    ...(Number.isInteger(types.etf) ? (await popular(types.etf, CONFIG.etfs)).map(x => ({ ...x, type: "ETF" })) : []),
  ];
  log(`${universe.length} Werte: ${universe.slice(0, 8).map(x => x.sym).join(", ")} …`);

  // S&P 500 als Markt für das Beta
  let spxByDay = null;
  try {
    const d = await call("/v2/market-data/instruments", { symbols: "SPX500" });
    const spx = findArray(d).find(x => String(field(x, "symbol") || "").toUpperCase() === "SPX500");
    if (spx) {
      const c = await dailyCandles(num(field(spx, "instrumentId")));
      spxByDay = new Map(); for (let i = 1; i < c.length; i++) spxByDay.set(c[i].d, Math.log(c[i].c / c[i - 1].c));
    }
  } catch (e) { warn(`S&P 500 für Beta: ${e.message}`); }

  const items = [], errors = [];
  for (const u of universe) {
    try {
      const s = stockStats(await dailyCandles(u.id), spxByDay);
      if (!s) { errors.push(`${u.sym}: zu wenige Kerzen`); continue; }
      items.push({ sym: u.sym, tv: tvSymbol(u.sym), name: u.name, type: u.type, crowd: r2(u.crowd), ...s });
    } catch (e) { errors.push(`${u.sym}: ${e.message}`); }
  }
  rankPct(items, "mom"); rankPct(items, "vol60");

  // Optional: Termine und Analysten (nur US-Aktien ohne Börsenkürzel)
  let finn = "aus";
  if (FINNHUB_KEY) {
    try {
      const from = new Date().toISOString().slice(0, 10), to = new Date(Date.now() + 100 * 864e5).toISOString().slice(0, 10);
      const cal = await finnhub("/calendar/earnings", { from, to });
      const next = new Map();
      for (const e of (cal && cal.earningsCalendar) || []) {
        const sym = String(e.symbol || "").toUpperCase();
        if (!next.has(sym) || e.date < next.get(sym).date) next.set(sym, { date: e.date, hour: e.hour || "", eps: Number.isFinite(e.epsEstimate) ? e.epsEstimate : null });
      }
      let recs = 0;
      for (const it of items) {
        if (next.has(it.sym)) it.earn = next.get(it.sym);
        if (it.type !== "Aktie" || it.sym.includes(".")) continue;
        try {
          const r = await finnhub("/stock/recommendation", { symbol: it.sym });
          const cur = Array.isArray(r) && r[0];
          if (cur) { it.rec = { period: cur.period, sb: cur.strongBuy | 0, b: cur.buy | 0, h: cur.hold | 0, s: cur.sell | 0, ss: cur.strongSell | 0 }; recs++; }
        } catch (e) { if (/HTTP 429/.test(e.message)) { await sleep(20000); } }
      }
      finn = `an: ${next.size} Termine, ${recs} Analysten-Übersichten`;
    } catch (e) { finn = `Fehler: ${e.message}`; warn(`Finnhub: ${e.message}`); }
  }

  const out = { updated: new Date().toISOString(), count: items.length, finnhub: finn, source: "eToro-Marktdaten (Tageskerzen); optional Finnhub", errors: errors.slice(0, 30), items };
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(out));
  log(`Aktien-Daten: ${items.length} Werte, ${errors.length} ohne Daten; Finnhub ${finn}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(e => fail(`Aktien-Daten: ${e.message}`));
}

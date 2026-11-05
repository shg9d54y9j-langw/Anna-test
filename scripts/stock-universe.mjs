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
export const CONFIG = { stocks: Number(process.env.STOCK_COUNT || 700), etfs: Number(process.env.ETF_COUNT || 150), candles: 300 };
const FINNHUB_KEY = process.env.FINNHUB_API_KEY || "";
const FINNHUB = (process.env.FINNHUB_BASE || "https://finnhub.io/api/v1").replace(/\/$/, "");
if (!["finnhub.io", "localhost", "127.0.0.1"].includes(new URL(FINNHUB).hostname)) fail("Unzulässige Finnhub-Adresse – der Schlüssel geht nur an finnhub.io.");

const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
const sd = a => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const r2 = x => (Number.isFinite(x) ? Math.round(x * 100) / 100 : null);
const r4 = x => (Number.isFinite(x) ? Math.round(x * 10000) / 10000 : null);

// TradingView-Symbol aus dem eToro-Symbol ableiten (beste Schätzung; ohne Präfix sucht TradingView selbst)
const SUFFIX = { DE: "XETR", L: "LSE", PA: "EURONEXT", AS: "EURONEXT", NV: "EURONEXT", BR: "EURONEXT", LSB: "EURONEXT", MI: "MIL", MC: "BME", ZU: "SIX", SW: "SIX", HK: "HKEX", OL: "OSL", ST: "OMXSTO", CO: "OMXCOP", HE: "OMXHEX", VI: "VIE", LS: "EURONEXT" };
export function tvSymbol(sym) {
  const m = /^([A-Z0-9-]+)\.([A-Z]+)$/.exec(sym || "");
  if (m && SUFFIX[m[2]]) return `${SUFFIX[m[2]]}:${m[1].replace(/-/g, "_")}`;
  return sym || "";   // US-Aktien unverändert, auch Aktiengattungen wie BRK.B
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
// Offizielle Typ-Zuordnung: Die Suche liefert das Typ-Feld nicht mit und ignoriert womöglich den Typ-Filter.
// Die Instrumentenliste nennt zu jedem Instrument den Typ – nur so ist sicher, dass „Aktie“ wirklich eine Aktie ist
// (und nicht Bitcoin, Gold oder ein Index). Nicht öffentliche Instrumente fallen heraus.
async function typeIndex(typeIds) {
  const d = await call("/v1/market-data/instruments", { instrumentTypeIds: typeIds.join(",") });
  const list = [field(d, "instrumentDisplayDatas"), findArray(d)].find(a => Array.isArray(a) && a.length) || [];
  const index = new Map();
  for (const x of list) {
    const id = num(field(x, "instrumentID", "instrumentId")), t = num(field(x, "instrumentTypeID", "instrumentTypeId"));
    if (Number.isInteger(id) && Number.isInteger(t) && field(x, "isInternalInstrument") !== true) index.set(id, t);
  }
  return index;
}
// Beliebtheit: Die Suche ignoriert Typ-Filter und Blättern (Seite 2 = Seite 1). popularityUniques7Day ist dort
// ein Rang (1 = beliebteste), absteigend sortiert kämen die unbeliebtesten zuerst. Deshalb: aufsteigend sortiert
// mit großer Seite holen, zur Sicherheit auch vom anderen Ende, und selbst sortieren. Ob der Wert ein Rang oder
// eine Anzahl ist, entscheiden bekannte Großwerte (die beliebtesten müssen vorne stehen).
const PAGE = Number(process.env.SEARCH_PAGE_SIZE || 5000), MAX_PAGES = 200;
const KNOWN = ["AAPL", "MSFT", "NVDA", "TSLA", "AMZN", "META", "GOOG", "GOOGL", "SPY", "QQQ"];
async function allInstruments() {
  const fields = "instrumentId,internalSymbolFull,displayname,buyHoldingPct,popularityUniques7Day,isDelisted,isActiveInPlatform,isHiddenFromClient";
  const all = new Map();
  let total = null, size = PAGE;
  for (const dir of ["", "-"]) {
    for (let page = 1; page <= MAX_PAGES; page++) {
      let d;
      try {
        d = await call("/v1/market-data/search", { fields, sort: `${dir}popularityUniques7Day`, pageSize: size, pageNumber: page, page });
      } catch (e) {
        // zu große Seite abgelehnt: kleiner versuchen
        if (page === 1 && size > 100 && /HTTP 4\d\d/.test(e.message)) { warn(`Suche mit ${size} je Seite abgelehnt – versuche ${Math.max(100, size / 10)}`); size = Math.max(100, size / 10); page--; continue; }
        throw e;
      }
      const items = findArray(d);
      if (page <= 2) {
        total = num(field(d, "totalItems")) ?? total;
        log(`Suche ${dir || "+"}Rang Seite ${page}: ${items.length} Einträge (Server: Seite ${field(d, "page") ?? "?"}, Größe ${field(d, "pageSize") ?? "?"}, gesamt ${total ?? "?"}); erste: ${items.slice(0, 3).map(x => `${field(x, "internalSymbolFull")} (${field(x, "popularityUniques7Day") ?? "–"})`).join(", ")}`);
      }
      if (!items.length) break;
      let fresh = 0;
      for (const it of items) {
        const id = num(field(it, "instrumentId"));
        if (Number.isInteger(id) && !all.has(id)) { all.set(id, it); fresh++; }
      }
      if (!fresh || (Number.isFinite(total) && all.size >= total)) break;
    }
    if (Number.isFinite(total) && all.size >= total) break;
  }
  log(`Suche: ${all.size} von ${total ?? "?"} Instrumenten gelesen`);
  return [...all.values()];
}
const popVal = it => { const v = num(field(it, "popularityUniques7Day")); return Number.isFinite(v) ? v : null; };
const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
export function popularityIsRank(list) {
  const vals = list.map(popVal).filter(v => v !== null);
  const known = list.filter(it => KNOWN.includes(String(field(it, "internalSymbolFull") || "").toUpperCase())).map(popVal).filter(v => v !== null);
  if (!known.length || !vals.length) return true;   // so beobachtet bei eToro
  return median(known) <= median(vals);
}
function popular(list, typeId, count, index, isRank) {
  const out = [];
  for (const it of list) {
    const id = num(field(it, "instrumentId")), sym = field(it, "internalSymbolFull");
    if (index.get(id) !== typeId || typeof sym !== "string" || !/^[A-Za-z0-9.\-_]{1,20}$/.test(sym)) continue;
    if (field(it, "isDelisted") === true || field(it, "isHiddenFromClient") === true || field(it, "isActiveInPlatform") === false) continue;
    out.push({ id, sym: sym.toUpperCase(), name: String(field(it, "displayname") || sym).slice(0, 60), crowd: num(field(it, "buyHoldingPct")) ?? null, pop: popVal(it) });
  }
  // beliebteste zuerst, ohne Wert ans Ende, bei Gleichstand kleinere ID
  out.sort((a, b) => (a.pop === null) - (b.pop === null) || (isRank ? a.pop - b.pop : b.pop - a.pop) || a.id - b.id);
  log(`Typ ${typeId}: ${out.length} gültige, davon ${Math.min(count, out.length)} übernommen; beliebteste: ${out.slice(0, 6).map(x => x.sym).join(", ")}`);
  return out.slice(0, count);
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
  const index = await typeIndex([types.stock, types.etf].filter(Number.isInteger));
  const inIndex = t => [...index.values()].filter(x => x === t).length;
  log(`Offizielle Instrumentenliste: ${inIndex(types.stock)} Aktien, ${inIndex(types.etf)} ETFs`);
  if (!inIndex(types.stock)) throw new Error("Instrumentenliste ohne Aktien – Typ-Zuordnung nicht möglich.");
  const list = await allInstruments();
  const isRank = popularityIsRank(list);
  log(`Beliebtheit ist ${isRank ? "ein Rang (1 = beliebteste)" : "eine Anzahl (mehr = beliebter)"}`);
  const universe = [
    ...popular(list, types.stock, CONFIG.stocks, index, isRank).map(x => ({ ...x, type: "Aktie" })),
    ...(Number.isInteger(types.etf) ? popular(list, types.etf, CONFIG.etfs, index, isRank).map(x => ({ ...x, type: "ETF" })) : []),
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
      // Zuletzt gemeldete Quartalszahlen (60 Tage zurück): Ist gegen Schätzung → Überraschung in %
      const last = new Map();
      try {
        const pastFrom = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10), pastTo = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
        const past = await finnhub("/calendar/earnings", { from: pastFrom, to: pastTo });
        for (const e of (past && past.earningsCalendar) || []) {
          const sym = String(e.symbol || "").toUpperCase();
          if (!Number.isFinite(e.epsActual) || !Number.isFinite(e.epsEstimate) || !e.date) continue;
          if (!last.has(sym) || e.date > last.get(sym).date) last.set(sym, { date: e.date, actual: e.epsActual, estimate: e.epsEstimate, surprisePct: Math.abs(e.epsEstimate) >= 0.01 ? r2((e.epsActual - e.epsEstimate) / Math.abs(e.epsEstimate) * 100) : null });
        }
      } catch (e) { warn(`Finnhub vergangene Quartalszahlen: ${e.message}`); }
      const toRec = x => ({ period: x.period, sb: x.strongBuy | 0, b: x.buy | 0, h: x.hold | 0, s: x.sell | 0, ss: x.strongSell | 0 });
      let recs = 0;
      for (const it of items) {
        if (next.has(it.sym)) it.earn = next.get(it.sym);
        if (last.has(it.sym)) it.lastEarn = last.get(it.sym);
        if (it.type !== "Aktie" || it.sym.includes(".")) continue;
        try {
          const r = await finnhub("/stock/recommendation", { symbol: it.sym });
          const list = Array.isArray(r) ? [...r].sort((a, b) => String(b.period).localeCompare(String(a.period))) : [];
          if (list[0]) { it.rec = toRec(list[0]); recs++; }
          if (list[1]) it.recPrev = toRec(list[1]);   // Vormonat: Hoch- und Herabstufungen
        } catch (e) { if (/HTTP 429/.test(e.message)) { await sleep(20000); } }
      }
      finn = `an: ${next.size} Termine, ${last.size} gemeldete Quartalszahlen, ${recs} Analysten-Übersichten`;
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

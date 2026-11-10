// Aktien-Daten (GitHub Actions, an Börsentagen morgens und mittags):
// die beliebtesten Aktien und ETFs bei eToro mit Kennzahlen aus Tageskerzen – Grundlage für den Aktien-Check.
//  - Trend: Abstand zum 50- und 200-Tage-Durchschnitt; Momentum: Rendite von vor 12 bis vor 1 Monat
//    (Jegadeesh & Titman 1993); Nähe zum 52-Wochen-Hoch (George & Hwang 2004)
//  - Schwankung (20 und 60 Tage), ATR(14) für Stop-Abstände, größter Rückgang im Jahr, Beta zum S&P 500
// Optional mit Secret FINNHUB_API_KEY: nächster Quartalszahlen-Termin und Analysten-Empfehlungen (US-Aktien).
// Veröffentlicht werden nur abgeleitete Kennzahlen, keine Kursreihen.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { call, field, findArray, num, log, warn, fail, hasKeys, sleep } from "./etoro.mjs";

const here = p => fileURLToPath(new URL(p, import.meta.url));
const OUT = process.env.STOCKS_OUT || here("../data/stocks.json");
const CLOSES_OUT = process.env.CLOSES_OUT || "";   // Schlusskurse für die Note-Bilanz – nur lokal, nie hochgeladen
export const CONFIG = { stocks: Number(process.env.STOCK_COUNT || 700), etfs: Number(process.env.ETF_COUNT || 150), candles: 300 };
// Firmen der Theorie-Seite (Steckbriefe in data/firms.json): immer in den Aktien-Daten, auch wenn sie nicht unter den beliebtesten sind
const FIRMS = process.env.FIRMS_IN || here("../data/firms.json");
export function firmSymbols(d) {
  if (!d || typeof d !== "object") return [];
  const moon = Object.values(d.moon || {});
  return [...new Set([...Object.keys(d.firms || {}), ...Object.values(d.sectors || {}).flat(), ...moon.flatMap(m => [...(m.firms || []), ...(m.saferSyms || [])])]
    .map(s => String(s).toUpperCase()))];
}
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
  const s20 = sma(20), s50 = sma(50), s200 = sma(200);
  // Für den Swing-Planer: Spanne der letzten Kerze und der letzten 5 Kerzen (Stops und Trailing-Stops der Papier-Bilanz)
  const lastC = c[n - 1], last5 = c.slice(-5);
  return {
    last: r4(last), chg1d: r2(pct(last, at(1))), ret1m: r2(pct(last, at(21))), ret3m: r2(pct(last, at(63))), ret12m: r2(pct(last, at(252))),
    mom: r2(n > 252 ? pct(at(21), at(252)) : null), d20: r2(s20 ? (last / s20 - 1) * 100 : null), d50: r2(s50 ? (last / s50 - 1) * 100 : null), d200: r2(s200 ? (last / s200 - 1) * 100 : null),
    atr: r4(atr), atrPct: r2(atr / last * 100), vol20: r2(vol(20)), vol60: r2(vol(60)),
    hi52: r4(hi52), lo52: r4(lo52), dHi52: r2((last / hi52 - 1) * 100), mdd: r2(mdd * 100), beta: r2(beta),
    o1d: r4(lastC.o), hi1d: r4(lastC.h), lo1d: r4(lastC.l), hi5: r4(Math.max(...last5.map(x => x.h))), lo5: r4(Math.min(...last5.map(x => x.l))), asOf: lastC.d,
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
function popular(list, typeId, count, index, isRank, always = []) {
  const out = [];
  let closed = 0;
  for (const it of list) {
    const id = num(field(it, "instrumentId")), sym = field(it, "internalSymbolFull");
    if (index.get(id) !== typeId || typeof sym !== "string" || !/^[A-Za-z0-9.\-_]{1,20}$/.test(sym)) continue;
    if (field(it, "isDelisted") === true || field(it, "isHiddenFromClient") === true) continue;
    // „nicht aktiv“ heißt bei eToro oft nur: Börse gerade geschlossen (morgens fast alle europäischen und viele US-Aktien).
    // Ausgeschlossen wird so ein Wert nur ohne Beliebtheits-Rang – dann ist er wirklich nicht mehr handelbar.
    if (field(it, "isActiveInPlatform") === false) { if (popVal(it) === null) continue; closed++; }
    out.push({ id, sym: sym.toUpperCase(), name: String(field(it, "displayname") || sym).slice(0, 60), crowd: num(field(it, "buyHoldingPct")) ?? null, pop: popVal(it) });
  }
  // beliebteste zuerst, ohne Wert ans Ende, bei Gleichstand kleinere ID
  out.sort((a, b) => (a.pop === null) - (b.pop === null) || (isRank ? a.pop - b.pop : b.pop - a.pop) || a.id - b.id);
  log(`Typ ${typeId}: ${out.length} gültige (${closed} davon gerade ohne Handel), davon ${Math.min(count, out.length)} übernommen; beliebteste: ${out.slice(0, 6).map(x => x.sym).join(", ")}`);
  const top = out.slice(0, count), extra = out.slice(count).filter(x => always.includes(x.sym));
  if (always.length) {
    const missing = always.filter(s => !out.some(x => x.sym === s));
    log(`Firmen der Theorie-Seite: ${always.length - missing.length} von ${always.length} gefunden${extra.length ? `, zusätzlich aufgenommen: ${extra.map(x => x.sym).join(", ")}` : ""}${missing.length ? `; nicht als Aktie bei eToro: ${missing.join(", ")}` : ""}`);
  }
  return [...top, ...extra];
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
// Finnhubs Kalender liefert je Abfrage nur rund 1.500 Einträge – die spätesten zuerst. Über 100 Tage fielen so alle Termine
// der nächsten Wochen weg. Deshalb in Wochenfenstern fragen und ein volles Fenster weiter teilen (bis auf einen Tag).
const CAL_CAP = Number(process.env.FINNHUB_CAL_CAP || 1400);
export async function earningsWindows(from, to, ask = (a, b) => finnhub("/calendar/earnings", { from: a, to: b })) {
  const out = [], plus = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
  const span = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5) + 1;
  const get = async (a, b) => {
    const d = await ask(a, b), list = ((d && d.earningsCalendar) || []).filter(e => e && e.date >= a && e.date <= b);
    if (list.length >= CAL_CAP && span(a, b) > 1) { const mid = plus(a, Math.floor(span(a, b) / 2) - 1); await get(a, mid); await get(plus(mid, 1), b); return; }
    if (list.length >= CAL_CAP) warn(`Finnhub-Kalender ${a}: ${list.length} Einträge an einem Tag – womöglich unvollständig`);
    out.push(...list);
  };
  for (let a = from; a <= to; a = plus(a, 7)) { const b = plus(a, 6) < to ? plus(a, 6) : to; await get(a, b); }
  return out;
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
  let always = [];
  try { always = firmSymbols(JSON.parse(await readFile(FIRMS, "utf8"))); } catch (e) { warn(`Firmen der Theorie-Seite nicht lesbar (${e.message}) – nur die beliebtesten Werte.`); }
  const universe = [
    ...popular(list, types.stock, CONFIG.stocks, index, isRank, always).map(x => ({ ...x, type: "Aktie" })),
    ...(Number.isInteger(types.etf) ? popular(list, types.etf, CONFIG.etfs, index, isRank).map(x => ({ ...x, type: "ETF" })) : []),
  ];
  // Die Suche liest nie ganz alle Instrumente (rund 550 von 13.000 fehlen). Firmen der Theorie-Seite, die dort nicht
  // auftauchen, über ihr Kürzel nachschlagen – aufgenommen wird nur, was die offizielle Liste als Aktie führt.
  // nur, was die Suche gar nicht geliefert hat – was sie liefert und aussortiert (eingestellt, versteckt), bleibt draußen
  const seen = new Set(list.map(it => String(field(it, "internalSymbolFull") || "").toUpperCase()));
  const lost = always.filter(s => !seen.has(s) && !universe.some(u => u.sym === s));
  if (lost.length) {
    const found = [];
    for (const s of lost) {
      try {
        const d = await call("/v2/market-data/instruments", { symbols: s });
        const hit = findArray(d).find(x => String(field(x, "symbol", "internalSymbolFull") || "").toUpperCase() === s);
        const id = hit ? num(field(hit, "instrumentId", "instrumentID")) : null;
        if (Number.isInteger(id) && index.get(id) === types.stock && !universe.some(u => u.id === id)) {
          universe.push({ id, sym: s, name: String(field(hit, "displayName", "displayname") || s).slice(0, 60), crowd: null, pop: null, type: "Aktie" });
          found.push(s);
        }
      } catch (e) { warn(`${s} nachschlagen: ${e.message}`); }
    }
    log(`Firmen der Theorie-Seite über das Kürzel nachgeschlagen: ${found.length ? found.join(", ") : "keine"} gefunden${lost.length > found.length ? `; nicht bei eToro: ${lost.filter(s => !found.includes(s)).join(", ")}` : ""}`);
  }
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

  const items = [], errors = [], closes = {};
  for (const u of universe) {
    try {
      const candles = await dailyCandles(u.id);
      const s = stockStats(candles, spxByDay);
      if (!s) { errors.push(`${u.sym}: zu wenige Kerzen`); continue; }
      items.push({ sym: u.sym, tv: tvSymbol(u.sym), name: u.name, type: u.type, crowd: r2(u.crowd), ...s });
      if (CLOSES_OUT && u.type === "Aktie") closes[u.sym] = candles.map(x => [x.d, x.c]);
    } catch (e) { errors.push(`${u.sym}: ${e.message}`); }
  }
  rankPct(items, "mom"); rankPct(items, "vol60");

  // Optional: Termine und Analysten (nur US-Aktien ohne Börsenkürzel)
  let finn = "aus";
  if (FINNHUB_KEY) {
    try {
      const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
      const cal = await earningsWindows(day(0), day(100));
      const next = new Map();
      for (const e of cal) {
        const sym = String(e.symbol || "").toUpperCase();
        if (!next.has(sym) || e.date < next.get(sym).date) next.set(sym, { date: e.date, hour: e.hour || "", eps: Number.isFinite(e.epsEstimate) ? e.epsEstimate : null });
      }
      // Zuletzt gemeldete Quartalszahlen (60 Tage zurück): Ist gegen Schätzung → Überraschung in %
      const last = new Map();
      try {
        const past = await earningsWindows(day(-60), day(-1));
        for (const e of past) {
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
  // Schlusskurse für die Note-Bilanz (scripts/note-track.mjs): nur auf dem Rechner des Laufs, wird nicht veröffentlicht
  if (CLOSES_OUT) { await mkdir(dirname(CLOSES_OUT), { recursive: true }); await writeFile(CLOSES_OUT, JSON.stringify({ asOf: out.updated, items: closes })); }
  log(`Aktien-Daten: ${items.length} Werte, ${errors.length} ohne Daten; Finnhub ${finn}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(e => fail(`Aktien-Daten: ${e.message}`));
}

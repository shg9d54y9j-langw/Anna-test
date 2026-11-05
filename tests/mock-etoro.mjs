// Nachgebauter eToro-API-Server NUR für die automatischen Tests (erfundene Daten, gleiche Struktur wie die echte API).
// Aufruf: node tests/mock-etoro.mjs [port] [deny]
import http from "node:http";

const PORT = Number(process.argv[2] || 8790);
const DENY = process.argv[3] === "deny";              // simuliert fehlende Berechtigung „Benutzerinfo“
let seed = 42;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const gauss = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

const now = new Date();
const curKey = now.getUTCFullYear() * 12 + now.getUTCMonth();
const market = Array.from({ length: 72 }, () => gauss() * 3);       // gemeinsamer Marktfaktor
const traders = Array.from({ length: 180 }, (_, i) => {
  const skilled = i % 30 === 7;                                     // 6 Trader mit echtem Können
  const len = i % 11 === 3 ? 14 : 72;                               // manche mit zu kurzer Historie
  const months = [];
  for (let m = 0; m < len; m++) {
    const k = curKey - len + m + 1;                                 // enthält auch den laufenden Monat
    const g = skilled ? 1.8 + 0.3 * market[m] + gauss() * 1.4 : 0.4 + 0.6 * market[m] + gauss() * 3.5;
    months.push({ timestamp: `${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, "0")}-01T00:00:00Z`, gain: Math.round(g * 100) / 100 });
  }
  // Wie die echte API: „gain“ (LastTwoYears = 24 abgeschlossene Monate + laufender Monat), „dailyGain“ und
  // „thisWeekGain“ als Anteil (0,125 = 12,5 %), „peakToValley“ dagegen in Prozent
  const twoYears = months.slice(-25).reduce((e, m) => e * (1 + m.gain / 100), 1);
  let eq = 1, peak = 1, dd = 0;
  for (const m of months.slice(-25)) { eq *= 1 + m.gain / 100; peak = Math.max(peak, eq); dd = Math.max(dd, 1 - eq / peak); }
  return {
    username: `trader${String(i).padStart(3, "0")}`, cid: 5000 + i, riskScore: 1 + Math.floor(rnd() * 7), copiers: Math.floor(rnd() * 20000),
    gain: Math.round((twoYears - 1) * 1e4) / 1e4, dailyGain: Math.round(gauss() * 120) / 1e4, thisWeekGain: Math.round(gauss() * 250) / 1e4,
    peakToValley: -Math.round(dd * 100 * (1.05 + rnd() * 0.3) * 10) / 10, profitableMonthsPct: Math.round(40 + rnd() * 40), months,
  };
});

// ---------- Copy-Trading wie die echte API (Demo- und Echtgeld-Konto getrennt) ----------
// Kopie starten ist asynchron: Antwort { token }, Ergebnis über GET …/copy/{referenceID}.
// Beenden ist asynchron: die Kopie steht beim nächsten Abruf als „wird geschlossen“ da und ist danach weg.
const accounts = { demo: { credit: 100000, mirrors: [], ops: [], statuses: {}, positions: [], pendingOpen: [], orders: {}, tradeOps: [] }, real: { credit: 20000, mirrors: [], ops: [], statuses: {}, positions: [], pendingOpen: [], orders: {}, tradeOps: [] } };
const realTradeOps = [];   // Aufrufe an Echtgeld-Handelsadressen (müssen in den Tests leer bleiben)
let nextPosition = 70000, nextOrder = 50000;
const trendFlags = { failNextOpen: false, pendingNextOpen: false, slowConfirm: false, foreignOrderIds: false };
function openPosition(acc, instrumentID, amount, orderID, mirrorID = 0) {
  // Wie im echten Betrieb beobachtet: Bestätigung kann auf sich warten lassen, die Position eine andere Auftragsnummer tragen
  const price = trendPrice(instrumentID), pos = { positionID: nextPosition++, instrumentID, orderID: trendFlags.foreignOrderIds ? orderID + 900000000 : orderID, mirrorID, amount, units: amount / price, openRate: price, isBuy: true, leverage: 1, openDateTime: new Date().toISOString() };
  acc.credit -= amount; acc.positions.push(pos);
  acc.orders[orderID] = { orderId: orderID, executed: !trendFlags.slowConfirm, positionId: pos.positionID };
  return pos;
}
let nextMirror = 900;
const testFlags = { failNextRegister: false, mirrorStopLossPct: 40 };
const byCid = cid => traders.find(t => t.cid === cid);
function register(acc, body) {
  const t = byCid(body.parentCID);
  const existing = acc.mirrors.find(m => m.parentCID === body.parentCID && !m.closing);
  if (!t) { acc.statuses[body.referenceID] = { referenceID: body.referenceID, isSuccess: false, failReason: "Investor not found", errorMessageCode: 404 }; return; }
  if (body.amount > acc.credit) { acc.statuses[body.referenceID] = { referenceID: body.referenceID, isSuccess: false, failReason: "Insufficient funds", errorMessageCode: 1 }; return; }
  acc.credit -= body.amount;
  let m = existing;
  if (m) m.depositSummary += body.amount;                     // bestehende Kopie: Geld kommt dazu (wie bei eToro)
  else {
    m = { mirrorID: nextMirror++, CID: 1, parentCID: t.cid, parentUsername: t.username, initialInvestment: body.amount, depositSummary: 0, withdrawalSummary: 0,
      pnlPct: 0, closing: 0, mirrorStatusID: 3, isPaused: false, copyExistingPositions: true, startedCopyDate: new Date().toISOString(), stopLossPercentage: testFlags.mirrorStopLossPct };
    acc.mirrors.push(m);
  }
  acc.statuses[body.referenceID] = { referenceID: body.referenceID, isSuccess: true, mirrorID: m.mirrorID, parentCID: t.cid, parentUsername: t.username };
}
function portfolio(acc) {
  // Geschlossene Kopien verschwinden beim zweiten Abruf, das Geld geht zurück aufs Konto
  for (const m of acc.mirrors.filter(x => x.closing >= 2)) acc.credit += mirrorValue(m);
  acc.mirrors = acc.mirrors.filter(x => x.closing < 2);
  for (const m of acc.mirrors) { if (m.closing) m.closing++; else if (m.mirrorStatusID === 3) m.mirrorStatusID = 0; }
  return {
    clientPortfolio: {
      accountCurrencyId: 1, credit: acc.credit, bonusCredit: 0, orders: [],
      positions: acc.positions.map(x => ({ ...x, amount: Math.round(x.amount * 100) / 100, unrealizedPnL: { pnL: Math.round(x.units * (trendPrice(x.instrumentID) - x.openRate) * 100) / 100, closeRate: trendPrice(x.instrumentID) } })),
      ordersForOpen: acc.pendingOpen.map(o => ({ orderID: o.orderID, instrumentId: o.instrumentID, amount: o.amount, isBuy: true })),
      unrealizedPnL: acc.mirrors.reduce((x, m) => x + mirrorInvested(m) * m.pnlPct / 100, 0),
      mirrors: acc.mirrors.map(m => {
        const inv = mirrorInvested(m), value = mirrorValue(m);
        return {
          mirrorID: m.mirrorID, CID: 1, parentCID: m.parentCID, parentUsername: m.parentUsername,
          initialInvestment: m.initialInvestment, depositSummary: m.depositSummary, withdrawalSummary: m.withdrawalSummary,
          availableAmount: Math.round(inv * 0.1 * 100) / 100, closedPositionsNetProfit: 0, isPaused: m.isPaused,
          mirrorStatusID: m.closing ? 2 : m.mirrorStatusID, pendingForClosure: Boolean(m.closing), copyExistingPositions: true,
          startedCopyDate: m.startedCopyDate, stopLossPercentage: m.stopLossPercentage, stopLossAmount: Math.round(value * (1 - m.stopLossPercentage / 100) * 100) / 100,
          positions: [{ positionID: m.mirrorID * 10, mirrorID: m.mirrorID, instrumentID: 1001, isBuy: true, leverage: 1,
            amount: Math.round(inv * 0.9 * 100) / 100, unrealizedPnL: { pnL: Math.round(inv * m.pnlPct) / 100 } }],
        };
      }),
    },
  };
}
// ---------- Marktdaten (Tageskerzen) und FRED-Reihen für das Marktlage-Cockpit ----------
const INSTRUMENTS = { SPX500: 27, NSDQ100: 28, GER40: 32, GOLD: 18, OIL: 17, BTC: 100000 };
function series(id, n) {   // erfundene, reproduzierbare Tagesschlusskurse, älteste zuerst
  let x = 1000 + id % 997, s = id * 7919 % 4294967296;
  const r = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
  const drift = id === 17 ? -0.0006 : 0.0004, vol = id === 100000 ? 0.035 : 0.011;
  const out = [];
  const day0 = Date.UTC(2025, 0, 2);
  for (let i = 0, d = 0; out.length < n; d++) {
    const t = new Date(day0 + d * 864e5);
    if (id !== 100000 && (t.getUTCDay() === 0 || t.getUTCDay() === 6)) continue;   // Krypto auch am Wochenende
    x *= Math.exp(drift + vol * (r() + r() + r() - 1.5) * 2);
    out.push({ fromDate: t.toISOString(), open: x, high: x * 1.005, low: x * 0.995, close: Math.round(x * 100) / 100, volume: 1000 + i++ });
  }
  return out;
}
// ---------- ETFs für den Trend-Bot (erfundene Kurse, werktags bis heute) ----------
// EFA meldet absichtlich den falschen Typ – der Bot muss auf VEA ausweichen.
// Wie bei eToro: DBC gibt es, aber ohne Kurshistorie (der Bot muss auf PDBC ausweichen); VNQ hat eine kürzere Historie.
const TREND_ETFS = { SPY: 3201, VEA: 3202, IEF: 3203, GLD: 3204, DBC: 3205, VNQ: 3206, PDBC: 3207 };
const TREND_PARAMS = { 3201: [0.0005, 0.011], 3202: [0.0003, 0.012], 3203: [0.0001, 0.005], 3204: [0.0004, 0.010], 3205: [-0.0004, 0.013], 3206: [0.0002, 0.014], 3207: [-0.0004, 0.013] };
const NO_CANDLES = new Set([3205]), SHORT_HISTORY = { 3206: 1500 };
const trendSeries = {};
function makeTrend(id, recentDrift = null) {
  const [drift, vol] = TREND_PARAMS[id];
  let s = id * 2654435761 % 4294967296, x = 50 + id % 50;
  const r = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
  const days = [];
  const end = new Date(); end.setUTCHours(0, 0, 0, 0);
  for (let d = new Date(end); days.length < 3000; d = new Date(d - 864e5)) if (d.getUTCDay() % 6 !== 0) days.push(d.toISOString().slice(0, 10));
  days.reverse();
  trendSeries[id] = days.map((d, i) => {
    const mu = recentDrift !== null && i >= days.length - 80 ? recentDrift : drift;
    x *= Math.exp(mu + vol * (r() + r() + r() - 1.5) * 2);
    return { d, c: Math.round(x * 10000) / 10000 };
  }).slice(-(SHORT_HISTORY[id] || 3000));
}
for (const id of Object.values(TREND_ETFS)) makeTrend(id);
const trendPrice = id => trendSeries[id][trendSeries[id].length - 1].c;
function trendCandles(id, interval, n) {
  const daily = trendSeries[id];
  let list = daily;
  if (interval === "OneWeek") {   // Wochenkerzen mit dem Montag der Woche als Datum
    const weeks = new Map();
    for (const x of daily) { const t = new Date(`${x.d}T00:00:00Z`), mon = new Date(t - ((t.getUTCDay() + 6) % 7) * 864e5).toISOString().slice(0, 10); weeks.set(mon, x.c); }
    list = [...weeks.entries()].map(([d, c]) => ({ d, c }));
  }
  return list.slice(-n).map(x => ({ fromDate: `${x.d}T00:00:00Z`, open: x.c, high: x.c * 1.004, low: x.c * 0.996, close: x.c, volume: 1000 }));
}

// Beliebte Instrumente für den Aktien-Check (erfunden): Typ 5 = Aktien, 6 = ETFs. Ganz oben stehen – wie bei eToro –
// Bitcoin, Gold, ein Index und eine Währung; sie dürfen nie als Aktie erscheinen. STK007 ist nicht öffentlich.
const UNIVERSE = [
  { instrumentId: 100000, internalSymbolFull: "BTC", displayname: "Bitcoin", instrumentTypeID: 10, exchangeID: 8, buyHoldingPct: 95, popularityUniques7Day: 200000, isDelisted: false, isActiveInPlatform: true },
  { instrumentId: 18, internalSymbolFull: "GOLD", displayname: "Gold", instrumentTypeID: 2, exchangeID: 2, buyHoldingPct: 80, popularityUniques7Day: 150000, isDelisted: false, isActiveInPlatform: true },
  { instrumentId: 27, internalSymbolFull: "SPX500", displayname: "US500", instrumentTypeID: 4, exchangeID: 3, buyHoldingPct: 85, popularityUniques7Day: 140000, isDelisted: false, isActiveInPlatform: true },
  { instrumentId: 1, internalSymbolFull: "EURUSD", displayname: "EUR/USD", instrumentTypeID: 1, exchangeID: 1, buyHoldingPct: 50, popularityUniques7Day: 130000, isDelisted: false, isActiveInPlatform: true },
  ...Array.from({ length: 70 }, (_, i) => ({ instrumentId: 2000 + i, internalSymbolFull: ["AAPL", "MSFT", "NVDA"][i] || (i % 10 === 3 ? `DE${i}.DE` : `STK${String(i).padStart(3, "0")}`), displayname: `Testaktie ${i}`, instrumentTypeID: 5, exchangeID: i % 10 === 3 ? 6 : 4, buyHoldingPct: 60 + (i % 35), popularityUniques7Day: 100000 - i * 100, isDelisted: i === 5, isInternal: i === 7, isActiveInPlatform: true, isHiddenFromClient: false })),
  { instrumentId: 2999, internalSymbolFull: "BAD SYMBOL!", displayname: "Ungültig", instrumentTypeID: 5, exchangeID: 4, popularityUniques7Day: 99999, isDelisted: false, isActiveInPlatform: true },
  ...Array.from({ length: 15 }, (_, i) => ({ instrumentId: 3000 + i, internalSymbolFull: `ETF${String(i).padStart(2, "0")}`, displayname: `Test-ETF ${i}`, instrumentTypeID: 6, exchangeID: 5, buyHoldingPct: 90, popularityUniques7Day: 50000 - i * 100, isDelisted: false, isActiveInPlatform: true, isHiddenFromClient: false })),
  { instrumentId: 2500, internalSymbolFull: "NOPOP", displayname: "Aktie ohne Beliebtheit", instrumentTypeID: 5, exchangeID: 4, isDelisted: false, isActiveInPlatform: true, isHiddenFromClient: false },
];
// Wie bei eToro ist die Beliebtheit ein Rang (1 = beliebteste): aus den erfundenen Zahlen oben einen Rang machen
UNIVERSE.filter(u => u.popularityUniques7Day !== undefined).sort((a, b) => b.popularityUniques7Day - a.popularityUniques7Day).forEach((u, i) => { u.popularityUniques7Day = i + 1; });
// alte, nicht mehr handelbare Einträge ohne Rang
const DEAD = Array.from({ length: 30 }, (_, i) => ({ instrumentId: 4000 + i, internalSymbolFull: `OLD${i}`, displayname: `Alt ${i}`, instrumentTypeID: i % 3 ? 5 : 6, exchangeID: 4, isDelisted: i % 2 === 0, isActiveInPlatform: i % 2 === 0 }));
const SEARCH_ORDER = [...DEAD, ...[...UNIVERSE].sort((a, b) => (a.instrumentId * 7919) % 1009 - (b.instrumentId * 7919) % 1009)];
const FRED_DATA = {
  T10Y3M: d => (0.4 - 0.002 * d).toFixed(2),
  NFCI: d => (-0.45 + 0.001 * d).toFixed(3),
  DTWEXBGS: d => (120 + Math.sin(d / 40) * 3 + d * 0.01).toFixed(4),
};
function fredCsv(id, cosd) {
  const f = FRED_DATA[id];
  if (!f) return null;
  const rows = ["observation_date," + id];
  if (id === "NFCI") {
    // wöchentlich (freitags) ab dem angefragten Datum bis heute; wechselt in Wellen über und unter null
    const from = Math.max(Date.UTC(2005, 0, 7), cosd ? Date.parse(`${cosd}T00:00:00Z`) : Date.UTC(2025, 8, 1));
    for (let t = new Date(from); t <= new Date(); t = new Date(t.getTime() + 864e5)) {
      if (t.getUTCDay() !== 5) continue;
      const k = Math.round((t - Date.UTC(2000, 0, 7)) / 864e5);
      rows.push(`${t.toISOString().slice(0, 10)},${k % 37 === 5 ? "." : (0.32 * Math.sin(k / 160) - 0.12).toFixed(3)}`);   // „.“ = fehlender Wert wie bei FRED
    }
    return rows.join("\n") + "\n";
  }
  const start = Date.UTC(2025, 8, 1);
  for (let d = 0; d < 430; d++) {
    const t = new Date(start + d * 864e5);
    if (t.getUTCDay() === 0 || t.getUTCDay() === 6) continue;
    rows.push(`${t.toISOString().slice(0, 10)},${d % 37 === 5 ? "." : f(d)}`);   // „.“ = fehlender Wert wie bei FRED
  }
  return rows.join("\n") + "\n";
}

const mirrorInvested = m => m.initialInvestment + m.depositSummary - m.withdrawalSummary;
const mirrorValue = m => mirrorInvested(m) * (1 + m.pnlPct / 100);
const readBody = req => new Promise(resolve => { let b = ""; req.on("data", c => (b += c)); req.on("end", () => { try { resolve(b ? JSON.parse(b) : {}); } catch { resolve(null); } }); });

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const send = (code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };

  // Steuerung nur für die Tests (gibt es bei eToro nicht)
  if (url.pathname.startsWith("/__test/")) {
    const body = req.method === "POST" ? await readBody(req) : {};
    const acc = accounts[(body && body.account) || url.searchParams.get("account") || "demo"];
    if (url.pathname === "/__test/state") return send(200, { credit: acc.credit, mirrors: acc.mirrors, ops: acc.ops });
    if (url.pathname === "/__test/trend") return send(200, { credit: acc.credit, positions: acc.positions, pendingOpen: acc.pendingOpen, tradeOps: acc.tradeOps, realTradeOps, prices: Object.fromEntries(Object.entries(TREND_ETFS).map(([k, id]) => [k, trendPrice(id)])) });
    if (url.pathname === "/__test/fail-next-open") { trendFlags.failNextOpen = true; return send(200, { ok: true }); }
    if (url.pathname === "/__test/pending-next-open") { trendFlags.pendingNextOpen = true; return send(200, { ok: true }); }
    if (url.pathname === "/__test/trend-flags") { Object.assign(trendFlags, body); return send(200, { ok: true }); }
    if (url.pathname === "/__test/confirm-orders") { for (const o of Object.values(acc.orders)) if (o.positionId) o.executed = true; return send(200, { ok: true }); }
    if (url.pathname === "/__test/fill-pending") { for (const o of acc.pendingOpen.splice(0)) openPosition(acc, o.instrumentID, o.amount, o.orderID); return send(200, { ok: true }); }
    if (url.pathname === "/__test/manual-position") { openPosition(acc, TREND_ETFS[body.sym], body.amount, nextOrder++); return send(200, { ok: true }); }
    if (url.pathname === "/__test/remove-position") { const x = acc.positions.find(y => y.positionID === body.positionID); if (x) { acc.credit += x.units * trendPrice(x.instrumentID); acc.positions = acc.positions.filter(y => y !== x); } return send(200, { ok: true }); }
    if (url.pathname === "/__test/regime") { makeTrend(TREND_ETFS[body.sym], body.drift); return send(200, { ok: true }); }
    if (url.pathname === "/__test/pnl") { for (const m of acc.mirrors) if (m.parentUsername === body.userName) m.pnlPct = body.pnlPct; return send(200, { ok: true }); }
    if (url.pathname === "/__test/manual-copy") { const t = traders.find(x => x.username === body.userName); register(acc, { parentCID: t.cid, amount: body.amount, referenceID: `manual-${Date.now()}` }); return send(200, { ok: true }); }
    if (url.pathname === "/__test/fail-next-register") { testFlags.failNextRegister = true; return send(200, { ok: true }); }
    if (url.pathname === "/__test/remove") { acc.mirrors = acc.mirrors.filter(m => m.parentUsername !== body.userName); return send(200, { ok: true }); }
    return send(404, { error: "unknown test endpoint" });
  }

  // Finnhub (Token in der Adresse, keine eToro-Schlüssel)
  if (url.pathname.startsWith("/finnhub/")) {
    if (url.searchParams.get("token") !== "test-finnhub-0000") return send(401, { error: "invalid token" });
    if (url.pathname === "/finnhub/calendar/earnings") {
      const past = (url.searchParams.get("to") || "9999") < new Date().toISOString().slice(0, 10);
      if (past) return send(200, { earningsCalendar: UNIVERSE.filter(u => u.instrumentTypeID === 5 && u.instrumentId % 3 === 1).map(u => ({ symbol: u.internalSymbolFull, date: new Date(Date.now() - (u.instrumentId % 50 + 2) * 864e5).toISOString().slice(0, 10), hour: "amc", epsEstimate: 1.0, epsActual: 1.0 + (u.instrumentId % 7 - 2) / 20, quarter: 3, year: 2026 })) });
      return send(200, { earningsCalendar: UNIVERSE.filter(u => u.instrumentTypeID === 5 && u.instrumentId % 3 === 0).map(u => ({ symbol: u.internalSymbolFull, date: new Date(Date.now() + (u.instrumentId % 40 + 3) * 864e5).toISOString().slice(0, 10), hour: "amc", epsEstimate: 1.23, quarter: 4, year: 2026 })) });
    }
    if (url.pathname === "/finnhub/stock/recommendation") {
      // US-Aktien (ohne Börsenkürzel): je Symbol andere, reproduzierbare Zahlen; Vormonat für Hoch-/Herabstufungen
      const sym = url.searchParams.get("symbol"), u = UNIVERSE.find(x => x.internalSymbolFull === sym && x.instrumentTypeID === 5 && !sym.includes("."));
      if (!u) return send(200, []);
      const k = u.instrumentId;
      const now = { symbol: sym, period: "2026-11-01", strongBuy: k % 7, buy: 4 + k % 9, hold: 3 + k % 5, sell: k % 4, strongSell: k % 3 === 0 ? 1 : 0 };
      const prev = { symbol: sym, period: "2026-10-01", strongBuy: Math.max(0, now.strongBuy + (k % 5) - 2), buy: now.buy, hold: now.hold + (k % 3) - 1, sell: now.sell, strongSell: now.strongSell };
      return send(200, [now, prev]);
    }
    return send(404, { error: "unknown finnhub endpoint" });
  }

  // FRED braucht keine Schlüssel – deshalb vor der Schlüsselprüfung
  if (url.pathname === "/fred") {
    const csv = fredCsv(url.searchParams.get("id"), url.searchParams.get("cosd"));
    if (!csv) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "content-type": "text/csv" });
    return res.end(csv);
  }

  if (!req.headers["x-api-key"] || !req.headers["x-user-key"] || !req.headers["x-request-id"]) return send(401, { error: "missing auth headers" });

  if (url.pathname === "/api/v1/market-data/instrument-types") {
    return send(200, { instrumentTypes: [{ instrumentTypeID: 1, instrumentTypeDescription: "Currencies" }, { instrumentTypeID: 2, instrumentTypeDescription: "Commodities" }, { instrumentTypeID: 4, instrumentTypeDescription: "Indices" }, { instrumentTypeID: 5, instrumentTypeDescription: "Stocks" }, { instrumentTypeID: 6, instrumentTypeDescription: "ETF" }, { instrumentTypeID: 10, instrumentTypeDescription: "Crypto" }] });
  }
  if (url.pathname === "/api/v1/market-data/search") {
    if (!url.searchParams.get("fields")) return send(400, { error: "fields is required" });
    // wie die echte API: Typ-Filter und Seitenzahl ignoriert, Typ-Feld nicht mitgeliefert; sortiert nach Rang,
    // Einträge ohne Rang in beiden Richtungen am Ende; unbekannte Sortierfelder lassen die Abfrage scheitern
    const size = Math.min(10000, Number(url.searchParams.get("pageSize") || 20)), sort = url.searchParams.get("sort") || "";
    if (sort && !/^-?popularityUniques7Day$/.test(sort)) return send(400, { error: `cannot sort by ${sort}` });
    let list = SEARCH_ORDER;
    if (sort) {
      const dir = sort.startsWith("-") ? -1 : 1, has = list.filter(u => u.popularityUniques7Day !== undefined);
      list = [...has.sort((a, b) => dir * (a.popularityUniques7Day - b.popularityUniques7Day)), ...list.filter(u => u.popularityUniques7Day === undefined)];
    }
    return send(200, { items: list.slice(0, size).map(({ instrumentTypeID, exchangeID, isInternal, ...rest }) => rest), page: 1, pageSize: size, totalItems: list.length });
  }
  if (url.pathname === "/api/v1/market-data/instruments") {   // offizielle Liste mit Typ je Instrument
    const want = (url.searchParams.get("instrumentTypeIds") || "").split(",").filter(Boolean).map(Number);
    const list = [...UNIVERSE, ...DEAD].filter(u => !want.length || want.includes(u.instrumentTypeID));
    return send(200, { instrumentDisplayDatas: list.map(u => ({ instrumentID: u.instrumentId, instrumentDisplayName: u.displayname, instrumentTypeID: u.instrumentTypeID, exchangeID: u.exchangeID, symbolFull: u.internalSymbolFull, isInternalInstrument: Boolean(u.isInternal) })) });
  }
  if (url.pathname === "/api/v2/market-data/instruments") {
    const sym = url.searchParams.get("symbols");
    if (TREND_ETFS[sym]) return send(200, { results: [{ instrumentId: TREND_ETFS[sym], symbol: sym, displayName: `${sym} ETF`, type: "ETF" }], pagination: { hasNext: false } });
    if (sym === "EFA") return send(200, { results: [{ instrumentId: 3299, symbol: "EFA", displayName: "falscher Typ", type: "Stocks" }], pagination: { hasNext: false } });
    const id = INSTRUMENTS[sym];
    return send(200, { results: id ? [{ instrumentId: id, symbol: sym, displayName: sym, type: "Indices" }] : [], pagination: { hasNext: false } });
  }
  const tc = /^\/api\/v1\/market-data\/instruments\/(\d+)\/history\/candles\/(asc|desc)\/(OneDay|OneWeek)\/(\d+)$/.exec(url.pathname);
  if (tc && trendSeries[Number(tc[1])]) {
    const list = NO_CANDLES.has(Number(tc[1])) ? [] : trendCandles(Number(tc[1]), tc[3], Math.min(1000, Number(tc[4])));
    return send(200, { interval: tc[3], candles: [{ instrumentId: Number(tc[1]), candles: tc[2] === "desc" ? list.reverse() : list }] });
  }
  const candles = /^\/api\/v1\/market-data\/instruments\/(\d+)\/history\/candles\/(asc|desc)\/OneDay\/(\d+)$/.exec(url.pathname);
  if (candles) {
    const id = Number(candles[1]), n = Math.min(1000, Number(candles[3]));
    if (!Object.values(INSTRUMENTS).includes(id) && !UNIVERSE.some(u => u.instrumentId === id)) return send(404, { error: "unknown instrument" });
    const list = series(id, n);
    return send(200, { interval: "OneDay", candles: [{ instrumentId: id, candles: candles[2] === "desc" ? list.reverse() : list }] });
  }

  const copy = /^\/api\/v2\/trading\/copy(\/demo)?(\/eligibility|\/close|\/[A-Za-z0-9_-]+)?$/.exec(url.pathname);
  if (copy) {
    const acc = accounts[copy[1] ? "demo" : "real"], sub = copy[2] || "";
    if (req.method === "POST" && sub === "/eligibility") {
      const b = await readBody(req);
      if (!b || !Number.isInteger(b.parentCID) || !b.amount) return send(400, { error: "parentCID and non-zero amount required" });
      acc.ops.push({ op: "eligibility", ...b });
      const ok = Boolean(byCid(b.parentCID)) && b.amount >= 200 && b.amount <= acc.credit;
      return send(200, ok ? { CID: 1, parentCID: b.parentCID, isSuccess: true } : { CID: 1, parentCID: b.parentCID, isSuccess: false, errorMessage: "Not eligible" });
    }
    if (req.method === "POST" && sub === "/close") {
      const b = await readBody(req);
      if (!b || !Number.isInteger(b.mirrorID) || b.mirrorID < 1) return send(400, { error: "mirrorID required" });
      acc.ops.push({ op: "close", ...b });
      const m = acc.mirrors.find(x => x.mirrorID === b.mirrorID);
      if (!m) return send(404, { error: "Mirror not found" });
      if (!m.closing) m.closing = 1;
      return send(200, { token: b.clientRequestID || "00000000-0000-4000-8000-000000000000" });
    }
    if (req.method === "POST" && sub === "") {
      const b = await readBody(req);
      if (!b || !Number.isInteger(b.parentCID) || !b.amount) return send(400, { error: "Amount must not be zero" });
      if (typeof b.referenceID !== "string" || !b.referenceID || b.referenceID.length > 35) return send(400, { error: "referenceID missing or longer than 35 characters" });
      acc.ops.push({ op: "register", ...b });
      register(acc, b);
      if (testFlags.failNextRegister) { testFlags.failNextRegister = false; return send(503, { error: "temporarily unavailable" }); }   // angekommen, aber keine Bestätigung
      return send(200, { token: "11111111-1111-4111-8111-111111111111" });
    }
    if (req.method === "GET" && sub && !["/eligibility", "/close"].includes(sub)) {
      const st = acc.statuses[sub.slice(1)];
      return st ? send(200, st) : send(404, { error: "Reference not found" });
    }
    return send(405, { error: "method not allowed" });
  }
  const exec = /^\/api\/v1\/trading\/execution\/(demo\/)?(market-open-orders\/by-amount|market-close-orders\/positions\/(\d+))$/.exec(url.pathname);
  if (exec && req.method === "POST") {
    const b = await readBody(req) || {};
    if (!exec[1]) { realTradeOps.push({ path: url.pathname, body: b }); return send(403, { error: "real-money trading is not allowed in tests" }); }
    const acc = accounts.demo;
    acc.tradeOps.push({ path: url.pathname, body: b });
    if (exec[2].startsWith("market-open")) {
      if (!TREND_PARAMS[b.InstrumentID]) return send(400, { error: "unknown instrument" });
      if (!Number.isInteger(b.Leverage) || b.Leverage < 1) return send(400, { error: "Leverage must be at least 1" });
      if (typeof b.IsBuy !== "boolean" || !(b.Amount >= 10)) return send(400, { error: "IsBuy and Amount >= 10 required" });
      if (b.Amount > acc.credit) return send(400, { error: "Insufficient funds" });
      if (b.StopLossRate !== undefined && b.StopLossRate !== null && !(b.StopLossRate < trendPrice(b.InstrumentID))) return send(400, { error: "StopLoss must be worse than current price" });
      const orderID = nextOrder++;
      if (trendFlags.pendingNextOpen) { trendFlags.pendingNextOpen = false; acc.pendingOpen.push({ orderID, instrumentID: b.InstrumentID, amount: b.Amount }); acc.orders[orderID] = { orderId: orderID, executed: false }; }
      else openPosition(acc, b.InstrumentID, b.Amount, orderID);
      if (trendFlags.failNextOpen) { trendFlags.failNextOpen = false; return send(503, { error: "temporarily unavailable" }); }   // angekommen, aber keine Bestätigung
      return send(200, { orderForOpen: { orderID, instrumentID: b.InstrumentID, amount: b.Amount, isBuy: b.IsBuy, leverage: b.Leverage, statusID: 1, openDateTime: new Date().toISOString() }, token: "22222222-2222-4222-8222-222222222222" });
    }
    const pos = acc.positions.find(x => x.positionID === Number(exec[3]));
    if (!pos) return send(404, { error: "Position not found" });
    if (b.InstrumentID !== pos.instrumentID) return send(400, { error: "InstrumentID does not match the position" });
    const price = trendPrice(pos.instrumentID), cut = b.UnitsToDeduct === undefined || b.UnitsToDeduct === null ? pos.units : Math.min(pos.units, Number(b.UnitsToDeduct));
    acc.credit += cut * price;
    if (cut >= pos.units - 1e-9) acc.positions = acc.positions.filter(x => x !== pos);
    else { pos.amount *= 1 - cut / pos.units; pos.units -= cut; }
    return send(200, { orderForClose: { orderID: nextOrder++, positionID: pos.positionID, instrumentID: pos.instrumentID, unitsToDeduct: cut }, token: "33333333-3333-4333-8333-333333333333" });
  }
  if (/^\/api\/v[0-9]\/trading\/execution\//.test(url.pathname)) { realTradeOps.push({ path: url.pathname }); return send(403, { error: "not available in tests" }); }
  const orderInfo = /^\/api\/v1\/trading\/info\/demo\/orders\/(\d+)$/.exec(url.pathname);
  if (orderInfo) {
    const o = accounts.demo.orders[Number(orderInfo[1])];
    if (!o) return send(404, { error: "Order not found" });
    return send(200, { orderId: o.orderId, action: "open", positionExecutions: o.executed ? [{ positionId: o.positionId, state: "open" }] : [] });
  }
  const pnl = /^\/api\/v1\/trading\/info\/(demo|real)\/pnl$/.exec(url.pathname);
  if (pnl && req.method === "GET") return send(200, portfolio(accounts[pnl[1]]));

  if (url.pathname === "/api/v2/portfolios/rankings") {
    if (url.searchParams.get("sort")) return send(400, { error: "unknown parameter sort" });   // prüft die Rückfallebene
    const page = Number(url.searchParams.get("page") || 1), size = Number(url.searchParams.get("pageSize") || 20);
    const max = Number(url.searchParams.get("riskScoreMax") || 10);
    const list = traders.filter(t => t.riskScore <= max);
    return send(200, { totalRows: list.length, items: list.slice((page - 1) * size, page * size).map(({ months, ...t }) => t) });
  }
  const one = /^\/api\/v2\/portfolios\/([^/]+)\/rankings$/.exec(url.pathname);
  if (one) {
    if (!url.searchParams.get("period")) return send(400, { error: "period is required" });
    const t = traders.find(x => x.username === decodeURIComponent(one[1]));
    if (!t) return send(404, { error: "not found" });
    const { months, ...row } = t;
    return send(200, { data: row });
  }
  const m = /^\/api\/v1\/user-info\/people\/([^/]+)\/gain$/.exec(url.pathname);
  if (m && DENY) return send(403, { errorCode: "InsufficientPermissions", errorMessage: "UserToken does not have permission to access" });
  if (m) {
    const t = traders.find(x => x.username === decodeURIComponent(m[1]));
    return t ? send(200, { monthly: t.months, yearly: [] }) : send(404, { error: "not found" });
  }
  send(404, { error: "unknown endpoint" });
}).listen(PORT, () => console.log(`Test-Server auf Port ${PORT}`));

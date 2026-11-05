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
const accounts = { demo: { credit: 100000, mirrors: [], ops: [], statuses: {} }, real: { credit: 20000, mirrors: [], ops: [], statuses: {} } };
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
      accountCurrencyId: 1, credit: acc.credit, bonusCredit: 0, positions: [], orders: [],
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
// Beliebte Instrumente für den Aktien-Check (erfunden): Typ 5 = Aktien, 6 = ETFs. Ganz oben stehen – wie bei eToro –
// Bitcoin, Gold, ein Index und eine Währung; sie dürfen nie als Aktie erscheinen. STK007 ist nicht öffentlich.
const UNIVERSE = [
  { instrumentId: 100000, internalSymbolFull: "BTC", displayname: "Bitcoin", instrumentTypeID: 10, exchangeID: 8, buyHoldingPct: 95, popularityUniques7Day: 200000, isDelisted: false, isActiveInPlatform: true },
  { instrumentId: 18, internalSymbolFull: "GOLD", displayname: "Gold", instrumentTypeID: 2, exchangeID: 2, buyHoldingPct: 80, popularityUniques7Day: 150000, isDelisted: false, isActiveInPlatform: true },
  { instrumentId: 27, internalSymbolFull: "SPX500", displayname: "US500", instrumentTypeID: 4, exchangeID: 3, buyHoldingPct: 85, popularityUniques7Day: 140000, isDelisted: false, isActiveInPlatform: true },
  { instrumentId: 1, internalSymbolFull: "EURUSD", displayname: "EUR/USD", instrumentTypeID: 1, exchangeID: 1, buyHoldingPct: 50, popularityUniques7Day: 130000, isDelisted: false, isActiveInPlatform: true },
  ...Array.from({ length: 70 }, (_, i) => ({ instrumentId: 2000 + i, internalSymbolFull: i % 10 === 3 ? `DE${i}.DE` : `STK${String(i).padStart(3, "0")}`, displayname: `Testaktie ${i}`, instrumentTypeID: 5, exchangeID: i % 10 === 3 ? 6 : 4, buyHoldingPct: 60 + (i % 35), popularityUniques7Day: 100000 - i * 100, isDelisted: i === 5, isInternal: i === 7, isActiveInPlatform: true, isHiddenFromClient: false })),
  { instrumentId: 2999, internalSymbolFull: "BAD SYMBOL!", displayname: "Ungültig", instrumentTypeID: 5, exchangeID: 4, popularityUniques7Day: 99999, isDelisted: false, isActiveInPlatform: true },
  ...Array.from({ length: 15 }, (_, i) => ({ instrumentId: 3000 + i, internalSymbolFull: `ETF${String(i).padStart(2, "0")}`, displayname: `Test-ETF ${i}`, instrumentTypeID: 6, exchangeID: 5, buyHoldingPct: 90, popularityUniques7Day: 50000 - i * 100, isDelisted: false, isActiveInPlatform: true, isHiddenFromClient: false })),
  { instrumentId: 2500, internalSymbolFull: "NOPOP", displayname: "Aktie ohne Beliebtheit", instrumentTypeID: 5, exchangeID: 4, isDelisted: false, isActiveInPlatform: true, isHiddenFromClient: false },
];
// Wie bei eToro: alte, nicht mehr handelbare Einträge ohne Beliebtheit – die echte Suche liefert sie zuerst
const DEAD = Array.from({ length: 30 }, (_, i) => ({ instrumentId: 4000 + i, internalSymbolFull: `OLD${i}`, displayname: `Alt ${i}`, instrumentTypeID: i % 3 ? 5 : 6, exchangeID: 4, isDelisted: i % 2 === 0, isActiveInPlatform: i % 2 === 0 }));
const SEARCH_ORDER = [...DEAD, ...[...UNIVERSE].sort((a, b) => (a.instrumentId * 7919) % 1009 - (b.instrumentId * 7919) % 1009)];
const FRED_DATA = {
  T10Y3M: d => (0.4 - 0.002 * d).toFixed(2),
  NFCI: d => (-0.45 + 0.001 * d).toFixed(3),
  DTWEXBGS: d => (120 + Math.sin(d / 40) * 3 + d * 0.01).toFixed(4),
};
function fredCsv(id) {
  const f = FRED_DATA[id];
  if (!f) return null;
  const rows = ["observation_date," + id];
  const start = Date.UTC(2025, 8, 1);
  for (let d = 0; d < 430; d++) {
    const t = new Date(start + d * 864e5);
    if (id === "NFCI" && t.getUTCDay() !== 5) continue;                       // wöchentlich (freitags)
    if (id !== "NFCI" && (t.getUTCDay() === 0 || t.getUTCDay() === 6)) continue;
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
      return send(200, { earningsCalendar: UNIVERSE.filter(u => u.instrumentTypeID === 5 && u.instrumentId % 3 === 0).map(u => ({ symbol: u.internalSymbolFull, date: new Date(Date.now() + (u.instrumentId % 40 + 3) * 864e5).toISOString().slice(0, 10), hour: "amc", epsEstimate: 1.23, quarter: 4, year: 2026 })) });
    }
    if (url.pathname === "/finnhub/stock/recommendation") {
      const sym = url.searchParams.get("symbol");
      return send(200, sym && sym.startsWith("STK") ? [{ symbol: sym, period: "2026-11-01", strongBuy: 5, buy: 10, hold: 7, sell: 1, strongSell: 0 }, { symbol: sym, period: "2026-10-01", strongBuy: 4, buy: 9, hold: 8, sell: 2, strongSell: 0 }] : []);
    }
    return send(404, { error: "unknown finnhub endpoint" });
  }

  // FRED braucht keine Schlüssel – deshalb vor der Schlüsselprüfung
  if (url.pathname === "/fred") {
    const csv = fredCsv(url.searchParams.get("id"));
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
    const size = Number(url.searchParams.get("pageSize") || 20), page = Number(url.searchParams.get("pageNumber") || 1);
    // wie die echte API: Typ-Filter ignoriert, Typ-Feld nicht mitgeliefert, Reihenfolge nicht nach Beliebtheit
    const list = SEARCH_ORDER;
    return send(200, { items: list.slice((page - 1) * size, page * size).map(({ instrumentTypeID, exchangeID, isInternal, ...rest }) => rest), page, pageSize: size, totalItems: list.length });
  }
  if (url.pathname === "/api/v1/market-data/instruments") {   // offizielle Liste mit Typ je Instrument
    const want = (url.searchParams.get("instrumentTypeIds") || "").split(",").filter(Boolean).map(Number);
    const list = [...UNIVERSE, ...DEAD].filter(u => !want.length || want.includes(u.instrumentTypeID));
    return send(200, { instrumentDisplayDatas: list.map(u => ({ instrumentID: u.instrumentId, instrumentDisplayName: u.displayname, instrumentTypeID: u.instrumentTypeID, exchangeID: u.exchangeID, symbolFull: u.internalSymbolFull, isInternalInstrument: Boolean(u.isInternal) })) });
  }
  if (url.pathname === "/api/v2/market-data/instruments") {
    const sym = url.searchParams.get("symbols");
    const id = INSTRUMENTS[sym];
    return send(200, { results: id ? [{ instrumentId: id, symbol: sym, displayName: sym, type: "Indices" }] : [], pagination: { hasNext: false } });
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

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
  // eToro-Angabe „gain“ für LastTwoYears: 23 abgeschlossene Monate + laufender Monat
  const twoYears = months.slice(-24).reduce((e, m) => e * (1 + m.gain / 100), 1);
  return {
    username: `trader${String(i).padStart(3, "0")}`, riskScore: 1 + Math.floor(rnd() * 7), copiers: Math.floor(rnd() * 20000),
    gain: Math.round((twoYears - 1) * 10000) / 100, dailyGain: Math.round(gauss() * 120) / 100, thisWeekGain: Math.round(gauss() * 250) / 100,
    peakToValley: -Math.round((5 + rnd() * 20) * 10) / 10, profitableMonthsPct: Math.round(40 + rnd() * 40), months,
  };
});

http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const send = (code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  if (!req.headers["x-api-key"] || !req.headers["x-user-key"] || !req.headers["x-request-id"]) return send(401, { error: "missing auth headers" });
  if (url.pathname === "/api/v2/portfolios/rankings") {
    if (url.searchParams.get("sort")) return send(400, { error: "unknown parameter sort" });   // prüft die Rückfallebene
    const page = Number(url.searchParams.get("page") || 1), size = Number(url.searchParams.get("pageSize") || 20);
    const max = Number(url.searchParams.get("riskScoreMax") || 10);
    const list = traders.filter(t => t.riskScore <= max);
    return send(200, { totalRows: list.length, items: list.slice((page - 1) * size, page * size).map(({ months, ...t }) => t) });
  }
  const one = /^\/api\/v2\/portfolios\/([^/]+)\/rankings$/.exec(url.pathname);
  if (one) {
    const t = traders.find(x => x.username === decodeURIComponent(one[1]));
    if (!t) return send(404, { error: "not found" });
    const { months, ...row } = t;
    return send(200, row);
  }
  const m = /^\/api\/v1\/user-info\/people\/([^/]+)\/gain$/.exec(url.pathname);
  if (m && DENY) return send(403, { errorCode: "InsufficientPermissions", errorMessage: "UserToken does not have permission to access" });
  if (m) {
    const t = traders.find(x => x.username === decodeURIComponent(m[1]));
    return t ? send(200, { monthly: t.months, yearly: [] }) : send(404, { error: "not found" });
  }
  send(404, { error: "unknown endpoint" });
}).listen(PORT, () => console.log(`Test-Server auf Port ${PORT}`));

// Gemeinsamer, abgesicherter Zugriff auf die offizielle eToro-API für die GitHub-Jobs
// (daily-ranking.mjs und live-watch.mjs). Die Schlüssel kommen nur aus den GitHub-Secrets.
import { randomUUID } from "node:crypto";

export const API = (process.env.ETORO_API_BASE || "https://public-api.etoro.com/api").replace(/\/$/, "");
const THROTTLE_MS = Number(process.env.ETORO_THROTTLE_MS ?? 1100);   // eToro erlaubt 60 Abfragen pro Minute
export const KEY = process.env.ETORO_API_KEY;
export const USER_KEY = process.env.ETORO_USER_KEY;
export const hasKeys = Boolean(KEY && USER_KEY);

// Schlüssel sicherheitshalber aus jeder Ausgabe entfernen (GitHub maskiert sie zusätzlich)
export const redact = s => [KEY, USER_KEY].filter(k => k && k.length >= 8).reduce((t, k) => t.split(k).join("***"), String(s));
export const log = (...a) => console.log(...a.map(redact));
export const warn = msg => console.log(`::warning::${redact(msg)}`);
export const fail = msg => { console.log(`::error::${redact(msg)}`); process.exit(1); };
export const sleep = ms => new Promise(r => setTimeout(r, ms));

// Schutz: Die Schlüssel gehen ausschließlich per HTTPS an public-api.etoro.com (Ausnahme: lokaler Testserver)
const apiHost = new URL(API);
const localTest = ["localhost", "127.0.0.1"].includes(apiHost.hostname);
if (!localTest && !(apiHost.protocol === "https:" && apiHost.hostname === "public-api.etoro.com")) {
  fail(`Unzulässige API-Adresse ${apiHost.host} – die Schlüssel werden nur an public-api.etoro.com gesendet.`);
}

export const VALID_NAME = /^[A-Za-z0-9_.-]{1,40}$/;   // eToro-Benutzernamen; alles andere wird verworfen

let lastCall = 0;
export async function call(path, params = {}) {
  const url = new URL(API + path);
  for (const [k, val] of Object.entries(params)) if (val !== undefined) url.searchParams.set(k, String(val));
  for (let attempt = 1; attempt <= 4; attempt++) {
    const wait = lastCall + THROTTLE_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
    let res;
    try {
      res = await fetch(url, {
        headers: { "x-api-key": KEY, "x-user-key": USER_KEY, "x-request-id": randomUUID(), accept: "application/json" },
        redirect: "error",                    // keine Weiterleitung – sonst gingen die Schlüssel an einen anderen Server
        signal: AbortSignal.timeout(20000),
      });
    } catch (e) {
      if (attempt === 4) throw new Error(`Netzwerkfehler bei ${url.pathname}: ${e.message}`);
      await sleep(3000 * attempt);
      continue;
    }
    if (res.status === 429 || res.status >= 500) { await sleep(5000 * attempt); continue; }
    if (!res.ok) throw new Error(`HTTP ${res.status} bei ${url.pathname}: ${(await res.text()).slice(0, 300)}`);
    return res.json();
  }
  throw new Error(`Keine Antwort von ${url.pathname} nach 4 Versuchen`);
}

// Feld unabhängig von der Schreibweise lesen (userName, UserName, username …)
export function field(obj, ...names) {
  if (!obj || typeof obj !== "object") return undefined;
  const map = {};
  for (const [k, val] of Object.entries(obj)) map[k.toLowerCase()] = val;
  for (const n of names) {
    const val = map[n.toLowerCase()];
    if (val !== undefined && val !== null && val !== "") return val;
  }
  return undefined;
}
export const findArray = d => (Array.isArray(d) ? d : ["items", "data", "rankings", "results", "users", "rows"].map(k => field(d, k)).find(Array.isArray) || []);
export const flatten = it => ({ ...Object.values(it).filter(x => x && typeof x === "object" && !Array.isArray(x)).reduce((a, x) => ({ ...a, ...x }), {}), ...it });
export const num = x => (x === undefined || x === null || x === "" ? undefined : Number(x));
const finite = x => (Number.isFinite(x) ? x : undefined);

// Ein Eintrag der eToro-Rangliste → die Felder, die wir verwenden
export function toTrader(raw) {
  const it = flatten(raw);
  const name = field(it, "userName", "username", "customerName", "nickName");
  const p2v = num(field(it, "peakToValley", "maxDrawdown", "drawdown"));
  const holdMin = num(field(it, "avgHoldingTimeInMinutes", "avgHoldingTimeMinutes"));
  return {
    userName: typeof name === "string" && VALID_NAME.test(name) ? name : undefined,
    risk: finite(num(field(it, "riskScore", "risk"))),
    copiers: finite(num(field(it, "copiers", "copiersCount", "numberOfCopiers"))),
    peakToValley: Number.isFinite(p2v) ? Math.abs(p2v) : undefined,
    avgHoldHours: Number.isFinite(holdMin) ? holdMin / 60 : undefined,
    profitableMonthsPct: finite(num(field(it, "profitableMonthsPct", "profitableMonthsPercentage"))),
    periodGain: finite(num(field(it, "gain"))),                       // Rendite im abgefragten Zeitraum (eToro)
    annualizedReturn: finite(num(field(it, "annualizedReturn"))),
    dailyGain: finite(num(field(it, "dailyGain"))),
    thisWeekGain: finite(num(field(it, "thisWeekGain"))),
    dailyDD: finite(num(field(it, "dailyDD"))),
    weeklyDD: finite(num(field(it, "weeklyDD"))),
  };
}

// Rangliste der Popular Investors, sortiert nach Kopierern (mehrere Abfrage-Varianten als Rückfallebene)
export async function loadRankings({ maxRisk = 10, limit = 150, pages = 5, period = "LastTwoYears" } = {}) {
  const strategies = [
    { path: "/v2/portfolios/rankings", params: { period, popularInvestor: true, riskScoreMin: 1, riskScoreMax: maxRisk, sort: "-copiers" } },
    { path: "/v2/portfolios/rankings", params: { period, popularInvestor: true, riskScoreMin: 1, riskScoreMax: maxRisk } },
    { path: "/v1/user-info/people/search", params: { period: "LastYear", popularInvestor: true, sort: "-copiers" } },
  ];
  for (const s of strategies) {
    try {
      const items = [];
      let total;
      for (let page = 1; page <= pages && items.length < limit * 2; page++) {
        const data = await call(s.path, { ...s.params, page, pageSize: 100 });
        const list = findArray(data);
        if (page === 1) {
          total = num(field(data, "totalRows", "total", "totalCount", "count"));
          log(`${s.path}: ${list.length} Einträge, Felder: ${Object.keys(flatten(list[0] || {})).join(", ")}`);
        }
        items.push(...list);
        if (list.length < 100) break;
      }
      const seen = new Set();
      const traders = items.map(toTrader).filter(u => u.userName && !seen.has(u.userName) && seen.add(u.userName))
        .filter(u => u.risk === undefined || u.risk <= maxRisk)
        .sort((a, b) => (b.copiers ?? 0) - (a.copiers ?? 0))
        .slice(0, limit);
      if (traders.length) return { source: s.path, total, traders };
      warn(`${s.path}: keine verwertbaren Einträge`);
    } catch (e) {
      warn(`${s.path} ${JSON.stringify(s.params)}: ${e.message}`);
    }
  }
  throw new Error("Keine Trader-Liste von eToro erhalten – Details in den Warnungen oben.");
}

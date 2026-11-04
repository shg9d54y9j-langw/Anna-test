// Täglicher Job (GitHub Actions): holt Live-Daten über die offizielle eToro-API,
// berechnet die Top 25 und die Tagesempfehlung und schreibt sie nach data/ranking.json.
// Benötigt die Repository-Secrets ETORO_API_KEY und ETORO_USER_KEY (nur Leserechte).
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

createRequire(import.meta.url)("../stats.js");
const S = globalThis.TradeStats;

// ---------- Einstellungen ----------
const CONFIG = {
  universe: 150,      // geprüft werden die meistkopierten Popular Investors …
  maxRisk: 5,         // … mit Risiko-Score bis 5
  minMonths: 24,      // mindestens 2 Jahre Monatsrenditen
  maxMonths: 60,      // ausgewertet werden höchstens die letzten 5 Jahre
  maxDd: 20,          // größter Rückgang höchstens 20 %
  threshold: 0.9,     // geforderte Können-Sicherheit
  rf: 2,              // Zins ohne Risiko in % p.a.
  share: 0.2,         // höchstens 20 % des Kontos pro Trader
  lossPct: 0.05,      // höchstens 5 % des Kontos Verlust pro Kopie
  top: 25,
  keepWithinTop: 5,   // Empfehlung wechselt erst, wenn der Trader aus den Top 5 der sicheren Trader fällt
};

const API = (process.env.ETORO_API_BASE || "https://public-api.etoro.com/api").replace(/\/$/, "");
const THROTTLE_MS = Number(process.env.ETORO_THROTTLE_MS ?? 1100);   // eToro erlaubt 60 Abfragen pro Minute
const OUT = process.env.RANKING_OUT || fileURLToPath(new URL("../data/ranking.json", import.meta.url));
const KEY = process.env.ETORO_API_KEY, USER_KEY = process.env.ETORO_USER_KEY;

// Schlüssel sicherheitshalber aus jeder Ausgabe entfernen (GitHub maskiert sie zusätzlich)
const redact = s => [KEY, USER_KEY].filter(k => k && k.length >= 8).reduce((t, k) => t.split(k).join("***"), String(s));
const log = (...a) => console.log(...a.map(redact));
const warn = msg => console.log(`::warning::${redact(msg)}`);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Schutz: Die Schlüssel gehen ausschließlich per HTTPS an public-api.etoro.com (Ausnahme: lokaler Testserver)
const apiHost = new URL(API);
const localTest = ["localhost", "127.0.0.1"].includes(apiHost.hostname);
if (!localTest && !(apiHost.protocol === "https:" && apiHost.hostname === "public-api.etoro.com")) {
  console.log(`::error::Unzulässige API-Adresse ${apiHost.host} – die Schlüssel werden nur an public-api.etoro.com gesendet.`);
  process.exit(1);
}
const VALID_NAME = /^[A-Za-z0-9_.-]{1,40}$/;   // eToro-Benutzernamen; alles andere wird verworfen

// ---------- eToro-API ----------
let lastCall = 0;
async function call(path, params = {}) {
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
function field(obj, ...names) {
  if (!obj || typeof obj !== "object") return undefined;
  const map = {};
  for (const [k, val] of Object.entries(obj)) map[k.toLowerCase()] = val;
  for (const n of names) {
    const val = map[n.toLowerCase()];
    if (val !== undefined && val !== null && val !== "") return val;
  }
  return undefined;
}
const findArray = d => (Array.isArray(d) ? d : ["items", "data", "rankings", "results", "users", "rows"].map(k => field(d, k)).find(Array.isArray) || []);
const flatten = it => ({ ...Object.values(it).filter(x => x && typeof x === "object" && !Array.isArray(x)).reduce((a, x) => ({ ...a, ...x }), {}), ...it });
const num = x => (x === undefined || x === null || x === "" ? undefined : Number(x));

function toUser(raw) {
  const it = flatten(raw);
  const p2v = num(field(it, "peakToValley", "maxDrawdown", "drawdown"));
  const holdMin = num(field(it, "avgHoldingTimeInMinutes", "avgHoldingTimeMinutes"));
  const name = field(it, "userName", "username", "customerName", "nickName");
  return {
    userName: typeof name === "string" && VALID_NAME.test(name) ? name : undefined,
    risk: num(field(it, "riskScore", "risk")),
    copiers: num(field(it, "copiers", "copiersCount", "numberOfCopiers")),
    peakToValley: Number.isFinite(p2v) ? Math.abs(p2v) : undefined,
    avgHoldHours: Number.isFinite(holdMin) ? holdMin / 60 : undefined,
    profitableMonthsPct: num(field(it, "profitableMonthsPct", "profitableMonthsPercentage")),
  };
}

// Kandidaten: die meistkopierten Popular Investors (nicht die mit der höchsten Rendite –
// so wird die Auswahl nicht schon vorab auf Glückstreffer verzerrt)
const STRATEGIES = [
  { path: "/v2/portfolios/rankings", params: { period: "LastTwoYears", popularInvestor: true, riskScoreMin: 1, riskScoreMax: CONFIG.maxRisk, sort: "-copiers" } },
  { path: "/v2/portfolios/rankings", params: { period: "LastTwoYears", popularInvestor: true, riskScoreMin: 1, riskScoreMax: CONFIG.maxRisk } },
  { path: "/v1/user-info/people/search", params: { period: "LastYear", popularInvestor: true, sort: "-copiers" } },
];
async function loadUniverse() {
  for (const s of STRATEGIES) {
    try {
      const items = [];
      let total;
      for (let page = 1; page <= 5 && items.length < CONFIG.universe * 2; page++) {
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
      const users = items.map(toUser).filter(u => u.userName && !seen.has(u.userName) && seen.add(u.userName))
        .filter(u => u.risk === undefined || u.risk <= CONFIG.maxRisk)
        .sort((a, b) => (b.copiers ?? 0) - (a.copiers ?? 0))
        .slice(0, CONFIG.universe);
      if (users.length) return { source: s.path, total, users };
      warn(`${s.path}: keine verwertbaren Einträge`);
    } catch (e) {
      warn(`${s.path} ${JSON.stringify(s.params)}: ${e.message}`);
    }
  }
  throw new Error("Keine Trader-Liste von eToro erhalten – Details in den Warnungen oben.");
}

// Monatsrenditen in %, älteste zuerst; ohne den laufenden Monat, nur die jüngste lückenlose Folge
function monthKey(tv) {
  const ym = typeof tv === "string" && /^(\d{4})-(\d{2})/.exec(tv);
  if (ym) return Number(ym[1]) * 12 + Number(ym[2]) - 1;
  const t = new Date(typeof tv === "number" && tv < 1e12 ? tv * 1000 : tv);
  return t.getUTCFullYear() * 12 + t.getUTCMonth();
}
const keyToMonth = k => `${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, "0")}`;
function findMonthly(d, depth = 0) {
  const m = field(d, "monthly", "monthlyGains", "months");
  if (Array.isArray(m)) return m;
  const inner = field(d, "data", "gain", "result");
  return inner && typeof inner === "object" && depth < 3 ? findMonthly(inner, depth + 1) : [];
}
async function monthlyReturns(userName) {
  const data = await call(`/v1/user-info/people/${encodeURIComponent(userName)}/gain`);
  const now = new Date();
  const current = now.getUTCFullYear() * 12 + now.getUTCMonth();
  const byMonth = new Map();
  for (const m of findMonthly(data)) {
    const k = monthKey(field(m, "timestamp", "date", "start", "month"));
    const g = num(field(m, "gain", "value", "return"));
    if (Number.isFinite(k) && Number.isFinite(g) && Math.abs(g) <= 1000 && k < current) byMonth.set(k, g);
  }
  const keys = [...byMonth.keys()].sort((a, b) => a - b);
  let i = keys.length - 1;
  while (i > 0 && keys[i - 1] === keys[i] - 1) i--;
  return keys.slice(i).slice(-CONFIG.maxMonths).map(k => ({ k, g: byMonth.get(k) }));
}

function avgCorrelation(series) {
  let sum = 0, cnt = 0;
  for (let i = 0; i < series.length; i++) for (let j = i + 1; j < series.length; j++) {
    const a = [], b = [];
    for (const [k, g] of series[i]) if (series[j].has(k)) { a.push(g); b.push(series[j].get(k)); }
    if (a.length >= 12) { sum += S.correlation(a, b); cnt++; }
  }
  return cnt ? sum / cnt : 0;
}

// Auf 4 Nachkommastellen runden, ∞/NaN als null speichern
const clean = o => JSON.parse(JSON.stringify(o, (k, val) => (typeof val === "number" ? (Number.isFinite(val) ? Math.round(val * 1e4) / 1e4 : null) : val)));

function decide(prev, qualified, rows) {
  const today = new Date().toISOString().slice(0, 10);
  const prevRec = prev && prev.recommendation;
  const pick = r => ({ userName: r.userName, cagr: r.cagr, mdd: r.mdd, dsr: r.dsr, sharpe: r.sharpe, risk: r.risk, csl: r.csl, amountPct: r.amountPct, bind: r.bind });
  const pos = prevRec ? qualified.findIndex(r => r.userName === prevRec.userName) : -1;
  if (prevRec && pos >= 0 && pos < CONFIG.keepWithinTop) {
    return { ...pick(qualified[pos]), since: prevRec.since || today, changed: false, previous: null,
      note: `Unverändert – erfüllt weiterhin alle Bedingungen (Platz ${pos + 1} der sicheren Trader).` };
  }
  if (!qualified.length) return null;
  let note = "Erste Empfehlung.";
  if (prevRec) {
    const old = rows.find(r => r.userName === prevRec.userName);
    note = !old ? `${prevRec.userName} ist nicht mehr unter den geprüften Tradern.`
      : !old.qualified ? `${prevRec.userName} erfüllt die Bedingungen nicht mehr (${old.reason}).`
      : `${prevRec.userName} ist nicht mehr unter den besten ${CONFIG.keepWithinTop} sicheren Tradern.`;
  }
  return { ...pick(qualified[0]), since: today, changed: Boolean(prevRec), previous: prevRec ? prevRec.userName : null, note };
}

async function main() {
  if (!KEY || !USER_KEY) {
    warn("Die Secrets ETORO_API_KEY und ETORO_USER_KEY fehlen – Job übersprungen. Anleitung auf der Website unter „Tagesempfehlung“.");
    return;
  }
  let prev = null;
  try { prev = JSON.parse(await readFile(OUT, "utf8")); } catch {}

  const { source, total, users } = await loadUniverse();
  log(`${users.length} Kandidaten aus ${source}${total ? ` (${total} Treffer insgesamt)` : ""}`);

  const evaluated = [];
  for (const u of users) {
    try {
      const months = await monthlyReturns(u.userName);
      if (!evaluated.length) log(`Beispiel ${u.userName}: ${months.length} Monate, zuletzt ${months.slice(-3).map(m => `${keyToMonth(m.k)}: ${m.g}`).join(", ")}`);
      evaluated.push({ ...u, months });
    } catch (e) {
      warn(`${u.userName}: ${e.message}`);
    }
  }
  const withData = evaluated.filter(u => u.months.length >= CONFIG.minMonths);
  if (!withData.length) throw new Error(`Für keinen der ${evaluated.length} Kandidaten gab es mindestens ${CONFIG.minMonths} Monatswerte.`);

  // Glücks-Korrektur: effektive Zahl unabhängiger Trader aus der mittleren Korrelation
  const rho = avgCorrelation(withData.map(u => new Map(u.months.map(m => [m.k, m.g]))));
  const nEff = S.effectiveTrials(withData.length, rho);

  const rows = withData.map(u => {
    const m = S.metrics(u.months.map(x => x.g), { rf: CONFIG.rf, N: nEff, mddInput: u.peakToValley });
    const fails = [];
    if (u.risk !== undefined && u.risk > CONFIG.maxRisk) fails.push(`Risiko-Score ${u.risk} > ${CONFIG.maxRisk}`);
    if (m.mdd > CONFIG.maxDd) fails.push(`Drawdown ${m.mdd.toFixed(1).replace(".", ",")} % > ${CONFIG.maxDd} %`);
    const inLimits = fails.length === 0;
    const qualified = inLimits && m.dsr >= CONFIG.threshold;
    if (inLimits && !qualified) fails.push(`Können-Sicherheit ${m.dsr < 0.005 ? "unter 1" : Math.round(m.dsr * 100)} % < ${CONFIG.threshold * 100} %`);
    const alloc = S.allocation(m, { share: CONFIG.share, lossPct: CONFIG.lossPct });
    return {
      userName: u.userName, risk: u.risk ?? null, copiers: u.copiers ?? null,
      avgHoldHours: u.avgHoldHours ?? null, profitableMonthsPct: u.profitableMonthsPct ?? null,
      months: m.n, lastMonth: keyToMonth(u.months[u.months.length - 1].k),
      cagr: m.cagr, sharpe: m.sharpe, sortino: m.sortino, mdd: m.mdd, dsr: m.dsr, halfKelly: m.halfKelly,
      qualified, inLimits, reason: fails[0] || null, csl: alloc.csl, amountPct: alloc.frac, bind: alloc.bind,
    };
  });

  // Rangliste: erst alle sicheren Trader nach Rendite, dann die übrigen innerhalb der Grenzen nach Sicherheit
  const qualified = rows.filter(r => r.qualified).sort((a, b) => b.cagr - a.cagr);
  const rest = rows.filter(r => !r.qualified && r.inLimits).sort((a, b) => b.dsr - a.dsr);
  const top = [...qualified, ...rest].slice(0, CONFIG.top).map((r, i) => ({ rank: i + 1, ...r }));

  const recommendation = decide(prev, qualified, rows);
  const lastRecommended = recommendation ? { userName: recommendation.userName, since: recommendation.since } : (prev && prev.lastRecommended) || null;
  const notice = recommendation ? null
    : `Heute erfüllt kein Trader alle Bedingungen.` + (lastRecommended ? ` Wenn Sie ${lastRecommended.userName} kopieren: Kopie pausieren, bis wieder eine Empfehlung erscheint.` : "");
  const today = new Date().toISOString().slice(0, 10);
  const history = [...((prev && prev.history) || []).filter(h => h.date !== today), { date: today, userName: recommendation ? recommendation.userName : null }].slice(-60);

  const out = clean({
    updated: new Date().toISOString(), source, totalAvailable: total ?? null,
    screened: users.length, evaluated: withData.length, avgCorrelation: rho, nEff,
    qualifiedCount: qualified.length, config: CONFIG,
    recommendation, notice, lastRecommended, top, history,
  });
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(out, null, 2) + "\n");

  log(`Ausgewertet: ${withData.length} Trader, mittlere Korrelation ${rho.toFixed(2)}, effektiv N = ${nEff.toFixed(1)}, sicher: ${qualified.length}`);
  for (const r of top.slice(0, 5)) log(`#${r.rank} ${r.userName}: Sicherheit ${(r.dsr * 100).toFixed(1)} %, Rendite p.a. ${r.cagr.toFixed(1)} %, Drawdown ${r.mdd.toFixed(1)} %${r.qualified ? " ✓" : ""}`);
  log(recommendation ? `Tagesempfehlung: ${recommendation.userName} (${recommendation.note})` : notice);
}

main().catch(e => { console.log(`::error::${redact(e.message)}`); process.exit(1); });

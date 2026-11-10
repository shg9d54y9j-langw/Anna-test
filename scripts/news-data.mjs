// Nachrichten mit Einordnung (GitHub Actions, an Börsentagen 4×): Marktnachrichten und Firmennachrichten der US-Aktien
// aus den Aktien-Daten, von Finnhub (Secret FINNHUB_API_KEY, kostenloser Tarif). Jede Meldung bekommt einen Nachrichtentyp
// (Zahlen über/unter Erwartung, Prognose, Hoch-/Herabstufung, Übernahme, Rückkauf, Kapitalerhöhung, Klage, Zulassung, Zinsen,
// Inflation …) – die Website erklärt damit, was die Meldung bedeutet. Geholt wird für alle US-Aktien, nicht nur für ein Depot:
// Depot und Merkliste bleiben im Browser. Veröffentlicht werden Schlagzeile, Quelle, Zeit, Link und die Kurzfassung der Quelle.
// Der Schlüssel geht nur an finnhub.io.
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const here = p => fileURLToPath(new URL(p, import.meta.url));
const KEY = process.env.FINNHUB_API_KEY || "";
const BASE = (process.env.FINNHUB_BASE || "https://finnhub.io/api/v1").replace(/\/$/, "");
const STOCKS = process.env.STOCKS_IN || here("../data/stocks.json");
const OUT = process.env.NEWS_OUT || here("../data/news");
const THROTTLE = Number(process.env.FINNHUB_THROTTLE_MS ?? 1100);   // kostenlos: 60 Abfragen pro Minute
const DAYS = Number(process.env.NEWS_DAYS || 7);
const LIMIT = Number(process.env.NEWS_LIMIT || 600);
export const PER_SYM = 6;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(...a);
if (!["finnhub.io", "localhost", "127.0.0.1"].includes(new URL(BASE).hostname)) { console.log("::error::Unzulässige Finnhub-Adresse – der Schlüssel geht nur an finnhub.io."); process.exit(1); }

async function finnhub(path, params) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("token", KEY);
  for (let attempt = 0; attempt < 3; attempt++) {
    await sleep(THROTTLE);
    const res = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(20000) });
    if (res.status === 429) { await sleep(20000); continue; }
    if (!res.ok) { const e = new Error(`Finnhub ${path}: HTTP ${res.status}`); e.status = res.status; throw e; }   // Adresse mit Schlüssel nie ausgeben
    return res.json();
  }
  throw new Error(`Finnhub ${path}: dauerhaft über der Minutengrenze`);
}

// ---------- Einordnung nach Nachrichtentyp (englische Schlagzeilen) ----------
// Reihenfolge = Vorrang: Warnungen vor guten Nachrichten, Konkretes vor Allgemeinem.
export const RULES = [
  ["guidance_down", "neg", /\b(cut|cuts|lower|lowers|lowered|slash|slashes|reduce|reduces|trim|trims|withdraw|withdraws)\b[^.]{0,40}\b(guidance|outlook|forecast)\b|\b(weak|disappointing|soft)\s+(guidance|outlook|forecast)\b/i],
  ["earnings_miss", "neg", /\b(miss|misses|missed|falls? short of|fell short of|below)\b[^.]{0,40}\b(estimates?|expectations?|forecasts?|consensus)\b/i],
  ["rejection", "neg", /\b(FDA|EMA)\b[^.]{0,40}\b(rejects?|declines?|complete response letter)\b|\bfails?\b[^.]{0,20}\b(trial|study)\b|\bCRL\b/i],
  ["downgrade", "neg", /\bdowngrade[sd]?\b|\b(cut|lowered)\s+to\s+(sell|underperform|underweight|neutral|hold|equal[- ]weight)\b/i],
  ["bankruptcy", "neg", /\b(bankruptcy|chapter 11|insolvency|insolvent)\b/i],
  ["legal", "neg", /\b(lawsuit|sues|sued|probe|investigation|antitrust|class action|subpoena|indicted|charges? against|fined|penalty|settles?|settlement)\b/i],
  ["offering", "neg", /\b(stock|share|equity|secondary|public)\s+offering\b|\bprices?\b[^.]{0,30}\boffering\b|\bconvertible (notes|senior notes)\b|\bshare sale\b/i],
  ["guidance_up", "pos", /\b(raise|raises|raised|lift|lifts|boost|boosts|hike|hikes|ups)\b[^.]{0,40}\b(guidance|outlook|forecast)\b/i],
  ["earnings_beat", "pos", /\btop\s+(estimates|expectations|forecasts|consensus|views)\b|\b(tops|topped|beat|beats|beating|exceed|exceeds|exceeded|surpass|surpasses|surpassed)\b[^.]{0,40}\b(estimates?|expectations?|forecasts?|consensus|views?)\b|\brecord (revenue|profit|quarter|sales)\b/i],
  ["approval", "pos", /\b(FDA|EMA)\b[^.]{0,40}\b(approv\w*|clear\w*|authoriz\w*)\b|\bwins? approval\b/i],
  ["upgrade", "pos", /\bupgrade[sd]?\b|\braised to (buy|outperform|overweight)\b/i],
  ["merger", "neu", /\b(acquire|acquires|acquired|acquisition|takeover|buyout|merger|merge|merges)\b|\b(agrees?|agreed|deal|plans?|offers?|bids?)\s+to\s+buy\b|\bto buy\b[^.]{0,40}\bfor \$[\d.,]+\s*(billion|million|bn|m)\b/i],
  ["buyback", "pos", /\b(buyback|repurchase)\b/i],
  ["dividend", "neu", /\bdividend\b/i],
  ["layoffs", "neu", /\b(layoffs?|lay off|job cuts|restructuring)\b|\bcut(s|ting)?\b[^.]{0,30}\b(jobs|workforce|staff|employees)\b/i],
  ["management", "neu", /\b(CEO|CFO|chief executive|chairman)\b[^.]{0,40}\b(steps? down|resigns?|depart\w*|retires?|named|appoint\w*|replac\w*|ousted)\b/i],
  ["price_target", "neu", /\bprice target\b/i],
  ["contract", "pos", /\b(contract|partnership|partners with|agreement with|deal with|collaborat\w+|order from)\b/i],
  ["product", "neu", /\b(launch|launches|unveil|unveils|introduces|debuts)\b/i],
  ["earnings", "neu", /\b(earnings|quarterly results|q[1-4] results|(first|second|third|fourth)[- ]quarter|eps|revenue)\b/i],
  ["macro_rates", "neu", /\b(fed|federal reserve|fomc|rate cuts?|rate hikes?|interest rates?|powell|ecb|lagarde|central bank)\b/i],
  ["macro_inflation", "neu", /\b(inflation|cpi|consumer prices|pce|ppi|producer prices)\b/i],
  ["macro_jobs", "neu", /\b(jobs report|payrolls|unemployment|jobless claims|labor market)\b/i],
  ["tariffs", "neu", /\b(tariffs?|trade war|export controls?|sanctions?)\b/i],
  ["oil", "neu", /\b(oil|opec|crude|brent)\b/i],
  ["crypto", "neu", /\b(bitcoin|crypto\w*|ethereum)\b/i],
];
// Marktnachrichten (ohne einzelne Firma): Zinsen, Inflation, Arbeitsmarkt usw. gehen vor – „Payrolls beat forecasts“ ist keine Firmenzahl
const MACRO = ["macro_rates", "macro_inflation", "macro_jobs", "tariffs", "oil", "crypto"];
// Eindeutige Makro-Wörter gehen immer vor (auch in Firmennachrichten: „Fed rate hike outlook, Bank of America says“)
const STRONG_MACRO = /\b(fed|federal reserve|fomc|powell|inflation|cpi|payrolls|jobless claims|ecb)\b/i;
export function classify(headline, summary = "", macroFirst = false) {
  const h = String(headline || "");
  if (macroFirst || STRONG_MACRO.test(h)) for (const [type, tone, re] of RULES) if (MACRO.includes(type) && re.test(h)) return { type, tone };
  const hit = rules => rules.find(([, , re]) => re.test(h));
  // Sammelmeldung mit Hoch- und Herabstufungen zugleich: keines von beiden
  if (/\bupgrade/i.test(h) && /\bdowngrade/i.test(h)) return { type: "general", tone: "neu" };
  // Frage-Schlagzeilen („Will X beat estimates?“) sind Vorschauen, keine Ergebnisse
  if (/\?\s*$/.test(h) || /^(will|can|could|should|is|are|does)\b/i.test(h)) {
    const r = hit(RULES);
    if (r && ["earnings_beat", "earnings_miss", "guidance_up", "guidance_down"].includes(r[0])) return { type: "earnings", tone: "neu" };
  }
  for (const [type, tone, re] of RULES) if (re.test(h)) return { type, tone: adjustTone(type, tone, h) };
  // erst die Schlagzeile, dann die Kurzfassung (dort nur die eindeutigen Typen)
  const s = String(summary || "").slice(0, 300);
  for (const [type, tone, re] of RULES) if (!["contract", "product", "earnings", "merger", "dividend"].includes(type) && re.test(s)) return { type, tone: adjustTone(type, tone, s) };
  return { type: "general", tone: "neu" };
}
function adjustTone(type, tone, text) {
  if (type === "price_target" || type === "dividend") {
    if (/\b(raise[sd]?|lifts?|boosts?|hikes?|increase[sd]?|ups)\b/i.test(text)) return "pos";
    if (/\b(cut|cuts|lower\w*|slash\w*|reduce[sd]?|suspend\w*|trims?)\b/i.test(text)) return "neg";
  }
  return tone;
}
// Nennt die Schlagzeile die Firma? Kürzel als eigenes Wort (Großschreibung) oder das erste Wort des Namens (ab 3 Buchstaben)
export function mentions(headline, sym, name) {
  const h = String(headline || "");
  if (!sym) return true;
  const base = String(sym).split(".")[0];
  if (base.length >= 2 && new RegExp(`(^|[^A-Za-z0-9])${base.replace(/[^A-Z0-9]/g, "")}([^A-Za-z0-9]|$)`).test(h)) return true;
  // erstes Wort des Namens; ist es allgemein („Bank“, „Advanced“ …), die ersten zwei oder drei Wörter („Bank of America“)
  const words = String(name || "").replace(/[^A-Za-z0-9 &-]/g, " ").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return false;
  const phrase = GENERIC.has(words[0].toLowerCase()) && words[1] ? words.slice(0, words[1].toLowerCase() === "of" || words[1] === "&" ? 3 : 2).join(" ") : words[0];
  return phrase.replace(/[^A-Za-z0-9]/g, "").length >= 3 && new RegExp(`\\b${phrase.replace(/[^A-Za-z0-9 &]/g, "").replace(/\s+/g, "\\s+")}`, "i").test(h);
}
const GENERIC = new Set(["bank", "the", "first", "general", "american", "united", "national", "global", "international", "advanced", "applied", "digital", "royal", "new", "great", "north", "south", "west", "east", "southern", "northern", "western", "eastern", "public", "energy", "real", "pacific", "atlantic", "china", "us", "u", "british", "canadian", "deutsche", "banco", "grupo", "sea", "super"]);
// ---------- Aufbereiten: nur Text, nur http(s)-Links, ohne Doppelte, neueste zuerst ----------
const clean = (s, n) => String(s || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/\s+/g, " ").trim().slice(0, n);
export function prepare(rows, { from, to, max = PER_SYM, sym = null, name = "", macroFirst = false } = {}) {
  const seen = new Set(), out = [];
  const list = (Array.isArray(rows) ? rows : []).filter(r => r && Number.isFinite(r.datetime) && r.datetime >= from && r.datetime <= to && /^https?:\/\/[^\s"<>]+$/.test(r.url || "") && clean(r.headline, 300))
    .sort((a, b) => b.datetime - a.datetime);
  for (const r of list) {
    const t = clean(r.headline, 300), k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    // Nennt die Schlagzeile die Firma nicht, ist es meist ein Sammelartikel: Kurzfassung nicht auswerten, Marktthemen zuerst
    const m = mentions(t, sym, name), sum = clean(r.summary, 400), c = classify(t, m ? sum : "", macroFirst || !m);
    const rel = [...new Set([sym, ...String(r.related || "").split(",")].map(s => String(s || "").trim().toUpperCase()).filter(s => /^[A-Z0-9][A-Z0-9.\-]{0,11}$/.test(s)))].slice(0, 6);
    out.push({ id: String(r.id || `${r.datetime}-${out.length}`).slice(0, 24), t, s: clean(r.source, 60), u: r.url, d: r.datetime, sum, type: c.type, tone: c.tone, rel, m: m ? 1 : 0 });
  }
  // Meldungen über die Firma zuerst (neueste zuerst), dann bloße Erwähnungen
  return [...out.filter(n => n.m), ...out.filter(n => !n.m)].slice(0, max);
}

async function main() {
  if (!KEY) { log("::warning::Kein FINNHUB_API_KEY – Nachrichten übersprungen."); return; }
  const stocks = JSON.parse(await readFile(STOCKS, "utf8"));
  const items = (stocks.items || []).filter(x => x.type === "Aktie" && typeof x.sym === "string" && !x.sym.includes("."));
  const syms = items.map(x => x.sym).slice(0, LIMIT);
  const names = new Map(items.map(x => [x.sym, x.name]));
  if (syms.length < 20) throw new Error(`Zu wenige US-Aktien in den Aktien-Daten (${syms.length})`);
  const now = Math.floor(Date.now() / 1000), from = now - DAYS * 86400, day = s => new Date(s * 1000).toISOString().slice(0, 10);
  const errors = [];
  // Marktnachrichten: allgemein und Übernahmen
  let market = [];
  for (const category of ["general", "merger"]) {
    try { market = market.concat(await finnhub("/news", { category })); } catch (e) { errors.push(`Markt ${category}: ${e.message}`); }
  }
  const marketList = prepare(market, { from: now - 3 * 86400, to: now + 3600, max: 60, macroFirst: true });
  // Firmennachrichten je Aktie
  const per = {};
  for (const sym of syms) {
    try {
      const rows = await finnhub("/company-news", { symbol: sym, from: day(from), to: day(now) });
      const l = prepare(rows, { from, to: now + 3600, sym, name: names.get(sym) });
      if (l.length) per[sym] = l;
    } catch (e) { if (e.status === 401 || e.status === 403) { errors.push(`Firmennachrichten im Tarif nicht enthalten (HTTP ${e.status})`); break; } errors.push(`${sym}: ${e.message}`); }
  }
  // Bewegte Aktien: die neueste eingeordnete Meldung der Werte mit den größten Tagesbewegungen
  const move = new Map(items.map(x => [x.sym, Math.abs(x.chg1d || 0)]));
  const hot = Object.entries(per).map(([sym, l]) => ({ sym, n: l.find(n => n.m && n.type !== "general") })).filter(o => o.n)
    .sort((a, b) => (move.get(b.sym) || 0) - (move.get(a.sym) || 0)).slice(0, 40).map(o => ({ ...o.n, rel: [o.sym, ...o.n.rel.filter(s => s !== o.sym)].slice(0, 6) }));
  await rm(OUT, { recursive: true, force: true });
  await mkdir(join(OUT, "co"), { recursive: true });
  for (const [sym, l] of Object.entries(per)) await writeFile(join(OUT, "co", `${sym}.json`), JSON.stringify({ sym, items: l }));
  const out = { updated: new Date().toISOString(), source: "Finnhub (Markt- und Firmennachrichten); Einordnung nach Nachrichtentyp durch diese Seite", days: DAYS,
    count: Object.keys(per).length, syms: Object.keys(per), errors: errors.slice(0, 20), market: marketList, hot };
  await writeFile(join(OUT, "news.json"), JSON.stringify(out));
  const types = {};
  for (const l of [marketList, ...Object.values(per)]) for (const n of l) types[n.type] = (types[n.type] || 0) + 1;
  log(`Nachrichten: ${marketList.length} Markt, ${Object.keys(per).length} von ${syms.length} Aktien mit Firmennachrichten, ${errors.length} Fehler`);
  log(`Typen: ${Object.entries(types).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ")}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(e => { console.log(`::error::Nachrichten: ${e.message}`); process.exit(1); });
}

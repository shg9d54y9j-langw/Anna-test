// Note-Bilanz (GitHub Actions, im Lauf der Aktien-Daten): merkt sich an jedem Börsentag die Gesamtnote aller Aktien
// (note-history.json) und misst danach mit den Tageskerzen, wie die Aktien je Notenstufe gelaufen sind (note-track.json).
//  - Gemessen wird ab dem Schlusskurs des Tages, an dem die Note entstand – also nur mit Kursen, die danach kamen.
//  - Die Note rechnet dieselbe Datei wie die Website (score.js), damit beide gleich zählen.
//  - Veröffentlicht werden nur Noten und Durchschnitte, keine Kursreihen. Die Tageskerzen kommen aus einer Datei, die
//    stock-universe.mjs nur auf dem Rechner des Laufs ablegt (CLOSES_IN) und die nicht hochgeladen wird.
//  - Sind die bisherigen Noten nicht lesbar, wird nichts geschrieben: Die Veröffentlichung übernimmt dann den alten Stand.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import vm from "node:vm";

const here = p => fileURLToPath(new URL(p, import.meta.url));
const env = process.env;
const REPO = env.GITHUB_REPOSITORY || "shg9d54y9j-langw/Anna-test";
const RAW = `https://raw.githubusercontent.com/${REPO}`;
const log = m => console.log(m), warn = m => console.log(`::warning::${m}`);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fin = Number.isFinite;
const r2 = x => (fin(x) ? Math.round(x * 100) / 100 : null);
const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
const median = a => { const v = [...a].sort((x, y) => x - y), n = v.length; return n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2; };

export const CAP = 260;   // rund ein Jahr Börsentage
export const GROUPS = [
  { k: "80", lo: 80, hi: 101, label: "80–100", name: "sehr stark" },
  { k: "60", lo: 60, hi: 80, label: "60–79", name: "stark" },
  { k: "40", lo: 40, hi: 60, label: "40–59", name: "durchschnittlich" },
  { k: "20", lo: 20, hi: 40, label: "20–39", name: "schwach" },
  { k: "0", lo: 0, hi: 20, label: "0–19", name: "sehr schwach" },
];
export const HORIZONS = [{ h: 5, label: "1 Woche" }, { h: 21, label: "1 Monat" }, { h: 63, label: "3 Monate" }];
const groupOf = n => GROUPS.find(g => n >= g.lo && n < g.hi) || null;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

// Gesamtnote je Aktie mit score.js der Website (in einer abgeschotteten Umgebung ohne Netz und Dateien)
export function computeNotes(stocks, fund, src) {
  const shared = { get: k => (k === "stocks" ? stocks : k === "fund" ? fund : null), item: () => null, fund: () => null, load: () => Promise.resolve(null) };
  const ctx = vm.createContext({ window: { DTD: { shared } } });
  vm.runInContext(src, ctx, { filename: "score.js", timeout: 20000 });
  const table = ctx.window.DTD.scoreAll();
  const type = new Map((stocks.items || []).map(x => [x.sym, x.type]));
  const notes = {};
  if (table) for (const [sym, s] of table) if (type.get(sym) === "Aktie" && fin(s.note)) notes[sym] = s.note;
  return notes;
}

// Momentaufnahme des Tages anhängen (ein Eintrag je Tag – ein späterer Lauf am selben Tag ersetzt den früheren)
export function addSnapshot(hist, date, notes, cap = CAP) {
  const old = hist && Array.isArray(hist.snaps) ? hist.snaps : [];
  const snaps = old.filter(s => s && DAY.test(s.d) && s.n && typeof s.n === "object" && s.d !== date);
  snaps.push({ d: date, n: notes });
  snaps.sort((a, b) => (a.d < b.d ? -1 : 1));
  return { v: 1, updated: new Date().toISOString(), snaps: snaps.slice(-cap) };
}

// erster Index mit Datum ≥ d (Kerzen aufsteigend sortiert), sonst -1
function atOrAfter(list, d) {
  let lo = 0, hi = list.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (list[m][0] < d) lo = m + 1; else hi = m; }
  return lo < list.length ? lo : -1;
}
// Börsentage (Mo–Fr) nach einem Datum – für „erste Bilanz voraussichtlich am …“ (Feiertage nicht berücksichtigt)
export function addWeekdays(iso, n) {
  const t = new Date(`${iso}T12:00:00Z`);
  while (n > 0) { t.setUTCDate(t.getUTCDate() + 1); const wd = t.getUTCDay(); if (wd !== 0 && wd !== 6) n--; }
  return t.toISOString().slice(0, 10);
}

// Auswertung: je Zeitraum und Notenstufe die durchschnittliche Rendite, der Vorsprung gegenüber dem Schnitt aller Aktien
// desselben Tages, die Trefferquote (Anteil über dem Median) und an wie vielen Messtagen die Stufe vorne lag. Dazu Körbe
// je Stufe, an jedem Messtag neu zusammengestellt (vom Schlusskurs eines Messtags bis zum nächsten).
export function evaluate(hist, closes, today, { minStocks = 50, minGroup = 5 } = {}) {
  const snaps = (hist && Array.isArray(hist.snaps) ? hist.snaps : []).filter(s => s && DAY.test(s.d) && s.n).sort((a, b) => (a.d < b.d ? -1 : 1));
  const C = new Map();
  for (const [sym, list] of Object.entries(closes || {})) {
    if (!Array.isArray(list)) continue;
    const l = list.filter(x => Array.isArray(x) && DAY.test(x[0]) && x[0] < today && fin(x[1]) && x[1] > 0).sort((a, b) => (a[0] < b[0] ? -1 : 1));
    if (l.length) C.set(sym, l);
  }
  const keys = [...GROUPS.map(g => g.k), "all"];
  const horizons = HORIZONS.map(H => {
    const acc = Object.fromEntries(keys.map(k => [k, { sum: 0, rel: 0, obs: 0, hits: 0, days: 0, win: 0 }]));
    let first = null, last = null;
    for (const s of snaps) {
      const rets = [];
      for (const [sym, note] of Object.entries(s.n)) {
        const l = C.get(sym);
        if (!l || !fin(note)) continue;
        const i = atOrAfter(l, s.d);
        if (i < 0 || i + H.h >= l.length) continue;
        rets.push({ g: groupOf(note), r: (l[i + H.h][1] / l[i][1] - 1) * 100 });
      }
      if (rets.length < minStocks) continue;
      const all = rets.map(x => x.r), mAll = mean(all), med = median(all);
      const A = acc.all;
      A.sum += mAll; A.obs += all.length; A.days++; A.hits += all.filter(r => r > med).length;
      for (const g of GROUPS) {
        const rs = rets.filter(x => x.g === g).map(x => x.r);
        if (rs.length < minGroup) continue;
        const a = acc[g.k], m = mean(rs);
        a.sum += m; a.rel += m - mAll; a.obs += rs.length; a.hits += rs.filter(r => r > med).length; a.days++;
        if (m > mAll) a.win++;
      }
      first = first || s.d; last = s.d;
    }
    const out = k => { const a = acc[k]; return a.days ? { avg: r2(a.sum / a.days), rel: k === "all" ? 0 : r2(a.rel / a.days), hit: Math.round(a.hits / a.obs * 100), obs: a.obs, days: a.days, win: k === "all" ? null : a.win } : null; };
    return {
      h: H.h, label: H.label, days: acc.all.days, from: first, to: last,
      all: out("all"), g: Object.fromEntries(GROUPS.map(g => [g.k, out(g.k)])),
      // Vorsprung der besten gegenüber der schwächsten Stufe
      spread: acc["80"].days && acc["0"].days ? r2(acc["80"].sum / acc["80"].days - acc["0"].sum / acc["0"].days) : null,
      firstAt: snaps.length ? addWeekdays(snaps[0].d, H.h + 1) : null,
    };
  });
  // Körbe: beste Stufe, alle Aktien, schwächste Stufe – Wert in % seit dem ersten Messtag
  const curve = { dates: [], top: [], all: [], low: [] };
  const eq = { top: 1, all: 1, low: 1 };
  let lastDay = "";
  for (const l of C.values()) if (l[l.length - 1][0] > lastDay) lastDay = l[l.length - 1][0];
  for (let k = 0; k < snaps.length; k++) {
    const s = snaps[k], next = snaps[k + 1];
    const r = { top: [], all: [], low: [] };
    for (const [sym, note] of Object.entries(s.n)) {
      const l = C.get(sym);
      if (!l || !fin(note)) continue;
      const i = atOrAfter(l, s.d);
      if (i < 0) continue;
      let j = next ? atOrAfter(l, next.d) : l.length - 1;
      if (j < 0) j = l.length - 1;
      if (j <= i) continue;
      const x = (l[j][1] / l[i][1] - 1) * 100;
      r.all.push(x);
      if (note >= 80) r.top.push(x);
      if (note < 20) r.low.push(x);
    }
    if (r.all.length < minStocks || r.top.length < minGroup || r.low.length < minGroup) continue;
    if (!curve.dates.length) { curve.dates.push(s.d); curve.top.push(0); curve.all.push(0); curve.low.push(0); }
    for (const key of ["top", "all", "low"]) { eq[key] *= 1 + mean(r[key]) / 100; curve[key].push(r2((eq[key] - 1) * 100)); }
    curve.dates.push(next && next.d <= lastDay ? next.d : lastDay);
  }
  const lastSnap = snaps[snaps.length - 1];
  return {
    updated: new Date().toISOString(), since: snaps.length ? snaps[0].d : null, days: snaps.length, last: lastSnap ? lastSnap.d : null,
    stocks: lastSnap ? Object.keys(lastSnap.n).length : 0,
    groups: GROUPS.map(g => ({ k: g.k, label: g.label, name: g.name, now: lastSnap ? Object.values(lastSnap.n).filter(n => groupOf(n) === g).length : 0 })),
    horizons, curve,
  };
}

// Notenverlauf je Aktie für die Seite (klein): Note der letzten Momentaufnahme und der Momentaufnahmen davor –
// d1 = vorherige, w1 = mindestens 7 Tage, m1 = mindestens 30 Tage, m3 = mindestens 91 Tage vor der letzten.
export function recent(hist) {
  const snaps = (hist && Array.isArray(hist.snaps) ? hist.snaps : []).filter(s => s && DAY.test(s.d) && s.n).sort((a, b) => (a.d < b.d ? -1 : 1));
  if (!snaps.length) return { dates: {}, n: {} };
  const last = snaps[snaps.length - 1], t = Date.parse(`${last.d}T12:00:00Z`);
  const before = days => { const lim = new Date(t - days * 864e5).toISOString().slice(0, 10); for (let i = snaps.length - 2; i >= 0; i--) if (snaps[i].d <= lim) return snaps[i]; return null; };
  const lag = { now: last, d1: snaps.length > 1 ? snaps[snaps.length - 2] : null, w1: before(7), m1: before(30), m3: before(91) };
  const keys = ["now", "d1", "w1", "m1", "m3"];
  const n = {};
  for (const sym of Object.keys(last.n)) n[sym] = keys.map(k => (lag[k] && fin(lag[k].n[sym]) ? lag[k].n[sym] : null));
  return { updated: new Date().toISOString(), dates: Object.fromEntries(keys.map(k => [k, lag[k] ? lag[k].d : null])), keys, n };
}

async function getJson(url, tries = 3) {
  const u = new URL(url);
  if (!["raw.githubusercontent.com", "localhost", "127.0.0.1"].includes(u.hostname)) throw new Error(`Unzulässige Adresse ${u.hostname}`);
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(`${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`, { signal: AbortSignal.timeout(30000) });
      if (r.status === 404) return { missing: true };
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return { data: await r.json() };
    } catch (e) { if (i >= tries) throw e; await sleep(i * 3000); }
  }
}
// Datei oder Adresse lesen; fehlende Datei = noch keine Daten
async function source(file, url) {
  if (file) { try { return { data: JSON.parse(await readFile(file, "utf8")) }; } catch (e) { if (e.code === "ENOENT") return { missing: true }; throw e; } }
  return getJson(url);
}

async function main() {
  const today = env.NOTE_TODAY || new Date().toISOString().slice(0, 10);
  const minStocks = Number(env.NOTE_MIN_STOCKS || 50), minGroup = Number(env.NOTE_MIN_GROUP || 5);
  const stocks = JSON.parse(await readFile(env.STOCKS_IN || here("../data/stocks.json"), "utf8"));
  if (!env.CLOSES_IN) { warn("Keine Tageskerzen (CLOSES_IN) – Note-Bilanz übersprungen."); return; }
  let closes;
  try { closes = JSON.parse(await readFile(env.CLOSES_IN, "utf8")).items; } catch (e) { warn(`Tageskerzen nicht lesbar (${e.message}) – Note-Bilanz übersprungen.`); return; }
  let hist;
  try {
    const r = await source(env.HISTORY_IN, env.HISTORY_URL || `${RAW}/stock-data/note-history.json`);
    hist = r.missing ? { snaps: [] } : r.data;
    if (r.missing) log("Noch keine Noten gespeichert – die Bilanz beginnt heute.");
  } catch (e) { warn(`Bisherige Noten nicht lesbar (${e.message}) – nichts geschrieben, der alte Stand bleibt.`); return; }
  if (!hist || !Array.isArray(hist.snaps)) { warn("Bisherige Noten im falschen Format – nichts geschrieben, der alte Stand bleibt."); return; }
  let fund = null;
  try { const r = await source(env.FUND_IN, env.FUND_URL || `${RAW}/fund-data/fund.json`); fund = r.data || null; } catch (e) { warn(`Kennzahlen (fund.json) nicht lesbar: ${e.message}`); }
  const before = hist.snaps.length;
  if (fund && fund.items && Array.isArray(stocks.items)) {
    const notes = computeNotes(stocks, fund, await readFile(env.SCORE_JS || here("../score.js"), "utf8"));
    const n = Object.keys(notes).length;
    if (n >= minStocks) { hist = addSnapshot(hist, today, notes); log(`Momentaufnahme ${today}: Noten für ${n} Aktien.`); }
    else warn(`Nur ${n} Aktien mit Note – heute keine Momentaufnahme.`);
  } else warn("Ohne Kennzahlen (fund.json) heute keine Momentaufnahme – die Bilanz rechnet mit den bisherigen.");
  const track = evaluate(hist, closes, today, { minStocks, minGroup });
  const hOut = env.HISTORY_OUT || here("../data/note-history.json"), tOut = env.TRACK_OUT || here("../data/note-track.json"), rOut = env.RECENT_OUT || here("../data/note-recent.json");
  for (const f of [hOut, tOut, rOut]) await mkdir(dirname(f), { recursive: true });
  await writeFile(hOut, JSON.stringify(hist));
  await writeFile(tOut, JSON.stringify(track));
  await writeFile(rOut, JSON.stringify(recent(hist)));
  const h = track.horizons.map(x => `${x.label}: ${x.days ? `${x.days} Messtage, Note 80+ ${x.g["80"] ? `${x.g["80"].rel >= 0 ? "+" : ""}${x.g["80"].rel}` : "–"} Punkte gegenüber dem Schnitt` : `ab ${x.firstAt}`}`).join(" · ");
  log(`Note-Bilanz: ${hist.snaps.length} Messtage (vorher ${before}), seit ${track.since}. ${h}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(e => { console.log(`::warning::Note-Bilanz: ${e.message}`); process.exit(0); });
}

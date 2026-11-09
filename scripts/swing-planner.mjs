// Swing-Planer: langfristige Swing-Trades (2–12 Monate) aus Theorie und Kurs. Läuft nach den Aktien-Daten, ohne Schlüssel.
// Eingaben: stocks.json (Tageskennzahlen), firms.json (Firmen-Steckbriefe der Theorie-Seite) und das bisherige swing.json
// (Papier-Bilanz). Ausgabe: swing.json – je Firma Zustand, Kauf, Stop Loss, Trailing-Stop und Teilziel; Rückenwind je Theorie;
// starke Aktien ohne Steckbrief („Neu entdeckt“); eine Papier-Bilanz aller Kaufsignale.
//
// Feste Regeln, vorab festgelegt und nicht auf gute Ergebnisse getrimmt:
//  - Gekauft wird nur im Aufwärtstrend: Kurs über dem 200-Tage-Schnitt, 50er über dem 200er, Momentum (12 bis 1 Monat) positiv.
//    Momentum hält im Schnitt 3–12 Monate an (Jegadeesh & Titman 1993), besonders nahe am 52-Wochen-Hoch (George & Hwang 2004).
//  - Kaufzone: 50-Tage-Schnitt − 0,5 bis + 2 Tagesspannen (ATR), am Jahreshoch bis + 3 ATR. Darüber ist der Kurs überhitzt:
//    Kauf-Order an der Obergrenze der Zone. eToro-Orders kaufen nur unter dem aktuellen Kurs – Käufe über dem Kurs
//    (Ausbruch über das Jahreshoch, Rückkehr über den 50er) deshalb per Kursalarm.
//  - Stop 3 ATR unter dem Kauf, Trailing-Stop mit demselben Abstand (so arbeitet eToros Trailing Stop Loss). Ein Stop um 10 %
//    hat Momentum-Crashs stark gedämpft (Han, Zhou & Zhu, Arbeitspapier, vor Kosten); Stops helfen, wenn Kurse Trends haben
//    (Kaminski & Lo 2014).
//  - Die Hälfte mit Gewinnziel bei 2 × Risiko (6 ATR), die andere ohne Ziel nur mit Trailing-Stop: Anleger verkaufen
//    Gewinner sonst zu früh (Shefrin & Statman 1985).
//  - Läge der Stop weiter als 20 % entfernt, ist die Aktie zu unruhig: abwarten (Momentum bricht vor allem in unruhigen Phasen
//    ein, Barroso & Santa-Clara 2015). Mehr als 3 ATR unter dem 50er ist der Trend beschädigt: nur beobachten.
//  - Quartalszahlen in den nächsten 10 Tagen: neue Käufe erst danach. Verkauf, wenn der Kurs unter den 200-Tage-Schnitt fällt;
//    spätestens nach 12 Monaten neu bewerten.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const here = p => fileURLToPath(new URL(p, import.meta.url));
export const RULES = {
  zoneLow: -0.5, zoneHigh: 2, extended: 3,   // Kaufzone in ATR um den 50-Tage-Schnitt; mehr als 3 ATR darüber: überhitzt
  atHigh: -0.5, nearHigh: -3,                // am Jahreshoch (höchstens 0,5 % darunter) / nahe dran (höchstens 3 %)
  stopAtr: 3, targetR: 2, maxStopPct: 20,    // Stop 3 ATR unter dem Kauf, Teilziel bei 2 × Risiko; Stop weiter als 20 %: zu schwankungsreich
  reclaimMax: -3,                            // mehr als 3 ATR unter dem 50er: Trend beschädigt, nur beobachten
  earnDays: 10, maxDays: 365, cost: 0.3,     // Pause vor Quartalszahlen, Höchstdauer, Kosten hin und zurück in %
  maxOpen: 20, cooldownDays: 14, keepClosed: 300,
  scanMinRank: 90, scanMaxBelowHigh: -10, scanMinAtrPct: 1, scanMaxAtrPct: 6, scanMinBuy: 0.55, scanTop: 8, minAnalysts: 5,
};
export const ACTIVE = ["buy", "wait", "alert"];
const STATE_ORDER = { buy: 0, wait: 1, alert: 2, watch: 3, avoid: 4, nodata: 5 };

const r2 = x => (Number.isFinite(x) ? Math.round(x * 100) / 100 : null);
const r4 = x => (Number.isFinite(x) ? Math.round(x * 10000) / 10000 : null);
export const px = x => (!Number.isFinite(x) ? null : x >= 1 ? Math.round(x * 100) / 100 : Math.round(x * 10000) / 10000);
const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
const median = a => {
  const s = a.filter(Number.isFinite).sort((x, y) => x - y);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
export const days = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 864e5);
const total = r => (r ? (r.sb | 0) + (r.b | 0) + (r.h | 0) + (r.s | 0) + (r.ss | 0) : 0);
const buyShare = r => (total(r) ? ((r.sb | 0) + (r.b | 0)) / total(r) : null);
export const avgFrom = (last, dist) => (Number.isFinite(last) && Number.isFinite(dist) ? last / (1 + dist / 100) : null);

// Trend aus den Abständen zu den Durchschnitten: up = Kauf erlaubt, down = Finger weg, flat = noch nicht bestätigt
export function trend(x) {
  const s50 = avgFrom(x.last, x.d50), s200 = avgFrom(x.last, x.d200);
  if (![x.last, x.atr, s50, s200].every(Number.isFinite) || !(x.atr > 0) || !(x.last > 0)) return { kind: "nodata", s50, s200 };
  const momUp = Number.isFinite(x.mom) && x.mom > 0, momDown = Number.isFinite(x.mom) && x.mom < 0;
  if (x.d200 > 0 && s50 > s200 && momUp) return { kind: "up", s50, s200 };
  if (x.d200 < 0 && (s50 < s200 || momDown)) return { kind: "down", s50, s200 };
  return { kind: "flat", s50, s200 };
}
export function earnSoon(x, today) {
  const d = x.earn && x.earn.date ? days(today, x.earn.date) : null;
  return d !== null && d >= 0 && d <= RULES.earnDays ? x.earn.date : null;
}
// Zustand und Einstellungen für eine Aktie
export function setupFor(x, today) {
  const t = trend(x);
  const out = { state: { nodata: "nodata", down: "avoid", flat: "watch", up: null }[t.kind], s50: px(t.s50), s200: px(t.s200) };
  if (t.kind === "up") {
    const ext = (x.last - t.s50) / x.atr;
    let E;
    out.ext = r2(ext);
    if (ext >= RULES.zoneLow && (ext <= RULES.zoneHigh || (ext <= RULES.extended && x.dHi52 >= RULES.atHigh))) { out.state = "buy"; out.entryType = "market"; E = x.last; }
    else if (ext < RULES.reclaimMax) { out.state = "watch"; out.why = "correction"; }
    else if (ext < RULES.zoneLow) { out.state = "alert"; out.why = "reclaim"; out.entryType = "alert"; E = t.s50; }
    else if (ext <= RULES.extended && x.dHi52 >= RULES.nearHigh && Number.isFinite(x.hi52)) { out.state = "alert"; out.why = "high"; out.entryType = "alert"; E = Math.max(x.hi52, x.last); }
    else { out.state = "wait"; out.entryType = "limit"; E = t.s50 + RULES.zoneHigh * x.atr; }
    const risk = RULES.stopAtr * x.atr;
    // bei sehr hoher Schwankung lieber abwarten: Momentum bricht vor allem in unruhigen Phasen ein (Barroso & Santa-Clara 2015)
    if (E !== undefined && !(risk / E * 100 <= RULES.maxStopPct)) { out.state = "watch"; out.why = "volatile"; delete out.entryType; }
    else if (E !== undefined) Object.assign(out, { entry: px(E), stop: px(E - risk), target: px(E + RULES.targetR * risk), stopPct: r2(-risk / E * 100), targetPct: r2(RULES.targetR * risk / E * 100) });
  }
  out.earnSoon = earnSoon(x, today);
  return out;
}
function analysts(x) {
  if (!x.rec || total(x.rec) < RULES.minAnalysts) return { buy: null, nRec: x.rec ? total(x.rec) : 0, recDelta: null };
  const prev = x.recPrev && total(x.recPrev) >= RULES.minAnalysts ? buyShare(x.recPrev) : null;
  return { buy: r2(buyShare(x.rec) * 100), nRec: total(x.rec), recDelta: prev === null ? null : r2((buyShare(x.rec) - prev) * 100) };
}
// Rangfolge innerhalb eines Zustands: Momentum zählt am meisten, dann Trendstärke, Analysten und Rückenwind der Theorie
export function score(x, heat) {
  const buy = x.rec && total(x.rec) >= RULES.minAnalysts ? buyShare(x.rec) : 0.5;
  const trendQ = Math.max(0, Math.min(1, (x.d200 || 0) / 30));
  const earn = x.lastEarn && x.lastEarn.surprisePct >= 5 ? 0.05 : 0;
  return r4(0.45 * (Number.isFinite(x.momRank) ? x.momRank : 50) / 100 + 0.2 * trendQ + 0.2 * buy + 0.15 * (Number.isFinite(heat) ? heat : 0.5) + earn);
}

// Theorien der Theorie-Seite: Sparten und 1000-%-Ideen mit ihren Firmen
export function themeMembers(firms) {
  const up = list => (Array.isArray(list) ? list.map(s => String(s).toUpperCase()) : []);
  return [
    ...Object.entries(firms.sectors || {}).map(([id, list]) => ({ key: `sector:${id}`, kind: "sector", id, members: up(list) })),
    ...Object.entries(firms.moon || {}).map(([id, m]) => ({ key: `moon:${id}`, kind: "moon", id, members: up(m && m.firms) })),
  ];
}
// Rückenwind: Wie viele Firmen der Theorie sind im Aufwärtstrend, wie liefen sie in 3 Monaten
export function themeStats(members, map) {
  const xs = members.map(s => map.get(s)).filter(x => x && trend(x).kind !== "nodata");
  if (!xs.length) return { n: 0, total: members.length, up: 0, med3m: null, medMom: null, buy: null, status: "nodata", heat: null };
  const up = xs.filter(x => trend(x).kind === "up").length, share = up / xs.length;
  const med3m = median(xs.map(x => x.ret3m)), medMom = median(xs.map(x => x.momRank));
  const recs = xs.filter(x => x.rec && total(x.rec) >= RULES.minAnalysts);
  const status = share >= 0.6 && med3m > 0 ? "tail" : share <= 0.3 || med3m < -5 ? "head" : "mixed";
  return {
    n: xs.length, total: members.length, up, med3m: r2(med3m), medMom: Number.isFinite(medMom) ? Math.round(medMom) : null,
    buy: recs.length ? r2(mean(recs.map(x => buyShare(x.rec))) * 100) : null, status,
    heat: r4(0.5 * share + 0.5 * (Number.isFinite(medMom) ? medMom : 50) / 100),
  };
}
const scanOk = x => {
  if (x.type !== "Aktie" || trend(x).kind !== "up") return false;
  // kaum Bewegung (unter 1 % am Tag) heißt oft: Übernahmeangebot, der Kurs klebt am Angebotspreis – kein Swing-Trade
  if (!(x.momRank >= RULES.scanMinRank) || !(x.dHi52 >= RULES.scanMaxBelowHigh) || !(x.atrPct >= RULES.scanMinAtrPct && x.atrPct <= RULES.scanMaxAtrPct)) return false;
  return !(x.rec && total(x.rec) >= RULES.minAnalysts && buyShare(x.rec) < RULES.scanMinBuy);
};

// ---------- Papier-Bilanz: jedes Kaufsignal wird so verfolgt, als hätte man die Einstellungen genau so gesetzt ----------
const current = t => {
  const retB = (t.last / t.entry - 1) * 100, retA = t.half ? (t.half.price / t.entry - 1) * 100 : retB;
  return (retA + retB) / 2 - RULES.cost;
};
function step(t, x) {
  t.last = px(x.last);
  if (x.asOf === t.opened) return;   // die Signal-Kerze selbst: geprüft wird ab der nächsten Kerze
  const fin = (v, f) => (Number.isFinite(v) ? v : f);
  const gap = days(t.seen, x.asOf), wide = gap > 4 && days(t.opened, x.asOf) > 8;   // Läufe verpasst: Spanne der letzten 5 Kerzen
  const lo = Math.min(fin(x.lo1d, x.last), wide ? fin(x.lo5, Infinity) : Infinity);
  const hi = Math.max(fin(x.hi1d, x.last), wide ? fin(x.hi5, -Infinity) : -Infinity);
  const open = fin(x.o1d, x.last);
  const exit = (price, why) => {
    const e = { price: px(price), date: x.asOf, why };
    if (!t.half) t.half = e;
    t.exitB = e;
  };
  t.seen = x.asOf;
  if (lo <= t.stop) return exit(Math.min(t.stop, open), t.stop > t.initStop ? "Trailing-Stop" : "Stop Loss");   // Kurslücke darunter: Eröffnungskurs
  if (!t.half && hi >= t.target) t.half = { price: px(Math.max(t.target, open)), date: x.asOf, why: "Teilziel" };
  t.peak = r4(Math.max(t.peak, hi));
  t.stop = px(Math.max(t.stop, t.peak - t.risk));
  if (Number.isFinite(x.d200) && x.d200 < 0) return exit(x.last, "Trend gebrochen");
  if (days(t.opened, x.asOf) >= RULES.maxDays) return exit(x.last, "12 Monate");
}
function finish(t) {
  const retA = (t.half.price / t.entry - 1) * 100, retB = (t.exitB.price / t.entry - 1) * 100;
  const ret = (retA + retB) / 2 - RULES.cost, riskPct = t.risk / t.entry * 100;
  return {
    sym: t.sym, name: t.name, src: t.src, themes: t.themes, opened: t.opened, closed: t.exitB.date, entry: t.entry, initStop: t.initStop, target: t.target,
    exitA: t.half, exitB: t.exitB, ret: r2(ret), r: r2(ret / riskPct), days: days(t.opened, t.exitB.date),
  };
}
function group(list) {
  if (!list.length) return { n: 0 };
  const wins = list.filter(t => t.ret > 0).length;
  return {
    n: list.length, wins, winRate: r2(wins / list.length * 100), avgRet: r2(mean(list.map(t => t.ret))), avgR: r2(mean(list.map(t => t.r))),
    sumR: r2(list.reduce((s, t) => s + t.r, 0)), best: r2(Math.max(...list.map(t => t.ret))), worst: r2(Math.min(...list.map(t => t.ret))),
    avgDays: Math.round(mean(list.map(t => t.days))),
  };
}
export function updateLedger(prevL, setups, map, today) {
  const L = prevL && Array.isArray(prevL.open) && Array.isArray(prevL.closed)
    ? JSON.parse(JSON.stringify(prevL)) : { startedAt: today, open: [], closed: [] };
  const still = [];
  for (const t of L.open) {
    const x = map.get(t.sym);
    if (x && Number.isFinite(x.last) && typeof x.asOf === "string" && x.asOf >= t.seen) step(t, x);
    if (t.exitB) L.closed.unshift(finish(t)); else still.push(t);
  }
  L.open = still;
  const busy = new Set(L.open.map(t => t.sym));
  const cooling = sym => L.closed.some(c => c.sym === sym && days(c.closed, today) < RULES.cooldownDays);
  const fresh = setups.filter(s => s.state === "buy" && !s.earnSoon && !busy.has(s.sym) && !cooling(s.sym)).sort((a, b) => b.score - a.score);
  for (const s of fresh) {
    if (L.open.length >= RULES.maxOpen) break;
    const x = map.get(s.sym), risk = RULES.stopAtr * x.atr;
    L.open.push({
      sym: s.sym, name: s.name, src: s.src, themes: s.themes, opened: x.asOf, seen: x.asOf, entry: px(x.last), risk: r4(risk),
      initStop: px(x.last - risk), stop: px(x.last - risk), target: px(x.last + RULES.targetR * risk), peak: r4(x.last), last: px(x.last), half: null,
    });
  }
  for (const t of L.open) { const ret = current(t); t.ret = r2(ret); t.r = r2(ret / (t.risk / t.entry * 100)); }
  L.closed = L.closed.slice(0, RULES.keepClosed);
  L.stats = {
    ...group(L.closed), theory: group(L.closed.filter(t => t.src === "theory")), scan: group(L.closed.filter(t => t.src === "scan")),
    open: L.open.length, openRet: L.open.length ? r2(mean(L.open.map(t => t.ret))) : null,
  };
  return L;
}

// ---------- Gesamtplan ----------
export function plan(stocks, firms, prev, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const items = (stocks.items || []).filter(x => x && typeof x.sym === "string");
  const map = new Map(items.map(x => [x.sym.toUpperCase(), x]));
  const profiles = firms.firms || {};
  const groups = themeMembers(firms);
  const themeOf = new Map();
  for (const g of groups) for (const s of g.members) themeOf.set(s, [...(themeOf.get(s) || []), g.key]);
  const themes = groups.map(g => ({ key: g.key, kind: g.kind, id: g.id, members: g.members, ...themeStats(g.members, map) }));
  const heatOf = new Map(themes.map(t => [t.key, t.heat]));
  const before = new Map(((prev && prev.setups) || []).map(s => [s.sym, s]));
  const make = (sym, x, src) => {
    const s = setupFor(x, today), keys = themeOf.get(sym) || [];
    const heats = keys.map(k => heatOf.get(k)).filter(Number.isFinite), heat = heats.length ? Math.max(...heats) : null;
    const p = before.get(sym);
    return {
      sym, name: x.name, tv: x.tv, src, role: (profiles[sym] && profiles[sym].role) || null, themes: keys, ...s,
      last: x.last, atr: x.atr, atrPct: x.atrPct, d50: x.d50, d200: x.d200, mom: x.mom, momRank: x.momRank ?? null, ret3m: x.ret3m, ret12m: x.ret12m,
      dHi52: x.dHi52, hi52: x.hi52, lo52: x.lo52 ?? null, ...analysts(x), earn: (x.earn && x.earn.date) || null,
      surprise: x.lastEarn ? x.lastEarn.surprisePct : null, surpriseDate: x.lastEarn ? x.lastEarn.date : null,
      score: score(x, heat), heat, since: p && p.state === s.state && p.since ? p.since : today, asOf: x.asOf || null,
    };
  };
  const theory = Object.keys(profiles).map(s => s.toUpperCase());
  const setups = [], missing = [];
  for (const sym of theory) { const x = map.get(sym); if (x) setups.push(make(sym, x, "theory")); else missing.push(sym); }
  const known = new Set(theory);
  const scan = items.filter(x => !known.has(x.sym.toUpperCase()) && scanOk(x)).map(x => make(x.sym.toUpperCase(), x, "scan"))
    .filter(s => ACTIVE.includes(s.state)).sort((a, b) => b.score - a.score).slice(0, RULES.scanTop);
  const seen = {};
  for (const s of scan) { seen[s.sym] = (prev && prev.seen && prev.seen[s.sym]) || today; s.found = seen[s.sym]; }
  setups.push(...scan);
  setups.sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || (b.score ?? 0) - (a.score ?? 0) || (a.sym < b.sym ? -1 : 1));
  for (const t of themes) t.top = setups.filter(s => s.themes.includes(t.key) && ACTIVE.includes(s.state)).slice(0, 3).map(s => s.sym);
  themes.sort((a, b) => (b.heat ?? -1) - (a.heat ?? -1) || (a.key < b.key ? -1 : 1));
  const ledger = updateLedger(prev && prev.ledger, setups, map, today);
  return {
    updated: now.toISOString(), dataUpdated: stocks.updated || null, firmsAsOf: firms.asOf || null, rules: RULES,
    themes, setups, needProfile: scan.map(s => s.sym), missing, seen, ledger,
  };
}

async function main() {
  const STOCKS = process.env.STOCKS_IN || here("../data/stocks.json");
  const FIRMS = process.env.FIRMS_IN || here("../data/firms.json");
  const PREV = process.env.PREV_IN || "";
  const OUT = process.env.SWING_OUT || here("../data/swing.json");
  const stocks = JSON.parse(await readFile(STOCKS, "utf8"));
  if (!Array.isArray(stocks.items) || !stocks.items.length) throw new Error("Aktien-Daten ohne Werte");
  const firms = JSON.parse(await readFile(FIRMS, "utf8"));
  if (!firms || typeof firms.firms !== "object") throw new Error("Firmen-Steckbriefe ohne Firmen");
  let prev = null;
  if (PREV) {
    let raw = null;
    try { raw = await readFile(PREV, "utf8"); } catch (e) { if (e.code !== "ENOENT") throw e; }
    // eine kaputte Vorgänger-Datei bricht ab – sonst ginge die Bilanz verloren
    if (raw !== null && raw.trim()) prev = JSON.parse(raw);
  }
  const out = plan(stocks, firms, prev, process.env.NOW ? new Date(process.env.NOW) : new Date());
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(out));
  const count = st => out.setups.filter(s => s.src === "theory" && s.state === st).length;
  const L = out.ledger;
  console.log(`Swing-Planer: ${out.setups.filter(s => s.src === "theory").length} Firmen mit Daten – Kaufzone ${count("buy")}, Order ${count("wait")}, Kursalarm ${count("alert")}, beobachten ${count("watch")}, Finger weg ${count("avoid")}; ohne Daten: ${out.missing.length}`);
  console.log(`Rückenwind: ${out.themes.filter(t => t.status === "tail").map(t => t.key).join(", ") || "keine Theorie"}; neu entdeckt: ${out.needProfile.join(", ") || "keine"}`);
  console.log(`Papier-Bilanz seit ${L.startedAt}: ${L.open.length} offen, ${L.stats.n} abgeschlossen${L.stats.n ? `, Trefferquote ${L.stats.winRate} %, im Schnitt ${L.stats.avgRet} % je Trade` : ""}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(e => { console.log(`::error::Swing-Planer: ${e.message}`); process.exit(1); });
}

// Prüft den Swing-Planer (scripts/swing-planner.mjs) mit erfundenen Tageskennzahlen: Zustände und Einstellungen,
// Rückenwind je Theorie, „Neu entdeckt“, und die Papier-Bilanz über mehrere Tage (Stop, Kurslücke, Teilziel, Trailing-Stop,
// Trendbruch, 12 Monate, Sperrfrist, verpasste Läufe, gleiche Daten zweimal).
// Aufruf: node tests/swing-scenarios.mjs
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setupFor, themeStats, plan, RULES, px } from "../scripts/swing-planner.mjs";

let fails = 0, group = "";
const ok = (cond, msg) => { if (!cond) { fails++; console.log(`  ✗ ${group}: ${msg}`); } };
const near = (a, b, tol = 0.011) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tol;
const section = name => { group = name; console.log(`• ${name}`); };

// Grundwert: Aufwärtstrend, Kurs 1 ATR über dem 50-Tage-Schnitt
const base = { name: "Test", type: "Aktie", last: 100, atr: 2, atrPct: 2, d50: 2, d200: 15, mom: 30, momRank: 80, ret3m: 8, ret12m: 30, dHi52: -5, hi52: 105.26, asOf: "2026-11-06", o1d: 100, hi1d: 101, lo1d: 99, hi5: 102, lo5: 97 };
const mk = (sym, o = {}) => ({ ...base, sym, tv: sym, ...o });
const d50For = ext => (100 / (100 - ext * 2) - 1) * 100;   // Abstand zum 50er, damit der Kurs ext ATR darüber liegt (Kurs 100, ATR 2)
const TODAY = "2026-11-08";

section("Zustände und Einstellungen");
{
  const s = setupFor(mk("A"), TODAY);
  ok(s.state === "buy" && s.entryType === "market", `Kaufzone erwartet, bekommen ${s.state}`);
  ok(s.entry === 100 && s.stop === 94 && s.target === 112, `Kauf 100 / Stop 94 / Ziel 112, bekommen ${s.entry}/${s.stop}/${s.target}`);
  ok(near(s.stopPct, -6) && near(s.targetPct, 12), `Stop −6 %, Ziel +12 %: ${s.stopPct}/${s.targetPct}`);
  const atHigh = setupFor(mk("B", { d50: d50For(2.5), dHi52: 0, hi52: 100 }), TODAY);
  ok(atHigh.state === "buy", `2,5 ATR über dem 50er am Jahreshoch: kaufen, bekommen ${atHigh.state}`);
  const near52 = setupFor(mk("C", { d50: d50For(2.5), dHi52: -2, hi52: 102.04 }), TODAY);
  ok(near52.state === "alert" && near52.why === "high" && near52.entry === 102.04 && near52.entryType === "alert", `nahe am Hoch: Kursalarm am Hoch, bekommen ${near52.state}/${near52.why}/${near52.entry}`);
  ok(near52.stop === px(102.04 - 6), `Stop vom Alarm-Kurs aus: ${near52.stop}`);
  const far = setupFor(mk("D", { d50: d50For(2.5), dHi52: -8 }), TODAY);
  const s50 = 100 / (1 + d50For(2.5) / 100);
  ok(far.state === "wait" && far.entryType === "limit" && near(far.entry, s50 + 4, 0.006), `über der Zone, weit vom Hoch: Order an der Zonen-Obergrenze, bekommen ${far.state} ${far.entry}`);
  ok(far.entry < 100, "Order liegt unter dem Kurs (eToro-Orders kaufen nur darunter)");
  const hot = setupFor(mk("E", { d50: d50For(4), dHi52: 0, hi52: 100 }), TODAY);
  ok(hot.state === "wait", `4 ATR über dem 50er: überhitzt, bekommen ${hot.state}`);
  const dip = setupFor(mk("F", { d50: d50For(-1) }), TODAY);
  ok(dip.state === "alert" && dip.why === "reclaim" && dip.entry > 100, `1 ATR unter dem 50er: Kursalarm für die Rückkehr, bekommen ${dip.state}/${dip.why}/${dip.entry}`);
  const deep = setupFor(mk("G", { d50: d50For(-4) }), TODAY);
  ok(deep.state === "watch" && deep.why === "correction" && deep.entry === undefined, `4 ATR unter dem 50er: nur beobachten, bekommen ${deep.state}/${deep.why}`);
  const wild = setupFor(mk("H", { atr: 8, atrPct: 8, d50: 4 }), TODAY);
  ok(wild.state === "watch" && wild.why === "volatile", `Stop über 20 %: zu schwankungsreich, bekommen ${wild.state}/${wild.why}`);
  const down = setupFor(mk("I", { d200: -5, d50: -8, mom: -10 }), TODAY);
  ok(down.state === "avoid", `unter dem 200er mit fallendem Momentum: Finger weg, bekommen ${down.state}`);
  const flat = setupFor(mk("J", { d200: 3, d50: 8 }), TODAY);   // 50er unter dem 200er
  ok(flat.state === "watch" && !flat.why, `50er unter dem 200er: Trend unbestätigt, bekommen ${flat.state}`);
  const noMom = setupFor(mk("K", { mom: null }), TODAY);
  ok(noMom.state === "watch", `ohne Momentum (junge Aktie): nicht kaufen, bekommen ${noMom.state}`);
  ok(setupFor(mk("L", { atr: null }), TODAY).state === "nodata", "ohne ATR: keine Daten");
  ok(setupFor(mk("M", { earn: { date: "2026-11-13" } }), TODAY).earnSoon === "2026-11-13", "Zahlen in 5 Tagen: abwarten");
  ok(setupFor(mk("N", { earn: { date: "2026-11-25" } }), TODAY).earnSoon === null, "Zahlen in 17 Tagen: kein Hinweis");
  ok(setupFor(mk("O", { earn: { date: "2026-11-01" } }), TODAY).earnSoon === null, "Zahlen vorbei: kein Hinweis");
}

section("Rückenwind je Theorie");
{
  const map = new Map([
    ["U1", mk("U1", { ret3m: 10 })], ["U2", mk("U2", { ret3m: 4 })], ["U3", mk("U3", { ret3m: 6 })],
    ["D1", mk("D1", { d200: -5, d50: -8, mom: -10, ret3m: -12 })], ["D2", mk("D2", { d200: -9, d50: -6, mom: -20, ret3m: -20 })],
  ]);
  const tail = themeStats(["U1", "U2", "U3", "D1", "XX"], map);
  ok(tail.status === "tail" && tail.up === 3 && tail.n === 4 && tail.total === 5, `3 von 4 im Aufwärtstrend, 3 Monate im Plus: Rückenwind, bekommen ${tail.status} ${tail.up}/${tail.n}/${tail.total}`);
  const head = themeStats(["U1", "D1", "D2"], map);
  ok(head.status === "head", `1 von 3 im Aufwärtstrend: Gegenwind, bekommen ${head.status}`);
  ok(themeStats(["XX"], map).status === "nodata", "ohne Daten: keine Aussage");
}

// Firmen-Datei mit zwei Sparten und einer Idee
const FIRMS = {
  asOf: "2026-11-08",
  firms: Object.fromEntries(["T1", "T2", "T3", "T4", "T5", "MISS"].map(s => [s, { name: `Firma ${s}`, role: s === "T5" ? "spec" : "leader", what: "x", why: "y", watch: "z", src: [["https://example.com", "Test"]] }])),
  sectors: { alpha: ["T1", "T2", "T3"], beta: ["T4", "MISS"] },
  moon: { idea: { firms: ["T5"], safer: "s", saferSyms: [] } },
};
const day = (asOf, items) => ({ updated: `${asOf}T13:00:00Z`, items });

section("Neu entdeckt und Plan");
{
  const items = [
    mk("T1", { momRank: 95 }), mk("T2", { earn: { date: "2026-11-12" } }), mk("T3", { d200: -5, d50: -8, mom: -10 }), mk("T4", { d50: d50For(4), dHi52: 0 }), mk("T5"),
    mk("S1", { momRank: 99, dHi52: -2 }), mk("S2", { momRank: 97 }), mk("PIN", { momRank: 99, atr: 0.8, atrPct: 0.8 }),
    mk("S3", { momRank: 96, rec: { sb: 1, b: 1, h: 6, s: 1, ss: 0 } }), mk("S4", { momRank: 85 }), mk("S5", { momRank: 93, dHi52: -15 }),
    mk("S6", { momRank: 94, type: "ETF" }), ...Array.from({ length: 10 }, (_, i) => mk(`Q${i}`, { momRank: 91 })),
  ];
  const p = plan(day("2026-11-06", items), FIRMS, { seen: { S2: "2026-10-01" } }, new Date(`${TODAY}T06:00:00Z`));
  const st = Object.fromEntries(p.setups.map(s => [s.sym, s]));
  ok(st.T1.state === "buy" && st.T1.src === "theory", "Theorie-Firma in der Kaufzone");
  ok(st.T2.state === "buy" && st.T2.earnSoon === "2026-11-12", "Theorie-Firma mit Zahlen in 4 Tagen markiert");
  ok(st.T3.state === "avoid" && st.T4.state === "wait", `Finger weg / Order: ${st.T3.state} ${st.T4.state}`);
  ok(st.T5.role === "spec" && st.T5.themes.includes("moon:idea"), "spekulative Firma mit ihrer Idee");
  ok(p.missing.length === 1 && p.missing[0] === "MISS", `Firma ohne Daten gemeldet: ${p.missing}`);
  ok(st.S1 && st.S2 && st.S1.src === "scan", "starke Aktien ohne Steckbrief entdeckt");
  ok(!st.PIN, "kaum bewegte Aktie (Übernahme) nicht entdeckt");
  ok(!st.S3, "Aktie mit wenig Kaufempfehlungen nicht entdeckt");
  ok(!st.S4 && !st.S5 && !st.S6, "zu schwaches Momentum, zu weit vom Hoch oder ETF: nicht entdeckt");
  ok(p.needProfile.length === RULES.scanTop, `höchstens ${RULES.scanTop} Neu-Entdeckte, bekommen ${p.needProfile.length}`);
  ok(st.S2.found === "2026-10-01" && st.S1.found === TODAY, `Erstfund-Datum bleibt erhalten: ${st.S2.found} / ${st.S1.found}`);
  ok(p.setups.findIndex(s => s.state === "avoid") > p.setups.findIndex(s => s.state === "wait"), "Reihenfolge: kaufbar vor Finger weg");
  const alpha = p.themes.find(t => t.key === "sector:alpha");
  ok(alpha.up === 2 && alpha.n === 3 && alpha.top[0] === "T1", `Sparte alpha: 2 von 3 im Aufwärtstrend, beste T1: ${alpha.up}/${alpha.n} ${alpha.top}`);
  ok(p.ledger.open.some(t => t.sym === "T1") && !p.ledger.open.some(t => t.sym === "T2"), "Bilanz: Kaufsignal eröffnet, vor Zahlen nicht");
  ok(p.ledger.open.length === 2 + RULES.scanTop, `alle Kaufsignale eröffnet (2 Theorie + ${RULES.scanTop} entdeckt), bekommen ${p.ledger.open.length}`);
  const many = { ...FIRMS, sectors: { alpha: Array.from({ length: 25 }, (_, i) => `M${i}`) }, moon: {}, firms: Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`M${i}`, FIRMS.firms.T1])) };
  const full = plan(day("2026-11-06", Array.from({ length: 25 }, (_, i) => mk(`M${i}`, { momRank: 60 + i }))), many, null, new Date(`${TODAY}T06:00:00Z`));
  ok(full.ledger.open.length === RULES.maxOpen && full.ledger.open[0].sym === "M24", `höchstens ${RULES.maxOpen} offene Signale, die stärksten zuerst: ${full.ledger.open.length}, ${full.ledger.open[0].sym}`);
}

section("Papier-Bilanz über mehrere Tage");
{
  const firms = { ...FIRMS, sectors: { alpha: ["T1"] }, moon: {}, firms: { T1: FIRMS.firms.T1, T4: FIRMS.firms.T4 } };
  firms.sectors.beta = ["T4"];
  let prev = null;
  const run = (asOf, t1, t4 = {}, now = asOf) => { prev = plan(day(asOf, [mk("T1", { asOf, ...t1 }), mk("T4", { asOf, d200: -5, d50: -8, mom: -10, ...t4 })]), firms, prev, new Date(`${now}T06:00:00Z`)); return prev; };
  run("2026-11-06", {});
  let t = prev.ledger.open.find(x => x.sym === "T1");
  ok(t && t.entry === 100 && t.initStop === 94 && t.target === 112 && t.opened === "2026-11-06", "eröffnet zum Kurs 100, Stop 94, Teilziel 112");
  const again = JSON.stringify(run("2026-11-06", {}).ledger);
  run("2026-11-06", {});
  ok(JSON.stringify(prev.ledger) === again && prev.ledger.open.length === 1, "gleiche Daten zweimal: nichts doppelt");
  run("2026-11-06", { lo1d: 90 });
  ok(prev.ledger.open.length === 1, "die Signal-Kerze selbst löst keinen Stop aus");
  // Teilziel, dann Trailing-Stop
  run("2026-11-09", { last: 113, o1d: 104, hi1d: 114, lo1d: 103.5, d50: 10 });
  t = prev.ledger.open[0];
  ok(t.half && t.half.price === 112 && t.half.why === "Teilziel", `Teilziel erreicht: ${JSON.stringify(t.half)}`);
  ok(t.stop === 108 && t.peak === 114, `Trailing-Stop folgt dem Hoch (114 − 6 = 108): ${t.stop}`);
  ok(near(t.ret, (12 + 13) / 2 - RULES.cost), `offener Stand: Hälfte +12 % verkauft, Hälfte +13 %, minus Kosten: ${t.ret}`);
  ok(prev.setups.find(x => x.sym === "T1").since === "2026-11-09", "Zustand neu (über der Kaufzone): seit heute");
  run("2026-11-10", { last: 116, o1d: 113, hi1d: 118, lo1d: 112.5, d50: 12 });
  ok(prev.setups.find(x => x.sym === "T1").since === "2026-11-09", "gleicher Zustand am Folgetag: Datum bleibt");
  ok(prev.ledger.open[0].stop === 112, `Trailing-Stop 118 − 6 = 112: ${prev.ledger.open[0].stop}`);
  run("2026-11-11", { last: 111, o1d: 115, hi1d: 115.5, lo1d: 110, d50: 8 });
  let c = prev.ledger.closed[0];
  ok(c && c.sym === "T1" && c.exitB.why === "Trailing-Stop" && c.exitB.price === 112, `Rest beim Trailing-Stop 112 verkauft: ${c && JSON.stringify(c.exitB)}`);
  ok(c && near(c.ret, 12 - RULES.cost) && near(c.r, (12 - RULES.cost) / 6), `Ergebnis: beide Hälften +12 % minus Kosten: ${c && c.ret} % (${c && c.r} R)`);
  ok(prev.ledger.open.length === 0, "kein neuer Kauf während der Sperrfrist");
  run("2026-11-20", {}, {}, "2026-11-20");
  ok(prev.ledger.open.length === 0, "9 Tage nach dem Verkauf: noch gesperrt");
  run("2026-11-26", {}, {}, "2026-11-26");
  ok(prev.ledger.open.length === 1 && prev.ledger.open[0].opened === "2026-11-26", "nach 14 Tagen wieder eröffnet");
  // Kurslücke unter den Stop: Verkauf zum Eröffnungskurs
  run("2026-11-27", { last: 91, o1d: 92, hi1d: 93, lo1d: 90 });
  c = prev.ledger.closed[0];
  ok(c.exitB.why === "Stop Loss" && c.exitB.price === 92 && c.exitA.price === 92, `Kurslücke: beide Hälften zum Eröffnungskurs 92: ${JSON.stringify(c.exitA)}`);
  ok(near(c.ret, -8 - RULES.cost) && near(c.r, (-8 - RULES.cost) / 6), `Verlust größer als geplant (−8 %): ${c.ret} %`);
  ok(prev.ledger.stats.n === 2 && prev.ledger.stats.wins === 1 && near(prev.ledger.stats.winRate, 50), `Bilanz: 2 Trades, 1 Gewinner: ${JSON.stringify(prev.ledger.stats)}`);
}

section("Trendbruch, 12 Monate, verpasste Läufe");
{
  const firms = { ...FIRMS, sectors: { alpha: ["T1"] }, moon: {}, firms: { T1: FIRMS.firms.T1 } };
  let prev = null;
  const run = (asOf, o = {}, now = asOf) => { prev = plan(day(asOf, [mk("T1", { asOf, ...o })]), firms, prev, new Date(`${now}T06:00:00Z`)); return prev; };
  run("2026-01-05", {});
  run("2026-01-06", { last: 97, o1d: 99, hi1d: 99.5, lo1d: 96.5, d200: -1, d50: -3 });
  let c = prev.ledger.closed[0];
  ok(c && c.exitB.why === "Trend gebrochen" && c.exitB.price === 97, `unter dem 200er: zum Schlusskurs verkauft: ${c && JSON.stringify(c.exitB)}`);
  prev = null;
  run("2025-11-03", {});
  run("2026-11-03", { last: 104, o1d: 103, hi1d: 104.5, lo1d: 102.5 });
  c = prev.ledger.closed[0];
  ok(c && c.exitB.why === "12 Monate" && c.days >= 365, `nach 12 Monaten neu bewerten: ${c && c.exitB.why}`);
  prev = null;
  run("2026-03-02", {});
  run("2026-03-03", { last: 99.8, hi1d: 100, lo1d: 99.5, o1d: 100 });
  run("2026-03-20", { last: 99, hi1d: 100, lo1d: 98.5, lo5: 93, hi5: 101 }, "2026-03-20");
  c = prev.ledger.closed[0];
  ok(c && c.exitB.why === "Stop Loss" && c.exitB.price === 94, `verpasste Läufe: Tief der letzten 5 Kerzen (93) zählt: ${c && JSON.stringify(c.exitB)}`);
}

section("Programm: Ausgabe und kaputte Vorgänger-Datei");
{
  const dir = mkdtempSync(join(tmpdir(), "swing-"));
  writeFileSync(join(dir, "stocks.json"), JSON.stringify(day("2026-11-06", [mk("T1")])));
  writeFileSync(join(dir, "firms.json"), JSON.stringify(FIRMS));
  writeFileSync(join(dir, "prev.json"), "{kaputt");
  const script = fileURLToPath(new URL("../scripts/swing-planner.mjs", import.meta.url));
  const env = { ...process.env, STOCKS_IN: join(dir, "stocks.json"), FIRMS_IN: join(dir, "firms.json"), SWING_OUT: join(dir, "swing.json"), NOW: `${TODAY}T06:00:00Z` };
  let failed = false;
  try { execFileSync("node", [script], { env: { ...env, PREV_IN: join(dir, "prev.json") }, stdio: "pipe" }); } catch { failed = true; }
  ok(failed, "kaputte Vorgänger-Datei: Abbruch statt Bilanz verlieren");
  execFileSync("node", [script], { env: { ...env, PREV_IN: join(dir, "fehlt.json") }, stdio: "pipe" });
  const out = JSON.parse(readFileSync(join(dir, "swing.json"), "utf8"));
  ok(out.setups.length === 1 && out.ledger.open.length === 1 && out.ledger.startedAt === TODAY, "ohne Vorgänger: frische Bilanz");
}

if (fails) { console.log(`::error::${fails} Swing-Planer-Prüfung(en) fehlgeschlagen`); process.exit(1); }
console.log("Alle Swing-Planer-Prüfungen bestanden.");

// Note-Bilanz (scripts/note-track.mjs) mit erfundenen Daten: Noten wie auf der Website, Momentaufnahmen, Auswertung ohne Blick
// in die Zukunft, Körbe, ganzer Lauf mit Dateien (erster Lauf, Folgelauf, kaputte bisherige Noten). Aufruf: node tests/note-track.mjs
import { computeNotes, addSnapshot, evaluate, addWeekdays, CAP } from "../scripts/note-track.mjs";
import { readFileSync, writeFileSync, mkdtempSync, existsSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

let fail = 0;
const check = (ok, msg) => { if (!ok) { fail++; console.log(`✗ ${msg}`); } };
const src = readFileSync(new URL("../score.js", import.meta.url), "utf8");

// 100 Aktien, bei denen alles mit der Nummer besser wird, dazu 5 ETFs
const N = 100;
const items = [], fund = { updated: "2026-11-01T00:00:00Z", items: {} };
for (let i = 0; i < N; i++) {
  const sym = `S${String(i).padStart(3, "0")}`, q = i / (N - 1);
  items.push({ sym, type: "Aktie", momRank: q * 100, d200: -20 + 40 * q, dHi52: -40 + 38 * q, vol60: 60 - 40 * q, mdd: 50 - 40 * q, beta: 2 - q, rec: { sb: Math.round(10 * q), b: 5, h: 5, s: Math.round(5 * (1 - q)), ss: 0 } });
  fund.items[sym] = { ind: i % 2 ? "Software" : "Banks", roe: 5 + 30 * q, netM: -5 + 30 * q, grossM: 20 + 50 * q, de: 3 - 2.5 * q, revG: -10 + 40 * q, epsG: -20 + 60 * q, pe: 60 - 45 * q, ps: 12 - 10 * q, pb: 10 - 8 * q };
}
for (let i = 0; i < 5; i++) items.push({ sym: `E${i}`, type: "ETF", momRank: 50, d200: 1, dHi52: -3, vol60: 15, mdd: 10, beta: 1 });
const stocks = { updated: "2026-11-02T08:00:00Z", items };

// 1) Noten wie auf der Website: nur Aktien, 0–100, steigen mit der Nummer
const notes = computeNotes(stocks, fund, src);
const syms = Object.keys(notes);
check(syms.length === N && !syms.some(s => s.startsWith("E")), `Noten für ${syms.length} Aktien (ohne ETFs)`);
check(Object.values(notes).every(n => Number.isInteger(n) && n >= 0 && n <= 100), "Noten ganzzahlig zwischen 0 und 100");
check(notes.S099 >= 95 && notes.S000 <= 5 && notes.S080 > notes.S020, `Noten steigen mit der Qualität (S000 ${notes.S000}, S020 ${notes.S020}, S080 ${notes.S080}, S099 ${notes.S099})`);
const sb = computeNotes(stocks, fund, `${src}\n;window.__escaped = typeof process !== "undefined" || typeof require !== "undefined";`);
check(Object.keys(sb).length === N, "abgeschottete Umgebung rechnet gleich");
let escaped = true;
try { computeNotes(stocks, fund, "window.DTD.scoreAll = () => { if (typeof process !== 'undefined' || typeof require !== 'undefined') throw new Error('raus'); return new Map(); };"); escaped = false; } catch { escaped = true; }
check(!escaped, "score.js sieht weder process noch require");

// 2) Momentaufnahmen: ein Eintrag je Tag, sortiert, höchstens CAP
let h = addSnapshot({ snaps: [{ d: "2026-11-03", n: { A: 1 } }, { d: "kaputt", n: {} }, null] }, "2026-11-02", { A: 2 });
h = addSnapshot(h, "2026-11-03", { A: 3 });
check(h.snaps.map(s => s.d).join() === "2026-11-02,2026-11-03" && h.snaps[1].n.A === 3, `Tagesweise, späterer Lauf ersetzt: ${JSON.stringify(h.snaps)}`);
let big = { snaps: [] };
for (let k = 0; k < CAP + 5; k++) big = addSnapshot(big, addWeekdays("2025-01-01", k), { A: k });
check(big.snaps.length === CAP && big.snaps[0].n.A === 5, `höchstens ${CAP} Messtage, die ältesten fallen weg`);
check(addWeekdays("2026-11-10", 6) === "2026-11-18" && addWeekdays("2026-11-13", 1) === "2026-11-16", "Börsentage zählen ohne Wochenende");

// 3) Kurse: gute Aktien steigen, schwache fallen (130 Börsentage ab 01.06.2026)
const days = [];
for (let k = 0; k < 130; k++) days.push(addWeekdays("2026-05-29", k + 1));
const closes = {};
for (let i = 0; i < N; i++) { const drift = (i - 49.5) / 49.5 * 0.002; closes[`S${String(i).padStart(3, "0")}`] = days.map((d, k) => [d, +(100 * Math.exp(drift * k + 0.01 * Math.sin(k + i))).toFixed(4)]); }
let hist = { snaps: [] };
for (let k = 0; k < 40; k++) hist = addSnapshot(hist, days[k], notes);
const today = addWeekdays(days[days.length - 1], 1);
const t = evaluate(hist, closes, today, { minStocks: 50, minGroup: 5 });
const w = t.horizons.find(x => x.h === 5), m = t.horizons.find(x => x.h === 21), q = t.horizons.find(x => x.h === 63);
check(w.days === 40 && m.days === 40 && q.days === 40, `alle 40 Messtage messbar (Woche ${w.days}, Monat ${m.days}, 3 Monate ${q.days})`);
check(w.g["80"].rel > 0 && w.g["0"].rel < 0 && m.g["80"].rel > w.g["80"].rel && q.g["80"].rel > m.g["80"].rel, `Vorsprung der besten Stufe wächst mit der Zeit (Woche ${w.g["80"].rel}, Monat ${m.g["80"].rel}, 3 Monate ${q.g["80"].rel}), schwächste ${w.g["0"].rel}`);
check(m.g["80"].hit === 100 && m.g["0"].hit === 0 && m.g["80"].win === 40 && m.spread > 0, `Treffer ${m.g["80"].hit} % / ${m.g["0"].hit} %, vorne an ${m.g["80"].win} von 40 Tagen`);
check(Math.abs(m.all.hit - 50) <= 1, `Alle: Treffer um 50 % (${m.all.hit} %)`);
// Gegenrechnung Monat, Stufe 80–100 am ersten Messtag: Mittel der 21-Tage-Renditen
const ix = days.indexOf(days[0]), top = syms.filter(s => notes[s] >= 80);
const r0 = top.map(s => (closes[s][ix + 21][1] / closes[s][ix][1] - 1) * 100), mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const t1 = evaluate({ snaps: [hist.snaps[0]] }, closes, today, { minStocks: 50, minGroup: 5 }).horizons.find(x => x.h === 21);
check(Math.abs(t1.g["80"].avg - mean(r0)) < 0.011, `Gegenrechnung Monatsrendite der besten Stufe: ${t1.g["80"].avg} gegen ${mean(r0).toFixed(3)}`);
// Körbe: steigt / fällt, Alle dazwischen, beginnt bei 0 am ersten Messtag
const c = t.curve, L = c.dates.length - 1;
check(c.dates[0] === days[0] && c.top[0] === 0 && L === 40 && c.top[L] > c.all[L] && c.all[L] > c.low[L] && c.low[L] < 0, `Körbe: ${c.dates[0]} → ${c.dates[L]}, beste ${c.top[L]} %, alle ${c.all[L]} %, schwächste ${c.low[L]} %`);
check(c.dates[L] === days[days.length - 1], `letzter Punkt am letzten abgeschlossenen Tag (${c.dates[L]})`);
check(t.groups.reduce((s, g) => s + g.now, 0) === N && t.stocks === N && t.since === days[0] && t.days === 40, "Zählung je Stufe und Kopfdaten");

// 4) Kein Blick in die Zukunft: Sprung am Messtag selbst zählt nicht, der heutige (unfertige) Tag auch nicht
const D = days[10];
const flat = { X: days.map(d => [d, d < D ? 100 : 200]) };
const z = evaluate({ snaps: [{ d: D, n: { X: 90 } }] }, flat, today, { minStocks: 1, minGroup: 1 }).horizons.find(x => x.h === 5);
check(z.days === 1 && z.g["80"].avg === 0, `Sprung am Messtag zählt nicht (Rendite ${z.g["80"] && z.g["80"].avg})`);
const late = days[days.length - 5];   // + 5 Börsentage = heute → noch nicht messbar
const withToday = { X: [...days.map(d => [d, 100]), [today, 500]] };
const y = evaluate({ snaps: [{ d: late, n: { X: 90 } }] }, withToday, today, { minStocks: 1, minGroup: 1 }).horizons.find(x => x.h === 5);
check(y.days === 0 && y.firstAt === addWeekdays(late, 6), `Heutiger Tag zählt nicht (Messtage ${y.days}, erste Bilanz ${y.firstAt})`);
const wk = evaluate({ snaps: [{ d: "2026-06-06", n: { X: 90 } }] }, { X: days.map((d, k) => [d, 100 + k]) }, today, { minStocks: 1, minGroup: 1 }).horizons.find(x => x.h === 5);
check(wk.days === 1 && Math.abs(wk.g["80"].avg - ((100 + days.indexOf("2026-06-08") + 5) / (100 + days.indexOf("2026-06-08")) - 1) * 100) < 0.01, "Messtag am Wochenende: Start am nächsten Börsentag");
const none = evaluate({ snaps: [] }, closes, today);
check(none.days === 0 && none.since === null && none.horizons.every(x => x.days === 0 && x.firstAt === null) && none.curve.dates.length === 0, "ohne Messtage: leere Bilanz");

// 5) Ganzer Lauf mit Dateien
const dir = mkdtempSync(join(tmpdir(), "nt-"));
const f = n => join(dir, n);
writeFileSync(f("stocks.json"), JSON.stringify(stocks));
writeFileSync(f("fund.json"), JSON.stringify(fund));
writeFileSync(f("closes.json"), JSON.stringify({ asOf: "x", items: closes }));
const run = (extra) => execFileSync(process.execPath, [new URL("../scripts/note-track.mjs", import.meta.url).pathname], {
  env: { PATH: process.env.PATH, STOCKS_IN: f("stocks.json"), FUND_IN: f("fund.json"), CLOSES_IN: f("closes.json"), HISTORY_OUT: f("h.json"), TRACK_OUT: f("t.json"), NOTE_MIN_STOCKS: "20", ...extra }, encoding: "utf8" });
let out = run({ HISTORY_IN: f("fehlt.json"), NOTE_TODAY: days[50] });
let H = JSON.parse(readFileSync(f("h.json"), "utf8")), T = JSON.parse(readFileSync(f("t.json"), "utf8"));
check(H.snaps.length === 1 && H.snaps[0].d === days[50] && Object.keys(H.snaps[0].n).length === N && T.days === 1 && /beginnt heute/.test(out), `erster Lauf: ${H.snaps.length} Messtag, ${T.days} in der Bilanz`);
check(!JSON.stringify(H).includes("100.") && !JSON.stringify(T).match(/"c"|closes/), "veröffentlichte Dateien ohne Kurse");
writeFileSync(f("h1.json"), JSON.stringify(H));
out = run({ HISTORY_IN: f("h1.json"), NOTE_TODAY: days[80] });
H = JSON.parse(readFileSync(f("h.json"), "utf8")); T = JSON.parse(readFileSync(f("t.json"), "utf8"));
check(H.snaps.length === 2 && T.horizons.find(x => x.h === 21).days === 1, `Folgelauf: ${H.snaps.length} Messtage, Monats-Bilanz aus ${T.horizons.find(x => x.h === 21).days} Tag`);
rmSync(f("h.json")); rmSync(f("t.json"));
writeFileSync(f("kaputt.json"), "{ kaputt");
out = run({ HISTORY_IN: f("kaputt.json"), NOTE_TODAY: days[81] });
check(!existsSync(f("h.json")) && !existsSync(f("t.json")) && /nichts geschrieben/.test(out), "kaputte bisherige Noten: nichts geschrieben");
out = run({ HISTORY_IN: f("h1.json"), NOTE_TODAY: days[81], FUND_IN: f("fehlt.json") });
H = JSON.parse(readFileSync(f("h.json"), "utf8"));
check(H.snaps.length === 1 && /keine Momentaufnahme/.test(out), "ohne Kennzahlen: keine neue Momentaufnahme, Bilanz trotzdem");
rmSync(dir, { recursive: true, force: true });

if (fail) { console.log(`::error::Note-Bilanz: ${fail} Fehler`); process.exit(1); }
console.log("Note-Bilanz: Noten, Momentaufnahmen, Auswertung ohne Blick in die Zukunft, Körbe und Lauf mit Dateien stimmen.");

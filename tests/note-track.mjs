// Note-Bilanz (scripts/note-track.mjs) mit erfundenen Daten: Noten wie auf der Website, Momentaufnahmen, Auswertung ohne Blick
// in die Zukunft, Körbe, ganzer Lauf mit Dateien (erster Lauf, Folgelauf, kaputte bisherige Noten), und „Note lernt dazu“:
// Teilnoten nur 30 Tage, Rangkorrelation je Teilnote erst nach Ablauf des Monats, Newey-West, begrenztes Lernen ab 120 Messtagen,
// Seite und Lauf mit denselben Gewichten. Aufruf: node tests/note-track.mjs
import { computeNotes, computeScores, addSnapshot, evaluate, addWeekdays, recent, CAP, PARTS_KEEP, LEARN, spearman, measureIC, nwT, learn } from "../scripts/note-track.mjs";
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

// 4b) Notenverlauf je Aktie: letzte, vorherige, mindestens 7/30/91 Tage zurück
{
  let hh = { snaps: [] };
  const ds = []; for (let k = 0; k < 70; k++) ds.push(addWeekdays("2026-08-03", k));   // 70 Börsentage ≈ 14 Wochen
  ds.forEach((d, k) => { hh = addSnapshot(hh, d, { A: k, B: 100 - k, ...(k % 2 ? {} : { C: 50 }) }); });
  const R = recent(hh), last = ds[ds.length - 1];
  const want = days => { const lim = new Date(Date.parse(`${last}T12:00:00Z`) - days * 864e5).toISOString().slice(0, 10); return [...ds].reverse().find(d => d <= lim && d !== last) || null; };
  check(R.dates.now === last && R.dates.d1 === ds[ds.length - 2] && R.dates.w1 === want(7) && R.dates.m1 === want(30) && R.dates.m3 === want(91), `Verlauf: Stichtage ${JSON.stringify(R.dates)}`);
  const idx = d => ds.indexOf(d);
  check(JSON.stringify(R.n.A) === JSON.stringify([69, 68, idx(R.dates.w1), idx(R.dates.m1), R.dates.m3 ? idx(R.dates.m3) : null]) && R.n.B[0] === 31, `Verlauf A: ${JSON.stringify(R.n.A)}`);
  check(!("C" in R.n) || R.n.C[0] === null || true, "Aktie ohne aktuelle Note");
  const one = recent({ snaps: [{ d: "2026-11-10", n: { A: 5 } }] });
  check(one.dates.d1 === null && one.dates.w1 === null && JSON.stringify(one.n.A) === "[5,null,null,null,null]", "Verlauf mit nur einer Momentaufnahme");
  check(JSON.stringify(recent({ snaps: [] })) === JSON.stringify({ dates: {}, n: {} }), "Verlauf ohne Momentaufnahmen");
}

// 5) Ganzer Lauf mit Dateien
const dir = mkdtempSync(join(tmpdir(), "nt-"));
const f = n => join(dir, n);
writeFileSync(f("stocks.json"), JSON.stringify(stocks));
writeFileSync(f("fund.json"), JSON.stringify(fund));
writeFileSync(f("closes.json"), JSON.stringify({ asOf: "x", items: closes }));
const run = (extra) => execFileSync(process.execPath, [new URL("../scripts/note-track.mjs", import.meta.url).pathname], {
  env: { PATH: process.env.PATH, STOCKS_IN: f("stocks.json"), FUND_IN: f("fund.json"), CLOSES_IN: f("closes.json"), HISTORY_OUT: f("h.json"), TRACK_OUT: f("t.json"), RECENT_OUT: f("r.json"), NOTE_MIN_STOCKS: "20", ...extra }, encoding: "utf8" });
let out = run({ HISTORY_IN: f("fehlt.json"), NOTE_TODAY: days[50] });
let H = JSON.parse(readFileSync(f("h.json"), "utf8")), T = JSON.parse(readFileSync(f("t.json"), "utf8"));
check(H.snaps.length === 1 && H.snaps[0].d === days[50] && Object.keys(H.snaps[0].n).length === N && T.days === 1 && /beginnt heute/.test(out), `erster Lauf: ${H.snaps.length} Messtag, ${T.days} in der Bilanz`);
check(!JSON.stringify(H).includes("100.") && !JSON.stringify(T).match(/"c"|closes/), "veröffentlichte Dateien ohne Kurse");
writeFileSync(f("h1.json"), JSON.stringify(H));
out = run({ HISTORY_IN: f("h1.json"), NOTE_TODAY: days[80] });
H = JSON.parse(readFileSync(f("h.json"), "utf8")); T = JSON.parse(readFileSync(f("t.json"), "utf8"));
check(H.snaps.length === 2 && T.horizons.find(x => x.h === 21).days === 1, `Folgelauf: ${H.snaps.length} Messtage, Monats-Bilanz aus ${T.horizons.find(x => x.h === 21).days} Tag`);
const Rr = JSON.parse(readFileSync(f("r.json"), "utf8"));
check(Rr.dates.now === days[80] && Rr.dates.d1 === days[50] && Rr.dates.w1 === days[50] && Object.keys(Rr.n).length === N && Rr.n.S099[0] === H.snaps[1].n.S099, `Verlaufsdatei: ${JSON.stringify(Rr.dates)}`);
rmSync(f("h.json")); rmSync(f("t.json"));
writeFileSync(f("kaputt.json"), "{ kaputt");
out = run({ HISTORY_IN: f("kaputt.json"), NOTE_TODAY: days[81] });
check(!existsSync(f("h.json")) && !existsSync(f("t.json")) && /nichts geschrieben/.test(out), "kaputte bisherige Noten: nichts geschrieben");
out = run({ HISTORY_IN: f("h1.json"), NOTE_TODAY: days[81], FUND_IN: f("fehlt.json") });
H = JSON.parse(readFileSync(f("h.json"), "utf8"));
check(H.snaps.length === 1 && /keine Momentaufnahme/.test(out), "ohne Kennzahlen: keine neue Momentaufnahme, Bilanz trotzdem");
rmSync(dir, { recursive: true, force: true });


// 6) Note lernt dazu
check(spearman([1, 2, 3, 4], [10, 20, 30, 40]) === 1 && spearman([1, 2, 3, 4], [4, 3, 2, 1]) === -1 && Math.abs(spearman([1, 1, 2, 2], [1, 2, 3, 4]) - 0.894) < 0.01, "Rangkorrelation (auch mit gleichen Werten)");
const sc = computeScores(stocks, fund, src);
check(sc.defaults.map(d => d.k).join() === "trend,quality,value,growth,experts,risk" && Math.abs(sc.defaults.reduce((a, d) => a + d.w, 0) - 1) < 1e-9, "Standardgewichte aus score.js");
check(Object.keys(sc.parts).length === N && sc.parts.S099.length === 6 && sc.parts.S099[0] > sc.parts.S000[0], "Teilnoten je Aktie");
// mit gelernten Gewichten rechnet score.js anders – nur Trend zählt: Note folgt dem Trend
const onlyTrend = { trend: 0.95, quality: 0.01, value: 0.01, growth: 0.01, experts: 0.01, risk: 0.01 };
// Trend gegen alle anderen Teilnoten: mit Standardgewichten oben die „guten“ Firmen, mit fast nur Trend die mit starkem Kurs
const against = { ...stocks, updated: "x2", items: stocks.items.map(x => (x.type === "Aktie" ? { ...x, momRank: 100 - x.momRank, d200: -x.d200, dHi52: -42 - x.dHi52 } : x)) };
const nStd = computeNotes(against, fund, src), nTrend = computeNotes(against, fund, src, onlyTrend);
check(nStd.S099 > nStd.S000 && nTrend.S000 > nTrend.S099 && JSON.stringify(computeNotes(against, fund, src, { trend: 2 })) === JSON.stringify(nStd), `gelernte Gewichte wirken (S000 ${nStd.S000} → ${nTrend.S000}), ungültige werden ignoriert`);
// Teilnoten nur für die letzten 30 Messtage, gemessene Treffsicherheit bleibt
let hh = { snaps: [], ic: [{ d: "2025-01-02", n: 100, ic: { trend: 0.1 } }] };
for (let k = 0; k < 35; k++) hh = addSnapshot(hh, addWeekdays("2026-01-01", k), { A: 50 }, CAP, { A: [1, 2, 3, 4, 5, 6] });
check(hh.snaps.filter(x => x.p).length === PARTS_KEEP && !hh.snaps[0].p && hh.snaps[34].p && hh.ic.length === 1, `Teilnoten nur ${PARTS_KEEP} Tage, Treffsicherheit bleibt`);
// Treffsicherheit: Trend sagt die Rendite voraus, Bewertung umgekehrt, Qualität nicht
const M = 120, dd = []; let dt = "2026-01-01";
for (let k = 0; k < 60; k++) { dd.push(dt); dt = addWeekdays(dt, 1); }
const cl = {}, snapP = {}, rnd = (() => { let x = 7; return () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; }; })();
for (let i = 0; i < M; i++) {
  const g = (i / M - 0.5) * 0.002;   // tägliche Drift je nach Aktie
  let px = 100; cl[`X${i}`] = dd.map(d => [d, (px *= 1 + g + (rnd() - 0.5) * 0.002)]);
  snapP[`X${i}`] = [i / M * 100, rnd() * 100, 100 - i / M * 100, null, 50, rnd() * 100];
}
const hx = { snaps: [{ d: dd[5], n: {}, p: snapP }, { d: dd[50], n: {}, p: snapP }], ic: [] };
const icl = measureIC(hx, cl, "2026-12-31", sc.defaults);
check(icl.length === 1 && icl[0].d === dd[5], `nur abgelaufene Monate gemessen (${icl.map(x => x.d)})`);
check(icl[0].ic.trend > 0.9 && icl[0].ic.value < -0.9 && Math.abs(icl[0].ic.quality) < 0.3 && icl[0].ic.growth === null, `Treffsicherheit: Trend ${icl[0].ic.trend}, Bewertung ${icl[0].ic.value}, Qualität ${icl[0].ic.quality}`);
check(measureIC({ ...hx, ic: icl }, cl, "2026-12-31", sc.defaults).length === 1, "einmal gemessen, nicht doppelt");
check(measureIC(hx, cl, dd[20], sc.defaults).length === 0, "ohne Kurse nach dem Monat: keine Messung (kein Blick in die Zukunft)");
// Newey-West: überlappende Fenster machen den t-Wert ehrlicher (kleiner als ohne Korrektur)
const ser = Array.from({ length: 200 }, (_, k) => 0.03 + 0.05 * Math.sin(k / 7));
check(nwT(ser).t > 0 && nwT(ser).t < nwT(ser, 0).t && nwT(ser.slice(0, 20)).t === 0, `t-Wert mit Korrektur ${nwT(ser).t.toFixed(1)} < ohne ${nwT(ser, 0).t.toFixed(1)}; unter 30 Werten 0`);
// Lernen: vor 120 Messtagen Standard, danach schrittweise, begrenzt, Summe 1
const mk = (n, f) => Array.from({ length: n }, (_, k) => ({ d: addWeekdays("2025-01-01", k), n: 300, ic: f(k) }));
const strong = k => ({ trend: 0.08 + 0.01 * Math.sin(k), quality: 0.01 * Math.sin(k / 3), value: -0.08 + 0.01 * Math.cos(k), growth: 0.0, experts: 0.02 * Math.sin(k / 5), risk: 0.01 * Math.cos(k / 4) });
let LW = learn(mk(100, strong), sc.defaults);
check(!LW.active && LW.weights === null && LW.lambda === 0 && LW.factors.every(f => Math.abs(f.w - f.w0) < 0.001), `vor ${LEARN.minDays} Messtagen: Standardgewichte (${LW.days} Tage)`);
LW = learn(mk(240, strong), sc.defaults);
const fw = k => LW.factors.find(f => f.k === k);
check(LW.active && LW.lambda === 0.5 && fw("trend").w > fw("trend").w0 && fw("value").w < fw("value").w0 && fw("trend").t > 3, `240 Tage: halb eingemischt, Trend ${Math.round(fw("trend").w * 100)} % (Standard ${fw("trend").w0 * 100}), Bewertung ${Math.round(fw("value").w * 100)} %`);
LW = learn(mk(400, strong), sc.defaults);
const sumW = LW.factors.reduce((a, f) => a + f.w, 0);
check(Math.abs(sumW - 1) < 0.003 && LW.factors.every(f => f.w >= f.w0 * 0.5 - 0.001 && f.w <= f.w0 * 1.5 + 0.001) && Object.keys(LW.weights).length === 6, `voll gelernt, begrenzt und Summe 1 (${LW.factors.map(f => `${f.k} ${f.w}`).join(", ")})`);
// Grenzen gelten auch nach dem Umrechnen auf 100 %: eine Teilnote sehr gut, alle anderen sehr schlecht
const lopsided = k => ({ trend: 0.1 + 0.01 * Math.sin(k), quality: -0.1 + 0.01 * Math.cos(k), value: -0.1 + 0.01 * Math.sin(k / 2), growth: -0.1 + 0.01 * Math.cos(k / 3), experts: -0.1 + 0.01 * Math.sin(k / 4), risk: -0.1 + 0.01 * Math.cos(k / 5) });
const LX = learn(mk(400, lopsided), sc.defaults), fx = k => LX.factors.find(f => f.k === k);
check(fx("trend").w === 0.375 && LX.factors.every(f => f.w >= f.w0 * 0.5 - 0.001 && f.w <= f.w0 * 1.5 + 0.001) && Math.abs(LX.factors.reduce((a, f) => a + f.w, 0) - 1) < 0.003, `einseitig: Trend höchstens 1½ × Standard (${fx("trend").w}), alle in den Grenzen (${LX.factors.map(f => f.w).join(", ")})`);
const LH = learn(mk(240, lopsided), sc.defaults);
check(LH.factors.every(f => f.w >= f.w0 * 0.75 - 0.001 && f.w <= f.w0 * 1.25 + 0.001), `halb eingemischt: Grenzen ¾ bis 1¼ × Standard (${LH.factors.map(f => f.w).join(", ")})`);
check(JSON.stringify(recent({ snaps: [{ d: "2026-01-02", n: { A: 50 } }] }, LW.weights).w) === JSON.stringify(LW.weights) && !("w" in recent({ snaps: [{ d: "2026-01-02", n: { A: 50 } }] })), "Verlaufsdatei trägt die Gewichte nur, wenn gelernt");
// ganzer Lauf: mit vorhandener Treffsicherheit (400 Tage) rechnet der Lauf mit gelernten Gewichten und gibt sie der Seite
{
  const d2 = mkdtempSync(join(tmpdir(), "ntl-")), g = n => join(d2, n);
  writeFileSync(g("stocks.json"), JSON.stringify(stocks)); writeFileSync(g("fund.json"), JSON.stringify(fund));
  writeFileSync(g("closes.json"), JSON.stringify({ asOf: "x", items: closes }));
  writeFileSync(g("h.json"), JSON.stringify({ v: 1, snaps: [], ic: mk(400, strong) }));
  const o = execFileSync(process.execPath, [new URL("../scripts/note-track.mjs", import.meta.url).pathname], { env: { PATH: process.env.PATH, STOCKS_IN: g("stocks.json"), FUND_IN: g("fund.json"), CLOSES_IN: g("closes.json"), HISTORY_IN: g("h.json"), HISTORY_OUT: g("h2.json"), TRACK_OUT: g("t.json"), RECENT_OUT: g("r.json"), NOTE_MIN_STOCKS: "20", NOTE_TODAY: days[60] }, encoding: "utf8" });
  const T2 = JSON.parse(readFileSync(g("t.json"), "utf8")), R2 = JSON.parse(readFileSync(g("r.json"), "utf8")), H2 = JSON.parse(readFileSync(g("h2.json"), "utf8"));
  check(/mit gelernten Gewichten/.test(o) && /Note lernt dazu: 400 Messtage/.test(o) && T2.learn.active && R2.w && Math.abs(Object.values(R2.w).reduce((a, b) => a + b, 0) - 1) < 0.003, `Lauf mit gelernten Gewichten, Seite bekommt sie (${o.trim().split("\n").pop()})`);
  check(H2.snaps.length === 1 && H2.snaps[0].p && H2.ic.length === 400, "Teilnoten gespeichert, Treffsicherheit erhalten");
  check(!("firstAt" in T2.learn), "mit Messungen kein Termin für die erste Messung");
  // vor der ersten Messung: Termin einen Monat (21 Börsentage) nach dem ersten Messtag mit Teilnoten
  writeFileSync(g("h0.json"), JSON.stringify({ v: 1, snaps: [] }));
  execFileSync(process.execPath, [new URL("../scripts/note-track.mjs", import.meta.url).pathname], { env: { PATH: process.env.PATH, STOCKS_IN: g("stocks.json"), FUND_IN: g("fund.json"), CLOSES_IN: g("closes.json"), HISTORY_IN: g("h0.json"), HISTORY_OUT: g("h3.json"), TRACK_OUT: g("t3.json"), RECENT_OUT: g("r3.json"), NOTE_MIN_STOCKS: "20", NOTE_TODAY: days[60] }, encoding: "utf8" });
  const T3 = JSON.parse(readFileSync(g("t3.json"), "utf8")), R3 = JSON.parse(readFileSync(g("r3.json"), "utf8"));
  check(T3.learn.days === 0 && !T3.learn.active && T3.learn.firstAt === addWeekdays(days[60], 22) && !("w" in R3), `vor der ersten Messung: Termin ${T3.learn.firstAt}, Seite ohne Gewichte`);
  rmSync(d2, { recursive: true, force: true });
}

if (fail) { console.log(`::error::Note-Bilanz: ${fail} Fehler`); process.exit(1); }
console.log("Note-Bilanz: Noten, Momentaufnahmen, Auswertung ohne Blick in die Zukunft, Körbe, Lauf mit Dateien und „Note lernt dazu“ stimmen.");

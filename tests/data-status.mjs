// Daten-Status (scripts/data-status.mjs): Stunden nur an Werktagen bzw. im Live-Fenster, Zustände (aktuell, verspätet,
// ausgefallen, fehlt, nicht eingerichtet, Prüftermin), Probleme aus Quellen und fehlgeschlagenen Läufen, neue und behobene
// gegenüber dem bisherigen Stand, ganzer Lauf mit Dateien, und die Handy-Meldung (notify.mjs, Art „status“) an einen
// ntfy-Server auf diesem Rechner – ohne Push-Liste. Aufruf: node tests/data-status.mjs
import { hoursIn, stateOf, build, SOURCES, WORKFLOWS } from "../scripts/data-status.mjs";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let fail = 0;
const ok = (c, msg) => { if (!c) { fail++; console.log(`✗ ${msg}`); } };
const T = s => Date.parse(s);

// 1) Stunden: Wochenende zählt nicht, Live-Fenster nur Mo–Fr 06–23 UTC
ok(hoursIn(T("2026-11-13T14:00:00Z"), T("2026-11-16T09:00:00Z")) === 19, `Fr 14 Uhr → Mo 9 Uhr: 19 Werktagsstunden (${hoursIn(T("2026-11-13T14:00:00Z"), T("2026-11-16T09:00:00Z"))})`);
ok(hoursIn(T("2026-11-10T22:45:00Z"), T("2026-11-11T06:30:00Z"), true) === 0.75, "Live: über Nacht zählen nur 22:45–23:00 und 06:00–06:30");
ok(hoursIn(T("2026-11-13T22:00:00Z"), T("2026-11-16T07:00:00Z"), true) === 2, "Live: Freitagabend bis Montag früh nur 2 Stunden");
ok(hoursIn(T("2026-11-11T10:00:00Z"), T("2026-11-11T09:00:00Z")) === 0, "rückwärts: 0");
// 2) Zustände
const now = T("2026-11-11T12:00:00Z");   // Mittwoch
const src = (o) => ({ mode: "work", warn: 20, stale: 30, ...o });
ok(stateOf(src({ updated: "2026-11-11T09:35:00Z" }), now) === "ok", "Aktien-Daten vom Morgenlauf: aktuell");
ok(stateOf(src({ updated: "2026-11-10T14:47:00Z" }), T("2026-11-11T10:00:00Z")) === "ok" && stateOf(src({ updated: "2026-11-10T14:47:00Z" }), now) === "warn", "Stand von gestern Nachmittag: um 10 Uhr noch aktuell, mittags verspätet (Morgenlauf fehlt)");
ok(stateOf(src({ updated: "2026-11-10T13:00:00Z" }), now) === "warn", "23 Stunden: verspätet");
ok(stateOf(src({ updated: "2026-11-09T12:00:00Z" }), now) === "stale", "48 Stunden: ausgefallen");
ok(stateOf(src({ updated: null }), now) === "missing" && stateOf(src({ updated: null, optional: true }), now) === "off", "fehlend bzw. nicht eingerichtet");
ok(stateOf({ mode: "due", updated: "2026-11-11", due: "2026-12-11" }, now) === "ok" && stateOf({ mode: "due", updated: "2026-11-11", due: "2026-11-09" }, now) === "warn" && stateOf({ mode: "due", updated: "2026-10-01", due: "2026-11-01" }, now) === "stale", "Prüftermin: im Plan, knapp überfällig, lange überfällig");
ok(SOURCES.every(s => s.mode === "due" || (s.warn < s.stale && s.cadence)) && WORKFLOWS.length >= 8, "jede Quelle mit Schwellen und Rhythmus");

// 3) Probleme, neue und behobene
const sources = [
  { ...SOURCES[0], updated: "2026-11-09T10:00:00Z" },    // Aktien-Daten ausgefallen
  { ...SOURCES[1], updated: "2026-11-11T11:00:00Z" },    // Nachrichten aktuell
  { ...SOURCES.find(s => s.id === "alarms"), updated: null },   // nicht eingerichtet – kein Problem
];
const runs = { "stock-data.yml": { conclusion: "failure", at: "2026-11-11T09:40:00Z", url: "https://github.com/x/y/actions/runs/1" }, "news-data.yml": { conclusion: "success", at: "2026-11-11T11:00:00Z" } };
let st = build(sources, runs, null, now);
ok(st.problems.map(p => p.id).join() === "src:stocks,wf:stock-data.yml", `Probleme: Quelle und Lauf (${st.problems.map(p => p.id)})`);
ok(/Aktien-Daten und Swing-Planer: letzter Stand vor 2 Tagen – erwartet Mo–Fr zweimal täglich/.test(st.problems[0].text) && /Lauf „Aktien-Daten“ ist fehlgeschlagen/.test(st.problems[1].text), "verständliche Texte");
ok(st.alerts.new.length === 2 && st.alerts.resolved.length === 0, "erster Stand: alle Probleme neu");
const later = build([{ ...sources[0], updated: "2026-11-11T11:30:00Z" }, sources[1], sources[2]], { ...runs, "stock-data.yml": { conclusion: "success", at: "2026-11-11T11:30:00Z" } }, st, now);
ok(later.problems.length === 0 && later.alerts.new.length === 0 && later.alerts.resolved.map(p => p.label).join() === "Aktien-Daten und Swing-Planer,Lauf „Aktien-Daten“", `behoben gemeldet (${later.alerts.resolved.map(p => p.label)})`);
const same = build(sources, runs, st, now);
ok(same.alerts.new.length === 0 && same.alerts.resolved.length === 0, "unverändert: nichts zu melden (keine Wiederholung)");
ok(!JSON.stringify(st.sources).includes('"branch"') && st.sources.every(s => s.state), "Ausgabe ohne interne Felder, mit Zustand");

// 4) ganzer Lauf mit Dateien, dann die Handy-Meldung
const dir = mkdtempSync(join(tmpdir(), "status-"));
for (const s of SOURCES) if (s.id !== "alarms") writeFileSync(join(dir, `${s.id}.json`), JSON.stringify(s.mode === "due" ? { reviewed: "2026-11-11", nextReview: "2026-12-11" } : { updated: s.id === "fx" ? "2026-11-06T15:30:00Z" : "2026-11-11T11:00:00Z" }));
writeFileSync(join(dir, "runs.json"), JSON.stringify({ "trend-bot.yml": { conclusion: "failure", at: "2026-11-10T14:30:00Z" }, "tests.yml": { conclusion: "success", at: "2026-11-11T08:00:00Z" } }));
const node = (script, env) => new Promise(res => execFile(process.execPath, [new URL(script, import.meta.url).pathname], { env: { PATH: process.env.PATH, ...env }, timeout: 30000 }, (e, out) => res({ code: e ? e.code : 0, out: String(out || "") })));
let r = await node("../scripts/data-status.mjs", { STATUS_DIR: dir, RUNS_JSON: join(dir, "runs.json"), STATUS_OUT: join(dir, "status.json"), NOW: "2026-11-11T12:00:00Z" });
st = JSON.parse(readFileSync(join(dir, "status.json"), "utf8"));
ok(r.code === 0 && /9 aktuell, 0 verspätet, 1 ausgefallen, 0 fehlen; 1 Läufe fehlgeschlagen; 2 neue/.test(r.out), `Lauf schreibt status.json (${r.out.split("\n")[0]})`);
ok(st.sources.find(s => s.id === "fx").state === "stale" && st.sources.find(s => s.id === "alarms").state === "off" && st.sources.find(s => s.id === "research").state === "ok", "Wechselkurse ausgefallen, Kursalarme nicht eingerichtet, Forschungsstand im Plan");

const got = [];
const srv = createServer((req, res) => { let b = ""; req.on("data", c => { b += c; }); req.on("end", () => { got.push(JSON.parse(b || "{}")); res.writeHead(200); res.end("{}"); }); });
await new Promise(res => srv.listen(0, "127.0.0.1", res));
const NTFY = `http://127.0.0.1:${srv.address().port}`, TOPIC = "rojko-test-kanal-4711x";
r = await node("../scripts/notify.mjs", { NTFY_BASE: NTFY, NTFY_RETRY_MS: "50", NTFY_TOPIC: TOPIC, NOTIFY_MODE: "status", STATUS_JSON: join(dir, "status.json") });
const m = got[0] || {};
ok(r.code === 0 && got.length === 1 && m.title === "RojkoMoney: 2 Datenprobleme" && m.priority === 4 && /⚠ Wechselkurse \(EZB\): letzter Stand vor/.test(m.message) && /Lauf „Trend-Bot“ ist fehlgeschlagen/.test(m.message) && /#datenstand$/.test(m.click), `Meldung ohne Push-Liste (${m.title})`);
ok(!r.out.includes(TOPIC) && !/Wechselkurse|Trend-Bot/.test(r.out), "Protokoll ohne Kanal und Inhalte");
writeFileSync(join(dir, "resolved.json"), JSON.stringify({ alerts: { new: [], resolved: [{ id: "src:fx", label: "Wechselkurse (EZB)", text: "…" }] } }));
got.length = 0;
r = await node("../scripts/notify.mjs", { NTFY_BASE: NTFY, NTFY_RETRY_MS: "50", NTFY_TOPIC: TOPIC, NOTIFY_MODE: "status", STATUS_JSON: join(dir, "resolved.json") });
ok(got.length === 1 && got[0].title === "RojkoMoney: Daten wieder in Ordnung" && got[0].priority === 2 && got[0].message === "✓ Wieder in Ordnung: Wechselkurse (EZB)", `Behebung gemeldet (${got[0] && got[0].message})`);
writeFileSync(join(dir, "none.json"), JSON.stringify({ alerts: { new: [], resolved: [] } }));
got.length = 0;
r = await node("../scripts/notify.mjs", { NTFY_BASE: NTFY, NTFY_RETRY_MS: "50", NTFY_TOPIC: TOPIC, NOTIFY_MODE: "status", STATUS_JSON: join(dir, "none.json") });
ok(got.length === 0 && /nichts Neues/.test(r.out), "nichts Neues: keine Meldung");
srv.close();
rmSync(dir, { recursive: true, force: true });

if (fail) { console.log(`::error::Daten-Status: ${fail} Fehler`); process.exit(1); }
console.log("Daten-Status: Werktags- und Live-Stunden, Zustände, Probleme, neue und behobene, Lauf mit Dateien und Handy-Meldung stimmen.");

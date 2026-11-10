// Handy-Meldungen (scripts/notify.mjs) mit erfundenen Daten und einem nachgebauten ntfy-Server auf diesem Rechner:
// Push-Liste, Stop und Kursalarme (jede Berührung genau einmal), 200-Tage-Schnitt, große Bewegungen, Analysten, Zahlen und
// Notenwechsel nur im ersten Lauf des Tages, Nachrichten nach Kennung, Wochenbericht, Probe-Meldung, nur ntfy.sh als Ziel,
// und dass die Protokolle weder Kanal noch Kürzel enthalten. Aufruf: node tests/notify.mjs
import { parseWatch, crossed, events, newsEvents, weekly, briefing } from "../scripts/notify.mjs";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let fail = 0;
const check = (ok, msg) => { if (!ok) { fail++; console.log(`✗ ${msg}`); } };
const texts = l => l.map(e => e.text).join("\n");

// 1) Push-Liste aus der Seite
const cfg = parseWatch(JSON.stringify({ v: 1, d: ["NVDA", "KO", "AMD", "bad sym", "NVDA"], w: ["AAPL", "KO", "MSFT"], a: [["AAPL", ">", 200], ["TSLA", "<", 150], ["X", "=", 1], ["MSFT", ">", -5]], s: { NVDA: 100, AAPL: 150, KO: "x" } }));
check(cfg && cfg.d.join() === "NVDA,KO,AMD" && cfg.w.join() === "AAPL,MSFT", `Depot und Merkliste ohne Doppelte und ungültige Kürzel: ${cfg && cfg.d}/${cfg && cfg.w}`);
check(cfg && cfg.a.length === 2 && cfg.a[1].sym === "TSLA" && cfg.a[1].dir === "<", "nur gültige Kursalarme");
check(cfg && JSON.stringify(cfg.s) === '{"NVDA":100}', `Stops nur für Depot-Aktien mit Zahl: ${cfg && JSON.stringify(cfg.s)}`);
check(parseWatch("{kaputt") === null && parseWatch("") === null && parseWatch("[]") === null && parseWatch('{"d":[],"w":[]}') === null, "kaputte oder leere Liste: keine Meldungen");

// 2) Marke erreicht: neue Kerze mit Tief darunter, gleiche Kerze nur mit neuem Tief
const k = (asOf, last, lo1d, hi1d) => ({ asOf, last, lo1d, hi1d });
check(crossed(k("2026-11-09", 105, 103, 106), k("2026-11-10", 102, 99, 104), 100, "down"), "neue Kerze, Tief unter dem Stop: erreicht");
check(!crossed(k("2026-11-10", 102, 99, 104), k("2026-11-10", 101, 99, 104), 100, "down"), "gleiche Kerze ohne neues Tief: nicht noch einmal");
check(crossed(k("2026-11-10", 103, 101, 104), k("2026-11-10", 102, 99.5, 104), 100, "down"), "gleiche Kerze, neues Tief unter dem Stop: erreicht");
check(!crossed(k("2026-11-09", 99, 98, 100), k("2026-11-10", 98, 97, 99), 100, "down"), "schon vorher darunter: keine neue Meldung");
check(crossed(k("2026-11-09", 195, 190, 196), k("2026-11-10", 199, 194, 201), 200, "up") && !crossed(k("2026-11-09", 195, 190, 196), k("2026-11-10", 199, 194, 199.9), 200, "up"), "Alarm nach oben über das Tageshoch");
check(!crossed(null, k("2026-11-10", 98, 97, 99), 100, "down"), "ohne bisherigen Stand: keine Meldung");

// 3) Ereignisse aus altem und neuem Stand
const now = new Date("2026-11-10T09:30:00Z");   // Dienstag, 10:30 Uhr in Wien
const base = (sym, o) => ({ sym, last: 100, lo1d: 99, hi1d: 101, asOf: "2026-11-09", d200: 5, chg1d: 0.5, ...o });
const prev = { updated: "2026-11-09T13:40:00Z", items: [
  base("NVDA", { last: 105, lo1d: 103 }), base("AAPL", { last: 195 }), base("TSLA", { last: 160, d200: 2 }), base("KO", { d200: 0.5 }),
  base("AMD", { chg1d: -1 }), base("MSFT", { rec: { period: "2026-10-01", sb: 5, b: 5, h: 10, s: 0, ss: 0 } }), base("SPY", {}),
] };
const next = { updated: "2026-11-10T09:25:00Z", items: [
  base("NVDA", { last: 102, lo1d: 99, asOf: "2026-11-10" }), base("AAPL", { last: 199, hi1d: 201, asOf: "2026-11-10", earn: { date: "2026-11-11", hour: "amc" } }),
  base("TSLA", { last: 149, lo1d: 148, asOf: "2026-11-10", d200: -3 }), base("KO", { d200: -0.3, asOf: "2026-11-10" }),
  base("AMD", { chg1d: -7.2, asOf: "2026-11-10" }), base("MSFT", { asOf: "2026-11-10", rec: { period: "2026-11-01", sb: 7, b: 6, h: 7, s: 0, ss: 0 }, recPrev: { period: "2026-10-01", sb: 5, b: 5, h: 10, s: 0, ss: 0 } }),
  base("SPY", { asOf: "2026-11-10" }),
] };
const recent = { n: { KO: [38, 45, 50], AAPL: [82, 79, 75], NVDA: [70, 70] } };
let ev = events(cfg, prev, next, recent, now);
const t = texts(ev);
check(/▼ NVDA \(Depot\): Ihr Stop 100,00 wurde erreicht – zuletzt 102,00/.test(t), "Stop erreicht (Depot)");
check(/▲ AAPL \(Merkliste\): Kursalarm über 200,00 erreicht/.test(t), "Kursalarm nach oben");
check(/▼ TSLA \(Kursalarm\): Kursalarm unter 150,00 erreicht/.test(t) && !/TSLA.*200-Tage/.test(t), "Kursalarm für eine Aktie außerhalb von Depot und Merkliste – sonst nichts zu ihr");
check(/▼ KO \(Depot\): fiel unter den 200-Tage-Schnitt \(−0,3 %\).*Halten prüfen/.test(t), "200-Tage-Schnitt gebrochen (Depot)");
check(/▼ AMD \(Depot\): −7,2 % am Handelstag Di\., 10\.11\./.test(t), "große Tagesbewegung");
check(/▲ MSFT \(Merkliste\): Analysten optimistischer: \+15 Punkte bei den Kaufempfehlungen \(jetzt 65 %\)/.test(t), `Analysten-Umschwung: ${t.split("\n").find(l => /MSFT/.test(l))}`);
check(/• AAPL \(Merkliste\): meldet morgen Quartalszahlen \(nach Börsenschluss\)/.test(t), "Zahlen morgen (erster Lauf des Tages)");
check(/▼ KO \(Depot\): Gesamtnote fiel unter 40 \(45 → 38\)/.test(t) && /▲ AAPL \(Merkliste\): Gesamtnote stieg über 80 \(79 → 82\)/.test(t) && !/NVDA.*Gesamtnote/.test(t), "Notenwechsel unter 40 und über 80");
check(ev.length === 9 && ev.filter(e => e.depot && e.level === "down").length === 4, `9 Meldungen, 4 davon Warnungen fürs Depot: ${ev.length}`);
check(!/SPY/.test(t), "Aktien außerhalb der Liste: nichts");
// zweiter Lauf am selben Tag mit derselben Kerze: nichts doppelt, keine Zahlen und Noten mehr
const again = { updated: "2026-11-10T13:40:00Z", items: next.items.map(x => ({ ...x })) };
ev = events(cfg, next, again, recent, new Date("2026-11-10T13:45:00Z"));
check(ev.length === 0, `zweiter Lauf mit gleicher Kerze: keine Meldung (${texts(ev)})`);
// gleiche Kerze, aber Bewegung erst jetzt groß und neues Tief unter dem Stop
const later = { updated: "2026-11-10T13:40:00Z", items: [base("NVDA", { last: 101, lo1d: 98, asOf: "2026-11-10" }), base("AMD", { chg1d: -2, asOf: "2026-11-10" })] };
const later2 = { updated: "2026-11-10T15:00:00Z", items: [base("NVDA", { last: 99, lo1d: 97, asOf: "2026-11-10" }), base("AMD", { chg1d: -6, asOf: "2026-11-10" })] };
ev = events(cfg, later, later2, null, new Date("2026-11-10T15:05:00Z"));
check(ev.length === 1 && /AMD.*−6,0 %/.test(texts(ev)), `gleiche Kerze: Bewegung erst jetzt über 5 % → Meldung, Stop schon vorher berührt → keine (${texts(ev)})`);
// Freitag: Zahlen am Montag
const fri = new Date("2026-11-13T08:30:00Z");
ev = events(cfg, { updated: "2026-11-12T13:40:00Z", items: [base("AAPL", {})] }, { updated: "2026-11-13T08:25:00Z", items: [base("AAPL", { asOf: "2026-11-12", earn: { date: "2026-11-16", hour: "bmo" } })] }, null, fri);
check(/meldet am Mo\., 16\.11\. Quartalszahlen \(vor Börsenbeginn\)/.test(texts(ev)), `Freitag: Zahlen am nächsten Börsentag (${texts(ev)})`);
// ohne bisherigen Stand: nur Zahlen und Noten, keine Kreuzungen
ev = events(cfg, null, next, recent, now);
check(ev.every(e => /Quartalszahlen|Gesamtnote/.test(e.text)) && ev.length === 3, `erster Lauf überhaupt: nur Termine und Noten (${ev.length})`);

// 4) Nachrichten nach Kennung
const sec = now.getTime() / 1000;
const n = (id, type, tone, h = 1, m = 1, title = `${type} headline ${id}`) => ({ id, t: title, d: sec - h * 3600, type, tone, m });
const fresh = {
  NVDA: [n("a1", "downgrade", "neg"), n("a2", "downgrade", "neg", 3), n("a3", "price_target", "pos"), n("a4", "upgrade", "pos", 50), n("a5", "merger", "neu", 2, 0), n("a6", "dividend", "neu"), n("old", "earnings_beat", "pos")],
  AAPL: [n("b1", "guidance_up", "pos"), n("a1", "downgrade", "neg")],
  KO: [n("c1", "dividend", "pos", 2, 1, "Coca-Cola raises dividend")],
  AMD: [n("d1", "legal", "neg")],
};
const old = { NVDA: [n("old", "earnings_beat", "pos")], AAPL: [], KO: [] };   // AMD ohne bisherigen Stand
const nv = newsEvents(cfg, fresh, old, now), nt = texts(nv);
check(/▼ NVDA \(Depot\): Herabstufung – „downgrade headline a1“/.test(nt) && !/a2/.test(nt), "je Art und Aktie nur die neueste");
check(!/a3|a4|a5|a6|old/.test(nt), "ohne Kursziele, ältere als 36 Stunden, bloße Erwähnungen, neutrale Dividenden und schon Bekanntes");
check(/▲ AAPL \(Merkliste\): Prognose angehoben/.test(nt) && (nt.match(/a1/g) || []).length === 1, "gleiche Meldung bei zwei Aktien nur einmal");
check(/▲ KO \(Depot\): Dividende – „Coca-Cola raises dividend“/.test(nt), "Dividendenerhöhung");
check(!/AMD/.test(nt), "ohne bisherigen Stand (erster Lauf): kein Vergleich, keine Flut");
check(nv.length === 3 && nv.filter(e => e.depot && e.level === "down").length === 1, `3 neue Nachrichten, 1 Warnung fürs Depot (${nv.length})`);

// 5) Wochenbericht
const wk = weekly(cfg, { items: [base("NVDA", { ret1w: 4.26, d200: -1, earn: { date: "2026-11-17" } }), base("KO", { ret1w: -1.04 }), base("AMD", { ret1w: null }), base("AAPL", { ret1w: 2.5 }), base("SPY", { ret1w: 1.01 }), base("MSFT", { ret1w: 0, earn: { date: "2026-11-30" } })] },
  { n: { NVDA: [72, 70, 65], KO: [55, 55, 55] } }, now).join("\n");
check(/^Ihr Depot, letzte 5 Handelstage: Ø \+1,6 % \(S&P 500 \+1,0 %\)/.test(wk), `Depot im Schnitt gegen den S&P 500: ${wk.split("\n")[0]}`);
check(/• NVDA \+4,3 % · Note 72 \(▲7\)\n• KO −1,0 % · Note 55\n• AMD –/.test(wk), "Depot sortiert, mit Note und Wochenänderung");
check(/Merkliste:\n• AAPL \+2,5 %\n• MSFT ±0,0 %/.test(wk), "Merkliste");
check(/Zahlen in den nächsten 7 Tagen: NVDA Di\., 17\.11\.$/m.test(wk) && !/MSFT Mo/.test(wk), "Termine der nächsten 7 Tage");
check(/Unter dem 200-Tage-Schnitt: NVDA – Halten prüfen\./.test(wk), "Depot-Aktien unter dem 200-Tage-Schnitt");

// 5b) Morgen-Briefing: Stop erreicht oder nah, Kursalarm in Reichweite, Zahlen heute, Marktlage
check(parseWatch('{"d":["A1"],"b":1}').b === true && parseWatch('{"d":["A1"]}').b === false, "Briefing nur mit \"b\":1 eingeschaltet");
const bCfg = parseWatch(JSON.stringify({ d: ["NVDA", "KO", "AMD"], w: ["AAPL"], a: [["AAPL", ">", 203], ["MSFT", "<", 90]], s: { NVDA: 100, KO: 97, AMD: 50 }, b: 1 }));
const bStocks = { items: [base("NVDA", { last: 99, lo1d: 98 }), base("KO", { last: 99.5, lo1d: 99.2 }), base("AMD", { last: 100 }), base("AAPL", { last: 200, earn: { date: "2026-11-10", hour: "bmo" } }), base("MSFT", { last: 100 })] };
const bl = briefing(bCfg, bStocks, { overall: { light: "red", sizeFactor: 0.5 } }, now).join("\n");
check(/▼ NVDA: Stop 100,00 erreicht/.test(bl) && /! KO: nur 2,6 % über Ihrem Stop 97,00/.test(bl) && !/AMD/.test(bl), `Stops: erreicht und nah, weit weg nicht (${bl.split("\n").length} Zeilen)`);
check(/• AAPL: noch 1,5 % bis zu Ihrem Kursalarm 203,00/.test(bl) && !/MSFT/.test(bl), "Kursalarm in Reichweite, weit entfernte nicht");
check(/• AAPL: Quartalszahlen heute vor Börsenbeginn\./.test(bl), "Zahlen heute (Merkliste ohne Stop-Hinweis)");
check(/Marktlage: Gegenwind – neue Positionen mit 50 % der üblichen Größe\./.test(bl), "Marktlage");
check(briefing({ d: ["AMD"], w: [], a: [], s: {} }, bStocks, null, now).join() === "Heute nichts Dringendes bei Ihren Aktien.", "ruhiger Tag: kurze Meldung");

// 6) Ganzer Lauf mit Dateien und nachgebautem ntfy-Server
const dir = mkdtempSync(join(tmpdir(), "notify-"));
const f = name => join(dir, name);
writeFileSync(f("prev.json"), JSON.stringify(prev)); writeFileSync(f("next.json"), JSON.stringify(next)); writeFileSync(f("recent.json"), JSON.stringify(recent));
for (const [sub, data] of [["new", {}], ["old", old]]) { mkdirSync(join(dir, sub, "co"), { recursive: true }); for (const [sym, items] of Object.entries(data)) writeFileSync(join(dir, sub, "co", `${sym}.json`), JSON.stringify({ sym, items })); }
const got = [];
let status = 200;
const server = createServer((req, res) => { let b = ""; req.on("data", c => { b += c; }); req.on("end", () => { got.push({ method: req.method, url: req.url, body: b }); res.writeHead(status); res.end("{}"); }); });
await new Promise(r => server.listen(0, "127.0.0.1", r));
const NTFY = `http://127.0.0.1:${server.address().port}`;
const TOPIC = "rojko-Test_kanal-9x7Q2mPz";
const WATCH = JSON.stringify({ v: 1, d: ["NVDA", "KO", "AMD"], w: ["AAPL", "MSFT"], a: [["AAPL", ">", 200], ["TSLA", "<", 150]], s: { NVDA: 100 } });
const run = extra => { got.length = 0; return new Promise(res => execFile(process.execPath, [new URL("../scripts/notify.mjs", import.meta.url).pathname],
  { env: { PATH: process.env.PATH, NTFY_BASE: NTFY, NTFY_RETRY_MS: "50", NTFY_TOPIC: TOPIC, PUSH_WATCH: WATCH, ...extra }, timeout: 30000 },
  (err, stdout) => res({ code: err ? err.code ?? 1 : 0, out: stdout }))); };
const secretFree = out => !out.includes(TOPIC) && !/NVDA|AAPL|TSLA|KO\b|AMD|MSFT/.test(out);
const isoNow = new Date().toISOString();
// Ereignisse mit heutigem Datum erzeugen (der Lauf rechnet mit der echten Uhrzeit)
writeFileSync(f("prev-today.json"), JSON.stringify({ ...prev, updated: "2000-01-01T00:00:00Z" }));
writeFileSync(f("next-today.json"), JSON.stringify({ ...next, updated: isoNow }));

let r = await run({ NOTIFY_MODE: "events", STOCKS_PREV: f("prev-today.json"), STOCKS_NEW: f("next-today.json"), NOTE_RECENT: f("recent.json") });
const msg = got.length === 1 ? JSON.parse(got[0].body) : {};
check(r.code === 0 && got.length === 1 && got[0].method === "POST" && got[0].url === "/", `Ereignisse: eine Nachricht per POST an die Wurzel (${got.length}, Code ${r.code})`);
check(msg.topic === TOPIC && /Hinweise zu Ihren Aktien/.test(msg.title) && msg.priority === 4 && msg.tags.includes("warning") && msg.click === "https://shg9d54y9j-langw.github.io/Anna-test/#portfolio", `Inhalt: Kanal, Titel, hohe Priorität bei Depot-Warnungen, Link (${msg.title})`);
check(/Ihr Stop 100,00 wurde erreicht/.test(msg.message || "") && (msg.message || "").split("\n").length >= 6, "Text mit den Meldungen");
check(secretFree(r.out) && /1 Nachricht mit \d+ Punkten gesendet/.test(r.out), `Protokoll ohne Kanal und Kürzel: ${r.out.trim()}`);
got.length = 0;
r = await run({ NOTIFY_MODE: "events", STOCKS_PREV: f("next-today.json"), STOCKS_NEW: f("next-today.json"), NOTE_RECENT: f("recent.json") });
check(got.length === 0 && /nichts Neues/.test(r.out), "nichts Neues: nichts gesendet");
// Nachrichten mit Zeitstempeln relativ zur echten Uhr: erst drei Tage alt (zu alt), dann frisch
const s2 = Date.now() / 1000;
const writeNews = shift => { for (const [sym, items] of Object.entries(fresh)) writeFileSync(join(dir, "new", "co", `${sym}.json`), JSON.stringify({ sym, items: items.map(x => ({ ...x, d: x.d - sec + s2 - shift })) })); };
writeNews(3 * 86400);
r = await run({ NOTIFY_MODE: "news", NEWS_DIR: join(dir, "new"), NEWS_PREV_DIR: join(dir, "old") });
check(got.length === 0 && /nichts Neues/.test(r.out), "Nachrichten von vor drei Tagen: zu alt, nichts gesendet");
writeNews(0);
r = await run({ NOTIFY_MODE: "news", NEWS_DIR: join(dir, "new"), NEWS_PREV_DIR: join(dir, "old") });
const nm = got.length === 1 ? JSON.parse(got[0].body) : {};
check(got.length === 1 && /3 wichtige Nachrichten/.test(nm.title) && nm.tags.includes("newspaper") && nm.priority === 4 && secretFree(r.out), `Nachrichten: eine Meldung mit 3 Punkten (${nm.title})`);
got.length = 0;
r = await run({ NOTIFY_MODE: "weekly", STOCKS_NEW: f("next-today.json"), NOTE_RECENT: f("recent.json") });
const wm = got.length === 1 ? JSON.parse(got[0].body) : {};
check(got.length === 1 && wm.title === "RojkoMoney: Ihr Wochenbericht" && /Ihr Depot, letzte 5 Handelstage/.test(wm.message) && secretFree(r.out), "Wochenbericht gesendet");
got.length = 0;
r = await run({ NOTIFY_MODE: "test", PUSH_WATCH: "" });
const tm = got.length === 1 ? JSON.parse(got[0].body) : {};
check(got.length === 1 && /Probe-Meldung/.test(tm.title) && /fehlt noch das Secret PUSH_WATCH/.test(tm.message), "Probe-Meldung ohne Push-Liste");
got.length = 0;
r = await run({ NOTIFY_MODE: "test" });
check(got.length === 1 && /3 im Depot, 2 auf der Merkliste, 2 Kursalarme, 1 Stops/.test(JSON.parse(got[0].body).message), "Probe-Meldung mit Push-Liste");
got.length = 0;
// Morgen-Briefing: nur wenn eingeschaltet
writeFileSync(f("market.json"), JSON.stringify({ overall: { light: "green", sizeFactor: 1 } }));
r = await run({ NOTIFY_MODE: "briefing", STOCKS_NEW: f("next-today.json"), MARKET: f("market.json") });
check(got.length === 0 && /nicht eingeschaltet/.test(r.out), "Briefing ohne \"b\":1: nichts gesendet");
r = await run({ NOTIFY_MODE: "briefing", STOCKS_NEW: f("next-today.json"), MARKET: f("market.json"), PUSH_WATCH: JSON.stringify({ ...JSON.parse(WATCH), b: 1 }) });
const bm = got.length === 1 ? JSON.parse(got[0].body) : {};
check(got.length === 1 && bm.title === "RojkoMoney: Heute wichtig" && /Marktlage: Rückenwind\./.test(bm.message) && secretFree(r.out), `Briefing gesendet (${bm.title})`);
// lange Liste: höchstens 12 Zeilen und ein Hinweis
const many = { updated: isoNow, items: Array.from({ length: 15 }, (_, i) => base(`S${i}`, { asOf: "2026-11-10", chg1d: -6 - i })) };
const manyPrev = { updated: "2000-01-01T00:00:00Z", items: many.items.map(x => ({ ...x, asOf: "2026-11-09", chg1d: 0 })) };
writeFileSync(f("many.json"), JSON.stringify(many)); writeFileSync(f("many-prev.json"), JSON.stringify(manyPrev));
r = await run({ NOTIFY_MODE: "events", STOCKS_PREV: f("many-prev.json"), STOCKS_NEW: f("many.json"), PUSH_WATCH: JSON.stringify({ d: many.items.map(x => x.sym) }) });
const lm = got.length === 1 ? JSON.parse(got[0].body).message.split("\n") : [];
check(lm.length === 13 && /… und 3 weitere – Details auf der Seite/.test(lm[12]), `lange Liste gekürzt (${lm.length} Zeilen)`);
got.length = 0;
// ohne Einrichtung, falscher Kanal, kaputte Liste, fremde Adresse, Server-Fehler: nichts gesendet, Lauf endet ohne Fehler
r = await run({ NTFY_TOPIC: "" });
check(got.length === 0 && r.code === 0 && /nicht eingerichtet/.test(r.out), "ohne NTFY_TOPIC: nichts zu tun");
r = await run({ NTFY_TOPIC: "kurz" });
check(got.length === 0 && r.code === 0 && /NTFY_TOPIC ungültig/.test(r.out) && !r.out.includes("kurz\n"), "zu kurzer Kanal: Warnung");
r = await run({ PUSH_WATCH: "{kaputt", STOCKS_PREV: f("prev-today.json"), STOCKS_NEW: f("next-today.json") });
check(got.length === 0 && r.code === 0 && /PUSH_WATCH fehlt oder ist ungültig/.test(r.out), "kaputte Push-Liste: Warnung");
for (const bad of ["https://example.com", "https://ntfy.sh.example.com", "http://ntfy.sh", "https://ntfy.sh:8443"]) {
  r = await run({ NTFY_BASE: bad, NOTIFY_MODE: "test" });
  check(got.length === 0 && r.code === 0 && /nur ntfy\.sh/.test(r.out), `fremde Adresse ${bad}: nichts gesendet`);
}
status = 503;
r = await run({ NOTIFY_MODE: "test" });
check(got.length === 3 && r.code === 0 && /::warning::Meldungen aufs Handy: ntfy nicht erreichbar/.test(r.out), `Server-Fehler: 3 Versuche, dann Warnung (${got.length})`);
got.length = 0; status = 400;
r = await run({ NOTIFY_MODE: "test" });
check(got.length === 1 && r.code === 0 && /HTTP 400/.test(r.out), "abgelehnte Nachricht: kein weiterer Versuch");
server.close();
rmSync(dir, { recursive: true, force: true });

// 7) Mit den echten Datenformaten: veröffentlichte Aktien-Daten (Browser-Testdaten oder NOTIFY_REAL_STOCKS), in der
//    Rechenkontrolle auch die Nachrichten des Test-Servers (NOTIFY_REAL_NEWS)
const real = JSON.parse(readFileSync(process.env.NOTIFY_REAL_STOCKS || new URL("./browser/fixtures/stocks.json", import.meta.url), "utf8"));
const [a1, a2, a3] = real.items.filter(x => x.type === "Aktie" && Number.isFinite(x.last) && x.last > 0);
const low1 = Math.min(a1.last, Number.isFinite(a1.lo1d) ? a1.lo1d : a1.last);
const cfgReal = parseWatch(JSON.stringify({ d: [a1.sym, a2.sym], w: [a3.sym], s: { [a1.sym]: +(low1 * 1.01).toFixed(4) } }));
const prevReal = { updated: "2000-01-01T00:00:00Z", items: real.items.map(x => (x === a1 ? { ...x, last: x.last * 1.1, asOf: "2000-01-01" } : x)) };
const evReal = events(cfgReal, prevReal, real, null, now);
check(evReal.some(e => e.sym === a1.sym && /Ihr Stop/.test(e.text)), `echte Aktien-Daten: Stop erkannt (${texts(evReal)})`);
const wkReal = weekly(cfgReal, real, null, now);
check(/^Ihr Depot, letzte 5 Handelstage/.test(wkReal[0] || "") && wkReal.some(l => l.includes(a1.sym)) && wkReal.includes("Merkliste:"), "echte Aktien-Daten: Wochenbericht");
if (process.env.NOTIFY_REAL_NEWS) {
  const nd = process.env.NOTIFY_REAL_NEWS, idx = JSON.parse(readFileSync(join(nd, "news.json"), "utf8"));
  const sym = idx.syms.find(x => { try { return JSON.parse(readFileSync(join(nd, "co", `${x}.json`), "utf8")).items.some(i => i.m && i.type !== "general"); } catch { return false; } });
  const items = sym ? JSON.parse(readFileSync(join(nd, "co", `${sym}.json`), "utf8")).items : [];
  const pick = items.find(i => i.m && ["earnings_beat", "earnings_miss", "guidance_up", "guidance_down", "upgrade", "downgrade", "merger", "offering", "legal", "approval", "rejection", "bankruptcy", "layoffs", "management", "buyback"].includes(i.type));
  if (pick) {
    const newsCfg = { d: [sym], w: [], a: [], s: {} };
    const fresh2 = { [sym]: items.map(i => (i === pick ? { ...i, d: Math.floor(Date.now() / 1000) - 600 } : i)) }, old2 = { [sym]: items.filter(i => i !== pick) };
    const ne = newsEvents(newsCfg, fresh2, old2, new Date());
    check(ne.length === 1 && ne[0].sym === sym, `echte Nachrichten-Daten: neue Meldung erkannt (${texts(ne)})`);
    check(newsEvents(newsCfg, fresh2, fresh2, new Date()).length === 0, "echte Nachrichten-Daten: nichts doppelt");
  } else check(false, "echte Nachrichten-Daten: keine einordbare Firmenmeldung gefunden");
}

if (fail) { console.log(`::error::Handy-Meldungen: ${fail} Fehler`); process.exit(1); }
console.log("Handy-Meldungen: Push-Liste, Stops und Alarme, Trend, Bewegungen, Analysten, Termine, Noten, Nachrichten, Wochenbericht, Probe-Meldung und Schutz der Geheimnisse stimmen.");

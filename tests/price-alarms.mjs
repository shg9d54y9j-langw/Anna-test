// Kursalarme und Stops alle 15 Minuten (scripts/price-alarms.mjs): verschlüsselter Vergleichsstand (Rundlauf, falscher
// Kanal, verändert, auf 512 Byte aufgerundet, kein Klartext), Ereignisse (Stop auch nur kurz unterschritten, jede Berührung
// genau einmal, neuer Tag, Alarm nach oben), Tageskerze aus der eToro-Antwort, und ganze Läufe gegen den nachgebauten
// eToro-Server und einen ntfy-Server auf diesem Rechner: erster Lauf ohne Meldung, Stop gemeldet, nicht doppelt, Alarm,
// neuer Tag, Kennnummern aus dem Stand statt neu gesucht, anderer Kanal = frischer Stand, und kein Kürzel, kein Preis und kein
// Kanal im Protokoll. Aufruf: node tests/price-alarms.mjs
import { seal, unseal, alarmEvents, snapshotOf } from "../scripts/price-alarms.mjs";
import { parseWatch } from "../scripts/notify.mjs";
import { createServer } from "node:http";
import { spawn, execFile } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let fail = 0;
const ok = (c, msg) => { if (!c) { fail++; console.log(`✗ ${msg}`); } };
const TOPIC = "rojko-test-kanal-4711x", OTHER = "rojko-anderer-kanal-0815";

// 1) verschlüsselter Stand
const st = { v: 1, ids: { NVDA: 2002 }, q: { NVDA: { asOf: "2026-11-10", last: 105.25, lo1d: 104, hi1d: 110 } } };
const box = seal(st, TOPIC, new Date("2026-11-11T10:00:00Z"));
const raw = JSON.stringify(box);
ok(box.v === 1 && box.updated === "2026-11-11T10:00:00.000Z" && !/NVDA|105\.25|2002/.test(raw), "Stand verschlüsselt: weder Kürzel noch Preis noch Kennnummer lesbar");
ok(Buffer.from(box.data, "base64").length % 512 === 0, `Länge auf 512 Byte aufgerundet (${Buffer.from(box.data, "base64").length})`);
ok(JSON.stringify(unseal(box, TOPIC)) === JSON.stringify(st), "Rundlauf mit demselben Kanal");
ok(unseal(box, OTHER) === null, "anderer Kanal: nicht lesbar");
const bad = { ...box, data: Buffer.from(Buffer.from(box.data, "base64").map((b, i) => (i === 3 ? b ^ 1 : b))).toString("base64") };
ok(unseal(bad, TOPIC) === null && unseal(null, TOPIC) === null && unseal({ v: 2 }, TOPIC) === null, "verändert oder kaputt: nicht lesbar (frischer Stand statt Fehler)");
ok(seal(st, TOPIC).iv !== seal(st, TOPIC).iv, "jedes Mal neuer Zufallswert");

// 2) Ereignisse
const cfg = parseWatch(JSON.stringify({ v: 1, d: ["NVDA"], w: ["AAPL"], a: [["MSFT", ">", 305], ["AAPL", "<", 200]], s: { NVDA: 100 } }));
const k = (asOf, last, lo1d, hi1d) => ({ asOf, last, lo1d, hi1d });
const t = (p, n) => alarmEvents(cfg, p, n).map(e => e.text).join(" | ");
ok(t({}, { NVDA: k("2026-11-10", 99, 98, 101) }) === "", "ohne bisherigen Stand: keine Meldung");
ok(/NVDA \(Depot\): Ihr Stop 100,00 wurde erreicht – zuletzt 101,00, Tagestief 99,00/.test(t({ NVDA: k("2026-11-10", 103, 102, 104) }, { NVDA: k("2026-11-10", 101, 99, 104) })), "Stop nur kurz unterschritten (Tagestief): gemeldet");
ok(t({ NVDA: k("2026-11-10", 101, 99, 104) }, { NVDA: k("2026-11-10", 100.5, 99, 104) }) === "", "dieselbe Kerze ohne neues Tief: nicht noch einmal");
ok(/Stop 100,00/.test(t({ NVDA: k("2026-11-10", 101, 99, 104) }, { NVDA: k("2026-11-11", 100.5, 98, 102) })), "neuer Tag, wieder darunter: neue Meldung");
ok(/MSFT \(Kursalarm\): Kursalarm über 305,00 erreicht/.test(t({ MSFT: k("2026-11-10", 300, 298, 302) }, { MSFT: k("2026-11-10", 304, 298, 306) })), "Kursalarm nach oben (Tageshoch)");
ok(/AAPL \(Merkliste\): Kursalarm unter 200,00/.test(t({ AAPL: k("2026-11-10", 205, 203, 206) }, { AAPL: k("2026-11-10", 201, 199.5, 206) })), "Kursalarm nach unten auf der Merkliste");
// 3) Tageskerze aus der Antwort: neueste Kerze, Hoch/Tief mindestens bis zum Schlusskurs
const snap = snapshotOf({ candles: [{ instrumentId: 7, candles: [{ fromDate: "2026-11-10T00:00:00Z", high: 110, low: 104, close: 105 }, { fromDate: "2026-11-11T00:00:00Z", high: 106, low: 99, close: 107 }] }] }, 7);
ok(JSON.stringify(snap) === JSON.stringify({ asOf: "2026-11-11", last: 107, lo1d: 99, hi1d: 107 }), `neueste Kerze, Hoch mindestens Schluss (${JSON.stringify(snap)})`);
ok(snapshotOf({ candles: [] }, 7) === null && snapshotOf({}, 7) === null, "ohne Kerzen: kein Stand");

// 4) ganze Läufe
const EPORT = 8797;
const mock = spawn(process.execPath, [new URL("./mock-etoro.mjs", import.meta.url).pathname, String(EPORT)], { stdio: "ignore" });
const got = [];
const ntfy = createServer((req, res) => { let b = ""; req.on("data", c => { b += c; }); req.on("end", () => { got.push(JSON.parse(b || "{}")); res.writeHead(200); res.end("{}"); }); });
await new Promise(r => ntfy.listen(0, "127.0.0.1", r));
await new Promise(r => setTimeout(r, 800));
const api = (p, body) => fetch(`http://127.0.0.1:${EPORT}${p}`, { method: body ? "POST" : "GET", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }).then(r => r.json());
const candle = (d, h, l, c) => ({ fromDate: `${d}T00:00:00Z`, open: c, high: h, low: l, close: c, volume: 1 });
const dir = mkdtempSync(join(tmpdir(), "alarm-"));
const WATCH = JSON.stringify({ v: 1, d: ["NVDA"], w: ["AAPL"], a: [["MSFT", ">", 305]], s: { NVDA: 100 } });
let n = 0;
const run = (extra = {}) => new Promise(res => {
  const out = join(dir, `s${++n}.json`), prev = join(dir, `s${n - 1}.json`);
  got.length = 0;
  execFile(process.execPath, [new URL("../scripts/price-alarms.mjs", import.meta.url).pathname], {
    env: { PATH: process.env.PATH, ETORO_API_BASE: `http://127.0.0.1:${EPORT}/api`, ETORO_THROTTLE_MS: "0", ETORO_API_KEY: "test-public-key-0000", ETORO_USER_KEY: "test-user-key-0000",
      NTFY_BASE: `http://127.0.0.1:${ntfy.address().port}`, NTFY_RETRY_MS: "50", NTFY_TOPIC: TOPIC, PUSH_WATCH: WATCH, ALARM_STATE_IN: prev, ALARM_STATE_OUT: out, ...extra }, timeout: 30000,
  }, (e, stdout) => res({ out: String(stdout || ""), code: e ? e.code : 0, state: out }));
});
const secretFree = s => !/NVDA|MSFT|AAPL|rojko-|105|101|99,|310|305|100,00/.test(s);
try {
  await api("/__test/candles", { id: 2002, candles: [candle("2026-11-09", 109, 103, 106), candle("2026-11-10", 110, 104, 105)] });
  await api("/__test/candles", { id: 2001, candles: [candle("2026-11-10", 300, 290, 295)] });
  await api("/__test/calls");
  let r = await run();
  ok(r.code === 0 && got.length === 0 && /2 Aktien beobachtet, 2 Kurse geholt – erster Stand/.test(r.out) && existsSync(r.state), `erster Lauf: nur Stand anlegen, keine Meldung (${r.out.trim()})`);
  const env1 = JSON.parse(readFileSync(r.state, "utf8")), bytes = Buffer.from(env1.data, "base64").toString("latin1");
  ok(secretFree(r.out) && Object.keys(env1).sort().join() === "data,iv,tag,updated,v" && !/NVDA|MSFT|"ids"|"q"/.test(bytes), "Protokoll ohne Kürzel, Preise oder Kanal; gespeichert nur der verschlüsselte Umschlag");
  const calls1 = (await api("/__test/calls")).calls;
  ok(calls1.filter(c => c.startsWith("/api/v2/market-data/instruments")).length === 2, `Kennnummern einmal gesucht (${calls1.length} Abfragen)`);

  // Stop kurz unterschritten (Tagestief 99), Kurs wieder darüber
  await api("/__test/candles", { id: 2002, candles: [candle("2026-11-09", 109, 103, 106), candle("2026-11-10", 110, 99, 101)] });
  r = await run();
  const m = got[0] || {};
  ok(r.code === 0 && got.length === 1 && m.topic === TOPIC && m.title === "RojkoMoney: Stop erreicht" && m.priority === 4 && /NVDA \(Depot\): Ihr Stop 100,00 wurde erreicht/.test(m.message), `Stop gemeldet (${m.title})`);
  ok(/1 Meldung/.test(r.out) && secretFree(r.out), `Protokoll nur mit Anzahlen (${r.out.trim().split("\n").pop()})`);
  const calls2 = (await api("/__test/calls")).calls;
  ok(calls2.length === 2 && calls2.every(c => /\/history\/candles\/desc\/OneDay\/2$/.test(c)), `Kennnummern aus dem verschlüsselten Stand, nur Kerzen abgefragt (${calls2.length})`);
  r = await run();
  ok(got.length === 0 && /0 Meldungen/.test(r.out), "gleiche Kerze, kein neues Tief: keine zweite Meldung");

  // Kursalarm nach oben (Tageshoch 310)
  await api("/__test/candles", { id: 2001, candles: [candle("2026-11-10", 310, 290, 304)] });
  r = await run();
  ok(got.length === 1 && got[0].title === "RojkoMoney: Kursalarm" && got[0].priority === 3 && /MSFT \(Kursalarm\): Kursalarm über 305,00 erreicht – zuletzt 304,00/.test(got[0].message), `Kursalarm gemeldet (${got[0] && got[0].title})`);

  // neuer Tag: wieder unter den Stop
  await api("/__test/candles", { id: 2002, candles: [candle("2026-11-10", 110, 99, 101), candle("2026-11-11", 102, 98, 99.5)] });
  r = await run();
  ok(got.length === 1 && /Stop 100,00 wurde erreicht – zuletzt 99,50, Tagestief 98,00/.test(got[0].message), "neuer Tag, wieder darunter: neue Meldung");

  // anderer Kanal: alter Stand nicht lesbar → frisch beginnen, keine Meldung
  r = await run({ NTFY_TOPIC: OTHER });
  ok(got.length === 0 && /erster Stand/.test(r.out), "anderer Kanal: Stand nicht lesbar, frisch begonnen");

  // nicht eingerichtet / nichts zu prüfen
  r = await run({ NTFY_TOPIC: "" });
  ok(r.code === 0 && /nicht eingerichtet/.test(r.out) && !existsSync(r.state), "ohne Kanal: nichts geprüft, nichts geschrieben");
  await api("/__test/calls");
  r = await run({ PUSH_WATCH: JSON.stringify({ v: 1, d: ["NVDA"], w: [] }) });
  ok(/keine Kursalarme oder Stops/.test(r.out) && (await api("/__test/calls")).calls.length === 0 && !existsSync(r.state), "ohne Alarme und Stops: keine Abfrage");
} finally {
  mock.kill(); ntfy.close();
  rmSync(dir, { recursive: true, force: true });
}

if (fail) { console.log(`::error::Kursalarme: ${fail} Fehler`); process.exit(1); }
console.log("Kursalarme: Verschlüsselung, Ereignisse, Kerzen und ganze Läufe (Stop, Alarm, neuer Tag, keine Doppelmeldung, nichts Geheimes im Protokoll) stimmen.");

// Prüft den Trend-Bot gegen den nachgebauten eToro-Server: jede Gruppe startet mit frischem Server und Demokonto.
// Die Uhrzeit wird über TREND_NOW vorgegeben (Handelstage, US-Börse offen bzw. geschlossen).
// Aufruf: node tests/trend-bot-scenarios.mjs
import { spawn, execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isTradingDay, weekOf } from "../scripts/trend-bot.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const dir = await mkdtemp(join(tmpdir(), "trend-test-"));
let failures = 0, port = 8900;
const check = (ok, text) => { console.log(`${ok ? "✓" : "✗"} ${text}`); if (!ok) failures++; };

// Testtage: ein Montag (Handelstag, nicht in der Zukunft), der Dienstag danach und der Montag eine Woche später
const iso = t => t.toISOString().slice(0, 10);
let mon = new Date(); mon.setUTCHours(12, 0, 0, 0);
// alle Testtage liegen in der Vergangenheit, damit der Test-Server für jeden Tag Kurse hat
while (mon.getUTCDay() !== 1 || ![0, 1, 7, 8].every(k => isTradingDay(iso(new Date(mon.getTime() + k * 864e5)))) || new Date(mon.getTime() + 8 * 864e5) > new Date()) mon = new Date(mon.getTime() - 864e5);
const day = (offset, hh = "16:00") => `${iso(new Date(mon.getTime() + offset * 864e5))}T${hh}:00Z`;
const D1 = day(0), D2 = day(1), NEXT = day(7), NEXT2 = day(8), SATURDAY = day(5), NIGHT = day(0, "03:00");

async function withServer(name, fn) {
  console.log(`\n— ${name}`);
  const p = ++port;
  const srv = spawn(process.execPath, [join(root, "tests/mock-etoro.mjs"), String(p)], { stdio: ["ignore", "pipe", "inherit"] });
  await new Promise(r => srv.stdout.once("data", r));
  const api = path => `http://localhost:${p}${path}`;
  const acct = async () => (await fetch(api("/__test/trend?account=demo"))).json();
  const ctl = (path, body = {}) => fetch(api(`${path}?account=demo`), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const files = { sig: join(dir, `${p}-signals.json`), state: join(dir, `${p}-state.json`) };
  let n = 0;
  const exec = (args, env) => new Promise(resolve => execFile(process.execPath, [join(root, "scripts/trend-bot.mjs"), ...args], {
    env: { PATH: process.env.PATH, ETORO_API_BASE: `http://localhost:${p}/api`, FRED_BASE: `http://localhost:${p}/fred`, ETORO_THROTTLE_MS: "0", TREND_POLL_MS: "5", ETORO_API_KEY: "test-key-0000", ETORO_USER_KEY: "test-user-0000", ...env },
  }, (err, stdout) => resolve({ code: err ? err.code : 0, log: stdout })));
  // Ein Lauf wie im Workflow: Signale mit dem Lese-Schlüssel, dann Handel mit dem Bot-Schlüssel
  const run = async (now, command = "status", env = {}) => {
    const out = join(dir, `${p}-state-${++n}.json`);
    const sig = await exec(["signals"], { TREND_NOW: now, TREND_SIGNALS_OUT: files.sig });
    const r = await exec(["trade"], { TREND_NOW: now, TREND_SIGNALS_IN: files.sig, TREND_STATE_IN: files.state, TREND_OUT: out, TREND_BOT_COMMAND: command, ...env });
    let s = null;
    try { s = JSON.parse(await readFile(out, "utf8")); await writeFile(files.state, JSON.stringify(s)); } catch {}
    return { ...r, sigCode: sig.code, s };
  };
  try { await fn({ run, acct, ctl, files }); } finally { srv.kill(); }
}
const opens = a => a.tradeOps.filter(o => o.path.endsWith("/by-amount"));
const closes = a => a.tradeOps.filter(o => o.path.includes("market-close-orders"));

await withServer("Ohne Schlüssel und nicht gestartet", async ({ run, acct }) => {
  let r = await run(D1, "starten", { ETORO_API_KEY: "", ETORO_USER_KEY: "" });
  check(r.code === 0 && r.s && r.s.setup === false, "ohne Bot-Schlüssel: als „nicht eingerichtet“ gemeldet, kein Absturz");
  check(r.s.enabled === false && r.s.newEvents.some(e => e.kind === "fehler"), "Start ohne Schlüssel wird abgelehnt (der Bot springt später nicht überraschend an)");
  r = await run(D1, "status");
  const a = await acct();
  check(r.code === 0 && a.tradeOps.length === 0, "ohne Start: kein einziger Auftrag");
  check(r.s.signals && r.s.signals.assets.length === 6 && r.s.backtest && r.s.backtest.daily, "Signale und Rückblick-Test stehen trotzdem für die Website bereit");
});

await withServer("Start, gleicher Tag, Ihre eigene Position", async ({ run, acct, ctl }) => {
  await ctl("/__test/manual-position", { sym: "SPY", amount: 5000 });
  const before = await acct();
  const manual = before.positions[0];
  let r = await run(D1, "starten");
  let a = await acct();
  const o = opens(a);
  const sig = r.s.signals;
  const want = sig.assets.filter(x => x.weightBase > 0);
  check(r.code === 0 && r.s.enabled === true && r.s.newEvents.some(e => e.kind === "gestartet"), "Start-Befehl: Bot läuft und meldet den Start");
  check(o.length === want.length, `kauft genau die ETFs mit Trend (${o.length} von ${want.length})`);
  check(o.every(x => x.body.Leverage === 1 && x.body.IsBuy === true && x.body.IsNoTakeProfit === true), "nur Kauf ohne Hebel");
  const priceOf = id => a.prices[sig.assets.find(x => x.instrumentId === id).sym];
  check(o.every(x => Math.abs(x.body.StopLossRate / priceOf(x.body.InstrumentID) - 0.7) < 0.05), "jede Position mit Notbremse 30 % unter dem Kurs");
  const equity = 100000;   // Startguthaben des Testkontos (eigene Position ist Teil des Kontos)
  const okAmounts = want.every(x => { const b = o.find(y => y.body.InstrumentID === x.instrumentId); return b && Math.abs(b.body.Amount - x.weightBase * 0.5 * equity) <= equity * 0.01; });
  check(okAmounts, "Beträge = Zielanteil × 50 % des Kontos");
  check(r.s.positions.length === want.length && r.s.orders.length === 0, "alle Käufe bestätigt und als Bot-Positionen gemerkt");
  check(!r.s.positions.some(x => x.positionID === manual.positionID), "Ihre eigene SPY-Position gehört nicht zum Bot");
  check(r.s.journal.length === 1 && r.s.journal[0].trades.length === want.length && Math.abs(r.s.journal[0].model - 100) < 0.5, "Tagebuch: erster Eintrag mit allen Käufen, Modell-Depot startet bei 100 (abzüglich Kaufkosten)");
  const n = a.tradeOps.length;
  r = await run(D1.replace("16:00", "17:30"), "status");
  a = await acct();
  check(a.tradeOps.length === n, "zweiter Lauf am selben Tag: kein weiterer Auftrag");
  r = await run(D2, "status");
  a = await acct();
  check(a.positions.some(x => x.positionID === manual.positionID), "Ihre eigene Position bleibt unberührt");
  check(JSON.stringify(r.s).indexOf("Amount") === -1 && !/\d{4,}\.\d+ ?\$/.test(JSON.stringify(r.s.journal)), "Tagebuch ohne Dollar-Beträge");
  check(a.realTradeOps.length === 0, "keine einzige Echtgeld-Adresse aufgerufen");
});

await withServer("Trend bricht mitten in der Woche, volle Umschichtung erst am Montag", async ({ run, acct, ctl }) => {
  let r = await run(D1, "starten");
  const gld = r.s.signals.assets.find(x => x.sym === "GLD");
  const had = r.s.positions.filter(x => x.key === "gold").length;
  await ctl("/__test/regime", { sym: "GLD", drift: -0.012 });   // Gold fällt seit Wochen kräftig
  await ctl("/__test/regime", { sym: "VNQ", drift: 0.004 });    // Immobilien steigen stärker (Anteil würde sich ändern)
  const n = (await acct()).tradeOps.length;
  r = await run(D2, "status");
  let a = await acct();
  const g2 = r.s.signals.assets.find(x => x.sym === "GLD");
  const newOps = a.tradeOps.slice(n);
  check(had > 0 && g2.score === 0, `Gold: Trend vorher ${gld.score * 4}/4, jetzt 0/4`);
  check(newOps.length > 0 && newOps.every(x => x.path.includes("market-close-orders") && x.body.InstrumentID === gld.instrumentId), "Dienstag: Gold wird sofort verkauft – sonst nichts");
  check(r.s.positions.filter(x => x.key === "gold").every(x => x.closing) && !a.positions.some(x => x.instrumentID === gld.instrumentId) && r.s.journal.at(-1).trades.some(t => t.sym === "GLD" && t.side === "verkauf"), "Gold-Positionen geschlossen, Tagebuch vermerkt den Ausstieg");
  r = await run(NEXT, "status");
  a = await acct();
  check(r.s.lastFullWeek === weekOf(NEXT.slice(0, 10)), "nächster Montag: volle Umschichtung durchgeführt");
  check(r.s.journal.length === 3 && r.s.journal.every(j => Number.isFinite(j.model)), "Tagebuch: ein Eintrag pro Handelstag mit Modell-Depot");
  check(a.realTradeOps.length === 0, "keine Echtgeld-Adresse");
});

await withServer("Offener Auftrag und unklare Bestätigung", async ({ run, acct, ctl }) => {
  await ctl("/__test/pending-next-open");
  let r = await run(D1, "starten");
  let a = await acct();
  check(a.pendingOpen.length === 1 && r.s.orders.length === 1, "erster Kauf wartet bei eToro (Börse noch zu) – Auftrag gemerkt");
  const n = a.tradeOps.length;
  r = await run(NEXT, "status");   // Montag = volle Umschichtung: ohne Sperre würde der Bot den fehlenden ETF nachkaufen
  a = await acct();
  check(a.tradeOps.length === n, "solange ein Auftrag offen ist: nichts Neues kaufen (keine Doppelkäufe)");
  await ctl("/__test/fill-pending");
  r = await run(NEXT2, "status");
  a = await acct();
  check(r.s.orders.length === 0 && r.s.positions.length >= 1 && r.s.positions.some(x => a.positions.some(y => y.positionID === x.positionID && y.orderID)), "ausgeführter Auftrag wird über die Auftragsnummer übernommen");
});

await withServer("Bestätigung verspätet, Position mit anderer Auftragsnummer", async ({ run, acct, ctl }) => {
  await ctl("/__test/trend-flags", { slowConfirm: true, foreignOrderIds: true });
  let r = await run(D1, "starten");
  let a = await acct();
  const n = opens(a).length;
  check(n > 0 && r.s.orders.length === n && r.s.positions.length === 0, `${n} Käufe gesendet, eToro bestätigt noch nicht – als unbestätigt gemerkt`);
  const firstBuys = opens(a).map(x => x.body.InstrumentID), firstOrders = r.s.orders.map(o => o.orderID);
  r = await run(NEXT, "status");   // Montag = volle Umschichtung: ohne Zuordnung würde der Bot alles noch einmal kaufen
  a = await acct();
  check(!r.s.orders.some(o => firstOrders.includes(o.orderID)) && firstBuys.every(id => r.s.positions.some(x => x.instrumentID === id)), "nächster Lauf: alle Positionen vom Vortag über ETF und Zeitpunkt zugeordnet");
  const again = r.s.journal.at(-1).trades.filter(x => x.side === "kauf" && x.reason.includes("Einstieg"));
  check(again.length === 0, `kein zweiter Einstieg in denselben ETF (höchstens normales Aufstocken: ${r.s.journal.at(-1).trades.map(x => `${x.sym} ${x.reason}`).join(", ") || "nichts"})`);
});

await withServer("Bestätigung kommt erst beim nächsten Lauf", async ({ run, acct, ctl }) => {
  await ctl("/__test/trend-flags", { slowConfirm: true });
  let r = await run(D1, "starten");
  const n = opens(await acct()).length;
  check(r.s.orders.length === n && r.s.positions.length === 0, "Käufe noch unbestätigt");
  await ctl("/__test/confirm-orders");
  r = await run(D2, "status");
  check(r.s.orders.length === 0 && r.s.positions.length === n && opens(await acct()).length === n, "nächster Lauf: bestätigte Käufe übernommen, nichts doppelt");
});

await withServer("Kauf ohne Bestätigung wird nie doppelt gesendet", async ({ run, acct, ctl }) => {
  await ctl("/__test/fail-next-open");
  let r = await run(D1, "starten");
  let a = await acct();
  const first = opens(a)[0];
  check(opens(a).filter(x => x.body.InstrumentID === first.body.InstrumentID).length === 1 && r.s.uncertain.length === 1, "keine Bestätigung: nicht noch einmal gesendet, als unklar gemerkt");
  check(r.s.newEvents.some(e => e.kind === "unklar"), "unklarer Kauf wird gemeldet");
  r = await run(D2, "status");
  a = await acct();
  check(r.s.uncertain.length === 0 && r.s.positions.some(x => x.instrumentID === first.body.InstrumentID), "nächster Lauf: tatsächlich ausgeführte Position wird übernommen");
  check(opens(a).filter(x => x.body.InstrumentID === first.body.InstrumentID).length === 1, "auch danach kein zweiter Kauf desselben ETF");
});

await withServer("Börse geschlossen, veraltete Kurse, Stoppen", async ({ run, acct, ctl }) => {
  let r = await run(NIGHT, "starten");
  let a = await acct();
  check(r.s.enabled === true && a.tradeOps.length === 0 && r.s.waiting, "Start nachts: Bot ist an, kauft aber erst während der Handelszeit");
  r = await run(SATURDAY, "status");
  a = await acct();
  check(a.tradeOps.length === 0, "Samstag: kein Auftrag");
  r = await run(D1, "status", { TREND_SIGNALS_IN: "/nonexistent.json" });
  a = await acct();
  check(a.tradeOps.length === 0, "ohne gültige Signale: kein Auftrag");
  r = await run(D1, "status");
  a = await acct();
  const botPositions = r.s.positions.length;
  check(botPositions > 0, "Handelszeit: Bot kauft");
  await ctl("/__test/manual-position", { sym: "IEF", amount: 3000 });
  const manual = (await acct()).positions.find(x => !r.s.positions.some(y => y.positionID === x.positionID));
  r = await run(D2, "stoppen");
  a = await acct();
  check(r.s.enabled === false && r.s.newEvents.some(e => e.kind === "gestoppt"), "Stopp-Befehl: Bot aus, Stopp gemeldet");
  check(closes(a).length === botPositions && a.positions.length === 1 && a.positions[0].positionID === manual.positionID, "alle Bot-Positionen verkauft, Ihre eigene bleibt");
  check(r.s.journal.at(-1).trades.some(t => t.reason === "Bot gestoppt"), "Tagebuch vermerkt den Stopp");
  const n = a.tradeOps.length;
  r = await run(NEXT, "status");
  check((await acct()).tradeOps.length === n, "nach dem Stopp: keine Aufträge mehr");
  check((await acct()).realTradeOps.length === 0, "keine Echtgeld-Adresse");
});

await withServer("Wenig freies Geld", async ({ run, acct, ctl }) => {
  await ctl("/__test/manual-position", { sym: "SPY", amount: 85000 });   // Ihr eigenes Geld ist fast ganz investiert
  const r = await run(D1, "starten");
  const a = await acct();
  const spent = opens(a).reduce((s, x) => s + x.body.Amount, 0);
  check(spent <= 15000 - 1000 + 1 && a.credit >= 999, `Käufe nur bis zum freien Geld, 1 % Reserve bleibt (${Math.round(spent)} $ gekauft)`);
  check(!r.s.newEvents.some(e => e.kind === "fehler"), "kein abgewiesener Auftrag");
  check(r.code === 0, "läuft ohne Fehler durch");
});

console.log(failures ? `\n${failures} Prüfung(en) fehlgeschlagen.` : "\nAlle Trend-Bot-Prüfungen bestanden.");
process.exit(failures ? 1 : 0);

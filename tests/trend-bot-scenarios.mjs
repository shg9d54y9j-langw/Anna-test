// Prüft den Trend-Bot gegen den nachgebauten eToro-Server: jede Gruppe startet mit frischem Server und Demokonto.
// Die Uhrzeit wird über TREND_NOW vorgegeben (Handelstage, Börse in London/Frankfurt offen bzw. geschlossen).
// Wie das echte Konto lehnt der Test-Server US-ETFs ab (CFD gesperrt) – gekauft werden europäische UCITS-Gegenstücke.
// Aufruf: node tests/trend-bot-scenarios.mjs
import { spawn, execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isTradingDay, isEuTradingDay, weekOf } from "../scripts/trend-bot.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const dir = await mkdtemp(join(tmpdir(), "trend-test-"));
let failures = 0, port = 8900;
const check = (ok, text) => { console.log(`${ok ? "✓" : "✗"} ${text}`); if (!ok) failures++; };

// Testtage: ein Montag (Handelstag, nicht in der Zukunft), der Dienstag danach und der Montag eine Woche später
const iso = t => t.toISOString().slice(0, 10);
let mon = new Date(); mon.setUTCHours(12, 0, 0, 0);
// alle Testtage liegen in der Vergangenheit, damit der Test-Server für jeden Tag Kurse hat
const tradable = day => isTradingDay(day) && isEuTradingDay(day);
while (mon.getUTCDay() !== 1 || ![0, 1, 7, 8].every(k => tradable(iso(new Date(mon.getTime() + k * 864e5)))) || new Date(mon.getTime() + 8 * 864e5) > new Date()) mon = new Date(mon.getTime() - 864e5);
// 13:00 UTC: London und Frankfurt sind im Winter wie im Sommer offen
const day = (offset, hh = "13:00") => `${iso(new Date(mon.getTime() + offset * 864e5))}T${hh}:00Z`;
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
  const run = async (now, command = "status", env = {}, presetState = null) => {
    const out = join(dir, `${p}-state-${++n}.json`);
    if (presetState) await writeFile(files.state, JSON.stringify(presetState));
    const sig = await exec(["signals"], { TREND_NOW: now, TREND_SIGNALS_OUT: files.sig });
    const r = await exec(["trade"], { TREND_NOW: now, TREND_SIGNALS_IN: files.sig, TREND_STATE_IN: files.state, TREND_OUT: out, TREND_BOT_COMMAND: command, ...env });
    let s = null;
    try { s = JSON.parse(await readFile(out, "utf8")); await writeFile(files.state, JSON.stringify(s)); } catch {}
    return { ...r, sigCode: sig.code, s };
  };
  // Euro-Kurs des Test-Servers (letzter Wert), mit dem der Bot sein Spielgeld in Dollar umrechnet
  const fx = async () => Number((await (await fetch(api(`/fred?id=DEXUSEU&cosd=${new Date(Date.now() - 45 * 864e5).toISOString().slice(0, 10)}`))).text()).trim().split("\n").pop().split(",")[1]);
  try { await fn({ run, acct, ctl, files, fx }); } finally { srv.kill(); }
}
const opens = a => a.tradeOps.filter(o => o.path.endsWith("/by-amount"));
const closes = a => a.tradeOps.filter(o => o.path.includes("market-close-orders"));
const usIds = sig => new Set(sig.assets.map(x => x.instrumentId));   // US-ETFs (im Konto nur als CFD – gesperrt)
const accepted = (a, sig) => opens(a).filter(x => !usIds(sig).has(x.body.InstrumentID));
const assetOf = (sig, id) => sig.assets.find(x => x.trade.some(v => v.id === id));
// So muss der Bot im Test-Server auswählen (Fallen siehe tests/mock-etoro.mjs); zuletzt immer der US-ETF selbst
const EXPECTED = { us: ["VUAA.L", "SXR8.DE", "SPY"], intl: ["EXUS.L", "EXUS.DE", "VEA"], bonds: ["CBU0.L", "IEF"], gold: ["IGLN.L", "SGLD.L", "GLD"], commod: ["CMOD.L", "ICOM.L", "PDBC"], reits: ["VNQ"] };

await withServer("Ohne Schlüssel und nicht gestartet", async ({ run, acct }) => {
  let r = await run(D1, "starten", { ETORO_API_KEY: "", ETORO_USER_KEY: "" });
  check(r.code === 0 && r.s && r.s.setup === false, "ohne Bot-Schlüssel: als „nicht eingerichtet“ gemeldet, kein Absturz");
  check(r.s.enabled === false && r.s.newEvents.some(e => e.kind === "fehler"), "Start ohne Schlüssel wird abgelehnt (der Bot springt später nicht überraschend an)");
  r = await run(D1, "status");
  const a = await acct();
  check(r.code === 0 && a.tradeOps.length === 0, "ohne Start: kein einziger Auftrag");
  check(r.s.signals && r.s.signals.assets.length === 6 && r.s.backtest && r.s.backtest.daily, "Signale und Rückblick-Test stehen trotzdem für die Website bereit");
  const got = Object.fromEntries(r.s.signals.assets.map(x => [x.key, x.trade.map(v => v.sym)]));
  check(JSON.stringify(got) === JSON.stringify(EXPECTED), `Gegenstücke richtig gewählt (gegenläufige, währungsgesicherte, kurslose und unsauber benannte übersprungen): ${JSON.stringify(got)}`);
  const cash = r.s.signals.cash;
  check(cash && cash.trade.map(v => v.sym).join() === "IB01.L,BB3M.L", `Geldmarkt-ETF gefunden (IB01.L, BB3M.L; IBTA.L mit 1–3 Jahren nicht): ${cash && cash.trade.map(v => v.sym)}`);
  const A = Object.fromEntries(r.s.signals.assets.map(x => [x.key, x]));
  check(A.us.core === 0.3 && A.bonds.core === 0.2 && ["intl", "gold", "commod", "reits"].every(k => A[k].core === 0), "fester Kern: 30 % S&P 500 und 20 % Anleihen (die Hälfte des Geldes als 60/40)");
  check(r.s.signals.assets.every(x => Math.abs(x.weight - x.core - x.trend) < 1e-3) && r.s.signals.assets.every(x => x.trend <= 0.5 * 0.35 + 1e-9), "Anteil = Kern + Trend-Teil, Trend-Teil je ETF höchstens 17,5 % (35 % der Hälfte)");
  check(Math.abs(r.s.signals.assets.reduce((a, x) => a + x.weight, 0) + cash.weight - 1) < 1e-3, "Märkte + Geldmarkt = 100 %");
});

await withServer("Start, gleicher Tag, Ihre eigene Position", async ({ run, acct, ctl, fx }) => {
  await ctl("/__test/regime", { sym: "VNQ", drift: 0.004 });   // Immobilien im Aufwärtstrend: der Bot will sie kaufen, hat aber nur den US-ETF
  await ctl("/__test/manual-position", { sym: "VUAA.L", amount: 5000 });
  const before = await acct();
  const manual = before.positions[0];
  let r = await run(D1, "starten");
  let a = await acct();
  const o = opens(a);
  const sig = r.s.signals;
  const sleeve = 1000 * await fx();   // 1.000 € Spielgeld in Dollar
  const want = sig.assets.filter(x => x.weight * sleeve >= 25), vnq = sig.assets.find(x => x.key === "reits");
  const cashBuy = opens(a).find(x => x.body.InstrumentID === a.ids["IB01.L"]);
  check(r.code === 0 && r.s.enabled === true && r.s.newEvents.some(e => e.kind === "gestartet" && /1\.000 € Spielgeld/.test(e.text)), "Start-Befehl: Bot läuft und meldet den Start mit 1.000 € Spielgeld");
  check(cashBuy && Math.abs(cashBuy.body.Amount - sig.cash.weight * sleeve) <= 0.5 && opens(a).at(-1) === cashBuy, `freies Geld zuletzt in den Geldmarkt (IB01.L, ${cashBuy && cashBuy.body.Amount} $)`);
  check(r.s.budgetEur === 1000 && r.s.capitalEur === 1000 && r.s.fx && r.s.fx.value > 1, `Spielgeld 1.000 €, Euro-Kurs ${r.s.fx && r.s.fx.value} vom ${r.s.fx && r.s.fx.asOf}`);
  check(vnq.weight > 0 && o.length === want.length + 1, `ein Kaufauftrag je Markt mit Anteil plus Geldmarkt (${o.length} von ${want.length + 1})`);
  check(want.filter(x => x.key !== "reits").every(x => o.some(y => y.body.InstrumentID === x.trade[0].id)), "gekauft wird das erste europäische Gegenstück, nicht der US-ETF");
  check(o.every(x => x.body.Leverage === 1 && x.body.IsBuy === true && x.body.IsNoTakeProfit === true), "nur Kauf ohne Hebel");
  const priceOf = id => a.prices[Object.keys(a.ids).find(k => a.ids[k] === id)];
  check(o.every(x => Math.abs(x.body.StopLossRate / priceOf(x.body.InstrumentID) - 0.7) < 0.05), "jede Position mit Notbremse 30 % unter dem Kurs des gekauften ETF");
  const okAmounts = want.every(x => { const b = o.find(y => assetOf(sig, y.body.InstrumentID) === x); return b && Math.abs(b.body.Amount - x.weightBase * sleeve) <= 0.5; });
  check(okAmounts, `Beträge = Zielanteil × 1.000 € Spielgeld (${Math.round(sleeve)} $): ${o.map(x => x.body.Amount).join(", ")}`);
  check(r.s.positions.length === want.length && r.s.orders.length === 0, "alle anderen Käufe (mit Geldmarkt) bestätigt und als Bot-Positionen gemerkt");
  check(r.s.blocked[vnq.instrumentId] && r.s.blocked[vnq.instrumentId].code === 797 && r.s.newEvents.some(e => e.kind === "abgelehnt" && /CFD/.test(e.text)), "US-ETF VNQ von eToro abgelehnt (CFD gesperrt): gesperrt und gemeldet");
  check(r.s.newEvents.some(e => e.kind === "hinweis" && e.text.includes("Immobilien")), "kein anderes Gegenstück: Hinweis, Anteil bleibt Geld");
  check(!r.s.positions.some(x => x.positionID === manual.positionID), "Ihre eigene VUAA-Position gehört nicht zum Bot");
  const j = r.s.journal[0];
  check(r.s.journal.length === 1 && j.trades.length === want.length + 1 && j.trades.filter(t => t.rejected).length === 1 && Math.abs(j.model - 100) < 0.5, "Tagebuch: erster Eintrag mit allen Käufen (einer als abgelehnt markiert), Modell-Depot startet bei 100");
  const n = a.tradeOps.length;
  r = await run(D1.replace("13:00", "14:30"), "status");
  a = await acct();
  check(a.tradeOps.length === n, "zweiter Lauf am selben Tag: kein weiterer Auftrag");
  r = await run(D2, "status");
  a = await acct();
  check(a.positions.some(x => x.positionID === manual.positionID), "Ihre eigene Position bleibt unberührt");
  check(JSON.stringify(r.s).indexOf("Amount") === -1 && !/\d{4,}\.\d+ ?\$/.test(JSON.stringify(r.s.journal)), "Tagebuch ohne Dollar-Beträge");
  r = await run(NEXT, "status");   // nächster Montag, volle Umschichtung
  a = await acct();
  check(opens(a).filter(x => x.body.InstrumentID === vnq.instrumentId).length === 1, "gesperrter US-ETF wird nicht noch einmal versucht");
  check(r.s.target.reits === 0 && Math.abs(r.s.target.cash - (r.s.signals.cash.weight + r.s.signals.assets.find(x => x.key === "reits").weight)) < 1e-3, "Immobilien nicht kaufbar: ihr Anteil kommt verzinst in den Geldmarkt");
  check(a.realTradeOps.length === 0, "keine einzige Echtgeld-Adresse aufgerufen");
});

await withServer("Trend bricht mitten in der Woche, volle Umschichtung erst am Montag", async ({ run, acct, ctl }) => {
  let r = await run(D1, "starten");
  const gld = r.s.signals.assets.find(x => x.sym === "GLD"), goldIds = new Set(gld.trade.map(v => v.id));
  const had = r.s.positions.filter(x => x.key === "gold").length;
  await ctl("/__test/regime", { sym: "GLD", drift: -0.012 });   // Gold fällt seit Wochen kräftig
  await ctl("/__test/regime", { sym: "VNQ", drift: 0.004 });    // Immobilien steigen stärker (Anteil würde sich ändern)
  const n = (await acct()).tradeOps.length;
  r = await run(D2, "status");
  let a = await acct();
  const g2 = r.s.signals.assets.find(x => x.sym === "GLD");
  const newOps = a.tradeOps.slice(n);
  check(had > 0 && g2.score === 0, `Gold: Trend vorher ${gld.score * 4}/4, jetzt 0/4`);
  check(newOps.length > 0 && newOps.every(x => x.path.includes("market-close-orders") && goldIds.has(x.body.InstrumentID)), "Dienstag: Gold (IGLN.L) wird sofort verkauft – sonst nichts");
  check(r.s.positions.filter(x => x.key === "gold").every(x => x.closing) && !a.positions.some(x => goldIds.has(x.instrumentID)) && r.s.journal.at(-1).trades.some(t => t.sym === "IGLN.L" && t.side === "verkauf"), "Gold-Positionen geschlossen, Tagebuch vermerkt den Ausstieg");
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
  const n = accepted(a, r.s.signals).length;
  check(n > 0 && r.s.orders.length === n && r.s.positions.length === 0, `${n} Käufe gesendet, eToro bestätigt noch nicht – als unbestätigt gemerkt`);
  const firstBuys = accepted(a, r.s.signals).map(x => x.body.InstrumentID), firstOrders = r.s.orders.map(o => o.orderID);
  r = await run(NEXT, "status");   // Montag = volle Umschichtung: ohne Zuordnung würde der Bot alles noch einmal kaufen
  a = await acct();
  check(!r.s.orders.some(o => firstOrders.includes(o.orderID)) && firstBuys.every(id => r.s.positions.some(x => x.instrumentID === id)), "nächster Lauf: alle Positionen vom Vortag über ETF und Zeitpunkt zugeordnet");
  const again = r.s.journal.at(-1).trades.filter(x => x.side === "kauf" && x.reason.includes("Einstieg"));
  check(again.length === 0, `kein zweiter Einstieg in denselben ETF (höchstens normales Aufstocken: ${r.s.journal.at(-1).trades.map(x => `${x.sym} ${x.reason}`).join(", ") || "nichts"})`);
});

await withServer("Ausführung fehlt in der Auftragsauskunft", async ({ run, acct, ctl }) => {
  await ctl("/__test/trend-flags", { slowConfirm: true });
  let r = await run(D1, "starten");
  const n = accepted(await acct(), r.s.signals).length;
  check(n > 0 && r.s.orders.length === 0 && r.s.positions.length === n, "Positionen gleich im selben Lauf über die Auftragsnummer im Konto übernommen");
  await ctl("/__test/confirm-orders");
  r = await run(D2, "status");
  check(r.s.orders.length === 0 && r.s.positions.length === n && accepted(await acct(), r.s.signals).length === n, "nächster Lauf: nichts doppelt");
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
  r = await run(day(0, "17:30"), "status");
  check((await acct()).tradeOps.length === 0 && r.s.waiting, "17:30 UTC: London und Frankfurt geschlossen – kein Auftrag");
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
  const r = await run(D1, "starten", { TREND_BOT_BUDGET_EUR: "50000" });   // großes Spielgeld: das freie Geld begrenzt
  const a = await acct();
  const spent = opens(a).reduce((s, x) => s + x.body.Amount, 0);
  check(spent <= 15000 - 1000 + 1 && a.credit >= 999, `Käufe nur bis zum freien Geld, 1 % Reserve bleibt (${Math.round(spent)} $ gekauft)`);
  check(!r.s.newEvents.some(e => e.kind === "fehler"), "kein abgewiesener Auftrag");
  check(r.code === 0, "läuft ohne Fehler durch");
});

await withServer("eToro lehnt ein Gegenstück ab – Ersatz im selben Lauf", async ({ run, acct, ctl }) => {
  await ctl("/__test/regime", { sym: "GLD", drift: 0.003 });   // Gold im Aufwärtstrend
  const ids = (await acct()).ids;
  await ctl("/__test/trend-flags", { rejectIds: [ids["IGLN.L"]] });   // erstes Gold-ETF ist für dieses Konto nicht handelbar
  let r = await run(D1, "starten");
  let a = await acct();
  const goldOps = opens(a).filter(x => [ids["IGLN.L"], ids["SGLD.L"]].includes(x.body.InstrumentID));
  check(goldOps.length === 2 && goldOps[0].body.InstrumentID === ids["IGLN.L"] && goldOps[1].body.InstrumentID === ids["SGLD.L"] && Math.abs(goldOps[0].body.Amount - goldOps[1].body.Amount) < 1, "IGLN.L abgelehnt → sofort derselbe Betrag in SGLD.L");
  check(r.s.positions.some(x => x.key === "gold" && x.instrumentID === ids["SGLD.L"]) && !r.s.orders.length, "Gold wird über SGLD.L gehalten, kein offener Auftrag");
  const b = r.s.blocked[ids["IGLN.L"]];
  check(b && b.code === 744 && b.until > D1.slice(0, 10) && b.until <= day(7).slice(0, 10), "IGLN.L eine Woche gesperrt (kein CFD-Grund)");
  const gt = r.s.journal.at(-1).trades.filter(t => t.key === "gold");
  check(gt.length === 2 && gt[0].rejected && gt[1].reason.includes("Ersatz"), "Tagebuch: abgelehnter Kauf und Ersatzkauf");
  check(r.s.holdings.find(h => h.key === "gold").via === "SGLD.L", "Website zeigt, worüber Gold gehalten wird");
  await ctl("/__test/trend-flags", { rejectIds: [] });
  const before = opens(a).length;
  r = await run(NEXT, "status");   // eine Woche später: Sperre abgelaufen, aufgestockt wird trotzdem im gehaltenen ETF
  a = await acct();
  const later = opens(a).slice(before).filter(x => [ids["IGLN.L"], ids["SGLD.L"]].includes(x.body.InstrumentID));
  check(!r.s.blocked[ids["IGLN.L"]] && later.every(x => x.body.InstrumentID === ids["SGLD.L"]), `Sperre nach einer Woche aufgehoben; Gold-Käufe danach nur in SGLD.L (${later.length})`);
});

await withServer("Abgelehnte Aufträge vom Vortag (wie beim ersten echten Start)", async ({ run, acct, ctl, files }) => {
  // Stand wie nach dem ersten echten Start: fünf US-ETF-Käufe gesendet, eToro hat sie nachträglich abgelehnt
  let r = await run(D1, "status");
  const sig = r.s.signals, ids = (await acct()).ids;
  const orders = [];
  for (const a of sig.assets.filter(x => x.key !== "bonds")) {
    const o = await (await ctl("/__test/rejected-order", { instrumentID: a.instrumentId })).json();
    orders.push({ orderID: o.orderID, key: a.key, instrumentID: a.instrumentId, at: D1 });
  }
  const journal = [{ day: D1.slice(0, 10), enabled: true, asOf: sig.asOf, trades: orders.map(o => ({ key: o.key, sym: sig.assets.find(x => x.key === o.key).sym, side: "kauf", pct: 10, reason: "Trend intakt – Einstieg" })) }];
  const preset = { ...r.s, enabled: true, startedAt: D1, orders, positions: [], uncertain: [], lastTradeDay: D1.slice(0, 10), lastFullWeek: weekOf(D1.slice(0, 10)), model: null, events: [], journal };
  r = await run(D2, "status", {}, preset);   // Dienstag: eigentlich keine volle Umschichtung
  const a = await acct();
  check(orders.every(o => r.s.blocked[o.instrumentID] && r.s.blocked[o.instrumentID].code === 797), "alle fünf abgelehnten US-ETFs erkannt und gesperrt");
  check(r.s.journal[0].trades.every(t => t.rejected && t.reason === "von eToro abgelehnt"), "Tagebuch des Vortags: die fünf Käufe nachträglich als abgelehnt durchgestrichen");
  const note = r.s.newEvents.filter(e => e.kind === "abgelehnt");
  check(note.length === 1 && orders.every(o => note[0].text.includes(sig.assets.find(x => x.key === o.key).sym)) && /CFD/.test(note[0].text) && !r.s.orders.length,
    `eine einzige Benachrichtigung für alle fünf („${note[0] && note[0].text.slice(0, 70)}…“), keine hängenden Aufträge mehr`);
  check(r.s.events.filter(e => e.kind === "abgelehnt").length === 6, "die fünf einzelnen Ablehnungen stehen auf der Website");
  const bought = opens(a).map(x => x.body.InstrumentID);
  const wanted = sig.assets.filter(x => x.weightBase > 0 && x.trade.length > 1);
  check(wanted.every(x => bought.includes(x.trade[0].id)) && !bought.some(id => usIds(sig).has(id)), `noch am selben Tag mit europäischen ETFs nachgekauft: ${opens(a).map(x => Object.keys(ids).find(k => ids[k] === x.body.InstrumentID)).join(", ")}`);
  check(r.s.lastTradeDay === D2.slice(0, 10) && r.s.positions.length === wanted.length + 1, "Käufe (mit Geldmarkt) bestätigt, Tag als gehandelt vermerkt");
});

await withServer("Altstand nach dem ersten echten Start: abgelehnte Käufe zählen nicht", async ({ run }) => {
  let r = await run(D1, "status");
  const sig = r.s.signals, us = sig.assets.filter(x => x.key !== "bonds"), d1 = D1.slice(0, 10);
  // So stand es im echten Bot-Stand: Käufe im Tagebuch, Sperren noch ohne Vermerk, Modell-Depot mit Verlust aus nie gehaltenen Positionen
  const blocked = Object.fromEntries(us.map(a => [a.instrumentId, { sym: a.sym, key: a.key, code: 797, msg: "User is blocked from CFD - opening position.", at: D1.replace("13:00", "15:00"), until: "2099-01-01" }]));
  const journal = [{ day: d1, enabled: true, asOf: sig.asOf, model: 98.7, liveDd: 1.3, trades: us.map(a => ({ key: a.key, sym: a.sym, side: "kauf", pct: 10, reason: "Trend intakt – Einstieg" })) }];
  const model = { start: sig.asOf, lastDate: sig.asOf, index: 98.7, peak: 100, w: Object.fromEntries(us.map(a => [a.key, 0.1])), appliedFor: sig.asOf };
  const preset = { ...r.s, enabled: true, startedAt: D1, orders: [], positions: [], uncertain: [], blocked, journal, model, lastTradeDay: d1, lastFullWeek: null, events: [] };
  r = await run(D2, "status", {}, preset);
  const j1 = r.s.journal.find(j => j.day === d1), j2 = r.s.journal.find(j => j.day === D2.slice(0, 10));
  check(j1.trades.length === us.length && j1.trades.every(t => t.rejected && t.reason === "von eToro abgelehnt"), "Tagebuch: die nachträglich abgelehnten Käufe des Vortags sind durchgestrichen");
  check(j1.model === null && j1.liveDd === null, "Tagebuch: kein Modell-Wert für den Tag ohne echte Käufe");
  const start = r.s.model.start;
  check(start === sig.asOf || start > sig.asOf, `Modell-Depot neu begonnen (Start ${start})`);
  check(r.s.positions.length > 0 && r.s.model.live === true && r.s.model.index > 99.5 && r.s.capitalEur === 1000 && Number.isFinite(j2.model), `ab den ersten echten Käufen zählt es: Modell ${r.s.model.index.toFixed(2)}, Spielgeld ${r.s.capitalEur} €`);
  check(Object.values(r.s.blocked).every(b => b.marked), "Sperren vermerkt – nichts wird ein zweites Mal durchgestrichen");
  r = await run(NEXT, "status");
  check(r.s.model.start === start && r.s.model.live === true && r.s.journal.filter(j => Number.isFinite(j.model)).length === 2, "nächste Woche: Modell-Depot läuft weiter (kein Neubeginn, solange der Bot etwas hält)");
});

console.log(failures ? `\n${failures} Prüfung(en) fehlgeschlagen.` : "\nAlle Trend-Bot-Prüfungen bestanden.");
process.exit(failures ? 1 : 0);

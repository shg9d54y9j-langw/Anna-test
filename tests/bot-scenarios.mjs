// Prüft den Copy-Bot gegen den nachgebauten eToro-Server: jede Gruppe startet mit einem frischen Server und Konto.
// Aufruf: node tests/bot-scenarios.mjs
import { spawn, execFile } from "node:child_process";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const dir = await mkdtemp(join(tmpdir(), "bot-test-"));
let failures = 0, port = 8800;
const check = (ok, text) => { console.log(`${ok ? "✓" : "✗"} ${text}`); if (!ok) failures++; };

async function withServer(name, fn) {
  console.log(`\n— ${name}`);
  const p = ++port;
  const srv = spawn(process.execPath, [join(root, "tests/mock-etoro.mjs"), String(p)], { stdio: ["ignore", "pipe", "inherit"] });
  await new Promise(r => srv.stdout.once("data", r));
  const api = path => `http://localhost:${p}${path}`;
  const state = async (account = "demo") => (await fetch(api(`/__test/state?account=${account}`))).json();
  const ctl = (path, body) => fetch(api(path), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  let n = 0;
  const files = { ranking: join(dir, `${p}-ranking.json`), state: join(dir, `${p}-bot.json`) };
  const ranking = async (pick, extra = {}) => writeFile(files.ranking, JSON.stringify({ updated: new Date().toISOString(), pick, ...extra }));
  const run = (env = {}) => new Promise(resolve => {
    n++;
    const out = join(dir, `${p}-bot-${n}.json`);
    execFile(process.execPath, [join(root, "scripts/copy-bot.mjs")], {
      env: {
        PATH: process.env.PATH, ETORO_API_BASE: `http://localhost:${p}/api`, ETORO_THROTTLE_MS: "0", BOT_POLL_MS: "5",
        ETORO_API_KEY: "test-bot-key-0000", ETORO_USER_KEY: "test-bot-user-0000", BOT_MODE: "demo",
        RANKING_IN: files.ranking, BOT_STATE_IN: files.state, BOT_OUT: out, ...env,
      },
    }, async (err, stdout) => {
      let s = null;
      try { s = JSON.parse(await readFile(out, "utf8")); await writeFile(files.state, JSON.stringify(s)); } catch {}
      resolve({ code: err ? err.code : 0, log: stdout, s });
    });
  });
  try { await fn({ run, ranking, state, ctl, files }); } finally { srv.kill(); }
}

const pickOf = (i, extra = {}) => ({ userName: `trader${String(i).padStart(3, "0")}`, cid: 5000 + i, light: "yellow", amountPct: 0.1, csl: 11, ...extra });
const ops = (s, op) => s.ops.filter(o => o.op === op);

await withServer("Ausgeschaltet und ohne Schlüssel", async ({ run, ranking, state }) => {
  await ranking(pickOf(7));
  let r = await run({ BOT_MODE: "off" });
  check(r.code === 0 && r.s && r.s.active === false, "BOT_MODE=off: Bot tut nichts");
  r = await run({ ETORO_API_KEY: "", ETORO_USER_KEY: "" });
  check(r.code === 0 && r.s.setup === false, "ohne Schlüssel: als „nicht eingerichtet“ gemeldet");
  r = await run({ BOT_MODE: "maybe" });
  check(r.s.active === false && r.s.newEvents.some(e => e.kind === "fehler"), "unbekannter BOT_MODE: nichts tun, Fehler melden");
  check((await state()).ops.length === 0, "kein einziger Auftrag an eToro");
});

await withServer("Starten, Wechsel, Stop Loss, Tageslimit", async ({ run, ranking, state, ctl, files }) => {
  await ranking(pickOf(7));
  let r = await run();
  let s = await state();
  check(ops(s, "eligibility").length === 1 && ops(s, "register").length === 1, "erster Lauf: Probelauf und genau ein Start");
  check(ops(s, "register")[0].amount === 10000 && ops(s, "register")[0].parentCID === 5007, "Betrag 10 % von 100.000 $ = 10.000 $ für trader007");
  check(ops(s, "register")[0].referenceID.length <= 35, "Auftragsnummer höchstens 35 Zeichen");
  check(r.s.managed.length === 1 && r.s.managed[0].userName === "trader007", "Bot führt die Kopie als eigene");
  r = await run();
  check(r.s.copies.length === 1 && Math.abs(r.s.copies[0].sharePct - 10) < 0.01 && r.s.copies[0].botStopLossPct === 11, "Überblick: Bot-Kopie mit 10 % des Kontos, Stop Loss 11 %");
  check(!/\d\s?\$/.test(JSON.stringify(r.s).replace(/200 \$/g, "")), "keine Dollar-Beträge im veröffentlichten Bot-Stand");
  r = await run();
  check(ops(await state(), "register").length === 1, "zweiter Lauf: kein weiterer Start, kein Nachschießen");

  await ranking(pickOf(12));
  r = await run();
  s = await state();
  check(ops(s, "close").length === 1 && ops(s, "close")[0].unregisterType === "Close", "neue Tageswahl: alte Kopie wird beendet (Positionen schließen)");
  check(ops(s, "register").length === 1, "… und noch nicht sofort die neue gestartet");
  r = await run();
  check(ops(await state(), "register").length === 1, "solange die alte Kopie schließt: warten");
  r = await run();
  s = await state();
  check(ops(s, "register").length === 2 && ops(s, "register")[1].parentCID === 5012, "alte Kopie weg: neue Tageswahl trader012 gestartet");

  await ctl("/__test/pnl", { userName: "trader012", pnlPct: -12 });
  r = await run();
  s = await state();
  check(ops(s, "close").length === 2, "Verlust −12 % bei Copy Stop Loss 11 %: Kopie wird beendet");
  check(r.s.newEvents.some(e => /Copy Stop Loss/.test(e.text)), "Stop Loss wird gemeldet");
  await run(); r = await run();
  check(ops(await state(), "register").length === 2, "nach dem Stop Loss: trader012 wird nicht wieder gestartet");

  await ranking(pickOf(13));
  r = await run();
  check(ops(await state(), "register").length === 2 && r.s.newEvents.some(e => /schon 2 Kopien/.test(e.text)), "dritter Start am selben Tag: verweigert");
  const st = JSON.parse(await readFile(files.state, "utf8"));
  st.starts = st.starts.map(() => new Date(Date.now() - 864e5).toISOString().slice(0, 10));
  await writeFile(files.state, JSON.stringify(st));
  r = await run();
  s = await state();
  check(ops(s, "register").length === 3 && ops(s, "register")[2].parentCID === 5013, "am nächsten Tag: trader013 gestartet");
});

await withServer("Ihre eigene Kopie und „keine Tageswahl“", async ({ run, ranking, state, ctl }) => {
  await ctl("/__test/manual-copy", { userName: "trader007", amount: 3000 });
  await ranking(pickOf(7));
  let r = await run();
  let s = await state();
  check(ops(s, "register").length === 0 && r.s.newEvents.some(e => /bereits selbst/.test(e.text)), "Sie kopieren die Tageswahl schon selbst: Bot startet keine zweite Kopie");
  const pub = JSON.stringify(r.s);
  check(r.s.copies.length === 0 && !/credit|equity|invested|\d\s?\$/.test(pub.replace(/200 \$/g, "")), "veröffentlichter Bot-Stand: weder Ihre eigene Kopie noch Dollar-Beträge");
  await ranking(null);
  r = await run();
  s = await state();
  check(ops(s, "close").length === 0 && s.mirrors.length === 1, "keine Tageswahl: Ihre eigene Kopie bleibt unberührt");

  await ctl("/__test/remove", { userName: "trader007" });
  await ranking(pickOf(7));
  await run();
  await ranking(null);
  r = await run();
  s = await state();
  check(ops(s, "close").length === 1, "keine Tageswahl: die Bot-Kopie wird beendet");
});

await withServer("Auftrag ohne Bestätigung wird nie doppelt gesendet", async ({ run, ranking, state, ctl }) => {
  await ctl("/__test/fail-next-register", {});
  await ranking(pickOf(7));
  let r = await run();
  let s = await state();
  check(ops(s, "register").length === 1 && r.s.pending && r.s.managed.length === 0, "Fehler 503 nach dem Senden: Auftrag als „unklar“ vorgemerkt");
  r = await run();
  s = await state();
  check(ops(s, "register").length === 1 && !r.s.pending && r.s.managed.length === 1, "nächste Runde: nachgefragt, bestätigt, kein zweiter Auftrag");
});

await withServer("Echtgeld ist gesperrt", async ({ run, ranking, state }) => {
  await ranking(pickOf(7));
  const r = await run({ BOT_MODE: "real" });
  const real = await state("real"), demo = await state("demo");
  check(real.ops.length === 0 && demo.ops.length === 0, "BOT_MODE=real: kein einziger Auftrag – weder Echtgeld noch Demo");
  check(r.s.active === false && r.s.newEvents.some(e => /gesperrt/.test(e.text)), "Bot meldet: Echtgeld ist gesperrt");
});

await withServer("Veraltete Daten und falsche Kunden-ID", async ({ run, ranking, state }) => {
  await ranking(pickOf(7), { updated: new Date(Date.now() - 3 * 864e5).toISOString() });
  let r = await run();
  check((await state()).ops.length === 0, "Tageswahl 3 Tage alt: keine neue Kopie");
  await ranking(pickOf(7, { cid: 5008 }));
  r = await run();
  check(ops(await state(), "register").length === 0 && r.s.newEvents.some(e => /Kunden-ID/.test(e.text)), "Kunden-ID gehört zu einem anderen Trader: keine Kopie");
  await ranking(pickOf(7, { amountPct: 0.001 }));
  r = await run();
  check(ops(await state(), "register").length === 0 && r.s.newEvents.some(e => /Mindestbetrag/.test(e.text)), "Betrag unter 200 $: keine Kopie");
});

console.log(failures ? `\n${failures} Prüfung(en) fehlgeschlagen.` : "\nAlle Bot-Prüfungen bestanden.");
process.exit(failures ? 1 : 0);

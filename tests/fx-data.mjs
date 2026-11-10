// EZB-Referenzkurse (scripts/fx-data.mjs) mit erfundener Verlaufsdatei im Format der EZB: Auswahl der Währungen ab 2018,
// aufsteigende Tage, fehlende Werte vom Vortag, Kurs am Wochenende = letzter Börsentag, Prüfungen und ganzer Lauf mit Dateien.
// Aufruf: node tests/fx-data.mjs
import { parse, rateOn, check } from "../scripts/fx-data.mjs";
import { writeFileSync, readFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

let fail = 0;
const ok = (c, msg) => { if (!c) { fail++; console.log(`✗ ${msg}`); } };

// Verlaufsdatei wie bei der EZB: neueste Zeile zuerst, Spalten mit alten Währungen, N/A, abschließendes Komma
const addDays = (iso, n) => { const t = new Date(`${iso}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const head = "Date,USD,JPY,BGN,CYP,CZK,DKK,GBP,HUF,PLN,SEK,CHF,NOK,TRL,AUD,CAD,HKD,KRW,SGD,";
const rows = [];
let d = "2017-12-20", i = 0;
const last = new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10);
while (d <= last) {
  const wd = new Date(`${d}T12:00:00Z`).getUTCDay();
  if (wd !== 0 && wd !== 6) {
    const usd = (1.1 + 0.05 * Math.sin(i / 40)).toFixed(4);
    rows.push(`${d},${usd},${(130 + i % 7).toFixed(2)},1.9558,N/A,25.1,7.45,${i === 5 ? "N/A" : "0.86"},390.1,4.3,11.2,0.95,11.5,N/A,1.6,1.5,8.6,1450.2,1.45,`);
    i++;
  }
  d = addDays(d, 1);
}
const csv = `${head}\n${rows.reverse().join("\n")}\n`;
const fx = parse(csv);
ok(fx.dates[0] >= "2018-01-01" && fx.dates[0] < "2018-01-05", `beginnt 2018 (${fx.dates[0]})`);
ok(fx.dates.every((x, k) => k === 0 || x > fx.dates[k - 1]), "Tage aufsteigend und ohne Doppelte");
ok(Object.keys(fx.rates).join() === "USD,GBP,CHF,DKK,SEK,NOK,PLN,CZK,HKD,JPY,KRW,CAD,AUD,SGD", `Währungen in fester Reihenfolge: ${Object.keys(fx.rates).join()}`);
ok(!("CYP" in fx.rates) && !("TRL" in fx.rates) && !("BGN" in fx.rates), "alte und nicht gebrauchte Währungen weggelassen");
ok(fx.rates.USD.length === fx.dates.length && fx.rates.USD.every(v => v > 1 && v < 1.2), "eine Zahl je Tag");
const gbpGap = rows.length - 1 - 5;   // Zeile mit N/A (Index in der umgedrehten Liste)
ok(fx.rates.GBP.every(v => v === 0.86), "fehlender Wert mit dem Vortag gefüllt");
// Kurs an einem Tag: Wochenende → Freitag, vor dem Beginn → keiner, Euro → 1
const fri = fx.dates.find(x => new Date(`${x}T12:00:00Z`).getUTCDay() === 5 && x > "2024-01-01");
const sat = addDays(fri, 1), sun = addDays(fri, 2);
ok(rateOn(fx, "USD", sat) === rateOn(fx, "USD", fri) && rateOn(fx, "USD", sun) === rateOn(fx, "USD", fri), "Wochenende: Kurs vom Freitag");
ok(rateOn(fx, "USD", "2017-06-01") === null && rateOn(fx, "EUR", "2017-06-01") === 1 && rateOn(fx, "XYZ", fri) === null, "vor dem Beginn kein Kurs, Euro immer 1, unbekannte Währung keiner");
ok(rateOn(fx, "USD", "2999-01-01") === fx.rates.USD[fx.rates.USD.length - 1], "nach dem letzten Tag: letzter Kurs");
// Prüfungen
ok(check(fx).length === 0, `vollständige Datei ohne Beanstandung (${check(fx).join(", ")})`);
ok(check({ dates: fx.dates.slice(0, 500), rates: { USD: fx.rates.USD.slice(0, 500) } }).some(p => /nur 500 Tage/.test(p)), "zu wenige Tage erkannt");
ok(check({ dates: fx.dates, rates: { GBP: fx.rates.GBP } }).some(p => /kein US-Dollar/.test(p)), "fehlender US-Dollar erkannt");
const old = parse(csv.split("\n").filter(l => !l.startsWith("20") || l < `${addDays(last, -30)}`).join("\n"));
ok(check(old).some(p => /letzter Kurs vom/.test(p)), "zu alter letzter Kurs erkannt");
let threw = false;
try { parse("Datum;USD\n2020-01-01;1,1"); } catch { threw = true; }
ok(threw, "falsches Format: Fehler statt leerer Datei");

// ganzer Lauf mit Dateien
const dir = mkdtempSync(join(tmpdir(), "fx-"));
writeFileSync(join(dir, "hist.csv"), csv);
const run = (env) => { try { return { out: execFileSync(process.execPath, [new URL("../scripts/fx-data.mjs", import.meta.url).pathname], { env: { PATH: process.env.PATH, ...env }, encoding: "utf8" }), code: 0 }; } catch (e) { return { out: String(e.stdout || ""), code: e.status }; } };
let r = run({ FX_CSV: join(dir, "hist.csv"), FX_OUT: join(dir, "fx.json") });
const out = JSON.parse(readFileSync(join(dir, "fx.json"), "utf8"));
ok(r.code === 0 && /EZB-Kurse: \d+ Tage/.test(r.out) && out.base === "EUR" && out.last === fx.dates[fx.dates.length - 1] && out.dates.length === out.rates.USD.length, `Lauf schreibt fx.json (${r.out.trim()})`);
ok(readFileSync(join(dir, "fx.json")).length < 400000, `Datei kompakt (${Math.round(readFileSync(join(dir, "fx.json")).length / 1024)} KB)`);
writeFileSync(join(dir, "short.csv"), `${head}\n${rows.slice(0, 50).join("\n")}\n`);
r = run({ FX_CSV: join(dir, "short.csv"), FX_OUT: join(dir, "fx2.json") });
ok(r.code === 1 && !existsSync(join(dir, "fx2.json")) && /unvollständig/.test(r.out), "unvollständige Datei: nichts geschrieben, Lauf rot");
rmSync(dir, { recursive: true, force: true });

if (fail) { console.log(`::error::EZB-Kurse: ${fail} Fehler`); process.exit(1); }
console.log(`EZB-Kurse: Auswahl, Reihenfolge, Lücken, Wochenenden, Prüfungen und Lauf mit Dateien stimmen (${fx.dates.length} Tage, ${gbpGap >= 0 ? "mit" : "ohne"} Lücke).`);

// Zinsen und Inflation (scripts/wealth-data.mjs) mit erfundenen Antworten im CSV-Format der EZB: Spalten über ihre Namen,
// Felder in Anführungszeichen mit Kommas, leere und kaputte Werte, Sortierung, Alter von Tages- und Monatswerten,
// Pflicht-Reihen und Plausibilität, ganzer Lauf mit Dateien. Aufruf: node tests/wealth-data.mjs
import { splitCsv, parse, parseAll, ageDays, build, SERIES } from "../scripts/wealth-data.mjs";
import { writeFileSync, readFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

let fail = 0;
const ok = (c, msg) => { if (!c) { fail++; console.log(`✗ ${msg}`); } };
const iso = d => d.toISOString().slice(0, 10);
const day = n => iso(new Date(Date.now() - n * 864e5));
const month = n => { const t = new Date(); t.setUTCDate(1); t.setUTCMonth(t.getUTCMonth() - n); return iso(t).slice(0, 7); };
const HEAD = 'KEY,FREQ,REF_AREA,CURRENCY,PROVIDER_FM,INSTRUMENT_FM,TITLE,TIME_PERIOD,OBS_VALUE,OBS_STATUS';
const csv = rows => `${HEAD}\n${rows.map(([d, v]) => `FM.D.U2.EUR.4F.KR.DFR.LEV,D,U2,EUR,4F,KR,"Deposit facility, ""rate""",${d},${v},A`).join("\n")}\n`;

// CSV-Zeilen
ok(JSON.stringify(splitCsv('a,"b, c","d ""e""",f')) === JSON.stringify(["a", "b, c", 'd "e"', "f"]), "Anführungszeichen und Kommas im Feld");
// Werte: Reihenfolge, Lücken, Doppelte
const p = parse(csv([["2026-11-03", "2.15"], ["2026-10-01", "2.00"], ["2026-11-02", ""], ["2026-11-04", "NaN"], ["kaputt", "1"], ["2026-11-03", "2.10"]]));
ok(JSON.stringify(p) === JSON.stringify([["2026-10-01", 2], ["2026-11-03", 2.1]]), `aufsteigend, leere/kaputte Werte weg, letzter Wert je Tag (${JSON.stringify(p)})`);
let threw = false;
try { parse("Datum;Wert\n2026-01-01;1"); } catch { threw = true; }
ok(threw, "falsches Format: Fehler statt leerer Reihe");
ok(parse(`﻿${csv([["2026-09", "2.4"]])}`)[0][0] === "2026-09", "Byte-Order-Mark und Monatswerte");
// Alter: Monatswerte zählen ab Monatsende
const now = new Date("2026-11-11T12:00:00Z");
ok(ageDays("2026-09", now) === 42.5 && ageDays("2026-11-10", now) === 1.5, `Alter Monats- und Tageswerte (${ageDays("2026-09", now)}, ${ageDays("2026-11-10", now)})`);

// Zusammenbau: Pflicht-Reihen, Alter, Plausibilität
const good = {
  deposit: [["2025-06-11", 2.0]], estr: [[day(1), 1.93]], hicpEA: [[month(2), 2.4], [month(1), 2.1]], hicpAT: [[month(1), 3.0]],
  y2: [[day(1), 2.05]], y5: [[day(1), 2.35]], y10: [[day(1), 2.8]],
};
let b = build(good);
ok(!b.problems.length && Object.keys(b.series).length === 7, `alle Reihen da (${b.problems.join(", ")})`);
ok(b.series.deposit.v === 2 && b.series.deposit.d === "2025-06-11", "Leitzins gilt bis zur nächsten Änderung, auch wenn das Datum alt ist");
ok(b.series.hicpEA.v === 2.1 && b.series.hicpEA.hist.length === 2, "letzter Monatswert und Verlauf");
b = build({ ...good, y5: [[day(40), 2.3]] });
ok(b.problems.some(x => /5 Jahre: letzter Wert .* zu alt/.test(x)), "veraltete Pflicht-Reihe erkannt");
b = build({ ...good, y10: [[day(40), 2.3]] });
ok(!b.problems.length && !b.series.y10, "veraltete freiwillige Reihe weggelassen, kein Fehler");
b = build({ ...good, hicpEA: [] });
ok(b.problems.some(x => /Inflation Euroraum.*: keine Werte/.test(x)), "fehlende Pflicht-Reihe erkannt");
b = build({ ...good, estr: [[day(1), 250]] });
ok(b.problems.some(x => /unplausibler Wert 250/.test(x)), "unplausibler Wert (Basispunkte statt Prozent) erkannt");
ok(Object.values(SERIES).every(s => Array.isArray(s.keys) && s.keys.length && s.keys.every(k => /^[A-Z]+\/[A-Z0-9_.+]+$/.test(k))), "Reihen-Schlüssel im EZB-Format (Platzhalter und Alternativen erlaubt)");
ok(SERIES.hicpEA.keys[0].startsWith("HICP/") && SERIES.hicpEA.keys[SERIES.hicpEA.keys.length - 1].startsWith("ICP/"), "Inflation: neuer Datensatz HICP zuerst, alter ICP nur als Rückfall");
// Antwort mit mehreren Reihen (Platzhalter): die mit dem neuesten Wert zählt
const multi = `KEY,FREQ,TIME_PERIOD,OBS_VALUE\nHICP.M.U2.N.TOTAL.4F0.ANR,M,2026-09,3.8\nHICP.M.U2.N.TOTAL.4F0.ANR,M,2026-10,4.0\nHICP.M.U2.N.000000.4.ANR,M,2025-12,2.0\n`;
const pm = parse(multi);
ok(JSON.stringify(pm) === JSON.stringify([["2026-09", 3.8], ["2026-10", 4]]) && parse.lastKey === "HICP.M.U2.N.TOTAL.4F0.ANR", `mehrere Reihen: die neueste gewinnt (${parse.lastKey})`);
ok(parseAll(multi).length === 2, "alle Reihen einzeln auslesbar (für die Suche nach umgestellten Schlüsseln)");

// ganzer Lauf mit Dateien
const dir = mkdtempSync(join(tmpdir(), "macro-"));
for (const [k, rows] of Object.entries(good)) writeFileSync(join(dir, `${k}.csv`), csv(rows));
const run = env => { try { return { out: execFileSync(process.execPath, [new URL("../scripts/wealth-data.mjs", import.meta.url).pathname], { env: { PATH: process.env.PATH, ...env }, encoding: "utf8" }), code: 0 }; } catch (e) { return { out: String(e.stdout || ""), code: e.status }; } };
let r = run({ MACRO_DIR: dir, MACRO_OUT: join(dir, "macro.json") });
const m = existsSync(join(dir, "macro.json")) ? JSON.parse(readFileSync(join(dir, "macro.json"), "utf8")) : {};
ok(r.code === 0 && /Zinsen und Inflation: 7 Reihen/.test(r.out) && m.series && m.series.y5.v === 2.35 && /EZB/.test(m.source), `Lauf schreibt macro.json (${r.out.trim()})`);
writeFileSync(join(dir, "y5.csv"), csv([[day(60), 2.3]]));
r = run({ MACRO_DIR: dir, MACRO_OUT: join(dir, "macro2.json") });
ok(r.code === 1 && !existsSync(join(dir, "macro2.json")) && /unvollständig/.test(r.out), "veraltete Pflicht-Reihe: nichts geschrieben, Lauf rot");
rmSync(dir, { recursive: true, force: true });

if (fail) { console.log(`::error::Zinsen und Inflation: ${fail} Fehler`); process.exit(1); }
console.log("Zinsen und Inflation: CSV der EZB, Lücken, Alter, Pflicht-Reihen, Plausibilität und Lauf mit Dateien stimmen.");

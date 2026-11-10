// Abgeleitete Testdaten für die Browser-Tests (nicht im Repository): Noten wie auf der Website, eine Note-Bilanz aus erfundenen
// Kursen, ein früher Stand der Bilanz und Kennzahlen mit Jahreswerten für die Finanzkraft. Aufruf: node tests/browser/make-fixtures.mjs <ordner>
import { computeNotes, addSnapshot, evaluate, addWeekdays } from "../../scripts/note-track.mjs";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const out = process.argv[2] || "/tmp/rojko-fixtures";
mkdirSync(out, { recursive: true });
const fx = n => new URL(`./fixtures/${n}`, import.meta.url);
const src = readFileSync(new URL("../../score.js", import.meta.url), "utf8");
const stocks = JSON.parse(readFileSync(fx("stocks.json"), "utf8")), fund = JSON.parse(readFileSync(fx("fund.json"), "utf8"));

// Noten wie auf der Website
const notes = computeNotes(stocks, fund, src);
writeFileSync(join(out, "nt-notes.json"), JSON.stringify(notes));

// Note-Bilanz aus erfundenen Kursen: gute Noten steigen im Schnitt leicht, dazu Markt und Zufall (fester Startwert)
let seed = 7;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
const days = [];
for (let k = 0; k < 140; k++) days.push(addWeekdays("2026-05-01", k + 1));
const mkt = days.map(() => gauss() * 0.009);
const closes = {};
for (const [s, n] of Object.entries(notes)) {
  let p = 100;
  closes[s] = days.map((d, k) => { p *= Math.exp(mkt[k] + (n - 50) / 50 * 0.0006 + gauss() * 0.018); return [d, +p.toFixed(4)]; });
}
let hist = { snaps: [] };
for (let k = 0; k < 70; k++) hist = addSnapshot(hist, days[k], Object.fromEntries(Object.entries(notes).map(([s, n]) => [s, Math.max(0, Math.min(100, n + Math.round(gauss() * 3)))])));
writeFileSync(join(out, "nt-track.json"), JSON.stringify(evaluate(hist, closes, addWeekdays(days[days.length - 1], 1))));
writeFileSync(join(out, "nt-early.json"), JSON.stringify(evaluate({ snaps: [hist.snaps[69]] }, closes, addWeekdays(days[69], 1))));

// Kennzahlen mit Jahreswerten (Finanzkraft): NVDA stark (im Abwärtstrend), AAPL stark im Aufwärtstrend, KO mittel, AMD schwach, MSFT zu wenig
const f = JSON.parse(JSON.stringify(fund));
f.items.NVDA.fs = { roa: [0.45, 0.30], cr: [4.1, 3.5], gm: [0.75, 0.72], lev: [0.05, 0.08], at: [1.2, 1.0], fcfm: [0.45, 0.4], cfps: 2.6, eps: 2.4, y: "2025" };
f.items.KO.fs = { roa: [0.11, 0.12], cr: [1.1, 1.0], gm: [0.61, 0.6], lev: [0.42, 0.40], at: [0.45, 0.46], fcfm: [0.2, 0.22], cfps: 2.9, eps: 2.5, y: "2025" };
f.items.AMD.fs = { roa: [-0.02, 0.01], cr: [0.9, 1.2], gm: [0.45, 0.5], lev: [0.2, 0.1], at: [0.5, 0.55], fcfm: [-0.05, 0.03], cfps: -0.4, eps: -0.1, y: "2025" };
f.items.MSFT.fs = { roa: [0.2, 0.19], cr: [1.3, 1.2], y: "2025" };
f.items.AAPL.fs = { roa: [0.3, 0.28], cr: [1.0, 0.9], gm: [0.47, 0.46], lev: [0.25, 0.28], at: [1.1, 1.05], fcfm: [0.26, 0.25], cfps: 7.5, eps: 6.9, y: "2025" };
writeFileSync(join(out, "fund-fs.json"), JSON.stringify(f));
console.log(`Testdaten in ${out}: ${Object.keys(notes).length} Noten, Note-Bilanz mit ${hist.snaps.length} Messtagen, Kennzahlen mit Jahreswerten.`);

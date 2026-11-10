// EZB-Referenzkurse für das Depot in Euro: aus der Verlaufsdatei der EZB (eurofxref-hist.csv, Kurse je 1 Euro, neueste
// zuerst) eine kompakte Datei mit den Währungen der Aktien-Daten ab 2018 – Tage aufsteigend, je Währung eine Zahlenreihe.
// Kein Schlüssel nötig. Aufruf: FX_CSV=<eurofxref-hist.csv> FX_OUT=<fx.json> node scripts/fx-data.mjs
// Ist die Datei unvollständig (zu wenige Tage, kein US-Dollar, letzter Kurs zu alt), wird nichts geschrieben.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const CURRENCIES = ["USD", "GBP", "CHF", "DKK", "SEK", "NOK", "PLN", "CZK", "HKD", "JPY", "KRW", "CAD", "AUD", "SGD"];
export const START = "2018-01-01";
const DAY = /^\d{4}-\d{2}-\d{2}$/;

// CSV der EZB → { dates: [...aufsteigend], rates: { USD: [...] } }; fehlende Werte (N/A) werden mit dem Vortag gefüllt
export function parse(csv, { start = START, currencies = CURRENCIES } = {}) {
  const lines = String(csv || "").trim().split(/\r?\n/);
  const head = (lines.shift() || "").split(",").map(s => s.trim());
  if (head[0] !== "Date") throw new Error("Unerwartetes Format: erste Spalte ist nicht Date");
  const col = Object.fromEntries(currencies.map(c => [c, head.indexOf(c)]).filter(([, i]) => i > 0));
  const rows = [];
  for (const line of lines) {
    const f = line.split(",");
    const d = (f[0] || "").trim();
    if (!DAY.test(d) || d < start) continue;
    rows.push([d, Object.fromEntries(Object.entries(col).map(([c, i]) => { const v = Number(f[i]); return [c, Number.isFinite(v) && v > 0 ? v : null]; }))]);
  }
  rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const dates = [], rates = Object.fromEntries(Object.keys(col).map(c => [c, []]));
  for (const [d, r] of rows) {
    if (dates.length && dates[dates.length - 1] === d) continue;   // doppelte Tage
    dates.push(d);
    for (const c of Object.keys(col)) { const prev = rates[c].length ? rates[c][rates[c].length - 1] : null; rates[c].push(r[c] ?? prev); }
  }
  // Währungen, die im ganzen Zeitraum fehlen, weglassen
  for (const c of Object.keys(rates)) if (!rates[c].some(v => v !== null)) delete rates[c];
  return { dates, rates };
}

// Kurs (Einheiten je 1 Euro) für einen Tag: der Tag selbst oder der letzte Börsentag davor
export function rateOn(fx, cur, iso) {
  if (cur === "EUR") return 1;
  const r = fx && fx.rates && fx.rates[cur];
  if (!r || !fx.dates.length) return null;
  let lo = 0, hi = fx.dates.length - 1;
  if (iso < fx.dates[0]) return null;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (fx.dates[mid] <= iso) lo = mid; else hi = mid - 1; }
  for (let i = lo; i >= 0; i--) if (r[i] !== null) return r[i];
  return null;
}

export function check(fx, now = new Date()) {
  const problems = [];
  if (fx.dates.length < 1000) problems.push(`nur ${fx.dates.length} Tage`);
  if (!fx.rates.USD) problems.push("kein US-Dollar");
  const last = fx.dates[fx.dates.length - 1];
  if (!last || (now - new Date(`${last}T12:00:00Z`)) / 864e5 > 10) problems.push(`letzter Kurs vom ${last || "–"}`);
  for (const [c, r] of Object.entries(fx.rates)) if (r.some(v => v !== null && !(v > 0))) problems.push(`ungültiger Kurs bei ${c}`);
  return problems;
}

async function main() {
  const csv = await readFile(process.env.FX_CSV || "eurofxref-hist.csv", "utf8");
  const fx = parse(csv);
  const problems = check(fx);
  if (problems.length) { console.log(`::error::EZB-Kurse unvollständig (${problems.join(", ")}) – nichts geschrieben`); process.exit(1); }
  const out = { updated: new Date().toISOString(), source: "Europäische Zentralbank, Referenzkurse (Einheiten je 1 Euro)", base: "EUR", start: fx.dates[0], last: fx.dates[fx.dates.length - 1], dates: fx.dates, rates: fx.rates };
  await writeFile(process.env.FX_OUT || "fx.json", JSON.stringify(out));
  console.log(`EZB-Kurse: ${fx.dates.length} Tage (${out.start} bis ${out.last}), ${Object.keys(fx.rates).length} Währungen, 1 EUR = ${rateOn(fx, "USD", out.last)} USD`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch(e => { console.log(`::error::EZB-Kurse: ${e.message}`); process.exit(1); });

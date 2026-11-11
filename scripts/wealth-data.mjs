// Zinsen und Inflation für den Bereich „Vermögen“ – aus dem EZB Data Portal (öffentlich, kein Schlüssel):
// EZB-Einlagezins, €STR (Tagesgeld unter Banken), Inflation (HVPI) im Euroraum und in Österreich, Renditen von
// Staatsanleihen bester Bonität im Euroraum (2, 5 und 10 Jahre). Daraus rechnet die Seite die erwarteten Renditen
// (Geldmarkt = €STR, Anleihen = 5-Jahres-Rendite, Aktien = Geldmarkt + Aktienprämie).
// Aufruf: MACRO_OUT=<macro.json> node scripts/wealth-data.mjs  (Tests: MACRO_DIR=<Ordner mit <name>.csv je Reihe>)
// Fehlt eine Pflicht-Reihe oder ist sie zu alt, wird nichts geschrieben und der Lauf endet rot.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const API = "https://data-api.ecb.europa.eu/service/data/";
// maxAge: höchstens so viele Tage alt (Monatswerte ab Monatsende); null = gilt bis zur nächsten Änderung (Leitzins)
export const SERIES = {
  deposit: { key: "FM/D.U2.EUR.4F.KR.DFR.LEV", label: "EZB-Einlagezins", maxAge: null, need: true },
  estr: { key: "EST/B.EU000A2X2A25.WT", label: "€STR – Tagesgeld unter Banken", maxAge: 12 },
  hicpEA: { key: "ICP/M.U2.N.000000.4.ANR", label: "Inflation Euroraum (HVPI, zum Vorjahr)", maxAge: 80, need: true },
  hicpAT: { key: "ICP/M.AT.N.000000.4.ANR", label: "Inflation Österreich (HVPI, zum Vorjahr)", maxAge: 80 },
  y2: { key: "YC/B.U2.EUR.4F.G_N_A.SV_C_YM.SR_2Y", label: "Staatsanleihen AAA, 2 Jahre", maxAge: 12 },
  y5: { key: "YC/B.U2.EUR.4F.G_N_A.SV_C_YM.SR_5Y", label: "Staatsanleihen AAA, 5 Jahre", maxAge: 12, need: true },
  y10: { key: "YC/B.U2.EUR.4F.G_N_A.SV_C_YM.SR_10Y", label: "Staatsanleihen AAA, 10 Jahre", maxAge: 12 },
};
const HIST = 13;   // so viele Werte je Reihe (Monatswerte: gut ein Jahr Verlauf)

// eine CSV-Zeile mit Anführungszeichen ("a,b" und "" innerhalb) zerlegen
export function splitCsv(line) {
  const out = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out.map(s => s.trim());
}
// EZB-CSV (format=csvdata) → [[Zeitpunkt, Wert], …] aufsteigend; Spalten über ihre Namen gefunden
export function parse(csv) {
  const lines = String(csv || "").replace(/^﻿/, "").split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) throw new Error("leere Antwort");
  const head = splitCsv(lines.shift());
  const t = head.indexOf("TIME_PERIOD"), v = head.indexOf("OBS_VALUE");
  if (t < 0 || v < 0) throw new Error("Unerwartetes Format: TIME_PERIOD oder OBS_VALUE fehlt");
  const rows = new Map();
  for (const line of lines) {
    const f = splitCsv(line), d = f[t], x = Number(f[v]);
    if (!/^\d{4}-\d{2}(-\d{2})?$/.test(d || "") || f[v] === "" || !Number.isFinite(x)) continue;
    rows.set(d, Math.round(x * 10000) / 10000);
  }
  return [...rows.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
}
// Alter in Tagen: Tageswerte ab dem Tag, Monatswerte ab dem Monatsende
export function ageDays(period, now = new Date()) {
  const end = period.length === 7 ? new Date(Date.UTC(+period.slice(0, 4), +period.slice(5, 7), 0)) : new Date(`${period}T00:00:00Z`);
  return (now - end) / 864e5;
}
export function build(raw, now = new Date()) {
  const series = {}, problems = [];
  for (const [name, s] of Object.entries(SERIES)) {
    const hist = raw[name] || [];
    if (!hist.length) { if (s.need) problems.push(`${s.label}: keine Werte`); continue; }
    const [d, v] = hist[hist.length - 1];
    if (s.maxAge !== null && ageDays(d, now) > s.maxAge) { if (s.need) problems.push(`${s.label}: letzter Wert vom ${d} zu alt`); continue; }
    if (v < -5 || v > 30) { problems.push(`${s.label}: unplausibler Wert ${v}`); continue; }
    series[name] = { label: s.label, v, d, hist: hist.slice(-HIST) };
  }
  return { series, problems };
}

async function fetchSeries(key) {
  const url = new URL(`${API}${key}`);
  url.searchParams.set("lastNObservations", String(HIST));
  url.searchParams.set("detail", "dataonly");
  url.searchParams.set("format", "csvdata");
  if (url.hostname !== "data-api.ecb.europa.eu" || url.protocol !== "https:") throw new Error("Unzulässige Adresse");
  for (let i = 1; i <= 3; i++) {
    try {
      const r = await fetch(url, { headers: { accept: "text/csv" }, redirect: "error", signal: AbortSignal.timeout(30000) });
      if (r.ok) return parse(await r.text());
      if (r.status < 500 && r.status !== 429) throw Object.assign(new Error(`HTTP ${r.status}`), { final: true });
    } catch (e) { if (e.final || i === 3) throw e; }
    await new Promise(res => setTimeout(res, i * 5000));
  }
  throw new Error("nicht erreichbar");
}

export async function main() {
  const out = process.env.MACRO_OUT || fileURLToPath(new URL("../data/macro.json", import.meta.url));
  const dir = process.env.MACRO_DIR;
  const raw = {};
  for (const [name, s] of Object.entries(SERIES)) {
    try { raw[name] = dir ? parse(await readFile(join(dir, `${name}.csv`), "utf8")) : await fetchSeries(s.key); }
    catch (e) { console.log(`::warning::${s.label}: ${String(e.message || e).slice(0, 120)}`); raw[name] = []; }
  }
  const { series, problems } = build(raw);
  if (problems.length) { console.log(`::error::Zinsen und Inflation unvollständig – nichts geschrieben: ${problems.join("; ")}`); process.exitCode = 1; return; }
  await writeFile(out, `${JSON.stringify({ updated: new Date().toISOString(), source: "EZB Data Portal (data-api.ecb.europa.eu)", series })}\n`);
  console.log(`Zinsen und Inflation: ${Object.keys(series).length} Reihen (${Object.entries(series).map(([k, s]) => `${k} ${s.v} %, ${s.d}`).join(" · ")})`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();

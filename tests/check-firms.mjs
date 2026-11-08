// Prüft die Firmen-Steckbriefe der Theorie-Seite und des Swing-Planers (data/firms.json): passende Sparten und Ideen,
// vollständige Steckbriefe (Rolle, was, warum, worauf achten, Quelle mit https), keine doppelten Firmen je Sparte,
// eigene Theorie (theme) für Firmen nur im Swing-Planer. Warnt, wenn der Stand alt wird.
// Aufruf: node tests/check-firms.mjs
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const d = JSON.parse(await readFile(process.env.FIRMS_FILE || `${root}data/firms.json`, "utf8"));
const js = await readFile(`${root}knowledge.js`, "utf8");
const errors = [];
const idsIn = name => {
  const start = js.indexOf(`const ${name} = [`), end = js.indexOf("\n  ];", start);
  return start < 0 ? [] : [...js.slice(start, end).matchAll(/\{ id: "([a-z0-9]+)", title:/g)].map(m => m[1]);
};
const future = idsIn("FUTURE"), moon = idsIn("MOON");
if (future.length < 8 || moon.length < 6) errors.push(`knowledge.js: Sparten/Ideen nicht gefunden (${future.length}/${moon.length})`);
for (const id of future) if (!Array.isArray(d.sectors[id]) || d.sectors[id].length < 3) errors.push(`Sparte ${id}: weniger als 3 Firmen`);
for (const id of Object.keys(d.sectors)) if (!future.includes(id)) errors.push(`Sparte ${id} gibt es auf der Seite nicht`);
for (const id of moon) if (!d.moon[id] || !Array.isArray(d.moon[id].firms) || d.moon[id].firms.length < 2 || !d.moon[id].safer) errors.push(`Idee ${id}: weniger als 2 Firmen oder kein sicherer Weg`);
for (const id of Object.keys(d.moon)) if (!moon.includes(id)) errors.push(`Idee ${id} gibt es auf der Seite nicht`);

const SYM = /^[A-Z0-9][A-Z0-9-]{0,9}(\.[A-Z]{1,3})?$/, ROLES = ["leader", "supplier", "challenger", "spec"];
// swing: Firmen, die der Swing-Planer entdeckt hat und die die wöchentliche Recherche beschrieben hat (eigene Theorie im Feld theme)
if (d.swing !== undefined && !(Array.isArray(d.swing) && d.swing.every(s => typeof s === "string"))) errors.push("swing muss eine Liste von Kürzeln sein");
const swing = Array.isArray(d.swing) ? d.swing : [];
const inTheory = new Set([...Object.values(d.sectors).flat(), ...Object.values(d.moon).flatMap(m => m.firms || [])]);
const used = [...inTheory, ...swing];
if (new Set(swing).size !== swing.length) errors.push("swing: Firma doppelt");
for (const s of swing) if (!inTheory.has(s) && !(d.firms[s] && typeof d.firms[s].theme === "string")) errors.push(`${s}: im Swing-Planer ohne eigene Theorie (theme)`);
for (const [id, list] of Object.entries(d.sectors)) if (new Set(list).size !== list.length) errors.push(`Sparte ${id}: Firma doppelt`);
for (const s of used) if (!d.firms[s]) errors.push(`${s}: Steckbrief fehlt`);
for (const s of Object.values(d.moon).flatMap(m => m.saferSyms || [])) if (!SYM.test(s)) errors.push(`${s}: ungültiges Kürzel`);
for (const [s, f] of Object.entries(d.firms)) {
  if (!SYM.test(s)) errors.push(`${s}: ungültiges Kürzel`);
  if (!used.includes(s)) errors.push(`${s}: Steckbrief wird nirgends gezeigt`);
  if (!ROLES.includes(f.role)) errors.push(`${s}: unbekannte Rolle ${f.role}`);
  for (const k of ["name", "what", "why", "watch"]) if (typeof f[k] !== "string" || f[k].trim().length < (k === "name" ? 2 : 30)) errors.push(`${s}: „${k}“ fehlt oder ist zu kurz`);
  if (!/[.!?]/.test(f.why || "")) errors.push(`${s}: Begründung ohne ganzen Satz`);
  if (!Array.isArray(f.src) || !f.src.length || !f.src.every(x => Array.isArray(x) && /^https:\/\/[^\s"<>]+$/.test(x[0]) && typeof x[1] === "string" && x[1].length > 3)) errors.push(`${s}: Quelle fehlt oder ohne https`);
  if (/<|>/.test(JSON.stringify(f))) errors.push(`${s}: HTML im Text`);
  if (f.theme !== undefined && !(typeof f.theme === "string" && f.theme.trim().length >= 3 && f.theme.length <= 60)) errors.push(`${s}: Theorie (theme) zu kurz oder zu lang`);
  if (f.added !== undefined && !(/^\d{4}-\d{2}-\d{2}$/.test(f.added) && Date.parse(`${f.added}T00:00:00Z`) <= Date.now() + 864e5)) errors.push(`${s}: ungültiges Datum added ${f.added}`);
  // Börsen außerhalb von eToro: Börse und TradingView-Symbol für den Kurs-Link
  if (f.tv !== undefined && !/^[A-Z]+:[A-Z0-9_]+$/.test(f.tv)) errors.push(`${s}: ungültiges TradingView-Symbol ${f.tv}`);
  if ((f.tv === undefined) !== (f.listing === undefined)) errors.push(`${s}: Börse (listing) und TradingView-Symbol (tv) nur zusammen`);
  if (/\.(KS|KQ|T|HK|SS|SZ)$/.test(s) && !f.tv) errors.push(`${s}: Asien-Börse ohne TradingView-Symbol`);
}
for (const m of Object.values(d.moon)) if (m.note && !(Array.isArray(m.note) && m.note.length === 3 && /^https:\/\//.test(m.note[1]))) errors.push(`Hinweis ohne Quelle: ${JSON.stringify(m.note).slice(0, 60)}`);

const age = (Date.now() - Date.parse(`${d.asOf}T12:00:00Z`)) / 864e5;
if (!Number.isFinite(age)) errors.push("asOf fehlt");
else if (age > 92) console.log(`::warning::Firmen-Steckbriefe sind ${Math.round(age)} Tage alt – bitte prüfen und asOf aktualisieren.`);

if (errors.length) { for (const e of errors) console.log(`::error::${e}`); console.log(`${errors.length} Fehler in data/firms.json`); process.exit(1); }
console.log(`Firmen-Steckbriefe in Ordnung: ${Object.keys(d.firms).length} Firmen, ${future.length} Sparten, ${moon.length} Ideen${swing.length ? `, ${swing.length} im Swing-Planer` : ""} (Stand ${d.asOf}).`);

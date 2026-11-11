// Prüft data/wealth.json (Bereich „Vermögen“) – in der Rechenkontrolle und vor jeder monatlichen Aktualisierung:
// Pflichtfelder, Datumsangaben (Prüfung nicht in der Zukunft, nächste danach), plausible Modellwerte, Profilregeln,
// Bausteine mit gültigen ISIN (Prüfziffer) und Kosten, Forschungs-Einträge mit Evidenzstufe und https-Quellen,
// Steuerpunkte mit Quelle, Änderungsliste. Aufruf: node tests/check-wealth.mjs [Datei]
import { readFileSync } from "node:fs";

const file = process.argv[2] || new URL("../data/wealth.json", import.meta.url).pathname;
const errs = [];
const bad = msg => errs.push(msg);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const num = (v, lo, hi) => Number.isFinite(v) && v >= lo && v <= hi;
const text = (v, min = 10) => typeof v === "string" && v.trim().length >= min;
const https = u => { try { return new URL(u).protocol === "https:"; } catch { return false; } };
// ISIN: 2 Buchstaben, 9 Zeichen, Prüfziffer nach Luhn über die in Ziffern umgewandelten Zeichen
export function isinOk(s) {
  if (!/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(String(s || ""))) return false;
  const digits = [...s].map(c => (/\d/.test(c) ? c : String(c.charCodeAt(0) - 55))).join("");
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = +digits[digits.length - 1 - i];
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}
const sources = (l, where) => {
  if (!Array.isArray(l) || !l.length) return bad(`${where}: keine Quelle`);
  l.forEach((s, i) => { if (!s || !text(s.t, 8) || !https(s.url)) bad(`${where}: Quelle ${i + 1} ohne Titel oder https-Adresse`); });
};

let d;
try { d = JSON.parse(readFileSync(file, "utf8")); } catch (e) { console.log(`::error::wealth.json nicht lesbar: ${e.message}`); process.exit(1); }
const today = new Date().toISOString().slice(0, 10);
if (d.version !== 1) bad("version muss 1 sein");
if (!DAY.test(d.reviewed || "") || d.reviewed > today) bad(`reviewed ungültig oder in der Zukunft (${d.reviewed})`);
if (!DAY.test(d.nextReview || "") || d.nextReview <= d.reviewed) bad(`nextReview muss nach reviewed liegen (${d.nextReview})`);
if (!text(d.method, 40)) bad("method fehlt");

const m = d.model || {};
if (!num(m.equityPremium, 1, 8)) bad(`model.equityPremium unplausibel (${m.equityPremium})`);
if (!num(m.equityVol, 8, 30) || !num(m.bondVol, 1, 15) || !num(m.cashVol, 0, 3)) bad("model: Schwankungen unplausibel");
if (!num(m.corrEquityBonds, -0.9, 0.9)) bad("model.corrEquityBonds unplausibel");
if (!num(m.terAvg, 0, 1)) bad("model.terAvg unplausibel");
const lr = m.longRun || {};
if (!num(lr.cash, -1, 10) || !num(lr.bonds, -1, 10) || !num(lr.inflation, 0, 10)) bad("model.longRun unplausibel");
const cr = m.crash || {};
if (!num(cr.equity, 20, 90) || !num(cr.bonds, 0, 40) || !num(cr.cash, 0, 10)) bad("model.crash unplausibel");
sources(m.sources, "model");

const p = d.profile || {}, H = ["lt3", "3to5", "5to10", "10to20", "gt20"];
for (const h of H) {
  if (!num((p.horizonCap || {})[h], 0, 100)) bad(`profile.horizonCap.${h} fehlt`);
  const s = (p.safeSplit || {})[h];
  if (!Array.isArray(s) || s.length !== 2 || s[0] + s[1] !== 100) bad(`profile.safeSplit.${h} muss zusammen 100 ergeben`);
}
for (let i = 1; i < H.length; i++) if ((p.horizonCap || {})[H[i]] < (p.horizonCap || {})[H[i - 1]]) bad("profile.horizonCap muss mit dem Horizont steigen");
for (const k of ["sell", "some", "hold", "buy"]) if (!num((p.reactionCap || {})[k], 0, 100)) bad(`profile.reactionCap.${k} fehlt`);
for (const k of ["safe", "mid", "unsafe"]) if (!num((p.incomeAdj || {})[k], -50, 0)) bad(`profile.incomeAdj.${k} fehlt`);
if (!num(p.crashEquity, 20, 90)) bad("profile.crashEquity unplausibel");

const ids = (d.blocks || []).map(b => b.id).join();
if (ids !== "aktien,anleihen,geldmarkt") bad(`blocks müssen aktien, anleihen, geldmarkt sein (${ids})`);
for (const b of d.blocks || []) {
  if (!text(b.name, 4) || !text(b.what, 30)) bad(`Baustein ${b.id}: Name oder Beschreibung fehlt`);
  if (!Array.isArray(b.products) || !b.products.length) bad(`Baustein ${b.id}: keine Beispiele`);
  for (const x of b.products || []) {
    if (!text(x.name, 6)) bad(`Baustein ${b.id}: Produkt ohne Namen`);
    if (x.isin !== null && !isinOk(x.isin)) bad(`Baustein ${b.id}: ISIN ungültig (${x.isin})`);
    if (!num(x.ter, 0, 1.5)) bad(`Baustein ${b.id}: Kosten unplausibel (${x.name})`);
    if (!DAY.test(x.checked || "") || x.checked > today) bad(`Baustein ${b.id}: Prüfdatum fehlt (${x.name})`);
  }
}
if (!text(d.productNote, 40)) bad("productNote fehlt");

const LEVELS = ["stark", "mittel", "umstritten", "neu", "praxis"], seen = new Set();
if (!Array.isArray(d.evidence) || d.evidence.length < 8) bad("evidence: mindestens 8 Einträge");
for (const e of d.evidence || []) {
  if (!/^[a-z0-9-]{3,24}$/.test(e.id || "") || seen.has(e.id)) bad(`evidence: Kennung fehlt oder doppelt (${e.id})`);
  seen.add(e.id);
  if (!LEVELS.includes(e.level)) bad(`evidence ${e.id}: Stufe „${e.level}“ unbekannt`);
  if (!text(e.title, 10) || !text(e.claim, 60) || !text(e.forYou, 30)) bad(`evidence ${e.id}: Titel, Befund oder „Für Sie“ zu kurz`);
  if (!DAY.test(e.checked || "") || e.checked > today) bad(`evidence ${e.id}: Prüfdatum fehlt`);
  sources(e.sources, `evidence ${e.id}`);
}
if (!Array.isArray(d.tax) || d.tax.length < 4) bad("tax: mindestens 4 Punkte");
for (const t of d.tax || []) { if (!text(t.t, 4) || !text(t.text, 40)) bad(`tax „${t.t}“: Text zu kurz`); sources(t.sources, `tax ${t.t}`); }
if (!Array.isArray(d.changes) || !d.changes.length) bad("changes: mindestens ein Eintrag");
(d.changes || []).forEach((c, i, l) => { if (!DAY.test(c.date || "") || !text(c.text, 10)) bad(`changes ${i + 1} ungültig`); if (i && c.date > l[i - 1].date) bad("changes: neueste zuerst"); });
if (d.changes && d.changes[0] && d.changes[0].date > d.reviewed) bad("changes: neuester Eintrag nach dem Prüfdatum");
const size = readFileSync(file).length;
if (size > 60000) bad(`Datei zu groß (${size} Bytes) – kurz halten, sie lädt am Handy`);

if (errs.length) { for (const e of errs) console.log(`✗ ${e}`); console.log(`::error::wealth.json: ${errs.length} Fehler`); process.exit(1); }
console.log(`wealth.json in Ordnung: ${d.evidence.length} Forschungs-Einträge, ${d.tax.length} Steuerpunkte, ${(d.blocks || []).reduce((n, b) => n + b.products.length, 0)} Beispiele, geprüft ${d.reviewed}.`);

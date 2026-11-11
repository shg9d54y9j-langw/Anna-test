// Kursalarme und Stops alle 15 Minuten (läuft in jeder Runde des Live-Wächters): prüft die Kursalarme und Stops aus der
// Push-Liste (Secret PUSH_WATCH) mit der laufenden Tageskerze von eToro und meldet jede Berührung genau einmal per ntfy
// (Secret NTFY_TOPIC) – auch wenn der Kurs nur kurz unter den Stop fiel (Tagestief zählt).
// Der Vergleichsstand der letzten Runde (je Aktie letzter Kurs, Tageshoch, Tagestief, Kerzendatum; dazu die eToro-Kennnummern)
// liegt VERSCHLÜSSELT auf dem öffentlichen Zweig alarm-state: AES-256-GCM, Schlüssel per HKDF aus NTFY_TOPIC abgeleitet.
// Öffentlich sichtbar sind nur Zeitstempel und (auf 512 Byte aufgerundete) Länge – nie Kürzel, Preise oder der Kanal.
// Im Protokoll stehen nur Anzahlen.
// Aufruf: ALARM_STATE_IN=<state.json, darf fehlen> ALARM_STATE_OUT=<state.json> node scripts/price-alarms.mjs
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { parseWatch, crossed, send } from "./notify.mjs";
import { call, findArray, field, num, hasKeys } from "./etoro.mjs";

const env = process.env;
const log = m => console.log(m);
const fin = Number.isFinite;
const SITE = "https://shg9d54y9j-langw.github.io/Anna-test/";
const MARK = { down: "▼", up: "▲" };
const de = (v, d = 2) => v.toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });
const price = v => (!fin(v) ? "–" : v >= 1000 ? de(v, 0) : v >= 1 ? de(v, 2) : de(v, 4));

// ---------- verschlüsselter Vergleichsstand ----------
const keyOf = topic => Buffer.from(hkdfSync("sha256", Buffer.from(String(topic), "utf8"), Buffer.from("rojko-alarm-state"), Buffer.from("v1"), 32));
export function seal(obj, topic, now = new Date()) {
  let text = JSON.stringify(obj);
  text += " ".repeat((512 - (Buffer.byteLength(text) % 512)) % 512);   // Länge verrät höchstens grob die Anzahl der Aktien
  const iv = randomBytes(12), c = createCipheriv("aes-256-gcm", keyOf(topic), iv);
  const data = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return { v: 1, updated: now.toISOString(), iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64"), data: data.toString("base64") };
}
export function unseal(box, topic) {
  try {
    if (!box || box.v !== 1) return null;
    const d = createDecipheriv("aes-256-gcm", keyOf(topic), Buffer.from(box.iv, "base64"));
    d.setAuthTag(Buffer.from(box.tag, "base64"));
    return JSON.parse(Buffer.concat([d.update(Buffer.from(box.data, "base64")), d.final()]).toString("utf8"));
  } catch { return null; }   // anderer Kanal, verändert oder kaputt: frisch beginnen
}

// ---------- Ereignisse ----------
// Stand je Aktie: { asOf, last, lo1d, hi1d } – wie in stocks.json, damit crossed() aus notify.mjs gilt:
// neue Tageskerze → ihr Tief bzw. Hoch zählt; dieselbe Kerze → nur ein neues Tief bzw. Hoch (jede Berührung genau einmal)
export function alarmEvents(cfg, prev, next) {
  const out = [], role = sym => (cfg.d.includes(sym) ? "Depot" : cfg.w.includes(sym) ? "Merkliste" : "Kursalarm");
  for (const [sym, stop] of Object.entries(cfg.s)) {
    const x = next[sym];
    if (x && crossed(prev[sym], x, stop, "down")) out.push({ sym, level: "down", stop: true, text: `${MARK.down} ${sym} (${role(sym)}): Ihr Stop ${price(stop)} wurde erreicht – zuletzt ${price(x.last)}, Tagestief ${price(x.lo1d)}. In eToro prüfen, ob die Position geschlossen wurde.` });
  }
  for (const a of cfg.a) {
    const x = next[a.sym], dir = a.dir === ">" ? "up" : "down";
    if (x && crossed(prev[a.sym], x, a.p, dir)) out.push({ sym: a.sym, level: dir, stop: false, text: `${MARK[dir]} ${a.sym} (${role(a.sym)}): Kursalarm ${dir === "up" ? "über" : "unter"} ${price(a.p)} erreicht – zuletzt ${price(x.last)}.` });
  }
  return out;
}

// ---------- eToro ----------
async function instrumentId(sym) {
  const d = await call("/v2/market-data/instruments", { symbols: sym });
  const hit = findArray(d).find(x => String(field(x, "symbol") || "").toUpperCase() === sym);
  const id = hit && num(field(hit, "instrumentId", "instrumentID"));
  return Number.isInteger(id) ? id : null;
}
// laufende (oder letzte) Tageskerze → { asOf, last, lo1d, hi1d }
export function snapshotOf(d, id) {
  const groups = Array.isArray(field(d, "candles")) ? field(d, "candles") : [];
  const list = (groups.find(g => num(field(g, "instrumentId")) === id) || groups[0] || {}).candles || [];
  const c = list.map(x => ({ d: String(field(x, "fromDate") || "").slice(0, 10), h: num(field(x, "high")), l: num(field(x, "low")), c: num(field(x, "close")) }))
    .filter(x => /^\d{4}-\d{2}-\d{2}$/.test(x.d) && fin(x.c) && x.c > 0).sort((a, b) => (a.d < b.d ? 1 : -1))[0];
  if (!c) return null;
  return { asOf: c.d, last: c.c, lo1d: fin(c.l) && c.l > 0 ? Math.min(c.l, c.c) : c.c, hi1d: fin(c.h) && c.h > 0 ? Math.max(c.h, c.c) : c.c };
}

export async function main() {
  const topic = String(env.NTFY_TOPIC || "").trim();
  if (!topic) { log("Kursalarme: Meldungen aufs Handy sind nicht eingerichtet (Secret NTFY_TOPIC fehlt) – nichts zu tun."); return 0; }
  if (!/^[A-Za-z0-9_-]{12,64}$/.test(topic)) { log("::warning::Kursalarme: NTFY_TOPIC ungültig – nichts geprüft."); return 0; }
  const cfg = parseWatch(env.PUSH_WATCH);
  if (!cfg) { log("Kursalarme: keine gültige Push-Liste (Secret PUSH_WATCH) – nichts zu tun."); return 0; }
  const syms = [...new Set([...cfg.a.map(a => a.sym), ...Object.keys(cfg.s)])];
  if (!syms.length) { log("Kursalarme: keine Kursalarme oder Stops in der Push-Liste – nichts zu tun."); return 0; }
  if (!hasKeys) { log("::warning::Kursalarme: eToro-Schlüssel fehlen – nichts geprüft."); return 0; }

  let box = null;
  try { if (env.ALARM_STATE_IN) box = JSON.parse(await readFile(env.ALARM_STATE_IN, "utf8")); } catch { box = null; }
  const prevState = unseal(box, topic) || { ids: {}, q: {} };
  const ids = { ...(prevState.ids || {}) }, prev = prevState.q || {}, next = {};
  let failed = 0;
  for (const sym of syms) {
    try {
      if (!Number.isInteger(ids[sym])) ids[sym] = await instrumentId(sym);
      if (!Number.isInteger(ids[sym])) { failed++; continue; }
      const snap = snapshotOf(await call(`/v1/market-data/instruments/${ids[sym]}/history/candles/desc/OneDay/2`), ids[sym]);
      if (snap) next[sym] = snap; else failed++;
    } catch { failed++; }
  }
  const events = alarmEvents(cfg, prev, next);
  // neuer Stand: frische Werte, für fehlgeschlagene Abrufe der alte (so geht keine Berührung verloren)
  const q = {};
  for (const sym of syms) if (next[sym] || prev[sym]) q[sym] = next[sym] || prev[sym];
  const keepIds = Object.fromEntries(syms.filter(s => Number.isInteger(ids[s])).map(s => [s, ids[s]]));
  if (env.ALARM_STATE_OUT) await writeFile(env.ALARM_STATE_OUT, `${JSON.stringify(seal({ v: 1, ids: keepIds, q }, topic))}\n`);
  const first = !Object.keys(prev).length;
  log(`Kursalarme: ${syms.length} Aktien beobachtet, ${Object.keys(next).length} Kurse geholt${failed ? `, ${failed} nicht abrufbar` : ""}${first ? " – erster Stand, ab der nächsten Runde wird verglichen" : ""}; ${events.length} ${events.length === 1 ? "Meldung" : "Meldungen"}.`);   // nie Kürzel oder Preise
  if (!events.length) return 0;
  const stops = events.filter(e => e.stop).length;
  const lines = events.map(e => e.text);
  await send(topic, {
    title: stops ? `RojkoMoney: ${stops === 1 ? "Stop erreicht" : `${stops} Stops erreicht`}${events.length > stops ? " und Kursalarme" : ""}` : `RojkoMoney: ${events.length === 1 ? "Kursalarm" : `${events.length} Kursalarme`}`,
    message: (lines.length > 12 ? [...lines.slice(0, 12), `… und ${lines.length - 12} weitere`] : lines).join("\n"),
    priority: stops ? 4 : 3, tags: stops ? ["warning"] : ["bell"], click: `${SITE}#portfolio`,
  });
  log(`Kursalarme: 1 Nachricht mit ${events.length} ${events.length === 1 ? "Punkt" : "Punkten"} gesendet.`);
  return events.length;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  // Fehler beim Senden oder Abrufen sollen den Live-Wächter nicht stoppen: nur eine Warnung ohne Inhalte
  main().catch(e => { log(`::warning::Kursalarme: ${String((e && e.message) || e).slice(0, 120)}`); });
}

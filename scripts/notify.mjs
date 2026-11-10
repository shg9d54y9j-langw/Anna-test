// Meldungen aufs Handy über ntfy (kostenlose App, ntfy.sh) – nur wenn der Besitzer es eingerichtet hat.
// Geheim (GitHub-Secrets): NTFY_TOPIC (Kanalname, wirkt wie ein Passwort) und PUSH_WATCH (Push-Liste aus der Seite: Depot,
// Merkliste, Kursalarme, Stops). Beides steht nie im Repository und nie in den Protokollen – ausgegeben werden nur Anzahlen.
// Arten (NOTIFY_MODE):
//   events – nach jedem Lauf der Aktien-Daten: Stop oder Kursalarm erreicht, 200-Tage-Schnitt gekreuzt, große Tagesbewegung,
//            Analysten-Umschwung; im ersten Lauf des Tages auch Zahlen am nächsten Börsentag und Gesamtnote unter 40 / über 80
//            (STOCKS_PREV, STOCKS_NEW, NOTE_RECENT)
//   news   – nach jedem Nachrichten-Lauf: neue wichtige Meldungen zu Ihren US-Aktien (NEWS_DIR neu, NEWS_PREV_DIR bisher)
//   weekly – freitags: Wochenbericht zu Depot und Merkliste, Noten und Termine der nächsten Woche (STOCKS_NEW, NOTE_RECENT)
//   test   – eine Probe-Meldung, um die Einrichtung zu prüfen
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const env = process.env;
const log = m => console.log(m);
const fin = Number.isFinite;
const SITE = "https://shg9d54y9j-langw.github.io/Anna-test/";
const SYM = /^[A-Z0-9][A-Z0-9.\-_]{0,19}$/;
const MARK = { down: "▼", up: "▲", info: "•" };
const de = (v, d = 2) => (fin(v) ? v.toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d }) : "–");
const pc = (v, d = 1) => (fin(v) ? `${v > 0 ? "+" : v < 0 ? "−" : "±"}${de(Math.abs(v), d)} %` : "–");
const price = v => (!fin(v) ? "–" : v >= 1000 ? de(v, 0) : v >= 1 ? de(v, 2) : de(v, 4));
const viennaDay = (t = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Vienna", year: "numeric", month: "2-digit", day: "2-digit" }).format(t);
const addDays = (iso, n) => { const t = new Date(`${iso}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const nextWeekday = iso => { let d = addDays(iso, 1); while ([0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay())) d = addDays(d, 1); return d; };
const dayLabel = iso => new Date(`${iso}T12:00:00Z`).toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "UTC" });
const bySym = d => new Map((d && Array.isArray(d.items) ? d.items : []).filter(x => x && typeof x.sym === "string").map(x => [x.sym, x]));

// Push-Liste aus der Seite: {"v":1,"d":[Depot],"w":[Merkliste],"a":[[Kürzel,">"|"<",Preis]],"s":{Kürzel:Stop}}
export function parseWatch(text) {
  let c;
  try { c = JSON.parse(String(text || "")); } catch { return null; }
  if (!c || typeof c !== "object" || Array.isArray(c)) return null;
  const syms = l => (Array.isArray(l) ? [...new Set(l.filter(s => typeof s === "string" && SYM.test(s)))].slice(0, 150) : []);
  const d = syms(c.d), w = syms(c.w).filter(s => !d.includes(s));
  const a = (Array.isArray(c.a) ? c.a : []).filter(x => Array.isArray(x) && SYM.test(String(x[0])) && (x[1] === ">" || x[1] === "<") && fin(x[2]) && x[2] > 0)
    .slice(0, 150).map(x => ({ sym: x[0], dir: x[1], p: x[2] }));
  const s = {};
  if (c.s && typeof c.s === "object") for (const [k, v] of Object.entries(c.s)) if (d.includes(k) && fin(v) && v > 0) s[k] = v;
  if (!d.length && !w.length && !a.length) return null;
  return { d, w, a, s };
}

// Wurde die Marke seit dem letzten Lauf erreicht? Neue Tageskerze: ihr Tief bzw. Hoch zählt; dieselbe Kerze (Lauf am selben
// Tag): nur ein neues Tief bzw. Hoch – so meldet jede Berührung genau einmal.
export function crossed(o, x, level, dir) {
  if (!o || !x || !fin(o.last) || !fin(x.last) || !fin(level)) return false;
  const low = v => (fin(v.lo1d) ? Math.min(v.last, v.lo1d) : v.last), high = v => (fin(v.hi1d) ? Math.max(v.last, v.hi1d) : v.last);
  if (o.asOf !== x.asOf) return dir === "down" ? o.last > level && low(x) <= level : o.last < level && high(x) >= level;
  return dir === "down" ? low(o) > level && low(x) <= level : high(o) < level && high(x) >= level;
}
const total = r => (r ? (r.sb || 0) + (r.b || 0) + (r.h || 0) + (r.s || 0) + (r.ss || 0) : 0);
const buyShare = r => (total(r) >= 5 ? ((r.sb || 0) + (r.b || 0)) / total(r) : null);

// Ereignisse aus bisherigem und neuem Stand der Aktien-Daten (und dem Notenverlauf note-recent.json)
export function events(cfg, prev, next, recent, now = new Date()) {
  const P = bySym(prev), N = bySym(next);
  const today = viennaDay(now), nextDay = nextWeekday(today);
  const firstRun = !prev || !prev.updated || viennaDay(new Date(prev.updated)) !== today;   // erster Lauf des Tages (Wiener Zeit)
  const role = sym => (cfg.d.includes(sym) ? "Depot" : cfg.w.includes(sym) ? "Merkliste" : "Kursalarm");
  const out = [];
  const add = (sym, level, text) => out.push({ sym, level, depot: cfg.d.includes(sym), text: `${MARK[level]} ${sym} (${role(sym)}): ${text}` });
  for (const sym of [...new Set([...cfg.d, ...cfg.w, ...cfg.a.map(q => q.sym)])]) {
    const x = N.get(sym), o = P.get(sym);
    if (!x || !fin(x.last)) continue;
    const stop = cfg.s[sym];
    if (fin(stop) && crossed(o, x, stop, "down")) add(sym, "down", `Ihr Stop ${price(stop)} wurde erreicht – zuletzt ${price(x.last)}. In eToro prüfen, ob die Position geschlossen wurde.`);
    for (const al of cfg.a) {
      if (al.sym !== sym) continue;
      const dir = al.dir === ">" ? "up" : "down";
      if (crossed(o, x, al.p, dir)) add(sym, dir, `Kursalarm ${dir === "up" ? "über" : "unter"} ${price(al.p)} erreicht – zuletzt ${price(x.last)}.`);
    }
    if (!(cfg.d.includes(sym) || cfg.w.includes(sym))) continue;   // nur Kursalarm: sonst nichts zu dieser Aktie
    if (o) {
      const fresh = o.asOf !== x.asOf;   // neue Tageskerze seit dem letzten Lauf
      if (fresh && fin(o.d200) && fin(x.d200)) {
        if (o.d200 >= 0 && x.d200 < 0) add(sym, "down", `fiel unter den 200-Tage-Schnitt (${pc(x.d200)}) – der langfristige Trend ist gebrochen${cfg.d.includes(sym) ? ", Halten prüfen" : ""}.`);
        if (o.d200 < 0 && x.d200 >= 0) add(sym, "up", `stieg über den 200-Tage-Schnitt (${pc(x.d200)}) – der langfristige Trend dreht nach oben.`);
      }
      const big = v => fin(v) && Math.abs(v) >= 5;
      if (big(x.chg1d) && (fresh || !big(o.chg1d))) add(sym, x.chg1d < 0 ? "down" : "up", `${pc(x.chg1d)} am Handelstag ${dayLabel(x.asOf)} – Nachrichten prüfen.`);
      if (x.rec && o.rec && x.rec.period && o.rec.period && x.rec.period !== o.rec.period) {
        const b = buyShare(x.rec), bp = buyShare(x.recPrev);
        if (fin(b) && fin(bp) && Math.abs(b - bp) >= 0.08) add(sym, b > bp ? "up" : "down", `Analysten ${b > bp ? "optimistischer" : "skeptischer"}: ${pc((b - bp) * 100, 0).replace(" %", " Punkte")} bei den Kaufempfehlungen (jetzt ${de(b * 100, 0)} %).`);
      }
    }
    if (firstRun) {
      if (x.earn && x.earn.date === nextDay) add(sym, "info", `meldet ${nextDay === addDays(today, 1) ? "morgen" : `am ${dayLabel(nextDay)}`} Quartalszahlen${x.earn.hour === "bmo" ? " (vor Börsenbeginn)" : x.earn.hour === "amc" ? " (nach Börsenschluss)" : ""} – der Kurs kann stark springen.`);
      const h = recent && recent.n && recent.n[sym];
      if (Array.isArray(h) && fin(h[0]) && fin(h[1])) {
        if (h[1] >= 40 && h[0] < 40) add(sym, "down", `Gesamtnote fiel unter 40 (${h[1]} → ${h[0]}) – Trend, Zahlen oder Analysten haben sich verschlechtert.`);
        if (h[1] < 80 && h[0] >= 80) add(sym, "up", `Gesamtnote stieg über 80 (${h[1]} → ${h[0]}) – jetzt unter den besten 20 %.`);
      }
    }
  }
  return out;
}

// Neue wichtige Nachrichten zu Ihren Aktien: was im bisherigen Stand noch fehlte (nach Kennung), höchstens 36 Stunden alt
const NEWS_LABEL = {
  earnings_beat: "Zahlen besser als erwartet", earnings_miss: "Zahlen schlechter als erwartet", guidance_up: "Prognose angehoben", guidance_down: "Prognose gesenkt",
  upgrade: "Hochstufung", downgrade: "Herabstufung", merger: "Übernahme oder Fusion", offering: "Kapitalerhöhung", legal: "Rechtsstreit oder Behörde",
  approval: "Zulassung", rejection: "Rückschlag bei Zulassung oder Studie", bankruptcy: "Insolvenz", layoffs: "Stellenabbau", management: "Wechsel an der Spitze",
  buyback: "Aktienrückkauf", dividend: "Dividende",
};
export function newsEvents(cfg, fresh, old, now = new Date()) {
  const since = now.getTime() / 1000 - 36 * 3600, seen = new Set(), out = [];
  for (const sym of [...cfg.d, ...cfg.w]) {
    if (!Array.isArray(fresh[sym]) || !Array.isArray(old[sym])) continue;   // ohne bisherigen Stand kein Vergleich (erster Lauf)
    const known = new Set(old[sym].map(n => n && n.id));
    const types = new Set();
    const items = fresh[sym].filter(n => n && n.id && !known.has(n.id) && fin(n.d) && n.d >= since && n.m && NEWS_LABEL[n.type] && !(n.type === "dividend" && n.tone !== "pos" && n.tone !== "neg"));
    for (const n of items.sort((a, b) => b.d - a.d)) {
      if (types.has(n.type) || seen.has(n.id)) continue;   // je Art und Aktie nur die neueste, jede Meldung nur einmal
      types.add(n.type); seen.add(n.id);
      const level = n.tone === "neg" ? "down" : n.tone === "pos" ? "up" : "info";
      const head = String(n.t || "").replace(/\s+/g, " ").trim();
      out.push({ sym, level, depot: cfg.d.includes(sym), text: `${MARK[level]} ${sym} (${cfg.d.includes(sym) ? "Depot" : "Merkliste"}): ${NEWS_LABEL[n.type]} – „${head.length > 110 ? `${head.slice(0, 107)}…` : head}“` });
    }
  }
  return out;
}

// Wochenbericht: letzte 5 Handelstage von Depot und Merkliste, Noten, Termine der nächsten 7 Tage
export function weekly(cfg, stocks, recent, now = new Date()) {
  const N = bySym(stocks);
  const row = sym => { const x = N.get(sym); return x ? { sym, x, w: fin(x.ret1w) ? x.ret1w : null } : null; };
  const dep = cfg.d.map(row).filter(Boolean), wat = cfg.w.map(row).filter(Boolean);
  const avg = l => { const v = l.map(r => r.w).filter(fin); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const spx = N.get("SPY") || N.get("IVV") || N.get("VOO");
  const note = sym => { const h = recent && recent.n && recent.n[sym]; return Array.isArray(h) && fin(h[0]) ? { now: h[0], w1: fin(h[2]) ? h[2] : null } : null; };
  const fmtRow = r => { const n = note(r.sym); return `${r.sym} ${pc(r.w)}${n ? ` · Note ${n.now}${fin(n.w1) && n.w1 !== n.now ? ` (${n.now > n.w1 ? "▲" : "▼"}${Math.abs(n.now - n.w1)})` : ""}` : ""}`; };
  const sorted = l => [...l].sort((a, b) => (fin(b.w) ? b.w : -1e9) - (fin(a.w) ? a.w : -1e9));
  const lines = [];
  if (dep.length) {
    lines.push(`Ihr Depot, letzte 5 Handelstage: Ø ${pc(avg(dep))}${spx && fin(spx.ret1w) ? ` (S&P 500 ${pc(spx.ret1w)})` : ""}`);
    lines.push(...sorted(dep).slice(0, 8).map(r => `• ${fmtRow(r)}`));
    if (dep.length > 8) lines.push(`• … und ${dep.length - 8} weitere`);
  }
  if (wat.length) { lines.push("Merkliste:"); lines.push(...sorted(wat).slice(0, 6).map(r => `• ${fmtRow(r)}`)); }
  const today = viennaDay(now), until = addDays(today, 7);
  const dates = [...dep, ...wat].filter(r => r.x.earn && r.x.earn.date > today && r.x.earn.date <= until).sort((a, b) => (a.x.earn.date < b.x.earn.date ? -1 : 1));
  if (dates.length) lines.push(`Zahlen in den nächsten 7 Tagen: ${dates.map(r => `${r.sym} ${dayLabel(r.x.earn.date)}`).join(", ")}`);
  const below = dep.filter(r => fin(r.x.d200) && r.x.d200 < 0).map(r => r.sym);
  if (below.length) lines.push(`Unter dem 200-Tage-Schnitt: ${below.join(", ")} – Halten prüfen.`);
  return lines;
}

// Senden: nur an ntfy.sh (für die Tests auch an einen Server auf diesem Rechner); der Kanal steht im Inhalt, nicht in der Adresse
export async function send(topic, msg) {
  const base = (env.NTFY_BASE || "https://ntfy.sh").replace(/\/+$/, "");
  const u = new URL(base);
  const local = u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname);
  if (!(u.protocol === "https:" && u.hostname === "ntfy.sh" && !u.port) && !local) throw new Error("Unzulässige Adresse für Meldungen – nur ntfy.sh.");
  for (let i = 1; i <= 3; i++) {
    try {
      const r = await fetch(`${u.origin}/`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ topic, ...msg }), redirect: "error", signal: AbortSignal.timeout(20000) });
      if (r.ok) return true;
      if (r.status < 500 && r.status !== 429) throw Object.assign(new Error(`ntfy antwortet mit HTTP ${r.status}`), { final: true });
    } catch (e) { if (e.final || i === 3) throw e; }
    await new Promise(res => setTimeout(res, i * Number(env.NTFY_RETRY_MS || 3000)));
  }
  throw new Error("ntfy nicht erreichbar");
}
const readJson = async f => { if (!f) return null; try { return JSON.parse(await readFile(f, "utf8")); } catch { return null; } };
async function newsOf(dir, syms) {
  const out = {};
  if (!dir) return out;
  for (const sym of syms) { const d = await readJson(join(dir, "co", `${sym}.json`)); if (d && Array.isArray(d.items)) out[sym] = d.items; }
  return out;
}

export async function main() {
  const topic = String(env.NTFY_TOPIC || "").trim();
  if (!topic) { log("Meldungen aufs Handy sind nicht eingerichtet (Secret NTFY_TOPIC fehlt) – nichts zu tun."); return 0; }
  if (!/^[A-Za-z0-9_-]{12,64}$/.test(topic)) { log("::warning::NTFY_TOPIC ungültig: 12 bis 64 Zeichen aus Buchstaben, Ziffern, - und _ – am besten in der Seite erzeugen lassen."); return 0; }
  const cfg = parseWatch(env.PUSH_WATCH);
  const mode = env.NOTIFY_MODE || "events";
  if (!cfg && mode !== "test") { log("::warning::Secret PUSH_WATCH fehlt oder ist ungültig – in der Seite unter Portfolio → Benachrichtigungen „Push-Liste kopieren“ und als Secret eintragen."); return 0; }
  let lines = [], title = "RojkoMoney", priority = 3, tags = ["chart_with_upwards_trend"];
  if (mode === "events") {
    const ev = events(cfg, await readJson(env.STOCKS_PREV), await readJson(env.STOCKS_NEW), await readJson(env.NOTE_RECENT));
    lines = ev.map(e => e.text);
    if (ev.some(e => e.depot && e.level === "down")) { priority = 4; tags = ["warning"]; }
    title = `RojkoMoney: ${ev.length} ${ev.length === 1 ? "Hinweis" : "Hinweise"} zu Ihren Aktien`;
  } else if (mode === "news") {
    const syms = [...cfg.d, ...cfg.w];
    const ev = newsEvents(cfg, await newsOf(env.NEWS_DIR, syms), await newsOf(env.NEWS_PREV_DIR, syms));
    lines = ev.map(e => e.text);
    if (ev.some(e => e.depot && e.level === "down")) { priority = 4; tags = ["newspaper", "warning"]; } else tags = ["newspaper"];
    title = `RojkoMoney: ${ev.length} wichtige ${ev.length === 1 ? "Nachricht" : "Nachrichten"}`;
  } else if (mode === "weekly") {
    lines = weekly(cfg, await readJson(env.STOCKS_NEW), await readJson(env.NOTE_RECENT));
    title = "RojkoMoney: Ihr Wochenbericht";
    tags = ["calendar"];
  } else if (mode === "test") {
    lines = [cfg ? `Die Einrichtung klappt. Beobachtet: ${cfg.d.length} im Depot, ${cfg.w.length} auf der Merkliste, ${cfg.a.length} Kursalarme, ${Object.keys(cfg.s).length} Stops.`
      : "Der Kanal klappt – es fehlt noch das Secret PUSH_WATCH mit Ihrer Push-Liste aus der Seite."];
    title = "RojkoMoney: Probe-Meldung";
    tags = ["white_check_mark"];
  } else { log(`::warning::Unbekannte Art „${mode}“`); return 0; }
  if (!lines.length) { log(`Meldungen (${mode}): nichts Neues – nichts gesendet.`); return 0; }
  const message = (lines.length > 12 ? [...lines.slice(0, 12), `… und ${lines.length - 12} weitere – Details auf der Seite`] : lines).join("\n");
  await send(topic, { title, message, priority, tags, click: `${SITE}#portfolio` });
  log(`Meldungen (${mode}): 1 Nachricht mit ${lines.length} ${lines.length === 1 ? "Punkt" : "Punkten"} gesendet.`);   // nie Inhalte ausgeben
  return lines.length;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  // Ein Fehler beim Senden darf die Daten-Läufe nicht stoppen: nur eine Warnung, ohne Inhalte
  main().catch(e => { log(`::warning::Meldungen aufs Handy: ${String((e && e.message) || e).slice(0, 120)}`); });
}

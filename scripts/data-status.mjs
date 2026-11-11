// Daten-Status (läuft alle zwei Stunden): Wie frisch ist jede Auswertung, und sind die letzten Läufe gelungen?
// Liest die öffentlichen Datenzweige (git) und die letzten Läufe der Workflows (GitHub-API, nur lesen) und schreibt
// status.json für die Seite (Knopf an der Live-Uhr). Neue und behobene Probleme stehen in alerts – die meldet notify.mjs
// (Art „status“) aufs Handy, falls ntfy eingerichtet ist. Kein Geheimnis nötig außer dem Lese-Token des Laufs.
// Aufruf: STATUS_OUT=<status.json> STATUS_PREV=<bisheriger Stand, darf fehlen> GH_TOKEN=… REPO=owner/name node scripts/data-status.mjs
// Tests: STATUS_DIR=<Ordner mit <id>.json je Quelle> RUNS_JSON=<{"datei.yml": {conclusion, at, url}}> NOW=<ISO-Zeit>
import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

// mode: work = Stunden an Werktagen (UTC), live = Stunden im Live-Fenster (Mo–Fr 06–23 UTC), due = Prüftermin
export const SOURCES = [
  { id: "stocks", label: "Aktien-Daten und Swing-Planer", branch: "stock-data", file: "stocks.json", mode: "work", warn: 20, stale: 30, cadence: "Mo–Fr zweimal täglich", workflow: "stock-data.yml" },
  { id: "news", label: "Nachrichten", branch: "news-data", file: "news.json", mode: "work", warn: 12, stale: 26, cadence: "Mo–Fr viermal täglich", workflow: "news-data.yml" },
  { id: "fund", label: "Kennzahlen und Insider", branch: "fund-data", file: "fund.json", mode: "work", warn: 30, stale: 54, cadence: "nachts nach jedem US-Handelstag", workflow: "fund-data.yml" },
  { id: "live", label: "Live-Wächter und Marktlage", branch: "live-data", file: "live.json", mode: "live", warn: 1.5, stale: 4, cadence: "Mo–Fr etwa alle 15 Minuten (7–24 Uhr)", workflow: "live-watch.yml" },
  { id: "alarms", label: "Kursalarme und Stops aufs Handy", branch: "alarm-state", file: "state.json", mode: "live", warn: 1.5, stale: 4, cadence: "mit dem Live-Wächter", workflow: "live-watch.yml", optional: true },
  { id: "bot", label: "Copy-Bot", branch: "bot-data", file: "bot.json", mode: "live", warn: 1.5, stale: 4, cadence: "mit dem Live-Wächter", workflow: "live-watch.yml" },
  { id: "ranking", label: "Tagesempfehlung", path: "data/ranking.json", mode: "work", warn: 26, stale: 50, cadence: "Mo–Fr dreimal täglich", workflow: "daily-ranking.yml" },
  { id: "trend", label: "Trend-Bot", branch: "trend-data", file: "trend-bot.json", mode: "work", warn: 30, stale: 54, cadence: "Mo–Fr einmal täglich", workflow: "trend-bot.yml" },
  { id: "fx", label: "Wechselkurse (EZB)", branch: "fx-data", file: "fx.json", mode: "work", warn: 30, stale: 54, cadence: "Mo–Fr einmal täglich", workflow: "fx-data.yml" },
  { id: "macro", label: "Zinsen und Inflation (EZB)", branch: "wealth-data", file: "macro.json", mode: "work", warn: 30, stale: 54, cadence: "Mo–Fr einmal täglich", workflow: "wealth-data.yml" },
  { id: "research", label: "Forschungsstand im Bereich Vermögen", path: "data/wealth.json", mode: "due", field: "reviewed", dueField: "nextReview", cadence: "monatlich geprüft" },
];
export const WORKFLOWS = [["stock-data.yml", "Aktien-Daten"], ["news-data.yml", "Nachrichten"], ["fund-data.yml", "Kennzahlen"], ["live-watch.yml", "Live-Wächter"],
  ["daily-ranking.yml", "Tagesempfehlung"], ["trend-bot.yml", "Trend-Bot"], ["fx-data.yml", "Wechselkurse"], ["wealth-data.yml", "Zinsen und Inflation"], ["tests.yml", "Rechenkontrolle"]];

// Stunden zwischen a und b (ms), gezählt nur an Werktagen (UTC) bzw. nur im Live-Fenster Mo–Fr 06:00–23:00 UTC
export function hoursIn(a, b, live = false) {
  if (!(b > a)) return 0;
  let t = a, sum = 0;
  while (t < b) {
    const d = new Date(t), start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()), next = Math.min(b, start + 864e5);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) {
      const lo = live ? start + 6 * 36e5 : start, hi = live ? start + 23 * 36e5 : start + 864e5;
      sum += Math.max(0, Math.min(next, hi) - Math.max(t, lo));
    }
    t = next;
  }
  return sum / 36e5;
}
// Zustand einer Quelle: ok, warn (verspätet), stale (ausgefallen), missing (fehlt), off (nicht eingerichtet)
export function stateOf(s, now = Date.now()) {
  if (!s.updated || !Number.isFinite(Date.parse(s.updated))) return s.optional ? "off" : "missing";
  if (s.mode === "due") {
    if (!s.due) return "ok";
    const late = (now - Date.parse(`${s.due}T23:59:59Z`)) / 864e5;
    return late > 3 ? "stale" : late > 0 ? "warn" : "ok";
  }
  const h = hoursIn(Date.parse(s.updated), now, s.mode === "live");
  return h > s.stale ? "stale" : h > s.warn ? "warn" : "ok";
}
export function ago(iso, now = Date.now()) {
  const m = Math.max(0, Math.round((now - Date.parse(iso)) / 6e4));
  return m < 90 ? `${m} Min.` : m < 48 * 60 ? `${Math.round(m / 60)} Std.` : `${Math.round(m / 1440)} Tagen`;
}
const atText = iso => new Date(iso).toLocaleString("de-AT", { timeZone: "Europe/Vienna", weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export function build(sources, runs, prev, now = Date.now()) {
  const list = sources.map(s => ({ ...s, state: stateOf(s, now) }));
  const problems = [];
  for (const s of list) {
    if (s.state === "stale") problems.push({ id: `src:${s.id}`, label: s.label, text: s.mode === "due" ? `${s.label}: Prüfung seit ${s.due} überfällig.` : `${s.label}: letzter Stand vor ${ago(s.updated, now)} – erwartet ${s.cadence}.` });
    if (s.state === "missing") problems.push({ id: `src:${s.id}`, label: s.label, text: `${s.label}: keine Daten gefunden.` });
  }
  const workflows = WORKFLOWS.map(([file, name]) => ({ file, name, ...(runs[file] || {}) }));
  for (const w of workflows) if (w.conclusion === "failure" || w.conclusion === "timed_out") problems.push({ id: `wf:${w.file}`, label: `Lauf „${w.name}“`, text: `Lauf „${w.name}“ ist fehlgeschlagen (${atText(w.at)}).` });
  const before = new Map(((prev && prev.problems) || []).map(p => [p.id, p]));
  const nowIds = new Set(problems.map(p => p.id));
  const alerts = { new: problems.filter(p => !before.has(p.id)), resolved: [...before.values()].filter(p => !nowIds.has(p.id)) };
  return { updated: new Date(now).toISOString(), sources: list.map(({ branch, file, path, field, dueField, ...s }) => s), workflows, problems, alerts };
}

// ---------- Daten holen ----------
const git = args => execFileSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
async function readSource(s, dir) {
  try {
    let text;
    if (dir) text = await readFile(join(dir, `${s.id}.json`), "utf8");
    else if (s.path) text = await readFile(fileURLToPath(new URL(`../${s.path}`, import.meta.url)), "utf8");
    else { git(["fetch", "-q", "--depth=1", "origin", s.branch]); text = git(["show", `FETCH_HEAD:${s.file}`]); }
    const d = JSON.parse(text);
    return { updated: d[s.field || "updated"] || null, due: s.dueField ? d[s.dueField] || null : undefined };
  } catch { return { updated: null }; }
}
async function readRuns() {
  if (process.env.RUNS_JSON) return JSON.parse(await readFile(process.env.RUNS_JSON, "utf8"));
  const token = process.env.GH_TOKEN, repo = process.env.REPO;
  if (!token || !/^[\w.-]+\/[\w.-]+$/.test(repo || "")) return {};
  const out = {};
  for (const [file] of WORKFLOWS) {
    try {
      const url = new URL(`https://api.github.com/repos/${repo}/actions/workflows/${file}/runs`);
      url.searchParams.set("status", "completed"); url.searchParams.set("per_page", "5");
      if (url.hostname !== "api.github.com") continue;
      const r = await fetch(url, { headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" }, redirect: "error", signal: AbortSignal.timeout(20000) });
      if (!r.ok) continue;
      // abgebrochene Läufe (neuer Lauf wartet) zählen nicht – der letzte echte Ausgang zählt
      const run = ((await r.json()).workflow_runs || []).find(x => x.conclusion && x.conclusion !== "cancelled" && x.conclusion !== "skipped");
      if (run) out[file] = { conclusion: run.conclusion, at: run.updated_at, url: run.html_url };
    } catch { /* ein Workflow nicht lesbar: weglassen */ }
  }
  return out;
}

export async function main() {
  const dir = process.env.STATUS_DIR, now = process.env.NOW ? Date.parse(process.env.NOW) : Date.now();
  const sources = [];
  for (const s of SOURCES) sources.push({ ...s, ...(await readSource(s, dir)) });
  let prev = null;
  try { if (process.env.STATUS_PREV) prev = JSON.parse(await readFile(process.env.STATUS_PREV, "utf8")); } catch { prev = null; }
  const status = build(sources, await readRuns(), prev, now);
  const out = process.env.STATUS_OUT || fileURLToPath(new URL("../data/status.json", import.meta.url));
  await writeFile(out, `${JSON.stringify(status)}\n`);
  const count = st => status.sources.filter(s => s.state === st).length;
  console.log(`Daten-Status: ${count("ok")} aktuell, ${count("warn")} verspätet, ${count("stale")} ausgefallen, ${count("missing")} fehlen; ${status.workflows.filter(w => w.conclusion === "failure" || w.conclusion === "timed_out").length} Läufe fehlgeschlagen; ${status.alerts.new.length} neue, ${status.alerts.resolved.length} behobene Probleme.`);
  for (const p of status.problems) console.log(`::warning::${p.text}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch(e => { console.log(`::error::Daten-Status: ${String(e.message || e).slice(0, 160)}`); process.exitCode = 1; });

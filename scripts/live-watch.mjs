// Live-Wächter (GitHub Actions, alle 15 Minuten an Börsentagen):
// holt Tagesergebnis, Wochenergebnis und Risiko-Score der Top-Trader aus der eToro-Rangliste
// und meldet Warnungen für den empfohlenen bzw. zuletzt empfohlenen Trader.
// Braucht nur 2–3 API-Abfragen pro Lauf.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { call, findArray, log, warn, fail, hasKeys, loadRankings, toTrader, VALID_NAME } from "./etoro.mjs";

const here = p => fileURLToPath(new URL(p, import.meta.url));
const RANKING = process.env.RANKING_IN || here("../data/ranking.json");
const OUT = process.env.LIVE_OUT || here("../data/live.json");
const PREV_URL = process.env.LIVE_PREV_URL;            // vorheriger Live-Stand, um nur neue Warnungen zu melden
const LIMITS = { dayLoss: -3, weekLoss: -7 };           // Warnschwellen in % für den kopierten Trader
const de = x => x.toFixed(1).replace(".", ",");

async function main() {
  if (!hasKeys) { warn("Die Secrets ETORO_API_KEY und ETORO_USER_KEY fehlen – Live-Wächter übersprungen."); return; }
  let ranking = {};
  try { ranking = JSON.parse(await readFile(RANKING, "utf8")); } catch { warn("Noch keine ranking.json vorhanden."); }
  const maxRisk = (ranking.config && ranking.config.maxRisk) || 5;
  const followedRaw = (ranking.recommendation && ranking.recommendation.userName) || (ranking.lastRecommended && ranking.lastRecommended.userName) || null;
  const followed = followedRaw && VALID_NAME.test(followedRaw) ? followedRaw : null;
  const names = new Set([...(ranking.top || []).map(t => t.userName), followed].filter(n => n && VALID_NAME.test(n)));

  // Rangliste über alle Risikostufen, damit auch ein gestiegener Risiko-Score auffällt
  const { traders } = await loadRankings({ maxRisk: 10, limit: 200, pages: 2 });
  const byName = new Map(traders.map(t => [t.userName, t]));
  if (followed && !byName.has(followed)) {
    try {
      const d = await call(`/v2/portfolios/${encodeURIComponent(followed)}/rankings`, { period: "LastTwoYears" });
      const t = toTrader(findArray(d)[0] || d);
      if (t.userName === followed) byName.set(followed, t);
    } catch (e) { warn(`${followed}: ${e.message}`); }
  }

  const entries = [...names].map(n => byName.get(n)).filter(Boolean).map(t => ({
    userName: t.userName, risk: t.risk ?? null, dailyGain: t.dailyGain ?? null, thisWeekGain: t.thisWeekGain ?? null, copiers: t.copiers ?? null,
  }));

  // Warnungen für den kopierten Trader
  const now = new Date(), today = now.toISOString().slice(0, 10);
  const monday = new Date(now.getTime() - ((now.getUTCDay() + 6) % 7) * 864e5).toISOString().slice(0, 10);
  const alerts = [];
  const f = followed && byName.get(followed);
  if (followed && !f) alerts.push({ id: `${today}:${followed}:missing`, userName: followed, text: `${followed} ist in der eToro-Rangliste nicht mehr zu finden.` });
  if (f && Number.isFinite(f.risk) && f.risk > maxRisk) alerts.push({ id: `${today}:${followed}:risk${f.risk}`, userName: followed, text: `Risiko-Score von ${followed} ist auf ${f.risk} gestiegen (Grenze ${maxRisk}).` });
  if (f && Number.isFinite(f.dailyGain) && f.dailyGain <= LIMITS.dayLoss) alerts.push({ id: `${today}:${followed}:day`, userName: followed, text: `${followed} liegt heute bei ${de(f.dailyGain)} %.` });
  if (f && Number.isFinite(f.thisWeekGain) && f.thisWeekGain <= LIMITS.weekLoss) alerts.push({ id: `${monday}:${followed}:week`, userName: followed, text: `${followed} liegt diese Woche bei ${de(f.thisWeekGain)} %.` });

  let prevIds = new Set();
  if (PREV_URL) {
    try {
      const r = await fetch(PREV_URL, { signal: AbortSignal.timeout(10000) });   // öffentlicher Stand, ohne Schlüssel
      if (r.ok) prevIds = new Set(((await r.json()).alerts || []).map(a => a.id));
    } catch {}
  }
  const newAlerts = alerts.filter(a => !prevIds.has(a.id));

  const out = { updated: now.toISOString(), followed, limits: LIMITS, entries, alerts, newAlerts };
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(out) + "\n");
  log(`Live-Stand: ${entries.length} Trader${followed ? `, verfolgt: ${followed}` : ""}, Warnungen: ${alerts.length} (neu: ${newAlerts.length})`);
  for (const a of alerts) log(`Warnung: ${a.text}`);
}

main().catch(e => fail(e.message));

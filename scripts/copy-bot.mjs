// Copy-Bot (GitHub Actions, in jeder Runde des Live-Wächters, an Börsentagen etwa alle 15 Minuten):
// kopiert die geprüfte Tageswahl automatisch im eToro-Konto – zuerst nur im Demokonto.
//
// Abgleich in jeder Runde:  Soll = Tageswahl aus data/ranking.json (wird nur nach bestandener Gegenrechnung veröffentlicht)
//                           Ist  = Kopien im eToro-Konto, die der Bot selbst angelegt hat
// Sicherungen:
//  - Schalter: Repository-Variable BOT_MODE = off | demo (ohne Variable: demo).
//  - Echtgeld ist im Programm gesperrt (REAL_MONEY_UNLOCKED = false): Der Bot handelt nur im Demokonto mit Spielgeld,
//    auch wenn jemand BOT_MODE = real setzt. Freigabe nur auf ausdrücklichen Wunsch des Nutzers per Code-Änderung.
//  - Der Bot fasst nur Kopien an, die er selbst gestartet hat; Ihre eigenen Kopien bleiben unberührt.
//  - Höchstens eine Bot-Kopie gleichzeitig, höchstens zwei Starts pro Tag, nie Geld nachschießen.
//  - Aufträge werden nie automatisch wiederholt (ein zweiter Versuch könnte doppelt kopieren); unklare Fälle werden geprüft.
//  - Copy Stop Loss: Die eToro-API kann ihn nicht setzen – der Bot überwacht ihn selbst und beendet die Kopie.
//  - Betrag: festes Spielgeld in Euro (Repository-Variable COPY_BOT_BUDGET_EUR, Standard 1.000 €), zum Euro-Kurs in Dollar.
//  - Lehnt eToro die Tageswahl ab, versucht der Bot per Probelauf die nächstbesten geprüften Trader (Top 5, in den Grenzen).
//  - Für später vorbereitet: Echtgeld höchstens 500 $ pro Kopie (vom Nutzer festgelegt).
//  - Datenschutz: Das Repository ist öffentlich. Deshalb stehen in Protokoll, bot.json und Meldungen keine Dollar-Beträge
//    und keine Ihrer eigenen Kopien – nur die Bot-Kopie mit Anteilen in Prozent.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { randomUUID, randomBytes } from "node:crypto";
import { call, send, field, num, log, warn, hasKeys, sleep, toTrader, VALID_NAME } from "./etoro.mjs";
import { eurUsdCached, budgetEur } from "./fred.mjs";

const here = p => fileURLToPath(new URL(p, import.meta.url));
const MODE = String(process.env.BOT_MODE || "demo").trim().toLowerCase();
const RANKING = process.env.RANKING_IN || here("../data/ranking.json");
const STATE_IN = process.env.BOT_STATE_IN || "";
const OUT = process.env.BOT_OUT || here("../data/bot.json");
const POLL_MS = Number(process.env.BOT_POLL_MS ?? 4000);

// Echtgeld gesperrt – der Nutzer möchte zuerst nur mit Spielgeld (Demokonto) handeln.
// Zum Freigeben müssten diese Zeile, die Workflows (Echtgeld-Schlüssel) und die Tests geändert werden.
export const REAL_MONEY_UNLOCKED = false;
// Spielgeld für die Kopie in Euro (eToro rechnet in Dollar – umgerechnet zum Referenzkurs)
export const BUDGET_EUR = budgetEur(process.env.COPY_BOT_BUDGET_EUR, 1000);

export const LIMITS = {
  realMaxUsd: 500,          // Echtgeld: höchstens 500 $ pro Kopie
  minCopyUsd: 200,          // eToro-Mindestbetrag für eine Kopie
  maxRankingAgeHours: 30,   // ältere Tageswahl → keine neue Kopie starten
  maxStartsPerDay: 2,       // erste Kopie des Tages + höchstens ein Wechsel
  substitutes: 4,           // so viele Ersatz-Trader (aus den Top 5) prüft der Bot, wenn eToro die Tageswahl ablehnt
  substituteMaxRank: 5,
  pendingTimeoutHours: 2,   // so lange wird ein unbestätigter Auftrag nachgeprüft
  closingRetryMinutes: 60,  // Beenden erneut anstoßen, wenn die Kopie danach noch normal läuft
  keepEvents: 40,
};

const de = (x, d = 0) => Number(x).toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });
const usd = x => `${de(x, 0)} $`;
const pctTxt = x => `${x > 0 ? "+" : ""}${de(x, 1)} %`;
async function readJson(path) {
  if (!path) return null;
  try { return JSON.parse(await readFile(path, "utf8")); } catch { return null; }
}

// Wert einer Kopie: freies Geld in der Kopie + offene Positionen samt nicht realisiertem Gewinn/Verlust
function mirrorInfo(m) {
  const positions = Array.isArray(field(m, "positions")) ? field(m, "positions") : [];
  let open = 0, missing = 0;
  for (const p of positions) {
    const pnl = num(field(field(p, "unrealizedPnL") || {}, "pnL"));
    if (!Number.isFinite(pnl)) missing++;
    open += (num(field(p, "amount")) || 0) + (Number.isFinite(pnl) ? pnl : 0);
  }
  const invested = (num(field(m, "initialInvestment")) || 0) + (num(field(m, "depositSummary")) || 0) - (num(field(m, "withdrawalSummary")) || 0);
  const value = (num(field(m, "availableAmount")) || 0) + open;
  const status = num(field(m, "mirrorStatusID"));
  const user = field(m, "parentUsername");
  return {
    mirrorID: num(field(m, "mirrorID")), parentCID: num(field(m, "parentCID")),
    userName: typeof user === "string" && VALID_NAME.test(user) ? user : null,
    invested, value, pnlPct: invested > 0 ? (value / invested - 1) * 100 : 0,
    complete: missing === 0, positions: positions.length, status,
    closing: field(m, "pendingForClosure") === true || status === 2,
    paused: field(m, "isPaused") === true || status === 1,
    etoroStopLossPct: num(field(m, "stopLossPercentage")) ?? null,
    etoroStopLossAmount: num(field(m, "stopLossAmount")) ?? null,
    since: field(m, "startedCopyDate") || null,
  };
}

async function readAccount(P) {
  const d = await call(P.pnl);
  const cp = field(d, "clientPortfolio") || d || {};
  const credit = num(field(cp, "credit"));
  if (!Number.isFinite(credit)) throw new Error("Kontostand nicht lesbar (credit fehlt).");
  const mirrors = (Array.isArray(field(cp, "mirrors")) ? field(cp, "mirrors") : []).map(mirrorInfo).filter(m => Number.isInteger(m.mirrorID));
  const own = (Array.isArray(field(cp, "positions")) ? field(cp, "positions") : [])
    .reduce((s, p) => s + (num(field(p, "amount")) || 0) + (num(field(field(p, "unrealizedPnL") || {}, "pnL")) || 0), 0);
  return { credit, equity: credit + own + mirrors.reduce((s, m) => s + m.value, 0), mirrors };
}

async function main() {
  const now = new Date(), today = now.toISOString().slice(0, 10);
  const prev = (await readJson(STATE_IN)) || {};
  const st = {
    version: 1, managed: [], pending: null, starts: [], blocked: {}, refused: {}, substitute: null, notices: {}, events: [],
    ...prev, mode: MODE, budgetEur: BUDGET_EUR, updated: now.toISOString(), newEvents: [],
  };
  const money = `${de(BUDGET_EUR, 0)} € Spielgeld`;
  const event = (kind, text, notify = true) => {
    const e = { at: now.toISOString(), kind, text };
    st.events = [...st.events, e].slice(-LIMITS.keepEvents);
    if (notify) st.newEvents.push(e);
    log(`${kind}: ${text}`);
  };
  const once = (key, kind, text, notify = true) => { if (st.notices[key] !== today) { st.notices[key] = today; event(kind, text, notify); } else log(`${kind}: ${text}`); };
  const save = async () => {
    for (const k of Object.keys(st.notices)) if (st.notices[k] !== today) delete st.notices[k];
    st.starts = st.starts.filter(d => d >= new Date(now - 7 * 864e5).toISOString().slice(0, 10));
    await mkdir(dirname(OUT), { recursive: true });
    await writeFile(OUT, JSON.stringify(st, null, 1));
  };

  if (MODE === "off") { st.active = false; log("Bot ausgeschaltet (BOT_MODE = off)."); return save(); }
  if (!["demo", "real"].includes(MODE)) {
    st.active = false;
    once("mode", "fehler", `Unbekannter Wert „${MODE}“ für BOT_MODE – erlaubt sind off, demo und real. Der Bot tut nichts.`);
    return save();
  }
  if (MODE === "real" && !REAL_MONEY_UNLOCKED) {
    st.active = false;
    once("real-locked", "hinweis", "Echtgeld ist im Bot gesperrt – er handelt nur im Demokonto mit Spielgeld. Bitte BOT_MODE auf demo setzen.");
    return save();
  }
  if (!hasKeys) { st.active = false; st.setup = false; log("Kein Bot-Schlüssel hinterlegt – Bot übersprungen."); return save(); }
  st.active = true; st.setup = true;
  st.fx = await eurUsdCached(st.fx, now, e => warn(`Euro-Kurs: ${e.message} – nehme den letzten bekannten.`));
  st.refused = st.refused || {};
  for (const n of Object.keys(st.refused)) if (st.refused[n].day !== today) delete st.refused[n];   // Ablehnungen gelten einen Tag
  if (st.managed.length) delete st.allRefused;   // eine Kopie läuft: eine spätere Sperre wird wieder sofort gemeldet
  const P = MODE === "real"
    ? { copy: "/v2/trading/copy", pnl: "/v1/trading/info/real/pnl" }
    : { copy: "/v2/trading/copy/demo", pnl: "/v1/trading/info/demo/pnl" };

  // 1. Unbestätigter Auftrag aus einer früheren Runde: nur nachfragen, nie neu senden
  if (st.pending) {
    const p = st.pending;
    let s = null;
    try { s = await call(`${P.copy}/${encodeURIComponent(p.referenceID)}`); } catch (e) { log(`Status ${p.referenceID}: ${e.message}`); }
    if (s && field(s, "isSuccess") === true) {
      const mirrorID = num(field(s, "mirrorID")), user = field(s, "parentUsername");
      const wrong = Boolean(user && user !== p.userName);
      st.managed.push({ mirrorID, userName: p.userName, parentCID: p.parentCID, csl: p.csl, sharePct: p.sharePct, since: today, ...(wrong ? { forceClose: true } : {}) });
      st.pending = null;
      event("gestartet", `Kopie von ${p.userName} mit ${money} ist bestätigt (nachträglich).`);
      if (wrong) event("fehler", `eToro meldet ${user} statt ${p.userName} – die Kopie wird sofort beendet.`);
    } else if (s && field(s, "isSuccess") === false) {
      st.pending = null;
      event("abgelehnt", `eToro hat die Kopie von ${p.userName} abgelehnt: ${field(s, "failReason") || "ohne Begründung"}.`);
    } else if ((now - new Date(p.at)) / 36e5 > LIMITS.pendingTimeoutHours) {
      st.pending = null;
      st.adopt = { userName: p.userName, parentCID: p.parentCID, csl: p.csl, sharePct: p.sharePct };
      event("unklar", `Für den Auftrag ${p.referenceID} (${p.userName}) kam keine Bestätigung. Der Bot prüft jetzt das Konto selbst.`);
    } else {
      log(`Warte auf die Bestätigung für ${p.userName} (${p.referenceID}).`);
      return save();
    }
  }

  // 2. Konto lesen
  const acc = await readAccount(P);
  st.checkedAt = now.toISOString();
  const byId = new Map(acc.mirrors.map(m => [m.mirrorID, m]));

  // 3. Eigene Kopien abgleichen (beendet? fremde Daten?)
  for (const x of [...st.managed]) {
    const m = byId.get(x.mirrorID);
    if (!m) {
      st.managed = st.managed.filter(y => y !== x);
      if (x.closing) event("beendet", `Die Kopie von ${x.userName} ist geschlossen, das Geld ist zurück im Konto.`, false);
      else {
        st.blocked[x.userName] = today;
        event("beendet", `Die Kopie von ${x.userName} ist nicht mehr im Konto (von Hand oder durch eToros eigenen Stop Loss beendet). Der Bot startet sie erst wieder, wenn die Tageswahl wechselt.`);
      }
      continue;
    }
    if (m.parentCID !== x.parentCID) {
      st.managed = st.managed.filter(y => y !== x);
      event("fehler", `Kopie ${x.mirrorID} gehört laut eToro zu ${m.userName}, nicht zu ${x.userName}. Der Bot fasst sie nicht mehr an – bitte in eToro prüfen.`);
    }
  }
  // Unbestätigter Auftrag, aber eToro hat die Kopie angelegt → als Bot-Kopie übernehmen
  if (st.adopt) {
    const a = st.adopt, m = acc.mirrors.find(y => y.parentCID === a.parentCID && !st.managed.some(x => x.mirrorID === y.mirrorID));
    if (m) { st.managed.push({ mirrorID: m.mirrorID, userName: a.userName, parentCID: a.parentCID, csl: a.csl, sharePct: a.sharePct, since: today }); event("gestartet", `Die Kopie von ${a.userName} ist doch angelegt worden; der Bot überwacht sie.`); }
    else event("beendet", `Im Konto gibt es keine Kopie von ${a.userName} – der Auftrag ist nicht ausgeführt worden.`, false);
    delete st.adopt;
  }

  // 4. Soll: geprüfte Tageswahl
  const ranking = await readJson(RANKING);
  const ageHours = ranking && ranking.updated ? (now - new Date(ranking.updated)) / 36e5 : Infinity;
  const fresh = ageHours <= LIMITS.maxRankingAgeHours;
  const pick = ranking && ranking.pick && VALID_NAME.test(ranking.pick.userName) ? ranking.pick : null;
  const noPick = Boolean(ranking) && fresh && ranking.pick === null;
  // Sperre (nach Stop Loss oder von Hand beendet) endet erst mit einer neuen, frischen Tageswahl
  for (const n of Object.keys(st.blocked)) if (noPick || (fresh && pick && pick.userName !== n)) delete st.blocked[n];
  if (!fresh) once("stale", "warten", `Die Tageswahl ist ${Number.isFinite(ageHours) ? `${de(ageHours, 0)} Stunden` : "nicht vorhanden oder zu"} alt – der Bot startet keine neue Kopie.`);
  // Ersatz-Kopie (eToro hat die Tageswahl abgelehnt): gilt, solange die Tageswahl dieselbe bleibt
  if (st.substitute && (noPick || (fresh && pick && pick.userName !== st.substitute.for))) st.substitute = null;
  const isSubstitute = name => Boolean(st.substitute && pick && st.substitute.userName === name && st.substitute.for === pick.userName);

  // 5. Copy Stop Loss selbst überwachen, Wechsel und „keine Tageswahl“ umsetzen
  for (const x of st.managed) {
    const m = byId.get(x.mirrorID);
    if (m.closing) continue;
    if (x.closing && (now - new Date(x.closing)) / 6e4 < LIMITS.closingRetryMinutes) continue;
    let reason = null;
    if (x.forceClose) reason = "eToro hat die Kopie einem anderen Trader zugeordnet";
    else if (m.complete && m.invested > 0 && m.pnlPct <= -x.csl) {
      reason = `Copy Stop Loss erreicht: ${pctTxt(m.pnlPct)} (Grenze −${x.csl} %)`;
      st.blocked[x.userName] = today;
    } else if (noPick) reason = "Heute gibt es keine Tageswahl – kein Trader hält alle Grenzen ein";
    else if (fresh && pick && pick.userName !== x.userName && !isSubstitute(x.userName)) reason = `die neue Tageswahl ist ${pick.userName}`;
    if (!m.complete) warn(`Für ${x.userName} fehlen eToro-Angaben zum Gewinn/Verlust einzelner Positionen – Stop Loss diesmal nicht prüfbar.`);
    if (!reason) continue;
    try {
      await send("POST", `${P.copy}/close`, { mirrorID: x.mirrorID, unregisterType: "Close", clientRequestID: randomUUID() });
      x.closing = now.toISOString();
      event("beenden", `Kopie von ${x.userName} wird beendet (${reason}). Stand der Kopie: ${pctTxt(m.pnlPct)}.`);
    } catch (e) {
      once(`close-err:${x.mirrorID}`, "fehler", `Beenden der Kopie von ${x.userName} ist fehlgeschlagen: ${e.message}. Der Bot versucht es jede Runde erneut.`);
    }
  }

  // 6. Tageswahl starten, wenn nichts dagegen spricht
  const startsToday = st.starts.filter(d => d === today).length;
  const own = pick && acc.mirrors.find(m => m.userName === pick.userName && !st.managed.some(x => x.mirrorID === m.mirrorID));
  if (!fresh || !pick || noPick) { /* nichts starten */ }
  else if (st.managed.length) { if (!st.managed.some(x => x.userName === pick.userName || isSubstitute(x.userName))) log("Warte, bis die alte Kopie geschlossen ist."); }
  else if (st.blocked[pick.userName]) log(`${pick.userName} ist bis zur nächsten neuen Tageswahl gesperrt.`);
  else if (own) once(`own:${pick.userName}`, "hinweis", `Sie kopieren ${pick.userName} bereits selbst – der Bot startet keine zweite Kopie und fasst Ihre nicht an.`);
  else if (startsToday >= LIMITS.maxStartsPerDay) once("starts", "hinweis", `Heute wurden schon ${startsToday} Kopien gestartet – mehr erlaubt der Bot nicht an einem Tag.`);
  else if ((st.refused[pick.userName] ? "refused" : await start(pick)) === "refused") await substitute();

  // eToro lehnt die Tageswahl ab: die nächstbesten geprüften Trader per Probelauf versuchen (ändert nichts, bis einer passt)
  async function substitute() {
    const ownNames = new Set(acc.mirrors.filter(m => !st.managed.some(x => x.mirrorID === m.mirrorID)).map(m => m.userName));
    const list = (Array.isArray(ranking.top) ? ranking.top : [])
      .filter(t => t && VALID_NAME.test(t.userName) && t.userName !== pick.userName && t.inLimits === true && Number(t.rank) <= LIMITS.substituteMaxRank
        && !st.blocked[t.userName] && !ownNames.has(t.userName))
      .sort((a, b) => a.rank - b.rank).slice(0, LIMITS.substitutes);
    let tried = 0;
    for (const t of list) {
      if (st.refused[t.userName]) continue;
      if (st.starts.filter(d => d === today).length >= LIMITS.maxStartsPerDay) return;
      tried++;
      const res = await start({ userName: t.userName, cid: t.cid, csl: t.csl }, pick.userName);
      if (res === "started" || res === "pending") { st.substitute = { userName: t.userName, for: pick.userName, day: today }; return; }
      if (res !== "refused") return;   // anderer Fehler: in dieser Runde nichts weiter
    }
    const codes = [...new Set(Object.values(st.refused).map(r => r.code).filter(c => c !== null && c !== undefined))];
    if (!list.length) once(`nosub:${pick.userName}`, "hinweis", `eToro lässt die Kopie von ${pick.userName} nicht zu, und heute ist kein anderer geprüfter Trader in den Grenzen. Der Bot versucht es mit der nächsten Tageswahl wieder.`);
    else if (tried || list.every(t => st.refused[t.userName])) {
      // Als Benachrichtigung nur, wenn es neu ist (anderer Fehlercode) oder die letzte eine Woche her ist; sonst nur auf der Website
      const key = codes.join(",") || "–", last = st.allRefused;
      const fresh = !last || last.codes !== key || !(last.notified > new Date(now - 7 * 864e5).toISOString().slice(0, 10));
      if (fresh && st.notices.allrefused !== today) st.allRefused = { codes: key, notified: today };
      once("allrefused", "abgelehnt", `eToro lässt heute keine Kopie zu – weder ${pick.userName} noch ${list.length} geprüfte Ersatz-Trader${codes.length ? ` (Fehlercode ${codes.join(", ")})` : ""}. `
        + "Mögliche Gründe: Ihr Konto ist für CFDs gesperrt, und die Trader halten auch CFD-Positionen – oder eToro lässt das Kopieren im Demokonto über die Schnittstelle zurzeit nicht zu. "
        + "Klären lässt es sich in der eToro-App: im virtuellen Portfolio einen dieser Trader einmal von Hand kopieren – die Meldung dort nennt den Grund. "
        + "Der Bot versucht es jeden Tag wieder und meldet sich erst wieder, wenn sich etwas ändert (spätestens nach einer Woche).", fresh);
    }
  }

  // Ergebnis: "started", "pending" (gesendet, Bestätigung folgt), "refused" (Probelauf abgelehnt), "skip" (anderer Grund)
  async function start(p, insteadOf = null) {
    // Kunden-ID prüfen: muss zum Benutzernamen gehören (öffentliche Rangliste)
    let cid = Number.isInteger(p.cid) ? p.cid : null;
    try {
      const r = toTrader(await call(`/v2/portfolios/${encodeURIComponent(p.userName)}/rankings`, { period: "LastTwoYears" }));
      const found = r.userName === p.userName ? r.cid : undefined;
      if (Number.isInteger(found)) {
        if (cid !== null && cid !== found) { once(`cid:${p.userName}`, "fehler", `Kunden-ID von ${p.userName} passt nicht (${cid} statt ${found}) – keine Kopie.`); return "skip"; }
        cid = found;
      }
    } catch (e) { log(`Kunden-ID von ${p.userName} nicht nachprüfbar: ${e.message}`); }
    if (!Number.isInteger(cid)) { once(`cid:${p.userName}`, "fehler", `Keine Kunden-ID für ${p.userName} – keine Kopie.`); return "skip"; }

    // Betrag: festes Spielgeld in Euro, zum Referenzkurs in Dollar; Echtgeld höchstens 500 $; nie mehr als das freie Geld
    let amount = Math.floor(BUDGET_EUR * st.fx.value);
    if (MODE === "real") amount = Math.min(amount, LIMITS.realMaxUsd);
    amount = Math.min(amount, Math.floor(acc.credit));
    if (!(amount >= LIMITS.minCopyUsd)) { once("amount", "hinweis", `Der Betrag für ${p.userName} läge unter eToros Mindestbetrag von ${usd(LIMITS.minCopyUsd)} pro Kopie. Keine Kopie.`); return "skip"; }
    const sharePct = acc.equity > 0 ? amount / acc.equity * 100 : 0;
    const csl = Number.isFinite(p.csl) ? Math.min(95, Math.max(5, Math.round(p.csl))) : 20;

    // Probelauf bei eToro (ändert nichts)
    let ok;
    try { ok = await send("POST", `${P.copy}/eligibility`, { parentCID: cid, amount }); }
    catch (e) { once(`elig-err:${p.userName}`, "fehler", `Probelauf für ${p.userName} fehlgeschlagen: ${e.message}`); return "skip"; }
    if (field(ok, "isSuccess") !== true) {
      // Begründung aus allen bekannten Feldern; die Feldnamen ins Protokoll, um neue Antworten zu verstehen (keine Beträge)
      const why = ["errorMessage", "failReason", "reason", "message", "errorMessageCode", "errorCode", "errors"].map(k => field(ok, k))
        .filter(x => x !== undefined && x !== null && x !== "").map(x => (typeof x === "object" ? JSON.stringify(x) : String(x))).join(" · ")
        .replace(/\d{4,}(?:[.,]\d+)?|\d+[.,]\d+/g, "#").slice(0, 200);
      log(`Probelauf ${p.userName}: Antwort-Felder ${Object.keys(ok || {}).join(", ") || "–"}`);
      const code = num(field(ok, "errorCode"));
      st.refused[p.userName] = { day: today, code: Number.isFinite(code) ? code : null };
      // nur auf der Website; benachrichtigt wird über das Ergebnis (Ersatz-Kopie gestartet oder gar keine Kopie möglich)
      once(`elig:${p.userName}`, "abgelehnt", `eToro lässt die Kopie von ${p.userName} mit ${money} nicht zu (${why ? `Antwort: ${why}` : "ohne Begründung"}).${insteadOf ? "" : " Der Bot prüft die nächstbesten geprüften Trader."}`, false);
      return "refused";
    }

    // Auftrag: vorher merken, dann genau einmal senden
    const referenceID = `dtd${today.replace(/-/g, "")}${randomBytes(6).toString("hex")}`;
    st.pending = { referenceID, userName: p.userName, parentCID: cid, sharePct, csl, at: now.toISOString() };
    st.starts.push(today);
    await save();
    try {
      await send("POST", P.copy, { parentCID: cid, amount, referenceID });
    } catch (e) {
      if (e.uncertain) { event("unklar", `Kopie von ${p.userName} gesendet, aber ohne Bestätigung (${e.message}). Der Bot fragt in der nächsten Runde nach – er sendet nicht noch einmal.`); return "pending"; }
      st.pending = null;
      event("fehler", `eToro hat den Auftrag für ${p.userName} abgewiesen: ${e.message}`);
      return "skip";
    }
    for (let i = 0; i < 6; i++) {
      await sleep(POLL_MS);
      let s = null;
      try { s = await call(`${P.copy}/${encodeURIComponent(referenceID)}`); } catch (e) { log(`Status: ${e.message}`); }
      if (!s || field(s, "isSuccess") === undefined) continue;
      st.pending = null;
      if (field(s, "isSuccess") !== true) { event("abgelehnt", `eToro hat die Kopie von ${p.userName} abgelehnt: ${field(s, "failReason") || "ohne Begründung"}.`); return "skip"; }
      const mirrorID = num(field(s, "mirrorID")), user = field(s, "parentUsername");
      const entry = { mirrorID, userName: p.userName, parentCID: cid, csl, sharePct, since: today };
      st.managed.push(entry);
      if (user && user !== p.userName) {
        try { await send("POST", `${P.copy}/close`, { mirrorID, unregisterType: "Close", clientRequestID: randomUUID() }); entry.closing = new Date().toISOString(); } catch {}
        event("fehler", `eToro meldet ${user} statt ${p.userName} – die Kopie wird sofort beendet.`);
        return "skip";
      }
      event("gestartet", `${MODE === "real" ? "Echtgeld" : "Demo"}: Kopie von ${p.userName} mit ${money} gestartet${insteadOf ? ` – als Ersatz, weil eToro ${insteadOf} nicht zulässt` : ""}, offene Trades werden mitkopiert. Copy Stop Loss ${csl} % überwacht der Bot.`);
      return "started";
    }
    log(`Noch keine Bestätigung für ${p.userName} – der Bot fragt in der nächsten Runde nach.`);
    return "pending";
  }

  // 7. Überblick für die Website: nur die Bot-Kopie, nur Prozentwerte (Ihre eigenen Kopien und Beträge bleiben privat)
  st.copies = st.managed.map(x => {
    const m = byId.get(x.mirrorID);
    return m ? {
      userName: x.userName, since: x.since, pnlPct: m.pnlPct, complete: m.complete, sharePct: acc.equity > 0 ? m.value / acc.equity * 100 : null,
      insteadOf: st.substitute && st.substitute.userName === x.userName ? st.substitute.for : null,
      botStopLossPct: x.csl, closing: m.closing || Boolean(x.closing), paused: m.paused, aligning: m.status === 3,
      // eToros eigene Grenze als Abstand zum aktuellen Wert in Prozent (der Dollar-Betrag bleibt privat)
      etoroStopBelowPct: m.value > 0 && m.etoroStopLossAmount > 0 ? (1 - m.etoroStopLossAmount / m.value) * 100 : null,
    } : { userName: x.userName, since: x.since, justStarted: true };
  });
  await save();
  log(`Bot-Kopien: ${st.copies.map(c => `${c.userName}${Number.isFinite(c.pnlPct) ? ` (${pctTxt(c.pnlPct)})` : ""}`).join(", ") || "keine"}.`);
}

main().catch(async e => {
  console.log(`::error::Copy-Bot: ${e.message}`);
  process.exit(1);
});

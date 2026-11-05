// ---------- Tagesempfehlung & Top 25 ----------
// Liest data/ranking.json (geprüft vom GitHub-Job), data/returns.json (Monatsrenditen für das Detail-Fenster)
// und den Live-Stand vom Zweig live-data. Nutzt Hilfsfunktionen aus app.js.
(() => {
  const BASE = "https://raw.githubusercontent.com/shg9d54y9j-langw/Anna-test";
  const RAW = `${BASE}/claude/daytrade-website/data/ranking.json`;
  const RAW_RETURNS = `${BASE}/claude/daytrade-website/data/returns.json`;
  const LIVE = `${BASE}/live-data/live.json`;
  const BOT = `${BASE}/bot-data/bot.json`;
  const body = $("dailyBody");
  let data = null, live = null, bot = null, returns = null, returnsLoading = null;

  const pct = p => (!Number.isFinite(p) ? "–" : p > 0.995 ? "über 99 %" : p < 0.005 ? "unter 1 %" : `${fmt(p * 100, 0)} %`);
  const n1 = x => (Number.isFinite(x) ? fmt(x, 1) : "–");
  const sign = x => (x > 0 ? "+" : "") + fmt(x, 2);
  const profile = u => `https://www.etoro.com/people/${encodeURIComponent(u)}`;
  const link = u => `<a href="${profile(u)}" target="_blank" rel="noopener noreferrer">${esc(u)}</a>`;
  const okName = u => typeof u === "string" && /^[A-Za-z0-9_.-]{1,40}$/.test(u);   // nur gültige eToro-Namen anzeigen
  const dateDe = iso => new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
  const account = () => { const x = parseFloat(($("sAccount") || {}).value); return Number.isFinite(x) && x > 0 ? x : null; };
  const get = url => fetch(url, { cache: "no-store" }).then(r => (r.ok ? r.json() : null)).catch(() => null);

  let lastStamp = null;
  async function load() {
    const t = Date.now();
    const [local, raw, lv, bt] = await Promise.all([get(`data/ranking.json?t=${t}`), get(`${RAW}?t=${t}`), get(`${LIVE}?t=${t}`), get(`${BOT}?t=${t}`)]);
    const list = [local, raw].filter(d => d && d.updated);
    const next = list.sort((a, b) => new Date(b.updated) - new Date(a.updated))[0] || null;
    const stamp = [next && next.updated, lv && lv.updated, bt && bt.updated].join("|");
    if (stamp === lastStamp) return;   // nichts Neues → nichts neu zeichnen
    lastStamp = stamp;
    if (next && data && next.updated !== data.updated) returns = null;   // neue Auswertung → Monatsrenditen neu laden
    data = next;
    live = lv && lv.updated && Array.isArray(lv.entries) ? lv : null;
    bot = bt && bt.updated ? bt : null;
    window.DTD.ranking = data;
    window.DTD.live = live;
    window.DTD.bot = bot;
    window.dispatchEvent(new Event("dtd:data"));
    notifyAlerts();
    render();
  }
  function loadReturns() {
    if (returns) return Promise.resolve(returns);
    if (!returnsLoading) {
      const t = Date.now();
      returnsLoading = Promise.all([get(`data/returns.json?t=${t}`), get(`${RAW_RETURNS}?t=${t}`)]).then(list => {
        const ok = list.filter(r => r && Array.isArray(r.traders));
        returns = ok.sort((a, b) => new Date(b.updated) - new Date(a.updated))[0] || null;
        returnsLoading = null;
        return returns;
      });
    }
    return returnsLoading;
  }

  // ---------- Live-Warnungen: Hinweis und Zähler am Reiter ----------
  function notifyAlerts() {
    const alerts = live ? (live.alerts || []).filter(a => a && typeof a.text === "string") : [];
    const tab = $("tab-daily");
    tab.querySelector(".count")?.remove();
    if (alerts.length) {
      const c = document.createElement("span");
      c.className = "count";
      c.textContent = alerts.length;
      c.setAttribute("aria-label", `${alerts.length} Warnung(en)`);
      tab.append(c);
    }
    const seen = new Set(store.get("dtd-seen-alerts", []));
    for (const a of alerts) if (!seen.has(a.id)) { toast("Warnung vom Live-Wächter", ` ${a.text}`); seen.add(a.id); }
    store.set("dtd-seen-alerts", [...seen].slice(-100));
  }

  // ---------- Live-Anzeige ----------
  const liveOf = name => (live ? live.entries.find(e => e.userName === name) : null);
  function liveBox() {
    if (!live) return `<p class="hint">Live-Werte erscheinen hier, sobald der Live-Wächter (alle 15 Minuten an Börsentagen) gelaufen ist.</p>`;
    const age = (Date.now() - new Date(live.updated)) / 6e4;
    const time = new Date(live.updated).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
    const f = okName(live.followed) ? liveOf(live.followed) : null;
    const alerts = (live.alerts || []).filter(a => a && typeof a.text === "string");
    let html = `<div class="live ${alerts.length ? "alert" : ""}">
      <div class="live-head"><span class="dot ${age < 40 ? "on" : ""}"></span> Live-Stand ${time} Uhr${age >= 40 ? ` <span class="muted small">(${fmt(age / 60, 1)} Std. alt – außerhalb der Börsenzeit normal)</span>` : ""}</div>`;
    if (f) {
      html += `<p class="small">${link(f.userName)}: heute <b class="${f.dailyGain < 0 ? "down" : "up"}">${Number.isFinite(f.dailyGain) ? sign(f.dailyGain) + " %" : "–"}</b>
        · diese Woche <b class="${f.thisWeekGain < 0 ? "down" : "up"}">${Number.isFinite(f.thisWeekGain) ? sign(f.thisWeekGain) + " %" : "–"}</b>
        · Risiko-Score <b>${f.risk ?? "–"}</b></p>`;
    }
    for (const a of alerts) html += `<p class="warn">⚠ ${esc(a.text)} Kopie in eToro prüfen: Portfolio → Trader → Zahnrad → „Kopieren pausieren“.</p>`;
    if (!f && !alerts.length) html += `<p class="muted small">Zurzeit wird kein Trader kopiert. Die Tagesergebnisse stehen in der Tabelle unter „Heute (live)“.</p>`;
    return html + `</div>`;
  }

  // ---------- Copy-Bot ----------
  function botSetup() {
    return `<details class="info card" ${bot && bot.setup === false ? "open" : ""}>
      <summary>Copy-Bot einrichten: Tageswahl automatisch im Demokonto kopieren</summary>
      <ol class="steps">
        <li>In eToro: <b>Einstellungen</b> → <b>Trading</b> → <b>API-Key-Verwaltung</b> → <b>„Neuen Schlüssel erstellen“</b>. Nur ${v("Trading – Demo → Write")} ankreuzen – nichts bei „Trading – Real“ und nichts unter „Geld“.</li>
        <li>In GitHub: Repository → <b>Settings</b> → <b>Secrets and variables</b> → <b>Actions</b> → <b>„New repository secret“</b>: ${v("ETORO_BOT_API_KEY")} (öffentlicher Schlüssel) und ${v("ETORO_BOT_USER_KEY")} (privater Schlüssel).</li>
        <li>Fertig. Der Bot startet in der nächsten 15-Minuten-Runde an einem Börsentag (etwa 7–23 Uhr).</li>
        <li>Ausschalten jederzeit: dort Reiter <b>„Variables“</b> → <b>„New repository variable“</b> ${v("BOT_MODE")} = ${v("off")}. Wieder einschalten: ${v("demo")}.</li>
      </ol>
      <p class="muted small">Der Bot handelt nur mit Spielgeld im eToro-Demokonto: Der Schlüssel funktioniert nur dort, und Echtgeld ist im Bot zusätzlich gesperrt.</p>
    </details>`;
  }
  function botBox() {
    if (!bot || bot.setup === false) return botSetup();
    const age = (Date.now() - new Date(bot.updated)) / 6e4;
    const time = new Date(bot.updated).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });
    const mode = !bot.active ? `<span class="chip">aus</span>` : `<span class="chip open">Demo · Spielgeld</span>`;
    const copies = (bot.copies || []).filter(c => c && okName(c.userName));
    let html = `<div class="live">
      <div class="live-head"><span class="dot ${bot.active && age < 40 ? "on" : ""}"></span> Copy-Bot ${mode} <span class="muted small">Stand ${time} Uhr</span></div>`;
    if (!bot.active) html += bot.mode === "real"
      ? `<p class="small muted">Echtgeld ist im Bot gesperrt – bitte die Variable BOT_MODE auf demo setzen.</p>`
      : `<p class="small muted">Ausgeschaltet (Variable BOT_MODE = off). Einschalten: BOT_MODE = demo.</p>`;
    for (const c of copies) {
      if (c.justStarted) { html += `<p class="small">Kopie von ${link(c.userName)} gerade gestartet – die Werte erscheinen in der nächsten Runde.</p>`; continue; }
      const state = c.closing ? " · <b>wird beendet</b>" : c.aligning ? " · wird an das Portfolio des Traders angepasst" : c.paused ? " · pausiert" : "";
      html += `<p class="small">Kopiert ${link(c.userName)} seit ${dateDe(c.since)} · Stand <b class="${c.pnlPct < 0 ? "down" : "up"}">${sign(c.pnlPct)} %</b>
        · ${Number.isFinite(c.sharePct) ? `${fmt(c.sharePct, 0)} % des Kontos` : ""}${state}</p>
        <p class="muted small">Copy Stop Loss: Der Bot beendet die Kopie bei −${c.botStopLossPct} % (geprüft alle 15 Minuten an Börsentagen, eToros Schnittstelle kann ihn nicht direkt setzen).${Number.isFinite(c.etoroStopBelowPct) ? ` eToros eigene Grenze greift, wenn der Wert um weitere ${fmt(c.etoroStopBelowPct, 0)} % fällt.` : ""}</p>`;
    }
    if (bot.active && !copies.length && !bot.pending) html += `<p class="small muted">Zurzeit keine Bot-Kopie. Der Bot startet die Tageswahl in der nächsten Runde, wenn nichts dagegen spricht.</p>`;
    if (bot.pending && okName(bot.pending.userName)) html += `<p class="small">Auftrag für ${link(bot.pending.userName)} gesendet, wartet auf Bestätigung.</p>`;
    const events = (bot.events || []).filter(e => e && typeof e.text === "string").slice(-4).reverse();
    if (events.length) html += `<ul class="bot-log">${events.map(e => `<li><span class="muted">${new Date(e.at).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span> ${esc(e.text)}</li>`).join("")}</ul>`;
    return html + `</div>`;
  }

  function setup() {
    $("dailyUpdated").textContent = "";
    body.innerHTML = `
      <div class="reco no">
        <div class="reco-head"><span class="icon-no">●</span> Noch keine Live-Daten</div>
        <p>Die Top 25 und die Tagesempfehlung werden an jedem Börsentag automatisch aus eToro-Daten berechnet. Dafür einmalig:</p>
        <ol class="steps">
          <li>In eToro: <b>Einstellungen</b> → <b>Trading</b> → <b>API-Key-Verwaltung</b> → <b>„Neuen Schlüssel erstellen“</b>, nur Leserechte („Read“ bei Trading – Demo, Benutzerinfo und Marktdaten).</li>
          <li>In GitHub: Repository → <b>Settings</b> → <b>Secrets and variables</b> → <b>Actions</b>: ${v("ETORO_API_KEY")} (öffentlicher Schlüssel) und ${v("ETORO_USER_KEY")} (privater Schlüssel) anlegen.</li>
          <li>Unter <b>Actions</b> → <b>„Tagesempfehlung“</b> → <b>„Run workflow“</b> einmal starten.</li>
        </ol>
        <p class="muted small">Die Schlüssel niemals in einen Chat oder in Dateien kopieren – nur in die GitHub-Secrets.</p>
      </div>`;
  }

  // ---------- Tabelle (sortierbar, durchsuchbar) ----------
  const tState = { key: "rank", dir: "asc" };
  let mode = "top", search = "";
  const liveRisk = r => { const l = liveOf(r.userName); return l && Number.isFinite(l.risk) ? l.risk : Number.isFinite(r.risk) ? r.risk : null; };
  const liveDay = r => { const l = liveOf(r.userName); return l && Number.isFinite(l.dailyGain) ? l.dailyGain : null; };
  const COLS = [
    { key: "rank", label: "Platz", num: true, first: "asc", get: r => r.rank },
    { key: "userName", label: "Trader", get: r => r.userName },
    { key: "result", label: "Ergebnis", num: true, title: "Sichere Trader zuerst, dann innerhalb der Grenzen, dann der Rest", get: r => (r.qualified ? 2 : r.inLimits ? 1 : 0) + (r.dsr || 0) },
    { key: "dsr", label: "Können-Sicherheit", num: true, title: "Wie wahrscheinlich die bisherige Leistung Können statt Glück war", get: r => r.dsr },
    { key: "cagr", label: "Rendite p.a.", num: true, get: r => r.cagr },
    { key: "mdd", label: "Max. Drawdown", num: true, title: "Größter Rückgang vom Höchststand", get: r => r.mdd },
    { key: "sharpe", label: "Sharpe", num: true, title: "Rendite im Verhältnis zur Schwankung", get: r => r.sharpe },
    { key: "pDay", label: "Gewinntag", num: true, title: "Chance, dass der Trader einen Tag im Plus abschließt (Näherung)", get: r => r.pDay },
    { key: "postMean", label: "Erwartet/Monat", num: true, title: "Erwartete Monatsrendite nach Schrumpfung über alle Trader", get: r => r.postMean },
    { key: "risk", label: "Risiko", num: true, title: "eToro-Risiko-Score 1–10 (live)", get: liveRisk },
    { key: "today", label: "Heute (live)", num: true, get: liveDay },
    { key: "copiers", label: "Kopierer", num: true, get: r => r.copiers },
    { key: "months", label: "Monate", num: true, title: "Monate Historie in der Auswertung", get: r => r.months },
  ];
  function rowsFor() {
    if (!data) return [];
    if (mode === "top") return (data.top || []).filter(r => r && okName(r.userName));
    // alle ausgewerteten Trader in derselben Reihenfolge wie die Top-Liste, danach die außerhalb der Grenzen
    const all = (data.all || []).filter(r => r && okName(r.userName));
    const safe = all.filter(r => r.qualified).sort((a, b) => b.cagr - a.cagr);
    const inl = all.filter(r => !r.qualified && r.inLimits).sort((a, b) => b.dsr - a.dsr);
    const out = all.filter(r => !r.inLimits).sort((a, b) => b.dsr - a.dsr);
    return [...safe, ...inl, ...out].map((r, i) => ({ ...r, rank: i + 1 }));
  }
  function resultCell(r, full = false) {
    if (r.qualified) return `<span class="tag good">✓ sicher${full ? " – alle Bedingungen erfüllt" : ""}</span>`;
    const reason = r.reason || (r.inLimits === false ? "außerhalb der Grenzen" : "zu unsicher");
    const text = full ? reason : /^Können-Sicherheit/.test(reason) ? "zu unsicher" : reason;
    return `<span class="tag bad" title="${esc(reason)}"><span class="x">✗</span> ${esc(text)}</span>`;
  }
  function renderTable() {
    const table = $("dailyTable");
    if (!table) return;
    const q = search.trim().toLowerCase();
    const rows = sortRows(rowsFor().filter(r => !q || r.userName.toLowerCase().includes(q)), COLS, tState);
    table.querySelector("thead").innerHTML = sortHead(COLS, tState);
    table.querySelector("tbody").innerHTML = rows.map(r => {
      const day = liveDay(r);
      return `<tr class="clickable" data-user="${esc(r.userName)}">
        <td class="num">${r.rank}</td>
        <td><button type="button" class="link-btn" data-user="${esc(r.userName)}">${esc(r.userName)}</button></td>
        <td>${resultCell(r)}</td>
        <td class="num">${pct(r.dsr)}</td>
        <td class="num">${n1(r.cagr)} %</td>
        <td class="num">${n1(r.mdd)} %</td>
        <td class="num">${Number.isFinite(r.sharpe) ? fmt(r.sharpe, 2) : "–"}</td>
        <td class="num">${pct(r.pDay)}</td>
        <td class="num">${Number.isFinite(r.postMean) ? `${sign(r.postMean)} %` : "–"}</td>
        <td class="num">${liveRisk(r) ?? "–"}</td>
        <td class="num">${day === null ? "–" : `<span class="${day < 0 ? "down" : "up"}">${sign(day)} %</span>`}</td>
        <td class="num">${Number.isFinite(r.copiers) ? r.copiers.toLocaleString("de-DE") : "–"}</td>
        <td class="num">${r.months ?? "–"}</td>
      </tr>`;
    }).join("") || `<tr><td colspan="${COLS.length}" class="muted">Keine Trader gefunden.</td></tr>`;
    $("dailyCount").textContent = `${rows.length} ${rows.length === 1 ? "Trader" : "Trader"}`;
  }

  // ---------- Forschung, auf der die Tageswahl beruht ----------
  const SRC = (url, text) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`;
  const RESEARCH = `
    <details class="info card">
      <summary>Forschung: Worauf die Tageswahl beruht (Stand November 2026)</summary>
      <ul class="checklist">
        <li><b>Copy-Trading verleitet zu zu viel Risiko.</b> ${SRC("https://econpapers.repec.org/RePEc:inm:ormnsc:v:66:y:12:i:2020:p:5608-5622", "Apesteguia, Oechssler &amp; Weidenholzer, Management Science 2020")}. → Strenge Grenzen für Risiko-Score und Drawdown, Copy Stop Loss.</li>
        <li><b>Kopierer wählen nach Beliebtheit, und die sagt kaum etwas über Leistung.</b> Gespiegelte Trades verloren im Schnitt 0,61 %, eigene nur 0,07 % (eToro-Daten). ${SRC("https://www.arxiv.org/pdf/2507.01817", "Studie zu eToro, arXiv 2025")}. → Kopierer-Zahl fließt nicht in die Wahl ein.</li>
        <li><b>Mehr Follower machen Trader schlechter</b> – mehr Trades, mehr Hebel, schwächere Ergebnisse. ${SRC("https://pubsonline.informs.org/doi/abs/10.1287/mnsc.2022.03144", "Xu, Wang, Liu &amp; Qiu, Management Science 2025")}. → Kein Bonus für Beliebtheit, Live-Wächter beobachtet das Risiko.</li>
        <li><b>Folgen lohnt sich nach Kosten selten.</b> Keine Strategie erzielte nach Transaktionskosten eine Überrendite. ${SRC("https://econpapers.repec.org/RePEc:eee:quaeco:v:70:y:2018:i:c:p:160-171", "„To follow or not to follow“, Quarterly Review of Economics and Finance 2018")}. → Kosten werden für jede Kopier-Dauer eingerechnet.</li>
        <li><b>Vergangene Leistung ist vor allem Rauschen</b>; bessere Prognosen entstehen, wenn man alle Trader gemeinsam betrachtet und Ausreißer zum Durchschnitt zieht. ${SRC("https://econpapers.repec.org/RePEc:oup:rfinst:v:31:y:2018:i:7:p:2499-2552", "Harvey &amp; Liu, Review of Financial Studies 2018")}, ${SRC("https://econpapers.repec.org/RePEc:eee:jfinec:v:78:y:2005:i:3:p:507-552", "Jones &amp; Shanken, Journal of Financial Economics 2005")}. → Schrumpfung der erwarteten Rendite.</li>
        <li><b>Glück beim Besten aus vielen herausrechnen:</b> Deflated Sharpe Ratio nach Bailey &amp; López de Prado (2014). → „Können-Sicherheit“ und grüne Ampel.</li>
        <li><b>Kurzfristige Überlegenheit ist klein und vergeht schnell</b> (gemessen über Quartale, nicht Tage). ${SRC("https://ideas.repec.org/a/oup/rfinst/v18y2005i2p569-597.html", "Bollen &amp; Busse, Review of Financial Studies 2005")}. Innerhalb eines Tages gibt es nur schwache Muster auf Marktebene (Erklärungskraft 1,6 %). ${SRC("https://econpapers.repec.org/RePEc:eee:jfinec:v:129:y:2018:i:2:p:394-414", "Gao, Han, Li &amp; Zhou, Journal of Financial Economics 2018")}. → Keine Vorhersage „wer heute am besten abschließt“ – sie wäre Zufall.</li>
        <li><b>Aufsicht warnt vor den Risiken von Copy-Trading.</b> ${SRC("https://www.iosco.org/library/pubdocs/pdf/IOSCOPD793.pdf", "IOSCO-Abschlussbericht 2025")}.</li>
        <li><b>Kosten:</b> Für kopierte Positionen gelten dieselben Spreads wie für eigene; für CFDs auf Aktien/ETFs nennt eToro 0,15 % beim Öffnen und beim Schließen. ${SRC("https://etoro.com/trading/fees", "eToro-Gebührenseite")}.</li>
      </ul>
    </details>`;

  // ---------- Tageswahl ----------
  const HZ = [["m30", "30 Minuten"], ["d1", "1 Tag"], ["w1", "1 Woche"], ["m1", "1 Monat"], ["m3", "3 Monate"]];
  function horizonTable(p, cost) {
    const TS = window.TradeStats;
    const rows = HZ.map(([k, label]) => {
      const h = TS.horizon(p.postMean, p.sdMonthly, p.postSd, TS.HORIZONS[k], cost);
      const verdict = h.expected <= 0 ? `<span class="tag bad"><span class="x">✗</span> lohnt sich nicht – Kosten höher als erwarteter Gewinn</span>`
        : h.pProfit < 0.6 ? `<span class="tag bad">≈ kaum besser als ein Münzwurf</span>`
        : `<span class="tag good">✓ sinnvoll</span>`;
      return `<tr><td>${label}</td><td class="num"><span class="pbar"><span style="width:${(h.pProfit * 100).toFixed(0)}%"></span></span>${pct(h.pProfit)}</td>
        <td class="num ${h.expected < 0 ? "down" : "up"}">${sign(h.expected)} %</td><td>${verdict}</td></tr>`;
    }).join("");
    return `<div class="table-wrap"><table class="hz">
      <thead><tr><th>Kopier-Dauer</th><th class="num">Ihre Chance im Plus</th><th class="num">Erwartet</th><th>Urteil</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;
  }
  function pickCard(p, cfg, acc, updated) {
    const green = p.light === "green";
    const cost = Number.isFinite(cfg.roundTripCostPct) ? cfg.roundTripCostPct : 0.3;
    const amount = acc ? Math.floor(p.amountPct * acc + 1e-9) : null;
    const minDays = Number.isFinite(p.breakEvenDays) ? Math.ceil(p.breakEvenDays) : null;
    const status = p.changed
      ? `<p class="reco-sub"><b>Neu seit heute.</b> ${esc(p.note || "")}</p>`
      : p.since === String(updated || "").slice(0, 10)
        ? `<p class="reco-sub"><b>Seit heute.</b> ${esc(p.note || "")}</p>`
        : `<p class="reco-sub">Seit ${dateDe(p.since)} · ${esc(p.note || "")}</p>`;
    const steps = [];
    if (p.changed && p.previous) steps.push(`Bisherige Kopie beenden: <b>„Portfolio“</b> → ${v(esc(p.previous))} antippen → Zahnrad → <b>„Kopieren beenden“</b>.`);
    steps.push(
      `In eToro oben in die Suche ${v(esc(p.userName))} eingeben und das Profil öffnen (oder direkt: ${link(p.userName)}). Auf <b>„Kopieren“</b> tippen.`,
      `Feld <b>„Betrag“</b>: ${v(amount !== null ? `${fmt(amount, 0)} $` : `${fmt(p.amountPct * 100, 0)} % Ihres Kontos`)}${green ? "" : " – halber Betrag, weil nicht gesichert"}.`,
      `<b>„Copy Stop Loss“</b>: ${v(p.csl + " %")}. Damit verlieren Sie mit dieser Kopie höchstens ca. ${amount !== null ? `${fmt(amount * p.csl / 100, 0)} $` : `${p.csl} % des Betrags`}.`,
      `Häkchen <b>„Offene Trades kopieren“</b>: ${v("anhaken")} – nur so läuft Ihre Kopie wie die ausgewerteten Zahlen.`,
      `Mit <b>„Kopieren“</b> bestätigen.`,
      `Laufen lassen: ${v(minDays ? `mindestens ${minDays} Börsentage` : "mehrere Wochen")} – so lange dauert es im Schnitt, bis die Kosten von ${fmt(cost, 1)} % wieder verdient sind. Nicht täglich wechseln.`,
      `Jeden Morgen hier nachsehen: Steht ein neuer Name da, zuerst die alte Kopie beenden. Sonst nichts tun.`,
    );
    return `
      <div class="reco ${green ? "ok" : "no"}">
        <div class="reco-head"><span class="${green ? "icon-ok" : "icon-no"}">●</span> Tageswahl: ${link(p.userName)}
          <span class="chip ${green ? "open" : "caution"}">${green ? "gesichert" : "nicht gesichert · halber Betrag"}</span></div>
        ${status}
        ${green ? "" : `<p class="small">Kein Trader erreicht heute die geforderte Können-Sicherheit von ${pct(cfg.threshold || 0.9)}. Das ist die beste verfügbare Wahl nach der Rechnung unten – deshalb nur mit halbem Betrag oder zuerst im Demokonto üben.</p>`}
        <div class="result">
          ${kpi("Gewinntag-Chance des Traders", pct(p.pDay))}
          ${kpi("Erwartet pro Monat", `${sign(p.postMean)} %`, p.postMean >= 0 ? "up" : "down")}
          ${kpi("Können-Sicherheit", pct(p.dsr))}
          ${kpi("Max. Drawdown", `${n1(p.mdd)} %`, "down")}
          ${kpi("Betrag", amount !== null ? `${fmt(amount, 0)} $` : `${fmt(p.amountPct * 100, 0)} %`)}
          ${kpi("Copy Stop Loss", `${p.csl} %`, "down")}
        </div>
        <h3>So tragen Sie es in eToro ein</h3>
        <ol class="steps">${steps.map(x => `<li>${x}</li>`).join("")}</ol>
        <h3>Wie lange kopieren? Chancen nach Kosten</h3>
        ${horizonTable(p, cost)}
        <p class="muted small">„Gewinntag-Chance des Traders“: wie wahrscheinlich der Trader einen Börsentag im Plus abschließt. „Ihre Chance im Plus“: wie wahrscheinlich Ihre Kopie nach Abzug der Kosten im Plus liegt – bei kurzer Dauer viel kleiner, weil die Kosten sofort anfallen.
          Gerechnet mit der erwarteten Monatsrendite nach Schrumpfung (${sign(p.postMean)} %), der Schwankung des Traders (${fmt(p.sdMonthly, 2)} % pro Monat) und geschätzten Kosten von ${fmt(cost, 1)} % (Spread beim Öffnen und Schließen laut eToro-Gebührenseite). Näherung – keine Garantie.</p>
        ${acc ? "" : `<p class="muted small">Kontostand im Trade-Setup eintragen, dann stehen hier Beträge in Dollar.</p>`}
      </div>`;
  }

  // ---------- Gesamtansicht ----------
  function render() {
    if (!data) return setup();
    const searchFocused = document.activeElement && document.activeElement.id === "dailySearch";
    const d = data, cfg = d.config || {};
    const pick = d.pick && okName(d.pick.userName) ? { ...d.pick } : null;
    if (pick && pick.previous && !okName(pick.previous)) pick.previous = null;
    const ageDays = (Date.now() - new Date(d.updated)) / 864e5;
    $("dailyUpdated").textContent = `Stand: ${new Date(d.updated).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })} Uhr · aktualisiert sich automatisch`;
    const acc = account();
    const notes = [];
    if (ageDays > 4) notes.push(`Die Daten sind ${fmt(ageDays, 0)} Tage alt – läuft die GitHub-Aktion „Tagesempfehlung“ noch?`);
    const head = pick ? pickCard(pick, cfg, acc, d.updated)
      : d.pick === undefined
        ? `<div class="reco no"><div class="reco-head"><span class="icon-no">●</span> Tageswahl wird berechnet</div><p>Die Tageswahl erscheint nach dem nächsten Lauf der Auswertung.</p></div>`
        : `<div class="reco no"><div class="reco-head"><span class="icon-no">✗</span> Heute keine Tageswahl</div><p>Kein geprüfter Trader hält heute alle Grenzen ein (Risiko-Score, Drawdown, Historie) und lässt nach der Rechnung einen Gewinn erwarten. Lieber keine Wahl als eine riskante.</p></div>`;

    const check = d.dataCheck && Number.isFinite(d.dataCheck.medianDeviationPp)
      ? ` Datenkontrolle: Abweichung zu eToros eigenen Angaben im Median ${fmt(d.dataCheck.medianDeviationPp, 2)} Prozentpunkte; jede Zahl wurde unabhängig nachgerechnet.` : "";
    const stats = `
      <div class="stats">
        ${kpi("Geprüfte Trader", d.evaluated)}
        ${kpi("Innerhalb der Grenzen", (d.all || []).filter(r => r.inLimits).length)}
        ${kpi("Sicher (ab " + pct(cfg.threshold || 0.9) + ")", d.qualifiedCount)}
        ${kpi("Glücks-Korrektur für", `${fmt(d.nEff, 0)} Trader`)}
      </div>`;

    body.innerHTML = `
      ${head}
      ${liveBox()}
      ${botBox()}
      ${warnBox(notes)}
      ${stats}
      <p class="hint">Geprüft werden die ${d.screened} meistkopierten Popular Investors mit Risiko-Score bis ${cfg.maxRisk} und mindestens ${cfg.minMonths} Monaten Historie. Sicher heißt: Können-Sicherheit ab ${pct(cfg.threshold || 0.9)} und Drawdown bis ${cfg.maxDd} %. Die Glücks-Korrektur berücksichtigt, dass sich viele Trader ähnlich bewegen (mittlere Korrelation ${fmt(d.avgCorrelation, 2)}).${check}</p>
      <article class="card">
        <h2 class="card-title">Sicherheit und Rendite aller geprüften Trader</h2>
        <p class="muted small">Jeder Punkt ist ein Trader. Rechts der gestrichelten Linie liegt die Können-Sicherheit bei mindestens ${pct(cfg.threshold || 0.9)}, je höher, desto mehr Rendite pro Jahr. Gesucht wird oben rechts. Auf einen Punkt tippen zeigt die Werte.</p>
        <div class="legend-row" id="dailyLegend"></div>
        <div class="chart-host" id="dailyChart"></div>
      </article>
      <article class="card">
        <div class="card-head">
          <h2 class="card-title">${mode === "top" ? "Top 25" : "Alle geprüften Trader"} <span class="muted small" id="dailyCount"></span></h2>
          <div class="toolbar" style="margin:0">
            <div class="seg" role="group" aria-label="Auswahl">
              <button type="button" data-mode="top" aria-pressed="${mode === "top"}">Top 25</button>
              <button type="button" data-mode="all" aria-pressed="${mode === "all"}">Alle ${(d.all || []).length}</button>
            </div>
            <input type="search" id="dailySearch" placeholder="Trader suchen …" aria-label="Trader suchen" value="${esc(search)}">
          </div>
        </div>
        <p class="muted small">Auf eine Spaltenüberschrift tippen sortiert nach der höchsten Zahl, noch einmal tippen nach der niedrigsten. Auf einen Trader tippen öffnet die Details mit allen Monatsrenditen.</p>
        <div class="table-wrap"><table id="dailyTable"><thead></thead><tbody></tbody></table></div>
      </article>
      ${RESEARCH}
      <p class="muted small">Vergangene Renditen garantieren nichts. Die Sicherheit gibt an, wie wahrscheinlich die bisherige Leistung Können statt Glück war – nicht, dass sie weitergeht.</p>`;
    renderTable();
    drawScatter();
    if (searchFocused) { const s = $("dailySearch"); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
  }

  // Ereignisse im Bereich (einmal registriert, gelten auch nach dem Neuzeichnen)
  body.addEventListener("click", e => {
    const sortBtn = e.target.closest("#dailyTable .th-sort");
    if (sortBtn) {
      const col = COLS.find(c => c.key === sortBtn.dataset.key);
      if (tState.key === col.key) tState.dir = tState.dir === "asc" ? "desc" : "asc";
      else { tState.key = col.key; tState.dir = col.first || (col.num ? "desc" : "asc"); }
      renderTable();
      body.querySelector(`#dailyTable .th-sort[data-key="${col.key}"]`)?.focus();
      return;
    }
    const seg = e.target.closest(".seg button[data-mode]");
    if (seg) { mode = seg.dataset.mode; render(); return; }
    const row = e.target.closest("#dailyTable tr[data-user]");
    if (row && !e.target.closest("a")) openTrader(row.dataset.user);
  });
  body.addEventListener("input", e => { if (e.target.id === "dailySearch") { search = e.target.value; renderTable(); } });

  // ---------- Detail-Fenster eines Traders ----------
  async function openTrader(name) {
    if (!okName(name) || !data) return;
    const all = [...(data.all || []), ...(data.top || [])];
    const r = { ...all.find(x => x.userName === name), ...(data.top || []).find(x => x.userName === name) };
    const l = liveOf(name);
    const cfg = data.config || {};
    const html = `
      <div>${resultCell(r, true)}</div>
      <div class="result" style="margin-top:0">
        ${kpi("Können-Sicherheit", pct(r.dsr))}
        ${kpi("Rendite p.a.", `${n1(r.cagr)} %`, r.cagr >= 0 ? "up" : "down")}
        ${kpi("Max. Drawdown", `${n1(r.mdd)} %`, "down")}
        ${kpi("Sharpe", Number.isFinite(r.sharpe) ? fmt(r.sharpe, 2) : "–")}
        ${kpi("Risiko-Score", l && Number.isFinite(l.risk) ? l.risk : r.risk ?? "–")}
        ${kpi("Heute (live)", l && Number.isFinite(l.dailyGain) ? `${sign(l.dailyGain)} %` : "–", l && l.dailyGain < 0 ? "down" : "up")}
        ${kpi("Gewinntag-Chance", pct(r.pDay))}
        ${kpi("Erwartet pro Monat", Number.isFinite(r.postMean) ? `${sign(r.postMean)} %` : "–", r.postMean >= 0 ? "up" : "down")}
      </div>
      ${Number.isFinite(r.postMean) && Number.isFinite(r.sdMonthly) ? `<div><h3 style="margin-top:0">Chancen nach Kosten, falls Sie diesen Trader kopieren</h3>${horizonTable(r, Number.isFinite(cfg.roundTripCostPct) ? cfg.roundTripCostPct : 0.3)}</div>` : ""}
      <div><h3 style="margin-top:0">Monatsrenditen</h3><div class="chart-host" id="trMonths"><p class="muted">Lade Monatsrenditen …</p></div></div>
      <div><h3>Wachstum von 100 $</h3><div class="chart-host" id="trGrowth"></div></div>
      <div id="trYears"></div>
      <a class="btn" href="${profile(name)}" target="_blank" rel="noopener noreferrer">Profil bei eToro öffnen ↗</a>
      <p class="muted small">Grenzen dieser Seite: Risiko-Score bis ${cfg.maxRisk}, Drawdown bis ${cfg.maxDd} %, Können-Sicherheit ab ${pct(cfg.threshold || 0.9)}. Vergangene Renditen garantieren nichts.</p>`;
    openDrawer(name, html);
    const ret = await loadReturns();
    if ($("drawer").hidden || $("drawerTitle").textContent !== name) return;
    const tr = ret && ret.traders.find(t => t.userName === name);
    if (!tr) { $("trMonths").innerHTML = `<p class="muted">Monatsrenditen sind für diesen Trader nicht verfügbar.</p>`; return; }
    drawMonths($("trMonths"), tr.months);
    drawGrowth($("trGrowth"), tr.months);
    drawYears($("trYears"), tr.months);
  }

  const MONTHS = ["Jan.", "Feb.", "März", "Apr.", "Mai", "Juni", "Juli", "Aug.", "Sep.", "Okt.", "Nov.", "Dez."];
  const monthLabel = ym => { const [y, m] = ym.split("-").map(Number); return `${MONTHS[m - 1]} ${y}`; };
  const NS = "http://www.w3.org/2000/svg";
  const svgEl = (tag, attrs, parent) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  };
  function niceTicks(min, max, count) {
    const raw = (max - min || 1) / count, mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map(s => s * mag).find(s => s >= raw);
    const out = [];
    for (let x = Math.floor(min / step) * step; x <= Math.ceil(max / step) * step + step / 2; x += step) out.push(+x.toFixed(10));
    return out;
  }
  function tipFor(host) {
    let tip = host.querySelector(".viz-tip");
    if (!tip) { tip = document.createElement("div"); tip.className = "viz-tip"; tip.hidden = true; host.append(tip); }
    return tip;
  }
  function placeTip(tip, x, y, W, H) {
    tip.hidden = false;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    tip.style.left = `${Math.max(0, x + 12 + tw > W ? x - tw - 12 : x + 12)}px`;
    tip.style.top = `${Math.max(0, Math.min(H - th, y - th / 2))}px`;
  }

  // Balken je Monat: grün = Gewinn, rot = Verlust
  function drawMonths(host, months) {
    const W = Math.max(280, host.clientWidth), H = 210, m = { l: 44, r: 8, t: 10, b: 24 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b, n = months.length;
    const vals = months.map(x => x[1]);
    const ticks = niceTicks(Math.min(0, ...vals), Math.max(0, ...vals), 4);
    const y0 = ticks[0], y1 = ticks[ticks.length - 1];
    const Y = val => m.t + (y1 - val) / (y1 - y0) * ph, bw = pw / n;
    const svg = svgEl("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `Monatsrenditen der letzten ${n} Monate` });
    for (const t of ticks) {
      svgEl("line", { x1: m.l, x2: m.l + pw, y1: Y(t), y2: Y(t), class: t === 0 ? "base" : "grid" }, svg);
      svgEl("text", { x: m.l - 6, y: Y(t) + 4, "text-anchor": "end", class: "tick" }, svg).textContent = `${fmt(t, 0)} %`;
    }
    months.forEach(([ym, g], i) => {
      const x = m.l + i * bw + Math.max(0.5, bw * 0.12), w = Math.max(1, bw * 0.76);
      svgEl("rect", { x, y: Math.min(Y(g), Y(0)), width: w, height: Math.max(1, Math.abs(Y(g) - Y(0))), rx: Math.min(2, w / 2), fill: g >= 0 ? PAL.up : PAL.down, opacity: 0.9 }, svg);
      if (ym.endsWith("-01")) svgEl("text", { x: x + w / 2, y: H - 6, "text-anchor": "middle", class: "tick" }, svg).textContent = ym.slice(0, 4);
    });
    const hit = svgEl("rect", { x: m.l, y: m.t, width: pw, height: ph, fill: "transparent", class: "hit" }, svg);
    const mark = svgEl("rect", { y: m.t, height: ph, width: bw, fill: "rgba(255,255,255,.06)", visibility: "hidden" }, svg);
    svg.insertBefore(mark, svg.firstChild);
    host.replaceChildren(svg);
    const tip = tipFor(host);
    const show = ev => {
      const r = svg.getBoundingClientRect(), x = (ev.clientX - r.left) * (W / r.width);
      const i = Math.max(0, Math.min(n - 1, Math.floor((x - m.l) / bw)));
      const [ym, g] = months[i];
      mark.setAttribute("x", m.l + i * bw); mark.setAttribute("visibility", "visible");
      tip.innerHTML = `<div class="tip-head"></div><div class="tip-row"><strong class="${g >= 0 ? "up" : "down"}">${sign(g)} %</strong></div>`;
      tip.querySelector(".tip-head").textContent = monthLabel(ym);
      placeTip(tip, m.l + i * bw + bw / 2, Y(g), W, H);
    };
    hit.addEventListener("pointermove", show);
    hit.addEventListener("pointerdown", show);
    hit.addEventListener("pointerleave", () => { tip.hidden = true; mark.setAttribute("visibility", "hidden"); });
  }

  // Wachstum von 100 $ über alle Monate
  function drawGrowth(host, months) {
    const W = Math.max(280, host.clientWidth), H = 170, m = { l: 52, r: 10, t: 10, b: 22 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    let eq = 100;
    const pts = [100, ...months.map(([, g]) => (eq *= 1 + g / 100))];
    const ticks = niceTicks(Math.min(100, ...pts), Math.max(100, ...pts), 4);
    const y0 = ticks[0], y1 = ticks[ticks.length - 1];
    const X = i => m.l + i / (pts.length - 1) * pw, Y = val => m.t + (y1 - val) / (y1 - y0) * ph;
    const line = pts.map((p, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(p).toFixed(1)}`).join("");
    host.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Aus 100 $ wurden ${fmt(pts[pts.length - 1], 0)} $">
      ${ticks.map(t => `<line class="${t === 100 ? "base" : "grid"}" x1="${m.l}" x2="${m.l + pw}" y1="${Y(t)}" y2="${Y(t)}"/><text class="tick" x="${m.l - 6}" y="${Y(t) + 4}" text-anchor="end">${fmt(t, 0)} $</text>`).join("")}
      <path d="${line}" fill="none" stroke="${PAL.series1}" stroke-width="2" stroke-linejoin="round"/>
      <circle cx="${X(pts.length - 1)}" cy="${Y(pts[pts.length - 1])}" r="4.5" fill="${PAL.series1}" stroke="${PAL.surface}" stroke-width="2"/>
      <text class="tick" x="${m.l}" y="${H - 5}">${monthLabel(months[0][0])}</text>
      <text class="tick" x="${m.l + pw}" y="${H - 5}" text-anchor="end">${monthLabel(months[months.length - 1][0])}: ${fmt(pts[pts.length - 1], 0)} $</text>
    </svg>`;
  }

  // Jahresrenditen (verkettet aus den Monatswerten)
  function drawYears(host, months) {
    const years = new Map();
    for (const [ym, g] of months) { const y = ym.slice(0, 4); years.set(y, (years.get(y) ?? 1) * (1 + g / 100)); }
    host.innerHTML = `<h3>Je Kalenderjahr</h3><div class="result" style="margin-top:6px">${[...years].map(([y, f]) => {
      const r = (f - 1) * 100, n = months.filter(([ym]) => ym.startsWith(y)).length;
      return kpi(`${y}${n < 12 ? ` (${n} Mon.)` : ""}`, `${sign(r)} %`, r >= 0 ? "up" : "down");
    }).join("")}</div>`;
  }

  // ---------- Abbildung: Können-Sicherheit (x) gegen Rendite p.a. (y) ----------
  const BLUE = PAL.series1, GRAY = "#6d6d76", INK = PAL.ink, SURFACE = PAL.surface;
  const STYLE = {
    rec:    { r: 7,   fill: BLUE,   stroke: INK,     sw: 2,   label: "Tagesempfehlung" },
    safe:   { r: 4.5, fill: BLUE,   stroke: SURFACE, sw: 1.5, label: "Sicher – alle Bedingungen erfüllt" },
    unsafe: { r: 4.5, fill: GRAY,   stroke: SURFACE, sw: 1.5, label: "Zu unsicher – könnte Glück sein" },
    out:    { r: 4,   fill: "none", stroke: GRAY,    sw: 1.5, label: "Außerhalb der Grenzen (Drawdown/Risiko)" },
  };
  function drawScatter() {
    if (!data) return;
    const rec = data.recommendation && okName(data.recommendation.userName) ? data.recommendation.userName : null;
    scatter(Array.isArray(data.all) && data.all.length ? data.all : (data.top || []), data.config || {}, rec);
  }
  function scatter(points, cfg, recName) {
    const host = $("dailyChart"), legend = $("dailyLegend");
    if (!host || host.closest(".view").hidden) return;
    const thr = cfg.threshold || 0.9;
    const kind = p => (p.userName === recName ? "rec" : p.qualified ? "safe" : p.inLimits === false ? "out" : "unsafe");
    const pts = points.filter(p => p && okName(p.userName) && Number.isFinite(p.dsr) && Number.isFinite(p.cagr)).map(p => ({ ...p, k: kind(p) }));
    if (!pts.length) { host.innerHTML = `<p class="muted">Keine Daten für die Abbildung.</p>`; legend.replaceChildren(); return; }

    legend.replaceChildren();
    for (const k of ["rec", "safe", "unsafe", "out"]) {
      if (!pts.some(p => p.k === k)) continue;
      const s = STYLE[k], item = document.createElement("span"), sym = svgEl("svg", { width: 16, height: 16, viewBox: "0 0 16 16", "aria-hidden": "true" });
      svgEl("circle", { cx: 8, cy: 8, r: Math.min(s.r, 6), fill: s.fill, stroke: s.stroke === SURFACE ? "none" : s.stroke, "stroke-width": s.sw }, sym);
      item.className = "legend-item";
      item.append(sym, document.createTextNode(`${s.label} (${pts.filter(p => p.k === k).length})`));
      legend.append(item);
    }

    const W = Math.max(240, host.clientWidth), H = W < 560 ? 320 : 400;
    const m = { l: 56, r: 18, t: 26, b: 44 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    const yt = niceTicks(Math.min(0, ...pts.map(p => p.cagr)), Math.max(0, ...pts.map(p => p.cagr)), 5);
    const y0 = yt[0], y1 = yt[yt.length - 1];
    const X = s => m.l + s * pw;
    const Y = c => m.t + (y1 - c) / (y1 - y0) * ph;

    const svg = svgEl("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img",
      "aria-label": `Streudiagramm: ${pts.length} Trader nach Können-Sicherheit und Rendite pro Jahr, davon ${pts.filter(p => p.k === "safe" || p.k === "rec").length} sicher.` });
    svgEl("rect", { x: X(thr), y: m.t, width: X(1) - X(thr), height: ph, fill: "rgba(255,255,255,.05)" }, svg);
    for (const t of yt) {
      svgEl("line", { x1: m.l, x2: m.l + pw, y1: Y(t), y2: Y(t), class: t === 0 ? "base" : "grid" }, svg);
      svgEl("text", { x: m.l - 8, y: Y(t) + 4, "text-anchor": "end", class: "tick" }, svg).textContent = `${fmt(t, 0)} %`;
    }
    for (const s of [0, 0.25, 0.5, 0.75, 1]) {
      svgEl("text", { x: X(s), y: m.t + ph + 18, "text-anchor": s === 0 ? "start" : s === 1 ? "end" : "middle", class: "tick" }, svg).textContent = `${fmt(s * 100, 0)} %`;
    }
    svgEl("text", { x: m.l + pw, y: H - 4, "text-anchor": "end", class: "axis-title" }, svg).textContent = "Können-Sicherheit →";
    svgEl("text", { x: m.l - 48, y: 12, class: "axis-title" }, svg).textContent = "↑ Rendite p.a.";
    svgEl("line", { x1: X(thr), x2: X(thr), y1: m.t, y2: m.t + ph, class: "threshold" }, svg);
    svgEl("text", { x: X(thr) - 6, y: m.t + 12, "text-anchor": "end", class: "tick" }, svg).textContent = `Schwelle ${pct(thr)}`;

    const order = { out: 0, unsafe: 1, safe: 2, rec: 3 };
    for (const p of [...pts].sort((a, b) => order[a.k] - order[b.k])) {
      const s = STYLE[p.k];
      p.cx = X(p.dsr); p.cy = Y(p.cagr);
      svgEl("circle", { cx: p.cx, cy: p.cy, r: s.r, fill: s.fill, stroke: s.stroke, "stroke-width": s.sw }, svg);
    }
    // Beschriftung: Empfehlung bzw. die sichersten Trader
    const labelled = pts.filter(p => p.k === "rec").concat([...pts].filter(p => p.k !== "rec").sort((a, b) => b.dsr - a.dsr).slice(0, recName ? 2 : 3));
    const placed = [];
    for (const p of labelled.sort((a, b) => a.cy - b.cy)) {
      const left = p.cx > m.l + pw - 150;
      let y = p.cy - 10;
      for (const q of placed) if (Math.abs(q.y - y) < 15 && Math.abs(q.x - p.cx) < 150) y = q.y + 15;
      placed.push({ x: p.cx, y });
      svgEl("text", { x: p.cx + (left ? -12 : 12), y, "text-anchor": left ? "end" : "start", class: "dlabel" }, svg).textContent = p.userName;
    }

    const ring = svgEl("circle", { r: 9, fill: "none", stroke: INK, "stroke-width": 1.5, visibility: "hidden" }, svg);
    const hit = svgEl("rect", { x: 0, y: 0, width: W, height: H, fill: "transparent", tabindex: 0, class: "hit" }, svg);
    host.replaceChildren(svg);
    const tip = tipFor(host);
    const byX = [...pts].sort((a, b) => a.dsr - b.dsr || a.cagr - b.cagr);
    let curIdx = byX.length - 1, current = null;

    function show(p) {
      current = p;
      ring.setAttribute("cx", p.cx); ring.setAttribute("cy", p.cy); ring.setAttribute("visibility", "visible");
      const head = document.createElement("div");
      head.className = "tip-head";
      head.textContent = `${p.userName} · ${STYLE[p.k].label}`;
      tip.replaceChildren(head);
      for (const [label, val] of [["Können-Sicherheit", pct(p.dsr)], ["Rendite p.a.", `${n1(p.cagr)} %`], ["Max. Drawdown", `${n1(p.mdd)} %`], ["Monate Historie", String(p.months ?? "–")]]) {
        const row = document.createElement("div"), b = document.createElement("strong"), lab = document.createElement("span");
        row.className = "tip-row"; b.textContent = val; lab.className = "muted"; lab.textContent = label;
        row.append(b, lab);
        tip.append(row);
      }
      const more = document.createElement("div");
      more.className = "tip-head";
      more.textContent = "Tippen/Klicken für Details";
      tip.append(more);
      placeTip(tip, p.cx, p.cy, W, H);
    }
    function hide() { ring.setAttribute("visibility", "hidden"); tip.hidden = true; current = null; }
    const nearest = ev => {
      const r = svg.getBoundingClientRect(), sx = W / r.width;
      const x = (ev.clientX - r.left) * sx, y = (ev.clientY - r.top) * sx;
      let best = null, bd = 24 * 24;
      for (const p of pts) { const d2 = (p.cx - x) ** 2 + (p.cy - y) ** 2; if (d2 < bd) { bd = d2; best = p; } }
      return best;
    };
    hit.addEventListener("pointermove", ev => { const p = nearest(ev); p ? show(p) : hide(); });
    hit.addEventListener("pointerleave", hide);
    hit.addEventListener("click", ev => { const p = nearest(ev) || current; if (p) openTrader(p.userName); });
    hit.addEventListener("focus", () => show(byX[curIdx]));
    hit.addEventListener("blur", hide);
    hit.addEventListener("keydown", ev => {
      if (ev.key === "Enter" && current) { openTrader(current.userName); return; }
      if (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight") return;
      curIdx = Math.max(0, Math.min(byX.length - 1, curIdx + (ev.key === "ArrowRight" ? 1 : -1)));
      show(byX[curIdx]);
      ev.preventDefault();
    });
  }

  // Kontostand ändert die Beträge; Größenänderung zeichnet nur die Abbildung neu (Eingaben bleiben erhalten)
  const settings = $("cmpSettings");
  if (settings) settings.addEventListener("input", e => { if (e.target.id === "sAccount" && data) render(); });
  let rt;
  window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(drawScatter, 150); });
  load();
  setInterval(() => { if (!document.hidden) load(); }, 60 * 1000);   // jede Minute auf Neues prüfen
  document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
  window.DTD.openTrader = openTrader;
})();

// ---------- Übersicht (Startseite) und gemeinsamer Kontostand ----------
// Nutzt Hilfsfunktionen aus app.js und die Daten, die daily.js unter window.DTD bereitstellt.
(() => {
  // Ein Kontostand für alle Rechner: Änderung an einer Stelle gilt überall
  const ACC = "dtd-account";
  const fields = [...document.querySelectorAll("[data-account]")];
  let syncing = false;
  function setAll(val, src) {
    syncing = true;
    for (const el of fields) if (el !== src && el.value !== val) { el.value = val; el.dispatchEvent(new Event("input", { bubbles: true })); }
    syncing = false;
  }
  for (const el of fields) el.addEventListener("input", () => { if (syncing) return; store.set(ACC, el.value); setAll(el.value, el); });
  const saved = store.get(ACC);
  if (saved !== null && saved !== "") setAll(String(saved), null);
  else store.set(ACC, $("cAccount").value);

  const pct = p => (!Number.isFinite(p) ? "–" : p > 0.995 ? "über 99 %" : p < 0.005 ? "unter 1 %" : `${fmt(p * 100, 0)} %`);
  const sign = x => (x > 0 ? "+" : "") + fmt(x, 2);
  const okName = u => typeof u === "string" && /^[A-Za-z0-9_.-]{1,40}$/.test(u);
  const berlin = d => d.toLocaleTimeString("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" });
  const goto = (id, text) => `<a class="btn ghost" href="#${id}">${text} →</a>`;

  function renderHead() {
    const h = Number(new Date().toLocaleString("de-DE", { timeZone: "Europe/Berlin", hour: "numeric", hour12: false }));
    $("ovGreeting").textContent = h < 11 ? "Guten Morgen" : h < 18 ? "Guten Tag" : "Guten Abend";
    $("ovDate").textContent = new Date().toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Berlin" });
  }

  function renderSessions() {
    const now = Date.now();
    $("ovSessions").innerHTML = marketsNow().map(mk => {
      const at = Number.isFinite(mk.ms) ? berlin(new Date(now + mk.ms)) : "–";
      return `<div class="session">
        <div class="name"><span class="status-dot ${mk.open ? "open" : ""}"></span>${mk.name}<span class="chip ${mk.open ? "open" : ""}">${mk.open ? "offen" : "geschlossen"}</span></div>
        <div class="when">${mk.open ? "schließt" : "öffnet"} um ${at} Uhr · in <b>${duration(mk.ms)}</b></div>
      </div>`;
    }).join("");
  }

  function renderReco() {
    const d = window.DTD.ranking;
    const box = $("ovReco");
    if (!d) { box.innerHTML = `<p class="muted">Noch keine Auswertung vorhanden.</p>${goto("daily", "Zur Tagesempfehlung")}`; return; }
    const cfg = d.config || {}, thr = cfg.threshold || 0.9;
    const rec = d.recommendation && okName(d.recommendation.userName) ? d.recommendation : null;
    const pick = d.pick && okName(d.pick.userName) ? d.pick : null;
    const stand = `Stand ${new Date(d.updated).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })} Uhr`;
    if (pick) {
      const green = pick.light === "green";
      const acc = account();
      const amount = acc ? `${fmt(Math.floor(pick.amountPct * acc + 1e-9), 0)} $` : `${fmt(pick.amountPct * 100, 0)} % des Kontos`;
      box.innerHTML = `<p class="big-number ${green ? "up" : ""}">${green ? "✓" : "●"} ${esc(pick.userName)}</p>
        <p class="chips"><span class="chip ${green ? "open" : "caution"}">${green ? "gesichert" : "nicht gesichert · halber Betrag"}</span>
          ${pick.changed ? `<span class="chip">neu seit heute</span>` : ""}</p>
        <p class="muted">Betrag ${amount} · Copy Stop Loss ${pick.csl} % · Gewinntag-Chance des Traders ${pct(pick.pDay)}</p>
        ${pick.changed && okName(pick.previous) ? `<p class="small warn">Zuerst die Kopie von <b>${esc(pick.previous)}</b> beenden.</p>` : ""}
        <p class="small muted">${stand}${Number.isFinite(pick.breakEvenDays) ? ` · mindestens ${Math.ceil(pick.breakEvenDays)} Börsentage laufen lassen` : ""}</p>
        ${botLine()}
        ${goto("daily", "Anleitung für eToro")}`;
      return;
    }
    if (rec) {
      box.innerHTML = `<p class="big-number up">✓ ${esc(rec.userName)}</p>
        <p class="muted">Heute kopieren · Können-Sicherheit ${pct(rec.dsr)} · Rendite ${fmt(rec.cagr, 1)} % p.a. · Copy Stop Loss ${rec.csl} %</p>
        <p class="small muted">${stand}</p>${goto("daily", "Einstellungen für eToro")}`;
      return;
    }
    const best = (d.top || []).filter(r => okName(r.userName))[0];
    const fill = best ? Math.min(100, best.dsr / thr * 100) : 0;
    box.innerHTML = `<p class="big-number">Heute keine</p>
      <p class="muted">Kein Trader erreicht ${pct(thr)} Können-Sicherheit. Lieber keine Empfehlung als eine geratene.</p>
      ${best ? `<p class="small">Am nächsten dran: <b>${esc(best.userName)}</b> mit ${pct(best.dsr)}</p>
        <div class="meter warn-bar" title="${pct(best.dsr)} von ${pct(thr)}"><span style="width:${fill.toFixed(0)}%"></span></div>` : ""}
      <p class="small muted">${stand} · ${d.evaluated} Trader geprüft</p>${goto("daily", "Top 25 ansehen")}`;
  }

  function botLine() {
    const b = window.DTD.bot;
    if (!b || b.setup === false) return `<p class="small muted">Copy-Bot noch nicht eingerichtet – Anleitung unter „Tagesempfehlung“.</p>`;
    if (!b.active) return `<p class="small muted">Copy-Bot ausgeschaltet.</p>`;
    const c = (b.copies || []).find(x => x && okName(x.userName) && Number.isFinite(x.pnlPct));
    return c ? `<p class="small">Bot (${b.mode === "real" ? "Echtgeld" : "Demo"}) kopiert <b>${esc(c.userName)}</b>: <b class="${c.pnlPct < 0 ? "down" : "up"}">${sign(c.pnlPct)} %</b>${c.closing ? " · wird beendet" : ""}</p>`
      : `<p class="small muted">Bot (${b.mode === "real" ? "Echtgeld" : "Demo"}) aktiv, zurzeit keine Kopie.</p>`;
  }

  function renderLive() {
    const l = window.DTD.live, box = $("ovLive");
    if (!l) { box.innerHTML = `<p class="muted">Der Live-Wächter läuft an Börsentagen alle 15 Minuten. Noch kein Stand vorhanden.</p>`; return; }
    const age = (Date.now() - new Date(l.updated)) / 6e4;
    const alerts = (l.alerts || []).filter(a => a && typeof a.text === "string");
    const f = okName(l.followed) ? l.entries.find(e => e.userName === l.followed) : null;
    const movers = l.entries.filter(e => okName(e.userName) && Number.isFinite(e.dailyGain)).sort((a, b) => b.dailyGain - a.dailyGain);
    const best = movers[0], worst = movers[movers.length - 1];
    box.innerHTML = `
      <p class="live-head"><span class="dot ${age < 40 ? "on" : ""}"></span> Stand ${new Date(l.updated).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} Uhr</p>
      ${alerts.length ? alerts.map(a => `<p class="warn">⚠ ${esc(a.text)}</p>`).join("") : `<p class="muted">Keine Warnungen.</p>`}
      ${f ? `<p>Kopierter Trader <b>${esc(f.userName)}</b>: heute <b class="${f.dailyGain < 0 ? "down" : "up"}">${Number.isFinite(f.dailyGain) ? sign(f.dailyGain) + " %" : "–"}</b>, Risiko ${f.risk ?? "–"}</p>`
          : `<p class="small muted">Zurzeit wird kein Trader kopiert.</p>`}
      ${best && worst && best !== worst ? `<p class="small">Top 25 heute: stärkster <b>${esc(best.userName)}</b> <span class="up">${sign(best.dailyGain)} %</span>, schwächster <b>${esc(worst.userName)}</b> <span class="down">${sign(worst.dailyGain)} %</span></p>` : ""}`;
  }

  function renderJournal() {
    const s = window.DTD.journalSummary(), cur = $("cCur").value || "$";
    const pctUse = Math.min(100, Math.round(s.usage * 100));
    $("ovJournal").innerHTML = `
      <p class="big-number ${s.todayPl < 0 ? "down" : s.todayPl > 0 ? "up" : ""}">${s.todayPl > 0 ? "+" : ""}${fmt(s.todayPl)} ${cur}</p>
      <p class="muted">${s.trades} Trade(s) heute · ${s.losses} Verlusttrade(s)</p>
      <div class="meter ${s.stop ? "stop" : s.usage >= 0.66 ? "warn-bar" : ""}"><span style="width:${pctUse}%"></span></div>
      <p class="small ${s.stop ? "down" : "muted"}">${s.stop ? "Tageslimit erreicht – heute nicht mehr handeln." : `Tageslimit zu ${pctUse} % ausgeschöpft (3 Verlusttrades oder −3 % des Kontos).`}</p>
      ${goto("journal", "Trade eintragen")}`;
  }

  renderHead();
  renderSessions();
  renderReco();
  renderLive();
  renderJournal();
  window.addEventListener("dtd:clock", () => { renderHead(); renderSessions(); });
  window.addEventListener("dtd:data", () => { renderReco(); renderLive(); });
  window.addEventListener("dtd:journal", renderJournal);
  $("cAccount").addEventListener("input", renderReco);
})();

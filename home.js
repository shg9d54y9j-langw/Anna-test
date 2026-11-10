// ---------- Persönliche Startseite: Hinweise, Depot, Merkliste, neue Signale und Termine auf einen Blick ----------
// Darunter wie bisher Marktlage, Börsen, Copy-Trading und Journal (overview.js, cockpit.js).
(() => {
  const S = window.DTD.shared;
  const fin = v => Number.isFinite(v);
  const SYM = /^[A-Z0-9][A-Z0-9.\-_:]{0,24}$/;
  const sign = (x, d = 1) => (fin(x) ? (x > 0 ? "+" : "") + fmt(x, d) : "–");
  const pc = (x, d = 1) => (fin(x) ? `<span class="${x < 0 ? "down" : "up"}">${sign(x, d)} %</span>` : "–");
  const dDate = iso => new Date(`${String(iso).slice(0, 10)}T12:00:00Z`).toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" });
  const chip = (x, extra = "") => `<button type="button" class="chip-btn" data-open="${esc(x.sym)}" title="${esc(x.name || "")}">${esc(x.sym)}${extra}</button>`;
  const depot = () => { const l = store.get("dtd-portfolio", []); return Array.isArray(l) ? l.filter(h => h && typeof h.sym === "string" && SYM.test(h.sym) && fin(h.buy) && h.buy > 0) : []; };
  const total = r => (r ? r.sb + r.b + r.h + r.s + r.ss : 0);
  const buy = r => (total(r) >= 5 ? (r.sb + r.b) / total(r) : null);

  // Erinnerung: Depot und Journal liegen nur in diesem Browser – Sicherung nie oder vor über 30 Tagen gemacht
  function nudge() {
    if (!window.DTD.backupDue || !window.DTD.backupDue()) return "";
    const age = window.DTD.backupAge();
    return `<p class="small backup-nudge"><b>Ihre Daten liegen nur in diesem Browser</b> – ${age === null ? "noch keine Sicherung gemacht" : `letzte Sicherung vor ${fmt(age, 0)} Tagen`}. <a href="#pfBackup">Jetzt als Datei sichern →</a></p>`;
  }
  function depotCard() {
    const l = depot();
    if (!l.length) return `<article class="card"><h2 class="card-title">Ihr Depot</h2><p class="small">Noch keine Aktien eingetragen. Im <a href="#portfolio">Portfolio</a> mit Kaufpreis eintragen – dann sehen Sie hier Ergebnis, Tagesbewegung und Hinweise.</p></article>`;
    const rows = l.map(h => ({ h, x: S.item(h.sym) })).filter(r => r.x);
    const since = rows.map(r => (r.x.last / r.h.buy - 1) * 100), today = rows.map(r => r.x.chg1d).filter(fin);
    const avg = a => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
    const byDay = [...rows].filter(r => fin(r.x.chg1d)).sort((a, b) => b.x.chg1d - a.x.chg1d);
    const sells = rows.filter(r => r.x.d200 < 0).length;
    return `<article class="card"><div class="card-head"><h2 class="card-title">Ihr Depot</h2><a class="small" href="#portfolio">Öffnen →</a></div>
      <div class="stats">${kpi("Aktien", l.length)}${kpi("Ø seit Kauf", pc(avg(since)))}${kpi("Ø heute", pc(avg(today)))}${kpi("Unter Ø 200", `<span class="${sells ? "down" : ""}">${sells}</span>`)}</div>
      ${byDay.length >= 2 ? `<p class="small" style="margin-top:10px">Heute vorne ${chip(byDay[0].x, ` ${pc(byDay[0].x.chg1d)}`)} · hinten ${chip(byDay[byDay.length - 1].x, ` ${pc(byDay[byDay.length - 1].x.chg1d)}`)}</p>` : ""}
      ${nudge()}
    </article>`;
  }
  function watchCard() {
    const w = window.DTD.watch ? window.DTD.watch.list() : [];
    return `<article class="card"><div class="card-head"><h2 class="card-title">Merkliste</h2>${w.length ? `<a class="small" href="#merkliste">Alle ${w.length} →</a>` : ""}</div>
      ${w.length ? `<div class="w-list">${w.slice(0, 5).map(s => window.DTD.watch.row(s, true)).join("")}</div>` : `<p class="small">Noch nichts gemerkt. Tippen Sie bei einer Aktie auf den Stern ☆ – im Aktien-Check, Screener, bei HotStuff oder im Swing-Planer.</p>`}
    </article>`;
  }
  // Neu heute: was die Daten seit dem letzten Lauf Neues zeigen
  function newCard() {
    const st = S.get("stocks"), fu = S.get("fund"), sw = S.get("swing");
    if (!st) return "";
    const items = st.items, F = sym => (fu && fu.items && fu.items[sym]) || {};
    const lines = [];
    const day = sw ? String(sw.dataUpdated || sw.updated || "").slice(0, 10) : "";
    const zone = sw ? sw.setups.filter(s => s.state === "buy" && s.since === day) : [];
    if (zone.length) lines.push(["Neu in der Kaufzone", zone.slice(0, 6).map(s => chip(s)).join(" "), "#swing"]);
    const up = items.filter(x => buy(x.rec) !== null && buy(x.recPrev) !== null && buy(x.rec) - buy(x.recPrev) >= 0.1).sort((a, b) => (buy(b.rec) - buy(b.recPrev)) - (buy(a.rec) - buy(a.recPrev))).slice(0, 5);
    if (up.length) lines.push(["Hochgestuft", up.map(x => chip(x, ` <span class="up">${sign((buy(x.rec) - buy(x.recPrev)) * 100, 0)}</span>`)).join(" "), "#hot"]);
    const ins = items.filter(x => { const f = F(x.sym); return f.ins && f.ins.buyers >= 2 && !(f.cty && f.cty !== "US") && f.ins.lastBuy && (Date.now() - Date.parse(`${f.ins.lastBuy}T12:00:00Z`)) / 864e5 <= 21; }).sort((a, b) => F(b.sym).ins.buyers - F(a.sym).ins.buyers).slice(0, 5);
    if (ins.length) lines.push(["Insider kaufen", ins.map(x => chip(x, ` <span class="muted">${F(x.sym).ins.buyers}×</span>`)).join(" "), "#tools"]);
    const earn = items.filter(x => x.lastEarn && fin(x.lastEarn.surprisePct) && x.lastEarn.surprisePct >= 10 && (Date.now() - Date.parse(`${x.lastEarn.date}T12:00:00Z`)) / 864e5 <= 7).sort((a, b) => b.lastEarn.surprisePct - a.lastEarn.surprisePct).slice(0, 5);
    if (earn.length) lines.push(["Starke Zahlen (7 Tage)", earn.map(x => chip(x, ` <span class="up">${sign(x.lastEarn.surprisePct, 0)} %</span>`)).join(" "), "#screener"]);
    const highs = items.slice(0, 250).filter(x => fin(x.hi1d) && fin(x.hi52) && x.hi1d >= x.hi52).map(x => ({ x, s: window.DTD.score ? window.DTD.score(x.sym) : null })).sort((a, b) => ((b.s && b.s.note) || 0) - ((a.s && a.s.note) || 0)).slice(0, 6);
    if (highs.length) lines.push(["Neues Jahreshoch", highs.map(o => chip(o.x)).join(" "), "#screener"]);
    return `<article class="card"><h2 class="card-title">Neu heute</h2>
      ${lines.length ? `<div class="nh-list">${lines.map(([l, c, href]) => `<div class="nh-row"><a class="nh-l" href="${href}">${l}</a><div class="nh-c">${c}</div></div>`).join("")}</div>` : `<p class="muted small">Heute nichts Auffälliges in den Daten.</p>`}
      <p class="hint">Aus den Aktien-Daten (2× pro Börsentag), dem Swing-Planer und den nächtlichen Insider-Daten. Kürzel antippen öffnet den Aktien-Check.</p></article>`;
  }
  // Termine der nächsten 7 Tage für Depot, Merkliste und Swing-Ideen
  function dateCard() {
    const st = S.get("stocks"), sw = S.get("swing");
    if (!st) return "";
    const mine = new Set(depot().map(h => h.sym)), watch = new Set(window.DTD.watch ? window.DTD.watch.list() : []);
    const ideas = new Set(sw ? sw.setups.filter(s => ["buy", "wait", "alert"].includes(s.state)).map(s => s.sym) : []);
    const now = Date.now();
    const rows = st.items.filter(x => (mine.has(x.sym) || watch.has(x.sym) || ideas.has(x.sym)) && x.earn && x.earn.date)
      .map(x => ({ x, t: Date.parse(`${x.earn.date}T12:00:00Z`) })).filter(r => r.t - now >= -864e5 / 2 && r.t - now <= 7.5 * 864e5).sort((a, b) => a.t - b.t);
    const tag = x => (mine.has(x.sym) ? `<span class="light green">Depot</span>` : watch.has(x.sym) ? `<span class="light">Merkliste</span>` : `<span class="light yellow">Swing-Idee</span>`);
    return `<article class="card"><div class="card-head"><h2 class="card-title">Termine der Woche</h2><a class="small" href="#kalender">Kalender →</a></div>
      ${rows.length ? `<div class="al-list">${rows.slice(0, 8).map(r => `<div class="al-row">${chip(r.x)}<div class="al-text"><b>${dDate(r.x.earn.date)}</b> Quartalszahlen${r.x.earn.hour === "bmo" ? " vor Börsenbeginn" : r.x.earn.hour === "amc" ? " nach Börsenschluss" : ""}<div class="muted small">${esc(r.x.name)}</div></div>${tag(r.x)}</div>`).join("")}</div>`
        : `<p class="muted small">Keine Quartalszahlen Ihrer Aktien, der Merkliste oder der Swing-Ideen in den nächsten 7 Tagen.</p>`}
    </article>`;
  }
  let busy = false, tried = 0;
  function render() {
    const host = $("ovSmart");
    if (!host || $("home").hidden) return;
    if (!S.get("stocks")) {
      // höchstens alle 30 Sekunden neu laden – ohne Netz sonst eine Endlosschleife, die die Seite einfriert
      if (!busy && Date.now() - tried > 30000) {
        busy = true; tried = Date.now();
        S.all().then(() => window.DTD.scoreReady && window.DTD.scoreReady()).catch(() => null).then(() => { busy = false; if (S.get("stocks")) render(); else if ($("ovSmart")) $("ovSmart").innerHTML = `<article class="card"><p class="muted small">Die Aktien-Daten sind gerade nicht erreichbar – ohne Netz oder bei Störungen. Die Seite versucht es beim nächsten Öffnen erneut.</p></article>`; });
      }
      if (busy) host.innerHTML = `<article class="card"><p class="muted small">Lade Ihre Übersicht …</p></article>`;
      return;
    }
    host.innerHTML = (window.DTD.whatsNewCard ? window.DTD.whatsNewCard() : "") + (window.DTD.smartAlertsCard ? window.DTD.smartAlertsCard() : "")
      + `<div class="grid-2">${depotCard()}${watchCard()}</div><div class="grid-2">${newCard()}${dateCard()}</div>`;
    if (window.DTD.smartBadge) window.DTD.smartBadge();
    if (window.DTD.fillWhy) window.DTD.fillWhy(host);
    window.dispatchEvent(new Event("dtd:sections"));
  }
  window.DTD.renderHome = render;
  for (const ev of ["dtd:shared", "dtd:watch", "dtd:smart", "dtd:backup"]) window.addEventListener(ev, () => render());
  window.addEventListener("dtd:view", e => { if (e.detail === "home") render(); });
  document.addEventListener("DOMContentLoaded", render);
  setTimeout(render, 0);
})();

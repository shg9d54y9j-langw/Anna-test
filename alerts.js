// ---------- Smarte Alarme: Hinweise zu Ihren Aktien im Depot und auf der Merkliste ----------
// Geprüft mit jedem Aktien-Datenlauf (2× pro Börsentag) und den nächtlichen Kennzahlen: Kreuzung des 50- und 200-Tage-Schnitts,
// Quartalszahlen in den nächsten Tagen, Hoch- und Herabstufungen der Analysten, Käufe mehrerer Insider, neue Kaufzone im
// Swing-Planer, große Tagesbewegung, neues Jahreshoch oder -tief. Neue Hinweise kommen als Browser-Meldung, wenn erlaubt.
// Alles bleibt in diesem Browser – Depot und Merkliste werden nirgends hochgeladen.
(() => {
  const S = window.DTD.shared;
  const fin = v => Number.isFinite(v);
  const TYPES = {
    ma200: "Kreuzt den 200-Tage-Schnitt", ma50: "Kreuzt den 50-Tage-Schnitt", earn: "Quartalszahlen in den nächsten 3 Tagen",
    rating: "Hoch- oder Herabstufung der Analysten", insider: "Käufe mehrerer Insider", swing: "Neu in der Kaufzone des Swing-Planers",
    move: "Tagesbewegung ab ±5 %", high: "Neues Jahreshoch oder -tief",
  };
  const cfg = () => { const c = store.get("dtd-smart", {}) || {}; return { off: Array.isArray(c.off) ? c.off.filter(k => TYPES[k]) : [] }; };
  const SYM = /^[A-Z0-9][A-Z0-9.\-_:]{0,24}$/;
  const depot = () => { const l = store.get("dtd-portfolio", []); return Array.isArray(l) ? [...new Set(l.filter(h => h && typeof h.sym === "string" && SYM.test(h.sym)).map(h => h.sym))] : []; };
  const watched = () => (window.DTD.watch ? window.DTD.watch.list() : []);
  const sign = (x, d = 1) => (fin(x) ? (x > 0 ? "+" : "") + fmt(x, d) : "–");
  const dDate = iso => new Date(`${String(iso).slice(0, 10)}T12:00:00Z`).toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" });
  const total = r => (r ? r.sb + r.b + r.h + r.s + r.ss : 0);
  const buy = r => (total(r) >= 5 ? (r.sb + r.b) / total(r) : null);
  const avgOf = (x, d) => (fin(x.last) && fin(d) ? x.last / (1 + d / 100) : null);

  function forSym(sym, where) {
    const x = S.item(sym);
    if (!x) return [];
    const f = S.fund(sym) || {}, plan = S.setup(sym), out = [];
    const add = (type, level, text) => out.push({ sym, name: x.name, type, level, text, where, key: `${sym}:${type}:${x.asOf}:${text.slice(0, 24)}` });
    const prev = fin(x.chg1d) ? x.last / (1 + x.chg1d / 100) : null;
    for (const [type, d, label] of [["ma200", x.d200, "200"], ["ma50", x.d50, "50"]]) {
      const avg = avgOf(x, d);
      if (prev === null || avg === null) continue;
      if (prev < avg && x.last >= avg) add(type, "good", `steigt über den ${label}-Tage-Schnitt (${fmt(avg, 2)})${label === "200" ? " – der langfristige Trend dreht nach oben" : ""}.`);
      if (prev > avg && x.last <= avg) add(type, label === "200" ? "high" : "warn", `fällt unter den ${label}-Tage-Schnitt (${fmt(avg, 2)})${label === "200" ? " – der langfristige Trend ist gebrochen, Verkauf prüfen" : ""}.`);
    }
    const days = x.earn && x.earn.date ? Math.round((Date.parse(`${x.earn.date}T12:00:00Z`) - Date.now()) / 864e5) : null;
    if (days !== null && days >= 0 && days <= 3) add("earn", "info", `meldet ${days === 0 ? "heute" : days === 1 ? "morgen" : `am ${dDate(x.earn.date)}`} Quartalszahlen${x.earn.hour === "bmo" ? " (vor Börsenbeginn)" : x.earn.hour === "amc" ? " (nach Börsenschluss)" : ""} – der Kurs kann stark springen.`);
    const b = buy(x.rec), bp = buy(x.recPrev);
    if (b !== null && bp !== null && b - bp >= 0.08) add("rating", "good", `Analysten optimistischer: ${sign((b - bp) * 100, 0)} Punkte Kaufempfehlungen zum Vormonat (jetzt ${fmt(b * 100, 0)} %).`);
    if (b !== null && bp !== null && b - bp <= -0.08) add("rating", "warn", `Analysten skeptischer: ${sign((b - bp) * 100, 0)} Punkte Kaufempfehlungen zum Vormonat (jetzt ${fmt(b * 100, 0)} %).`);
    if (f.ins && f.ins.buyers >= 2 && !(f.cty && f.cty !== "US") && f.ins.lastBuy && (Date.now() - Date.parse(`${f.ins.lastBuy}T12:00:00Z`)) / 864e5 <= 21) add("insider", "good", `${f.ins.buyers} Insider kauften in den letzten 90 Tagen eigene Aktien, zuletzt am ${dDate(f.ins.lastBuy)}.`);
    const st = S.get("swing");
    if (plan && plan.state === "buy" && st && plan.since && plan.since === String(st.dataUpdated || st.updated || "").slice(0, 10)) add("swing", "good", "ist neu in der Kaufzone des Swing-Planers – Kauf, Stop und Ziel stehen dort.");
    if (fin(x.chg1d) && Math.abs(x.chg1d) >= 5) add("move", x.chg1d < 0 ? "warn" : "info", `bewegte sich am letzten Handelstag um ${sign(x.chg1d)} % – Nachrichten prüfen.`);
    if (fin(x.hi1d) && fin(x.hi52) && x.hi1d >= x.hi52) add("high", "good", "erreichte ein neues 52-Wochen-Hoch.");
    else if (fin(x.lo1d) && fin(x.lo52) && x.lo1d <= x.lo52) add("high", "warn", "fiel auf ein neues 52-Wochen-Tief.");
    return out;
  }
  const ORDER = { high: 0, warn: 1, good: 2, info: 3 };
  function list() {
    if (!S.get("stocks")) return [];
    const off = new Set(cfg().off), d = depot(), w = watched().filter(s => !d.includes(s));
    return [...d.flatMap(s => forSym(s, "Depot")), ...w.flatMap(s => forSym(s, "Merkliste"))].filter(a => !off.has(a.type))
      .sort((a, b) => ORDER[a.level] - ORDER[b.level] || (a.where === b.where ? 0 : a.where === "Depot" ? -1 : 1));
  }
  // Zahl am Reiter „Übersicht“ (am Handy an „Start“) und Browser-Meldungen für neue Hinweise
  function badge() {
    const A = list(), n = A.filter(a => a.level === "high" || a.level === "warn" || a.level === "good").length;
    const b = $("homeBadge");
    if (b) { b.textContent = String(n); b.hidden = !n; }
    const nb = document.querySelector('.bottomnav [data-go="home"]');
    if (nb) { let dot = nb.querySelector(".nav-badge"); if (!dot) { dot = document.createElement("b"); dot.className = "nav-badge"; nb.append(dot); } dot.textContent = String(n); dot.hidden = !n; }
    if (!S.get("stocks")) return;
    const seen = new Set(store.get("dtd-smart-seen", []));
    const fresh = A.filter(a => a.level !== "info" && !seen.has(a.key));
    if (fresh.length && "Notification" in window && Notification.permission === "granted") {
      for (const a of fresh.slice(0, 4)) { try { new Notification(`RojkoMoney: ${a.sym}`, { body: `${a.sym} ${a.text}`, icon: "icons/icon-192.png", tag: a.key }); } catch { /* Handy-Browser ohne Meldungen */ } }
    }
    store.set("dtd-smart-seen", A.map(a => a.key).slice(0, 300));
  }
  const ICON = { high: ["▼", "down"], warn: ["!", "warn-t"], good: ["▲", "up"], info: ["i", "muted"] };
  let setOpen = false;   // Einstellungen bleiben beim Neuzeichnen aufgeklappt
  document.addEventListener("toggle", e => { if (e.target.classList && e.target.classList.contains("sa-set")) setOpen = e.target.open; }, true);
  function card() {
    const A = list(), c = cfg(), has = depot().length + watched().length;
    const row = a => `<div class="al-row"><button type="button" class="chip-btn" data-open="${esc(a.sym)}">${esc(a.sym)}</button>
        <div class="al-text"><span class="sa-icon ${ICON[a.level][1]}" aria-hidden="true">${ICON[a.level][0]}</span> ${esc(a.text)}<div class="muted small">${esc(a.name || "")} · ${a.where}</div></div></div>`;
    const settings = `<details class="sa-set"${setOpen ? " open" : ""}><summary>Welche Hinweise? (${Object.keys(TYPES).length - c.off.length} von ${Object.keys(TYPES).length})</summary>
        <div class="tchips">${Object.entries(TYPES).map(([k, l]) => `<button type="button" class="tchip" data-smart="${k}" aria-pressed="${!c.off.includes(k)}">${l}</button>`).join("")}</div>
        <p class="muted small">${"Notification" in window ? (Notification.permission === "granted" ? "Browser-Meldungen sind eingeschaltet – neue Hinweise melden sich, solange die Seite offen ist." : Notification.permission === "denied" ? "Browser-Meldungen sind blockiert – in den Website-Einstellungen erlauben." : `<button type="button" class="btn ghost small-btn" data-smart-notify>Als Browser-Meldung erlauben</button>`) : "Dieser Browser kann keine Meldungen anzeigen."}</p></details>`;
    return `<article class="card" data-section="Hinweise" id="hinweise">
      <div class="card-head"><h2 class="card-title">Hinweise zu Ihren Aktien</h2><span class="muted small">${A.length ? `${A.length} aktuell` : ""}</span></div>
      ${!has ? `<p class="small">Merken Sie Aktien mit dem Stern ☆ oder tragen Sie Ihr Depot im <a href="#portfolio">Portfolio</a> ein – dann erscheinen hier Hinweise: Trendwechsel, Quartalszahlen, Analysten, Insider, Swing-Signale.</p>`
        : A.length ? `<div class="al-list">${A.slice(0, 8).map(row).join("")}</div>${A.length > 8 ? `<details class="sa-more"><summary>${A.length - 8} weitere</summary><div class="al-list">${A.slice(8).map(row).join("")}</div></details>` : ""}`
        : `<p class="muted small">Gerade keine Hinweise – Ihre ${depot().length ? "Depot-Aktien und " : ""}gemerkten Aktien sind ruhig.</p>`}
      ${has ? settings : ""}
    </article>`;
  }
  document.addEventListener("click", e => {
    const t = e.target.closest("[data-smart]");
    if (t) {
      const c = cfg(), k = t.dataset.smart;
      c.off = c.off.includes(k) ? c.off.filter(v => v !== k) : [...c.off, k];
      store.set("dtd-smart", c);
      window.dispatchEvent(new CustomEvent("dtd:smart"));
      badge();
      return;
    }
    if (e.target.closest("[data-smart-notify]") && "Notification" in window) Notification.requestPermission().then(() => window.dispatchEvent(new CustomEvent("dtd:smart")));
  });
  window.DTD.smartAlerts = list;
  window.DTD.smartAlertsCard = card;
  window.DTD.smartBadge = badge;
  window.addEventListener("dtd:shared", badge);
  window.addEventListener("dtd:watch", badge);
  // Mit Depot oder Merkliste gleich beim Öffnen der Seite prüfen (Zahl am Reiter, Meldungen)
  if (depot().length || watched().length) setTimeout(() => S.all().then(badge), 1800);
})();

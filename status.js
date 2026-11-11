// ---------- Datenstand: wann kam welche Auswertung zuletzt? (Knopf an der Live-Uhr, Adresse #datenstand) ----------
// Liest status.json vom Zweig status (alle zwei Stunden vom Workflow „Daten-Status“) und rechnet das Alter jeder Quelle beim
// Anzeigen neu – mit denselben Regeln wie scripts/data-status.mjs: Stunden an Werktagen (UTC), Live-Fenster Mo–Fr 06–23 UTC,
// Prüftermin beim Forschungsstand. Ein farbiger Punkt an der Live-Uhr zeigt Verspätungen und Ausfälle.
(() => {
  let S = null;
  // gleiche Rechnung wie in scripts/data-status.mjs (dort getestet)
  function hoursIn(a, b, live) {
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
  function stateOf(s, now = Date.now()) {
    if (!s.updated || !Number.isFinite(Date.parse(s.updated))) return s.optional ? "off" : "missing";
    if (s.mode === "due") {
      if (!s.due) return "ok";
      const late = (now - Date.parse(`${s.due}T23:59:59Z`)) / 864e5;
      return late > 3 ? "stale" : late > 0 ? "warn" : "ok";
    }
    const h = hoursIn(Date.parse(s.updated), now, s.mode === "live");
    return h > s.stale ? "stale" : h > s.warn ? "warn" : "ok";
  }
  const ago = iso => { const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 6e4)); return m < 2 ? "gerade eben" : m < 90 ? `vor ${m} Min.` : m < 48 * 60 ? `vor ${Math.round(m / 60)} Std.` : `vor ${Math.round(m / 1440)} Tagen`; };
  const STATE = { ok: ["aktuell", "ds-ok"], warn: ["verspätet", "ds-warn"], stale: ["ausgefallen", "ds-bad"], missing: ["fehlt", "ds-bad"], off: ["nicht eingerichtet", "ds-off"] };
  const failed = () => (S && Array.isArray(S.workflows) ? S.workflows.filter(w => w.conclusion === "failure" || w.conclusion === "timed_out") : []);
  function health() {
    if (!S || !Array.isArray(S.sources)) return { level: "unknown", bad: 0, warn: 0 };
    const st = S.sources.map(s => stateOf(s));
    const bad = st.filter(x => x === "stale" || x === "missing").length + failed().length, warn = st.filter(x => x === "warn").length;
    return { level: bad ? "bad" : warn ? "warn" : "ok", bad, warn };
  }
  function paint() {
    const chip = document.querySelector(".livechip");
    if (!chip) return;
    const h = health();
    chip.dataset.health = h.level;
    const what = h.level === "bad" ? `${h.bad} ${h.bad === 1 ? "Problem" : "Probleme"}` : h.level === "warn" ? `${h.warn} verspätet` : h.level === "ok" ? "alles aktuell" : "wird geladen";
    chip.setAttribute("aria-label", `Datenstand anzeigen – ${what}`);
  }
  function body() {
    if (!S || !Array.isArray(S.sources)) return `<p class="muted">Der Datenstand ist noch nicht verfügbar – der Workflow „Daten-Status“ legt ihn alle zwei Stunden an.</p>`;
    const rows = S.sources.map(s => {
      const st = stateOf(s), [lbl, cls] = STATE[st];
      const when = s.mode === "due" ? `geprüft am ${new Date(`${s.updated}T12:00:00Z`).toLocaleDateString("de-AT")}${s.due ? `, nächste Prüfung ${new Date(`${s.due}T12:00:00Z`).toLocaleDateString("de-AT")}` : ""}` : s.updated ? `zuletzt ${ago(s.updated)}` : "noch keine Daten";
      return `<li class="ds-row"><span class="ds-dot ${cls}" aria-hidden="true"></span><span class="ds-main"><b>${esc(s.label)}</b><span class="muted small">${when} · ${esc(s.cadence || "")}</span></span><span class="ds-state ${cls}">${lbl}</span></li>`;
    }).join("");
    const f = failed();
    const h = health();
    return `<p class="small">${h.level === "ok" ? "Alle Auswertungen sind aktuell." : h.level === "warn" ? "Einzelne Auswertungen kommen verspätet – meist holt der nächste Lauf das nach." : "Mindestens eine Auswertung ist ausgefallen oder ein Lauf ist fehlgeschlagen."} Kurse und Grafiken (TradingView) laufen unabhängig davon in Echtzeit.</p>
      <ul class="ds-list">${rows}</ul>
      ${f.length ? `<h3 class="swing-h3">Fehlgeschlagene Läufe</h3><ul class="ds-list">${f.map(w => `<li class="ds-row"><span class="ds-dot ds-bad" aria-hidden="true"></span><span class="ds-main"><b>${esc(w.name)}</b><span class="muted small">${w.at ? new Date(w.at).toLocaleString("de-AT", { dateStyle: "short", timeStyle: "short" }) : ""}</span></span>${/^https:\/\/github\.com\//.test(w.url || "") ? `<a class="ds-state" href="${esc(w.url)}" target="_blank" rel="noopener noreferrer">Protokoll</a>` : ""}</li>`).join("")}</ul>` : ""}
      <p class="hint">Geprüft vom Workflow „Daten-Status“ alle zwei Stunden (zuletzt ${ago(S.updated)}); das Alter oben rechnet die Seite laufend neu. Ausfälle und ihre Behebung kommen aufs Handy, wenn Meldungen mit ntfy eingerichtet sind (Portfolio → Benachrichtigungen). Am Wochenende ruhen die meisten Läufe – das zählt nicht als Verspätung.</p>`;
  }
  async function load(force) {
    const d = await window.DTD.shared.load("status", force);
    if (d) S = d;
    paint();
    if (!$("drawer").hidden && $("drawerTitle").textContent === "Datenstand") $("drawerBody").innerHTML = body();
  }
  window.DTD.openDataStatus = () => { openDrawer("Datenstand", body()); load(true); };
  window.DTD.dataHealth = health;
  const fromHash = () => { if (location.hash === "#datenstand") window.DTD.openDataStatus(); };
  window.addEventListener("hashchange", fromHash);
  document.addEventListener("DOMContentLoaded", () => setTimeout(fromHash, 50));
  setTimeout(() => load(false), 3000);
  setInterval(() => { if (!document.hidden) load(true); }, 10 * 60 * 1000);
  setInterval(paint, 60 * 1000);
})();

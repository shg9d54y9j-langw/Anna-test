// ---------- Seite anpassen: Bereiche ausblenden, Karten der Startseite ausblenden und umsortieren ----------
// Nur in diesem Browser (dtd-layout, Teil der Sicherung). Ausgeblendete Bereiche verschwinden aus den Reitern, der Leiste unten
// und „Alle Themen“; über Links (z. B. „Neu in RojkoMoney“) bleiben sie erreichbar. Die Übersicht lässt sich nicht ausblenden.
(() => {
  const KEY = "dtd-layout";
  const VIEWS = [...document.querySelectorAll(".tabs .tab")].map(t => ({ id: t.dataset.tab, label: (t.querySelector("span") || t).textContent.trim() }))
    .concat(document.getElementById("botsBtn") ? [{ id: "bots", label: "Bots & Copy-Trading (Knopf oben)" }] : []);
  const TOP = [["brief", "Heute wichtig (Tagesbriefing)"], ["neu", "Neu in RojkoMoney"], ["since", "Seit Ihrem letzten Besuch"], ["alerts", "Hinweise (smarte Alarme)"], ["depot", "Depot und Merkliste"], ["today", "Neu heute und Termine"]];
  const DASH = [["market", "Marktlage"], ["sessions", "Börsen"], ["journal", "Mein Handelstag"], ["rules", "Tagesregeln"], ["quick", "Schnellzugriff"]];
  const arr = a => (Array.isArray(a) ? a.filter(x => typeof x === "string") : []);
  // gespeicherte Reihenfolge, ergänzt um später hinzugekommene Karten
  const order = (saved, all) => { const ids = all.map(([k]) => k), s = arr(saved).filter(k => ids.includes(k)); const add = ids.filter(k => !s.includes(k)); return [...add.filter(k => k === "brief"), ...s, ...add.filter(k => k !== "brief")]; };
  function get() {
    const c = store.get(KEY, {}) || {};
    return { hide: arr(c.hide).filter(id => id !== "home" && VIEWS.some(v => v.id === id)), homeHide: arr(c.homeHide), top: order(c.top, TOP), dash: order(c.dash, DASH) };
  }
  const set = c => { store.set(KEY, c); apply(); window.dispatchEvent(new Event("dtd:layout")); };
  window.addEventListener("dtd:access", () => apply());   // Anmeldung geändert: Bots-Knopf ein- oder ausblenden

  let style = null;
  function apply() {
    const c = get(), hide = new Set(c.hide);
    for (const v of VIEWS) {
      const off = hide.has(v.id);
      const tab = document.getElementById(v.id === "bots" ? "botsBtn" : `tab-${v.id}`);
      const denied = v.id === "bots" && window.DTD.botsAllowed && !window.DTD.botsAllowed();   // nur für den Besitzer (login.js)
      if (tab) tab.hidden = off || denied;
      document.querySelectorAll(`.bottomnav [data-go="${v.id}"], .navsheet [data-go="${v.id}"]`).forEach(b => { b.hidden = off; });
    }
    // Karten der Startseite: ausblenden und im Raster umsortieren
    if (!style) { style = document.createElement("style"); style.id = "layoutStyle"; document.head.append(style); }
    style.textContent = c.homeHide.map(k => `#home [data-home="${k}"]{display:none!important}`).join("")
      + c.dash.map((k, i) => `#ovDash>[data-home="${k}"]{order:${i}}`).join("");
  }

  function body() {
    const c = get(), hide = new Set(c.hide), hh = new Set(c.homeHide);
    const row = (kind, id, label, on, i, n) => `<li><label><input type="checkbox" data-lay="${kind}" data-id="${id}"${on ? " checked" : ""}> ${esc(label)}</label>${n ? `<button type="button" class="icon-btn" data-lay-move="${kind}" data-id="${id}" data-dir="-1" aria-label="${esc(label)} nach oben"${i === 0 ? " disabled" : ""}>↑</button><button type="button" class="icon-btn" data-lay-move="${kind}" data-id="${id}" data-dir="1" aria-label="${esc(label)} nach unten"${i === n - 1 ? " disabled" : ""}>↓</button>` : ""}</li>`;
    const label = (all, k) => (all.find(([x]) => x === k) || [k, k])[1];
    const th = window.RojkoTheme ? window.RojkoTheme.get() : "auto";
    const themeRow = window.RojkoTheme ? `<h3 class="swing-h3">Farbschema</h3>
      <div class="seg" role="group" aria-label="Farbschema">${[["auto", "Wie das Gerät"], ["light", "Hell"], ["dark", "Dunkel"]].map(([k, l]) => `<button type="button" data-theme-set="${k}" aria-pressed="${th === k}">${l}</button>`).join("")}</div>` : "";
    return `<p class="small">Was Sie nicht brauchen, blenden Sie hier aus. Gespeichert nur in diesem Browser – „Sicherung herunterladen“ im Portfolio nimmt es mit.</p>
      ${themeRow}
      ${window.DTD.swipe ? `<h3 class="swing-h3">Bedienung am Handy</h3><label class="lay-swipe"><input type="checkbox" data-swipe-toggle${window.DTD.swipe.enabled() ? " checked" : ""}> Nach links oder rechts wischen wechselt den Bereich</label>` : ""}
      <h3 class="swing-h3">Bereiche</h3>
      <ul class="lay-list">${VIEWS.filter(v => v.id !== "home" && !(v.id === "bots" && window.DTD.botsAllowed && !window.DTD.botsAllowed())).map(v => row("view", v.id, v.label, !hide.has(v.id))).join("")}</ul>
      <h3 class="swing-h3">Startseite: Ihre Karten oben</h3>
      <ul class="lay-list">${c.top.map((k, i) => row("top", k, label(TOP, k), !hh.has(k), i, c.top.length)).join("")}</ul>
      <h3 class="swing-h3">Startseite: weitere Karten</h3>
      <ul class="lay-list">${c.dash.map((k, i) => row("dash", k, label(DASH, k), !hh.has(k), i, c.dash.length)).join("")}</ul>
      <div class="btn-row"><button type="button" class="btn ghost" data-lay-reset>Alles zurücksetzen</button></div>`;
  }
  const refresh = () => { const el = document.getElementById("layBody"); if (el) el.innerHTML = body(); };
  function open() { openDrawer("Seite anpassen", `<div id="layBody">${body()}</div>`); }

  document.addEventListener("click", e => {
    if (e.target.closest("[data-layout-open]")) { e.preventDefault(); return open(); }
    const ts = e.target.closest("[data-theme-set]");
    if (ts && window.RojkoTheme) { window.RojkoTheme.set(ts.dataset.themeSet); return refresh(); }
    const mv = e.target.closest("[data-lay-move]");
    if (mv) {
      const c = get(), list = c[mv.dataset.layMove], i = list.indexOf(mv.dataset.id), j = i + Number(mv.dataset.dir);
      if (i < 0 || j < 0 || j >= list.length) return;
      [list[i], list[j]] = [list[j], list[i]];
      set(c); refresh();
      const again = document.querySelector(`[data-lay-move="${mv.dataset.layMove}"][data-id="${mv.dataset.id}"][data-dir="${mv.dataset.dir}"]`);
      if (again && !again.disabled) again.focus();
      return;
    }
    if (e.target.closest("[data-lay-reset]")) { store.set(KEY, {}); apply(); window.dispatchEvent(new Event("dtd:layout")); refresh(); toast("Seite anpassen", "Alles wieder wie am Anfang.", 3000); }
  });
  document.addEventListener("change", e => {
    const cb = e.target.closest("input[data-lay]");
    if (!cb) return;
    const c = get(), id = cb.dataset.id;
    if (cb.dataset.lay === "view") c.hide = cb.checked ? c.hide.filter(x => x !== id) : [...new Set([...c.hide, id])];
    else c.homeHide = cb.checked ? c.homeHide.filter(x => x !== id) : [...new Set([...c.homeHide, id])];
    set(c);
  });
  window.DTD.layout = { get, apply, open };
  // nav.js baut die Leiste unten und „Alle Themen“ erst später: danach noch einmal anwenden
  apply();
  document.addEventListener("DOMContentLoaded", apply);
  setTimeout(apply, 0);
})();

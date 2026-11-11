// ---------- Wischen am Handy: nach links = nächster Bereich bzw. Teil, nach rechts = vorheriger ----------
// Reihenfolge wie in der Leiste unten, Teile zusammengelegter Bereiche (z. B. Ideen: HotStuff, Swing, Muster, Theorie) einzeln;
// im Bereich „Bots & Copy-Trading“ nur zwischen dessen Teilen. Ausgeblendete Bereiche (Seite anpassen) werden übersprungen.
// Keine Wischgeste in Tabellen, Diagrammen, Leisten, Eingabefeldern und anderen waagrecht scrollbaren Stellen, nicht am
// Bildschirmrand (dort liegt die Zurück-Geste des Browsers) und nicht bei offenem Fenster. Abschaltbar unter „Seite anpassen“.
(() => {
  const KEY = "dtd-swipe";
  const MIN_X = 70, RATIO = 1.8, MAX_MS = 700, EDGE = 22;
  const enabled = () => store.get(KEY, "on") !== "off";
  const phone = () => window.matchMedia("(max-width: 760px)").matches;
  const NO = "input, textarea, select, [contenteditable], .chart-host, .table-wrap, .subnav, .viewswitch, .seg, .ticker, .tradingview-widget-container, iframe, svg, .w-alloc, [data-no-swipe], .bottomnav, .drawer, .navsheet";
  const blocked = el => {
    for (; el && el.nodeType === 1 && el.id !== "views"; el = el.parentElement) {
      if (el.matches(NO)) return true;
      const ox = getComputedStyle(el).overflowX;
      if ((ox === "auto" || ox === "scroll") && el.scrollWidth > el.clientWidth + 2) return true;
    }
    return false;
  };
  // Reihenfolge der Ansichten
  function order(current) {
    const g = GROUP_OF[current];
    if (g === "bots") return GROUPS.bots.slice();
    return GROUP_ORDER.filter(x => x !== "bots" && !(document.getElementById(`tab-${x}`) || {}).hidden).flatMap(x => GROUPS[x]);
  }
  function go(dir) {
    const v = document.querySelector("#views > .view:not([hidden])");
    if (!v) return false;
    const list = order(v.id), i = list.indexOf(v.id), next = list[i + dir];
    if (i < 0 || !next) return false;
    // in einen anderen Bereich: dessen zuletzt benutzten Teil öffnen, wenn man von außen kommt
    const target = GROUP_OF[next] !== GROUP_OF[v.id] && GROUPS[GROUP_OF[next]].length > 1 && dir > 0 ? GROUPS[GROUP_OF[next]][0] : next;
    location.hash = target;
    requestAnimationFrame(() => {
      const el = document.getElementById(target);
      if (!el || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      el.classList.remove("swipe-in-l", "swipe-in-r"); void el.offsetWidth;
      el.classList.add(dir > 0 ? "swipe-in-l" : "swipe-in-r");
      setTimeout(() => el.classList.remove("swipe-in-l", "swipe-in-r"), 320);
    });
    return true;
  }
  let s = null;
  addEventListener("touchstart", e => {
    s = null;
    if (!enabled() || !phone() || e.touches.length !== 1 || !$("drawer").hidden) return;
    const t = e.touches[0];
    if (t.clientX < EDGE || t.clientX > innerWidth - EDGE || !e.target.closest || !e.target.closest("#views") || blocked(e.target)) return;
    s = { x: t.clientX, y: t.clientY, at: performance.now() };
  }, { passive: true });
  addEventListener("touchmove", e => { if (s && e.touches.length !== 1) s = null; }, { passive: true });
  addEventListener("touchend", e => {
    if (!s) return;
    const t = e.changedTouches[0], dx = t.clientX - s.x, dy = t.clientY - s.y, ms = performance.now() - s.at;
    s = null;
    const sel = String(window.getSelection ? window.getSelection() : "");
    if (Math.abs(dx) < MIN_X || Math.abs(dx) < Math.abs(dy) * RATIO || ms > MAX_MS || sel.length) return;
    go(dx < 0 ? 1 : -1);
  }, { passive: true });
  addEventListener("touchcancel", () => { s = null; }, { passive: true });

  // einmaliger Hinweis am Handy
  setTimeout(() => {
    if (!phone() || !enabled() || store.get("dtd-swipe-hint", false)) return;
    store.set("dtd-swipe-hint", true);
    toast("Tipp", "Nach links oder rechts wischen wechselt den Bereich. Abschalten unter „Seite anpassen“.", 6000);
  }, 6000);
  window.DTD.swipe = { enabled, set: on => store.set(KEY, on ? "on" : "off"), go };
  document.addEventListener("change", e => { if (e.target.matches && e.target.matches("[data-swipe-toggle]")) window.DTD.swipe.set(e.target.checked); });
})();

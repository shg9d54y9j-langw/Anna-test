// ---------- Navigation: Unter-Navigation je Bereich, auf dem Handy die Leiste unten mit allen sieben Bereichen ----------
(() => {
  const tabs = [...document.querySelectorAll(".tabs .tab")];
  // Sieben Bereiche – am Handy alle direkt in der Leiste unten
  const MAIN = tabs.map(t => t.dataset.tab);
  const SHORT = { home: "Start", portfolio: "Depot", vermoegen: "Vermögen", aktie: "Aktie", markt: "Markt", tools: "Tools", ideas: "Ideen", bots: "Bots" };
  const icon = id => { const t = $(`tab-${id}`); const svg = t && t.querySelector("svg"); return svg ? svg.outerHTML : ""; };
  const go = g => window.DTD.openGroup(g);

  // Knopfleiste unten (Handy)
  const bar = document.createElement("nav");
  bar.className = "bottomnav";
  bar.setAttribute("aria-label", "Hauptbereiche");
  bar.innerHTML = MAIN.map(id => `<button type="button" data-go="${id}">${icon(id)}<span>${SHORT[id] || id}</span></button>`).join("");
  document.body.append(bar);
  bar.addEventListener("click", e => {
    const b = e.target.closest("button[data-go]");
    if (b) go(b.dataset.go);
  });

  // Farbschema-Schalter in der Kopfzeile: automatisch → hell → dunkel
  const THEME_ICON = {
    auto: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 0 0 16z" fill="currentColor" stroke="none"/></svg>',
    light: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/></svg>',
    dark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>',
  };
  const THEME_NAME = { auto: "wie das Gerät", light: "hell", dark: "dunkel" };
  const appbar = document.querySelector(".appbar");
  if (appbar && window.RojkoTheme) {
    const tb = document.createElement("button");
    tb.type = "button";
    tb.className = "icon-btn theme-btn";
    const paint = () => { const p = window.RojkoTheme.get(); tb.innerHTML = THEME_ICON[p]; tb.setAttribute("aria-label", `Farbschema: ${THEME_NAME[p]} – umschalten`); tb.title = `Farbschema: ${THEME_NAME[p]} (antippen zum Wechseln)`; };
    paint();
    tb.addEventListener("click", () => { window.RojkoTheme.next(); paint(); });
    appbar.insertBefore(tb, appbar.querySelector(".livechip"));
  }

  // Unter-Navigation: Knöpfe für alle Abschnitte mit data-section im sichtbaren Bereich
  function buildSubnav(view) {
    if (!view) return;
    let nav = view.querySelector(":scope > .subnav");
    const sections = [...view.querySelectorAll("[data-section]")].filter(s => s.offsetParent !== null);
    if (sections.length < 2) { if (nav) nav.remove(); return; }
    if (!nav) {
      nav = document.createElement("div");
      nav.className = "subnav";
      nav.setAttribute("role", "navigation");
      nav.setAttribute("aria-label", "Abschnitte");
      const head = view.querySelector(":scope > .view-head");
      if (head) head.after(nav); else view.prepend(nav);
    }
    nav.innerHTML = `<span class="label">Springen zu</span>` + sections.map((s, i) => `<button type="button" data-i="${i}">${s.dataset.section}</button>`).join("");
    nav.querySelectorAll("button").forEach(b => b.addEventListener("click", () => sections[+b.dataset.i].scrollIntoView({ behavior: "smooth", block: "start" })));
    // läuft die Leiste nach rechts weiter, blendet sie dort weich aus
    const edge = () => nav.classList.toggle("more-right", nav.scrollLeft + nav.clientWidth < nav.scrollWidth - 4);
    if (!nav.dataset.edge) { nav.dataset.edge = "1"; nav.addEventListener("scroll", edge, { passive: true }); window.addEventListener("resize", edge); }
    edge();
    observe(view, sections, nav);
  }
  let io = null;
  function observe(view, sections, nav) {
    if (io) io.disconnect();
    if (!("IntersectionObserver" in window)) return;
    io = new IntersectionObserver(entries => {
      const vis = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (!vis) return;
      const i = sections.indexOf(vis.target);
      nav.querySelectorAll("button").forEach(b => b.classList.toggle("on", +b.dataset.i === i));
      // aktiven Abschnitt in der Leiste sichtbar halten (nur waagrecht, die Seite springt nicht)
      const on = nav.querySelector("button.on");
      if (on && (on.offsetLeft < nav.scrollLeft || on.offsetLeft + on.offsetWidth > nav.scrollLeft + nav.clientWidth)) nav.scrollTo({ left: on.offsetLeft - 24, behavior: "smooth" });
    }, { rootMargin: "-120px 0px -60% 0px" });
    sections.forEach(s => io.observe(s));
  }
  function sync() {
    const v = document.querySelector("#views > .view:not([hidden])"), g = (v && window.DTD.groupOf(v.id)) || "home";
    bar.querySelectorAll("[data-go]").forEach(b => { const on = b.dataset.go === g; b.classList.toggle("on", on); if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); });
    requestAnimationFrame(() => buildSubnav(document.querySelector("#views > .view:not([hidden])")));
  }
  window.addEventListener("hashchange", () => setTimeout(sync, 0));
  window.addEventListener("dtd:data", () => setTimeout(sync, 50));
  window.addEventListener("dtd:sections", () => setTimeout(sync, 50));
  window.addEventListener("dtd:market", () => setTimeout(sync, 50));
  document.addEventListener("DOMContentLoaded", () => setTimeout(sync, 0));
  window.DTD.syncNav = sync;
  // Handy: lange Einleitungen sind auf drei Zeilen gekürzt – Antippen zeigt alles
  document.addEventListener("click", e => { const l = e.target.closest(".view-head .lead"); if (l && !e.target.closest("a, button")) l.classList.toggle("open"); });
})();

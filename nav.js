// ---------- Navigation: Unter-Navigation je Bereich, auf dem Handy Knopfleiste unten und Raster aller Themen ----------
(() => {
  const tabs = [...document.querySelectorAll(".tabs .tab")];
  const DESC = {
    home: "Tag auf einen Blick", portfolio: "Aktien, Journal, Steuer", markt: "Ampeln, Heatmap, News", aktie: "Symbol prüfen", tools: "Screener, Note-Bilanz, Alarme", ideen: "Belegte Muster",
    hot: "Experten-Favoriten", swing: "Theorie, Kauf, Stop", bot: "Handelt selbst, Tagebuch",
    setup: "Stop, Ziel, Stück", daily: "Wen kopieren? Vergleich", theorie: "Forschung",
  };
  const MAIN = ["home", "portfolio", "markt", "aktie", "hot", "bot"];
  const icon = id => { const t = $(`tab-${id}`); const svg = t && t.querySelector("svg"); return svg ? svg.outerHTML : ""; };
  const label = id => { const t = $(`tab-${id}`); return t ? t.querySelector("span").textContent : id; };
  const go = id => { location.hash = id; };

  // Knopfleiste unten (Handy)
  const bar = document.createElement("nav");
  bar.className = "bottomnav";
  bar.setAttribute("aria-label", "Hauptbereiche");
  bar.innerHTML = MAIN.map(id => `<button type="button" data-go="${id}">${icon(id)}<span>${({ home: "Start", portfolio: "Depot", markt: "Markt", aktie: "Aktie", hot: "Hot", bot: "Bot" })[id]}</span></button>`).join("")
    + `<button type="button" data-more><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg><span>Alle</span></button>`;
  document.body.append(bar);

  // Raster aller Themen (Handy)
  const sheet = document.createElement("div");
  sheet.className = "navsheet";
  sheet.hidden = true;
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-label", "Alle Themen");
  sheet.innerHTML = `<div class="navsheet-head"><b>Alle Themen</b><button type="button" class="icon-btn" data-close aria-label="Schließen">✕</button></div>
    <div class="navgrid">${tabs.map(t => { const id = t.dataset.tab; return `<button type="button" data-go="${id}">${icon(id)}<span>${label(id)}<small>${DESC[id] || ""}</small></span></button>`; }).join("")}
      <button type="button" data-layout-open><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg><span>Seite anpassen<small>Bereiche und Karten ausblenden</small></span></button></div>`;
  document.body.append(sheet);

  const openSheet = () => { sheet.hidden = false; document.body.style.overflow = "hidden"; sheet.querySelector(".navgrid button.on, .navgrid button").focus(); };
  const closeSheet = () => { sheet.hidden = true; document.body.style.overflow = ""; };
  bar.addEventListener("click", e => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.hasAttribute("data-more")) return sheet.hidden ? openSheet() : closeSheet();
    closeSheet(); go(b.dataset.go);
  });
  sheet.addEventListener("click", e => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.hasAttribute("data-close")) return closeSheet();
    if (b.hasAttribute("data-layout-open")) return closeSheet();   // das Fenster öffnet layout.js
    if (b.dataset.go) { closeSheet(); go(b.dataset.go); }
  });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !sheet.hidden) closeSheet(); });
  window.addEventListener("hashchange", () => { if (!sheet.hidden) closeSheet(); });   // z. B. Zurück-Taste: Menü nicht offen stehen lassen

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
    const id = (tabs.find(t => t.getAttribute("aria-selected") === "true") || {}).dataset?.tab || "home";
    bar.querySelectorAll("[data-go]").forEach(b => b.classList.toggle("on", b.dataset.go === id));
    const moreOn = !MAIN.includes(id);
    bar.querySelector("[data-more]").classList.toggle("on", moreOn);
    sheet.querySelectorAll("[data-go]").forEach(b => b.classList.toggle("on", b.dataset.go === id));
    requestAnimationFrame(() => buildSubnav($(id)));
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

// ---------- Ziehen zum Aktualisieren: auf jeder Seite ----------
// Handy: ganz oben nach unten ziehen und loslassen. Computer: ganz oben angekommen, weiter nach oben scrollen.
// Danach lädt die Seite neu – alle Daten und Grafiken frisch; der Bereich (#bot, #aktie …) und die gewählte Aktie bleiben.
// Als App vom Startbildschirm gibt es diese Geste sonst nicht; im Browser ersetzt sie die eigene Geste, damit sie überall gleich ist.
(() => {
  const PULL = 66;           // so weit ziehen (nach Dämpfung), dann loslassen = aktualisieren
  const MAX = 116;
  const DAMP = 0.55;         // der Hinweis folgt dem Finger gedämpft
  const WHEEL = 320;         // Computer: so viel Scrollweg nach oben, nachdem die Seite schon oben steht
  const REST_MS = 450;       // so lange muss die Seite oben stehen – Schwung vom Hochscrollen zählt nicht
  const ARROW = `<svg viewBox="0 0 24 24"><path d="M12 4v14M6 12l6 6 6-6"/></svg>`;
  const SPIN = `<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v4h-4"/></svg>`;

  const box = document.createElement("div");
  box.className = "ptr";
  box.setAttribute("role", "status");
  box.setAttribute("aria-live", "polite");
  box.innerHTML = `<span class="ptr-icon" aria-hidden="true">${ARROW}</span><span class="ptr-text"></span>`;
  document.body.append(box);
  const icon = box.querySelector(".ptr-icon"), text = box.querySelector(".ptr-text");
  let busy = false;

  const scroller = () => document.scrollingElement || document.documentElement;
  const atTop = () => scroller().scrollTop <= 0;
  const overlayOpen = () => [...document.querySelectorAll("#drawer, .navsheet")].some(el => !el.hidden);
  // Geste in Leiste unten, Menü, Detail-Fenster oder Eingabefeld: nicht aktualisieren
  const excluded = t => !t || !t.closest || Boolean(t.closest(".bottomnav, .drawer, .drawer-backdrop, .navsheet, input, textarea, select, [contenteditable]"));
  // Beginnt die Geste in einem eigenen Scrollbereich, der nicht ganz oben steht, gehört sie diesem Bereich
  const innerScrolled = el => {
    for (; el && el.nodeType === 1 && el !== document.body && el !== document.documentElement; el = el.parentElement) {
      if (el.scrollTop > 0 && el.scrollHeight > el.clientHeight && /auto|scroll/.test(getComputedStyle(el).overflowY)) return true;
    }
    return false;
  };

  function show(dist, armed, wheel = false) {
    box.classList.add("on");
    box.classList.toggle("armed", armed);
    box.style.transform = `translate(-50%, ${Math.round(dist - 52)}px)`;
    icon.style.transform = `rotate(${armed ? 180 : Math.round(Math.min(1, dist / PULL) * 180)}deg)`;
    const t = wheel ? "Weiter hochscrollen zum Aktualisieren" : armed ? "Loslassen zum Aktualisieren" : "Zum Aktualisieren ziehen";
    if (text.textContent !== t) text.textContent = t;
  }
  function hide() {
    if (busy) return;
    box.classList.remove("on", "armed", "dragging");
    box.style.transform = "";
    icon.style.transform = "";
    text.textContent = "";
  }
  function refresh() {
    if (busy) return;
    busy = true;
    box.classList.remove("dragging", "armed");
    box.classList.add("on", "busy");
    box.style.transform = "translate(-50%, 14px)";
    icon.style.transform = "";
    icon.innerHTML = SPIN;
    text.textContent = "Aktualisiere …";
    setTimeout(() => location.reload(), 150);
  }

  // Handy: Finger ganz oben nach unten ziehen
  let startY = null, startX = 0, dist = 0, mode = null;   // mode: null = Richtung offen, "pull" oder "skip"
  addEventListener("touchstart", e => {
    startY = null;
    if (busy || e.touches.length !== 1 || !atTop() || overlayOpen() || excluded(e.target) || innerScrolled(e.target)) return;
    startY = e.touches[0].clientY; startX = e.touches[0].clientX; dist = 0; mode = null;
  }, { passive: true });
  addEventListener("touchmove", e => {
    if (startY === null) return;
    if (e.touches.length !== 1) { startY = null; hide(); return; }
    const dy = e.touches[0].clientY - startY, dx = e.touches[0].clientX - startX;
    if (mode === null) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;                      // Richtung noch offen
      mode = dy > 0 && dy > Math.abs(dx) * 1.5 && atTop() ? "pull" : "skip";   // waagrecht wischen oder hochscrollen: nichts tun
    }
    if (mode !== "pull") return;
    dist = Math.min(MAX, Math.max(0, dy) * DAMP);
    box.classList.add("dragging");
    if (dist > 2) show(dist, dist >= PULL); else hide();
  }, { passive: true });
  addEventListener("touchend", () => {
    if (startY === null) return;
    const go = mode === "pull" && dist >= PULL && atTop();
    startY = null; mode = null;
    box.classList.remove("dragging");
    if (go) refresh(); else hide();
  }, { passive: true });
  addEventListener("touchcancel", () => { startY = null; mode = null; hide(); }, { passive: true });

  // Computer: oben angekommen, weiter nach oben scrollen (Mausrad oder Touchpad)
  let topSince = atTop() ? performance.now() : null, lastWheel = -1e9, acc = 0, armedBurst = false, hideTimer = null;
  addEventListener("scroll", () => { if (atTop()) { if (topSince === null) topSince = performance.now(); } else topSince = null; }, { passive: true });
  addEventListener("wheel", e => {
    if (busy || e.ctrlKey) return;   // Strg + Mausrad = Zoomen
    const now = performance.now();
    if (now - lastWheel > 300) {     // neue Bewegung: zählt nur, wenn die Seite schon eine Weile oben steht
      acc = 0;
      armedBurst = atTop() && topSince !== null && now - topSince >= REST_MS && !overlayOpen() && !excluded(e.target) && !innerScrolled(e.target);
    }
    lastWheel = now;
    if (!armedBurst) return;
    const px = e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? innerHeight : 1);
    if (px > 0 || !atTop()) { armedBurst = false; hide(); return; }   // doch nach unten: abbrechen
    acc -= px;
    clearTimeout(hideTimer);
    if (acc >= WHEEL) { refresh(); return; }
    if (acc > 0) show(Math.min(MAX, acc / WHEEL * PULL), false, true);
    hideTimer = setTimeout(hide, 400);
  }, { passive: true });
})();

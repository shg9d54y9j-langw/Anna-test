// ---------- Farbschema: hell, dunkel oder wie das Gerät (Standard) ----------
// Läuft im <head> vor dem ersten Zeichnen, damit nichts aufblitzt. Die Wahl bleibt in diesem Browser (dtd-theme, Teil der
// Sicherung). Wechsel per Schalter lädt die Seite neu, damit auch Diagramme und TradingView-Fenster die neuen Farben bekommen.
(() => {
  const KEY = "dtd-theme", ORDER = ["auto", "light", "dark"];
  let pref = "auto";
  try { const v = JSON.parse(localStorage.getItem(KEY) || '"auto"'); if (ORDER.includes(v)) pref = v; } catch { /* ohne Speicher: wie das Gerät */ }
  const mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: light)") : null;
  const effective = () => (pref === "light" || (pref === "auto" && mq && mq.matches) ? "light" : "dark");
  function apply() {
    const t = effective();
    document.documentElement.dataset.theme = t;
    const m = document.querySelector('meta[name="theme-color"]');
    if (m) m.content = t === "light" ? "#f4f4f7" : "#07070a";
  }
  apply();
  // Gerät stellt um (z. B. abends auf dunkel): Farben sofort, Diagramme beim nächsten Zeichnen
  if (mq && mq.addEventListener) mq.addEventListener("change", () => { if (pref === "auto") apply(); });
  window.RojkoTheme = {
    get: () => pref,
    effective,
    set(p) {
      if (!ORDER.includes(p)) return;
      const before = effective();
      pref = p;
      try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* ohne Speicher nur für diesen Besuch */ }
      apply();
      if (effective() !== before) setTimeout(() => location.reload(), 60);
    },
    next() { this.set(ORDER[(ORDER.indexOf(pref) + 1) % ORDER.length]); },
  };
})();

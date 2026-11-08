// ---------- Live: Uhr im Sekundentakt, jede Minute alle Daten auf Neues prüfen ----------
// Kurse und Grafiken (TradingView) laufen in Echtzeit. Die Auswertungen entstehen auf GitHub: Live-Wächter und Marktlage
// alle 15 Minuten, Aktien-Daten zweimal täglich, Trend-Bot einmal pro Börsentag. Die Seite prüft jede Minute, ob es Neues gibt,
// und zeichnet nur dann neu – ohne die Seite neu zu laden.
(() => {
  const bar = document.querySelector(".appbar");
  if (!bar) return;
  const chip = document.createElement("div");
  chip.className = "livechip";
  chip.setAttribute("role", "status");
  chip.title = "Kurse und Grafiken: Echtzeit. Auswertungen: Live-Wächter und Marktlage alle 15 Minuten, Aktien-Daten und Swing-Planer 2× täglich, Trend-Bot 1× pro Börsentag. Die Seite prüft jede Minute selbst auf Neues.";
  chip.innerHTML = `<span class="dot on" aria-hidden="true"></span><b>Live</b><span class="lc-clock num"></span><span class="lc-age muted"></span>`;
  bar.append(chip);
  const clock = chip.querySelector(".lc-clock"), age = chip.querySelector(".lc-age");
  let checked = Date.now(), lastStocks = 0, lastSwing = Date.now();
  const tick = () => {
    clock.textContent = new Date().toLocaleTimeString("de-DE");
    const s = Math.round((Date.now() - checked) / 1000);
    age.textContent = `geprüft vor ${s} s`;
  };
  const visible = id => { const el = document.getElementById(id); return el && !el.hidden; };
  async function refresh() {
    if (document.hidden) return;
    checked = Date.now();
    const D = window.DTD || {};
    if (D.reloadBot && (visible("bot") || D.trendBot)) D.reloadBot(true);
    // Aktien-Daten ändern sich nur zweimal am Tag – alle 5 Minuten nachsehen genügt
    if (Date.now() - lastStocks > 5 * 60 * 1000 && (visible("aktie") || visible("hot"))) {
      lastStocks = Date.now();
      if (D.reloadStocks && (await D.reloadStocks()) && D.reloadHot) D.reloadHot();
      else if (D.reloadHot && visible("hot")) D.reloadHot();
    }
    if (Date.now() - lastSwing > 5 * 60 * 1000 && visible("swing") && D.reloadSwing) { lastSwing = Date.now(); D.reloadSwing(); }
  }
  tick();
  setInterval(tick, 1000);
  setInterval(refresh, 60 * 1000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { refresh(); tick(); } });
})();

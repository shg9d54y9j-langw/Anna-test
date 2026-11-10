// ---------- Gemeinsame Daten für Merkliste, Gesamtnote, Vergleiche, Alarme und Startseite ----------
// Lädt jede Quelle einmal und gibt sie an alle Bereiche weiter (Aktien-Check, HotStuff, Portfolio, Swing-Planer, Werkzeuge,
// Theorie, Startseite) – die große Aktien-Datei kommt so nur einmal übers Netz. Erneutes Laden (Live-Prüfung, Ziehen zum
// Aktualisieren) holt höchstens einmal pro Minute neu; gleichzeitige Anfragen teilen sich einen Abruf.
// stocks.json: Kennzahlen aus eToro-Tageskerzen, Analysten und Quartalszahlen (2× pro Börsentag)
// fund.json: Kennzahlen, Branche, Sitzland und Insider (nachts) · swing.json: Swing-Planer · firms.json: Theorie-Firmen
(() => {
  const RAW = "https://raw.githubusercontent.com/shg9d54y9j-langw/Anna-test/";
  const get = url => fetch(url, { cache: "no-store" }).then(r => (r.ok ? r.json() : null)).catch(() => null);
  const SRC = {
    stocks: t => get(`${RAW}stock-data/stocks.json?t=${t}`).then(d => (d && Array.isArray(d.items) ? d : null)),
    fund: t => get(`${RAW}fund-data/fund.json?t=${t}`).then(d => (d && d.items ? d : null)),
    swing: t => get(`${RAW}stock-data/swing.json?t=${t}`).then(d => (d && Array.isArray(d.setups) ? d : null)),
    firms: t => get(`data/firms.json?t=${t}`).then(d => (d && d.firms ? d : null)),
  };
  const cache = {}, pending = {}, fetched = {};
  function load(name, force = false) {
    if (!SRC[name]) return Promise.resolve(null);
    if (pending[name]) return pending[name];
    // schon da – und beim erneuten Laden gerade erst geholt: nicht noch einmal übers Netz
    if (name in cache && (!force || (cache[name] && Date.now() - (fetched[name] || 0) < 60 * 1000))) return Promise.resolve(cache[name]);
    pending[name] = SRC[name](Date.now()).then(d => {
      const old = cache[name];
      if (d || !(name in cache)) cache[name] = d || null;
      fetched[name] = Date.now();
      delete pending[name];
      if (!old || !d || old.updated !== d.updated) window.dispatchEvent(new CustomEvent("dtd:shared", { detail: name }));
      return cache[name];
    });
    return pending[name];
  }
  // Nachschlagen nach Kürzel ohne jedes Mal die ganze Liste zu durchsuchen (je Datenstand einmal aufgebaut)
  const idx = {};
  function index(name, key) {
    const d = cache[name];
    if (!idx[name] || idx[name].d !== d) idx[name] = { d, m: new Map(d && Array.isArray(d[key]) ? d[key].map(x => [x.sym, x]) : []) };
    return idx[name].m;
  }
  // höchstens alle 5 Minuten neu nachsehen (für Live-Aktualisierung)
  const refresh = () => Promise.all(Object.keys(SRC).filter(n => n in cache && Date.now() - (fetched[n] || 0) > 5 * 60 * 1000).map(n => load(n, true)));
  window.DTD.shared = {
    load, refresh,
    get: name => (name in cache ? cache[name] : null),
    all: () => Promise.all(Object.keys(SRC).map(n => load(n))),
    item: sym => index("stocks", "items").get(sym) || null,
    fund: sym => { const f = cache.fund; return f && f.items ? f.items[sym] || null : null; },
    setup: sym => index("swing", "setups").get(sym) || null,
  };
})();

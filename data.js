// ---------- Gemeinsame Daten für Merkliste, Gesamtnote, Vergleiche, Alarme und Startseite ----------
// Lädt jede Quelle einmal (die neueste von lokaler Datei und Daten-Zweig) und gibt sie an alle Bereiche weiter.
// stocks.json: Kennzahlen aus eToro-Tageskerzen, Analysten und Quartalszahlen (2× pro Börsentag)
// fund.json: Kennzahlen, Branche, Sitzland und Insider (nachts) · swing.json: Swing-Planer · firms.json: Theorie-Firmen
(() => {
  const RAW = "https://raw.githubusercontent.com/shg9d54y9j-langw/Anna-test/";
  const get = url => fetch(url, { cache: "no-store" }).then(r => (r.ok ? r.json() : null)).catch(() => null);
  const newest = l => l.filter(d => d && d.updated).sort((a, b) => new Date(b.updated) - new Date(a.updated))[0] || null;
  const SRC = {
    stocks: t => Promise.all([get(`data/stocks.json?t=${t}`), get(`${RAW}stock-data/stocks.json?t=${t}`)]).then(l => newest(l.filter(d => d && Array.isArray(d.items)))),
    fund: t => get(`${RAW}fund-data/fund.json?t=${t}`).then(d => (d && d.items ? d : null)),
    swing: t => Promise.all([get(`data/swing.json?t=${t}`), get(`${RAW}stock-data/swing.json?t=${t}`)]).then(l => newest(l.filter(d => d && Array.isArray(d.setups)))),
    firms: t => get(`data/firms.json?t=${t}`).then(d => (d && d.firms ? d : null)),
  };
  const cache = {}, pending = {}, fetched = {};
  function load(name, force = false) {
    if (!SRC[name]) return Promise.resolve(null);
    if (!force && name in cache) return Promise.resolve(cache[name]);
    // Aktien-Daten, die der Aktien-Check schon geladen hat, nicht noch einmal holen
    if (!force && name === "stocks" && window.DTD.stockData && window.DTD.stockData()) { cache.stocks = window.DTD.stockData(); return Promise.resolve(cache.stocks); }
    if (pending[name]) return pending[name];
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
  // höchstens alle 5 Minuten neu nachsehen (für Live-Aktualisierung)
  const refresh = () => Promise.all(Object.keys(SRC).filter(n => n in cache && Date.now() - (fetched[n] || 0) > 5 * 60 * 1000).map(n => load(n, true)));
  window.DTD.shared = {
    load, refresh,
    get: name => (name in cache ? cache[name] : null),
    all: () => Promise.all(Object.keys(SRC).map(n => load(n))),
    item: sym => { const s = cache.stocks; return s && Array.isArray(s.items) ? s.items.find(x => x.sym === sym) || null : null; },
    fund: sym => { const f = cache.fund; return f && f.items ? f.items[sym] || null : null; },
    setup: sym => { const w = cache.swing; return w && Array.isArray(w.setups) ? w.setups.find(s => s.sym === sym) || null : null; },
  };
})();

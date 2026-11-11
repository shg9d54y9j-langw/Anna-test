// Service Worker: schneller Start, App auf dem Home-Bildschirm und Offline-Ansicht.
// Immer zuerst das Netz – so kommen neue Versionen und Daten sofort. Nur ohne Netz antwortet der Zwischenspeicher mit dem
// zuletzt geladenen Stand (Seite, Skripte, Aktien-Daten, Nachrichten). TradingView und andere fremde Seiten bleiben unberührt.
const CACHE = "rojko-v1";
const CORE = ["./", "index.html", "style.css", "manifest.webmanifest", "icons/icon-192.png", "icons/icon.svg", "fonts/inter-latin-wght-normal.woff2",
  "theme.js", "app.js", "data.js", "glossary.js", "score.js", "bilanz.js", "watch.js", "peers.js", "vergleich.js", "sectors.js", "alerts.js", "briefing.js", "neu.js", "layout.js", "home.js", "news.js", "econ.js",
  "stats.js", "compare.js", "daily.js", "overview.js", "cockpit.js", "knowledge.js", "backtest.js", "psych.js", "stock.js", "hot.js", "swing.js",
  "linechart.js", "verlauf.js", "portfolio.js", "journal-stats.js", "tools.js", "sparplan.js", "wealth.js", "bot.js", "live.js", "status.js", "quicksearch.js", "nav.js", "swipe.js", "login.js", "auth-hash.js", "pull.js"];
self.addEventListener("install", e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).catch(() => { /* einzelne Datei fehlt: Laufzeit-Speicher genügt */ }));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// Schlüssel ohne Zeitstempel (?t=…), damit der letzte Stand jeder Datei gefunden wird und der Speicher nicht wächst
const keyOf = req => { const u = new URL(req.url); return u.origin + u.pathname; };
// Netz zuerst, aber nicht endlos warten: Antwortet das Netz nicht binnen weniger Sekunden (schwaches Handynetz), kommt der
// gespeicherte Stand; fehlt der, wird weiter auf das Netz gewartet.
function networkFirst(req, ms, onCache) {
  return new Promise(resolve => {
    let done = false;
    const finish = (r, cached = false) => { if (!done) { done = true; if (cached && onCache) onCache(); resolve(r); } };
    const fallback = async () => (await caches.match(keyOf(req))) || (req.mode === "navigate"
      ? (await caches.match(new URL("./", self.registration.scope).href)) || (await caches.match(new URL("index.html", self.registration.scope).href)) : null);
    const timer = setTimeout(async () => { const hit = await fallback(); if (hit) finish(hit, true); }, ms);
    fetch(req).then(res => {
      clearTimeout(timer);
      if (res.ok && (res.type === "basic" || res.type === "cors")) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(keyOf(req), copy)).catch(() => {}); }
      finish(res);
    }).catch(async () => { clearTimeout(timer); const hit = await fallback(); finish(hit || Response.error(), !!hit); });
  });
}
// Kam die Seite selbst aus dem Speicher (Netz zu langsam oder weg), kommen auch ihre Skripte und Stile sofort von dort: gleiche
// Version wie die Seite (kein Gemisch aus alt und neu) und schneller Start. Im Hintergrund wird trotzdem nachgeladen.
const fromCacheClients = new Set();
function cacheFirst(req) {
  return caches.match(keyOf(req)).then(hit => {
    const net = fetch(req).then(res => { if (res.ok && res.type === "basic") { const copy = res.clone(); caches.open(CACHE).then(c => c.put(keyOf(req), copy)).catch(() => {}); } return res; });
    if (hit) { net.catch(() => {}); return hit; }
    return net;
  });
}
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const own = url.origin === self.location.origin, data = url.hostname === "raw.githubusercontent.com";
  if (!own && !data) return;
  if (req.mode === "navigate") {   // höchstens 2 s auf die Seite warten, dann der gespeicherte Stand
    const id = e.resultingClientId;
    e.respondWith(networkFirst(req, 2000, () => { if (id) { fromCacheClients.add(id); if (fromCacheClients.size > 50) fromCacheClients.delete(fromCacheClients.values().next().value); } }));
    return;
  }
  if (own && e.clientId && fromCacheClients.has(e.clientId)) { e.respondWith(cacheFirst(req)); return; }
  e.respondWith(networkFirst(req, data ? 6000 : 3500));
});

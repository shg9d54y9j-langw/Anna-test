// =====================================================================
// RojkoMoney – Grundfunktionen: Hilfsfunktionen, Reiter, Börsenzeiten,
// TradingView-Grafiken, Setup- und Copy-Rechner, Journal.
// =====================================================================

// ---------- Hilfsfunktionen (auch von compare.js, daily.js, overview.js genutzt) ----------
const $ = id => document.getElementById(id);
// Farben für Diagramme und Widgets (gleiche Werte wie in style.css; Reihenfarben gegen die schwarze Fläche geprüft)
// Grün und Rot nur für Gewinn und Verlust; Linien sonst in Weiß und Grau (unterschieden durch Strichart und Beschriftung)
const PAL = { up: "#1ed760", down: "#ff4545", surface: "#070707", series1: "#f2f2f2", series2: "#9a9a9a", gray: "#6a6a6a", ink: "#f2f2f2" };
const fmt = (n, d = 2) => (Number.isFinite(n) ? n.toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d }) : "–");
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const kpi = (lbl, val, cls = "") => `<div class="kpi"><div class="lbl">${lbl}</div><div class="val ${cls}">${val}</div></div>`;
const v = x => `<span class="v">${x}</span>`;
const warnBox = list => list.map(w => `<div class="warn">⚠ ${w}</div>`).join("");
const store = {
  get(k, d = null) { try { const x = localStorage.getItem(k); return x === null ? d : JSON.parse(x); } catch { return d; } },
  set(k, val) { try { localStorage.setItem(k, JSON.stringify(val)); } catch {} },
};
window.DTD = window.DTD || {};

// ---------- Sortierbare Tabellen ----------
// cols: [{ key, label, get: row => wert, num: true|false, title?, sortable? }]
// Klick auf die Überschrift: Zahlen zuerst von hoch nach niedrig, Text zuerst A–Z; zweiter Klick dreht um.
function sortHead(cols, state) {
  return `<tr>${cols.map(c => {
    const cls = c.num ? ' class="num"' : "";
    const title = c.title ? ` title="${esc(c.title)}"` : "";
    if (c.sortable === false) return `<th${cls}${title}>${c.label}</th>`;
    const active = state.key === c.key;
    const aria = active ? ` aria-sort="${state.dir === "asc" ? "ascending" : "descending"}"` : "";
    const arrow = active ? (state.dir === "asc" ? "▲" : "▼") : "↕";
    return `<th${cls}${title}${aria}><button type="button" class="th-sort" data-key="${c.key}">${c.label}<span class="arrow" aria-hidden="true">${arrow}</span></button></th>`;
  }).join("")}</tr>`;
}
function sortRows(rows, cols, state) {
  const col = cols.find(c => c.key === state.key);
  if (!col) return rows;
  const dir = state.dir === "asc" ? 1 : -1;
  const empty = x => x === null || x === undefined || x === "" || (typeof x === "number" && Number.isNaN(x));
  return rows.map((r, i) => [r, i]).sort(([a, ia], [b, ib]) => {
    const x = col.get(a), y = col.get(b);
    if (empty(x) || empty(y)) return empty(x) && empty(y) ? ia - ib : empty(x) ? 1 : -1;   // leere Werte immer ans Ende
    if (x === y) return ia - ib;
    if (typeof x === "string" || typeof y === "string") return dir * String(x).localeCompare(String(y), "de", { sensitivity: "base", numeric: true });
    return dir * (x < y ? -1 : 1);
  }).map(([r]) => r);
}
function bindSort(thead, cols, state, onChange) {
  thead.addEventListener("click", e => {
    const b = e.target.closest(".th-sort");
    if (!b) return;
    const col = cols.find(c => c.key === b.dataset.key);
    if (!col) return;
    if (state.key === col.key) state.dir = state.dir === "asc" ? "desc" : "asc";
    else { state.key = col.key; state.dir = col.first || (col.num ? "desc" : "asc"); }
    onChange();
    const again = thead.querySelector(`.th-sort[data-key="${col.key}"]`);
    if (again) again.focus();
  });
}

// ---------- Hinweise (Toasts) und Detail-Fenster ----------
function toast(title, text, ms = 9000) {
  const t = document.createElement("div");
  t.className = "toast";
  const b = document.createElement("b");
  b.textContent = title;
  t.append(b, document.createTextNode(text));
  $("toasts").append(t);
  setTimeout(() => t.remove(), ms);
}
let drawerReturn = null;
function openDrawer(title, html, after) {
  drawerReturn = document.activeElement;
  $("drawerTitle").textContent = title;
  $("drawerBody").innerHTML = html;
  $("drawer").hidden = false;
  $("drawerBackdrop").hidden = false;
  document.body.style.overflow = "hidden";
  $("drawerClose").focus();
  if (after) requestAnimationFrame(after);
}
function closeDrawer() {
  if ($("drawer").hidden) return;
  $("drawer").hidden = true;
  $("drawerBackdrop").hidden = true;
  document.body.style.overflow = "";
  if (drawerReturn && drawerReturn.focus) drawerReturn.focus();
}
$("drawerClose").addEventListener("click", closeDrawer);
$("drawerBackdrop").addEventListener("click", closeDrawer);
document.addEventListener("keydown", e => { if (e.key === "Escape") closeDrawer(); });

// ---------- TradingView-Grafiken (werden erst geladen, wenn ihr Reiter geöffnet wird) ----------
function tvWidget(containerId, script, config) {
  const host = $(containerId);
  host.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "tradingview-widget-container";
  wrap.style.height = "100%";
  const inner = document.createElement("div");
  inner.className = "tradingview-widget-container__widget";
  inner.style.height = "100%";
  wrap.appendChild(inner);
  const s = document.createElement("script");
  s.src = `https://s3.tradingview.com/external-embedding/embed-widget-${script}.js`;
  s.async = true;
  s.textContent = JSON.stringify(config);
  wrap.appendChild(s);
  host.appendChild(wrap);
}
const COMMON = { colorTheme: "dark", isTransparent: true, locale: "de_DE" };

// Großes Kursdiagramm einer Aktie: Tageskerzen der letzten 12 Monate (für Aktien-Check, Portfolio und Swing-Planer)
function bigChart(containerId, symbol) {
  tvWidget(containerId, "advanced-chart", {
    ...COMMON, isTransparent: false, backgroundColor: "#000000", gridColor: "rgba(255,255,255,0.06)", autosize: true, symbol,
    interval: "D", range: "12M", timezone: "Europe/Berlin", style: "1", allow_symbol_change: false, hide_side_toolbar: true, save_image: false,
  });
}
// Kurs-Leiter: die wichtigen Marken einer Aktie auf einer gemeinsamen Skala, mit Abstand zum Kurs.
// rows: [{ label, v, kind: "now" | "avg" | "buy" | "stop" | "target" | "range", from }] – from: Kaufpreis für die Gewinn-/Verlust-Strecke
function levelLadder(rows, caption = "") {
  const pts = rows.filter(r => r && Number.isFinite(r.v) && r.v > 0);
  const now = pts.find(r => r.kind === "now");
  if (pts.length < 3 || !now) return "";
  let lo = Math.min(...pts.map(r => r.v)), hi = Math.max(...pts.map(r => r.v));
  const pad = (hi - lo) * 0.05 || hi * 0.02;
  lo -= pad; hi += pad;
  const X = v => ((v - lo) / (hi - lo) * 100).toFixed(2);
  const pr = v => (v >= 1000 ? fmt(v, 0) : v >= 1 ? fmt(v, 2) : fmt(v, 4));
  const pct = v => `${v > 0 ? "+" : ""}${fmt(v, 1)} %`;
  const guide = `<i class="lad-guide" style="left:${X(now.v)}%"></i>`;
  const rowsHtml = [...pts].sort((a, b) => b.v - a.v || (a.kind === "now" ? -1 : 1)).map(r => {
    const seg = r.kind === "now" && Number.isFinite(r.from) && r.from > 0
      ? `<i class="lad-seg ${now.v >= r.from ? "up" : "down"}" style="left:${X(Math.min(r.from, now.v))}%;width:${(Math.abs(now.v - r.from) / (hi - lo) * 100).toFixed(2)}%"></i>` : "";
    const dist = r.kind === "now" ? (Number.isFinite(r.from) && r.from > 0 ? `<small class="${now.v >= r.from ? "up" : "down"}">${pct((now.v / r.from - 1) * 100)}<span class="lad-x"> seit Kauf</span></small>` : "")
      : `<small>${pct((r.v / now.v - 1) * 100)}</small>`;
    return `<div class="lad-row ${r.kind || ""}"><span class="lad-label">${r.label}</span><span class="lad-val"><b class="num">${pr(r.v)}</b>${dist}</span><span class="lad-track">${guide}${seg}<b class="lad-dot" style="left:${X(r.v)}%"></b></span></div>`;
  }).join("");
  const aria = pts.map(r => `${r.label} ${pr(r.v)}`).join(", ");
  return `<div class="ladder" role="img" aria-label="Kurs-Leiter: ${aria}">${caption ? `<p class="lad-cap">${caption}</p>` : ""}${rowsHtml}</div>`;
}
window.DTD.bigChart = bigChart;
window.DTD.levelLadder = levelLadder;

// Einstellbares Kursdiagramm (TradingView tv.js): Kerzen oder Linie, Tageskerzen, wählbare Linien und Kennzahlen.
// studies: Einträge wie "RSI@tv-basicstudies" oder { id: "MASimple@tv-basicstudies", inputs: { length: 50 } }
let tvLib = null;
function loadTvLib() {
  if (window.TradingView && window.TradingView.widget) return Promise.resolve(window.TradingView);
  if (!tvLib) {
    tvLib = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://s3.tradingview.com/tv.js";
      s.async = true;
      s.onload = () => (window.TradingView && window.TradingView.widget ? resolve(window.TradingView) : reject(new Error("tv.js ohne Widget")));
      s.onerror = () => reject(new Error("tv.js nicht geladen"));
      document.head.append(s);
    }).catch(e => { tvLib = null; throw e; });
  }
  return tvLib;
}
function tvChart(containerId, symbol, { style = "1", studies = [], hideVolume = false, compact = false } = {}) {
  const host = $(containerId);
  if (!host) return;
  const inner = `${containerId}-tv`;
  host.innerHTML = `<div id="${inner}" style="height:100%"></div>`;
  loadTvLib().then(TV => {
    if (!document.getElementById(inner)) return;   // inzwischen neu gezeichnet
    new TV.widget({
      container_id: inner, autosize: true, symbol, interval: "D", range: "12M", timezone: "Europe/Vienna", theme: "dark", style, locale: "de_DE",
      toolbar_bg: "#000000", backgroundColor: "#000000", gridColor: "rgba(255,255,255,0.06)", enable_publishing: false, allow_symbol_change: false,
      withdateranges: false, hide_side_toolbar: compact, hide_top_toolbar: false, hide_legend: false, save_image: false, details: false,
      hide_volume: hideVolume, studies,
    });
  }).catch(() => {
    host.innerHTML = `<p class="muted small" style="padding:16px">Das Diagramm von TradingView ließ sich nicht laden. <a href="https://www.tradingview.com/chart/?symbol=${encodeURIComponent(symbol)}" target="_blank" rel="noopener noreferrer">Bei TradingView öffnen ↗</a></p>`;
  });
}
window.DTD.tvChart = tvChart;

// ---------- Aktie öffnen: jedes Element mit data-open="KÜRZEL" führt in jedem Bereich zum Aktien-Check ----------
document.addEventListener("click", e => {
  const b = e.target.closest("[data-open]");
  if (!b || !b.dataset.open) return;
  e.preventDefault();
  closeDrawer();   // aus einer Erklärung heraus: Fenster schließen, dann zur Aktie
  if (window.DTD.openStock) window.DTD.openStock(b.dataset.open);
});

// ---------- Vorschläge beim Tippen (Aktien-Suche, Portfolio, Kursalarme) ----------
// Treffer nach Güte: Kürzel genau, Kürzel beginnt so, Name beginnt so, ein Wort im Namen beginnt so, enthält – sonst nach Beliebtheit
const normText = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
function matchStocks(items, query, max = 8) {
  const q = normText(query).trim();
  if (!q || !Array.isArray(items)) return [];
  const out = [];
  items.forEach((x, i) => {
    const s = normText(x.sym), n = normText(x.name), base = s.split(".")[0];
    const r = s === q || base === q ? 0 : s.startsWith(q) ? 1 : n.startsWith(q) ? 2 : n.split(/[\s\-.&,/()]+/).some(w => w.startsWith(q)) ? 3 : s.includes(q) ? 4 : n.includes(q) ? 5 : -1;
    if (r >= 0) out.push({ x, r, i });
  });
  return out.sort((a, b) => a.r - b.r || a.i - b.i).slice(0, max).map(o => o.x);
}
// input: das Eingabefeld; source(text) liefert Einträge { sym, name, type?, last?, chg1d? }; onPick(sym) nach der Auswahl.
// emptyTitle: Überschrift, wenn das Feld leer ist (dann liefert source("") z. B. die zuletzt angesehenen Werte).
function attachSuggest(input, { source, onPick, emptyTitle = "" }) {
  if (!input || input.dataset.suggest) return;
  input.dataset.suggest = "1";
  input.removeAttribute("list");
  input.setAttribute("autocomplete", "off");
  const wrap = document.createElement("span");
  wrap.className = "suggest-wrap";
  input.before(wrap);
  wrap.append(input);
  const box = document.createElement("div");
  box.className = "suggest";
  box.id = `${input.id || "in"}-vorschlaege`;
  box.setAttribute("role", "listbox");
  box.hidden = true;
  wrap.append(box);
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-controls", box.id);
  input.setAttribute("aria-expanded", "false");
  let list = [], active = -1;
  const price = v => (!Number.isFinite(v) ? "" : v >= 1000 ? fmt(v, 0) : v >= 1 ? fmt(v, 2) : fmt(v, 4));
  const close = () => { box.hidden = true; active = -1; input.setAttribute("aria-expanded", "false"); input.removeAttribute("aria-activedescendant"); };
  const mark = () => {
    box.querySelectorAll(".sugg-opt").forEach((o, i) => { const on = i === active; o.classList.toggle("on", on); o.setAttribute("aria-selected", String(on)); if (on) o.scrollIntoView({ block: "nearest" }); });
    if (active >= 0) input.setAttribute("aria-activedescendant", `${box.id}-${active}`); else input.removeAttribute("aria-activedescendant");
  };
  const update = () => {
    const text = input.value.trim();
    list = source(text) || [];
    if (!list.length) return close();
    box.innerHTML = (!text && emptyTitle ? `<p class="sugg-title">${esc(emptyTitle)}</p>` : "") + list.map((x, i) => `<div class="sugg-opt" role="option" id="${box.id}-${i}" data-i="${i}" aria-selected="false">
        <b class="sugg-sym">${esc(x.sym)}</b><span class="sugg-name">${esc(x.name || "")}</span>
        <span class="sugg-meta">${x.type ? esc(x.type) : ""}${Number.isFinite(x.last) ? ` · ${price(x.last)}` : ""}${Number.isFinite(x.chg1d) ? ` <span class="${x.chg1d < 0 ? "down" : "up"}">${x.chg1d > 0 ? "+" : ""}${fmt(x.chg1d, 1)} %</span>` : ""}</span></div>`).join("");
    active = -1;
    box.hidden = false;
    input.setAttribute("aria-expanded", "true");
  };
  const pick = i => { const x = list[i]; if (!x) return; input.value = x.sym; close(); onPick(x.sym); };
  input.addEventListener("input", update);
  input.addEventListener("focus", () => { if (!input.value.trim()) update(); });   // leeres Feld: z. B. zuletzt angesehen
  input.addEventListener("blur", () => setTimeout(close, 150));
  input.addEventListener("keydown", e => {
    if (box.hidden) { if (e.key === "ArrowDown") { update(); e.preventDefault(); } return; }
    if (e.key === "ArrowDown") { active = Math.min(list.length - 1, active + 1); mark(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { active = Math.max(-1, active - 1); mark(); e.preventDefault(); }
    else if (e.key === "Enter" && active >= 0) { e.preventDefault(); pick(active); }
    else if (e.key === "Escape") { close(); e.preventDefault(); }
    else if (e.key === "Tab") close();
  });
  box.addEventListener("mousedown", e => e.preventDefault());   // Fokus im Feld lassen, sonst schließt die Liste vor dem Klick
  // preventDefault: steht das Feld in einem <label>, würde der Klick sonst den Fokus zurück ins Feld holen
  box.addEventListener("click", e => { e.preventDefault(); const o = e.target.closest(".sugg-opt"); if (o) pick(+o.dataset.i); });
}
window.DTD.matchStocks = matchStocks;
window.DTD.attachSuggest = attachSuggest;

tvWidget("tickerTape", "ticker-tape", {
  ...COMMON,
  symbols: [
    { proName: "FOREXCOM:SPXUSD", title: "S&P 500" },
    { proName: "FOREXCOM:NSXUSD", title: "Nasdaq 100" },
    { proName: "XETR:DAX", title: "DAX" },
    { proName: "TVC:VIX", title: "VIX" },
    { proName: "FX:EURUSD", title: "EUR/USD" },
    { proName: "TVC:GOLD", title: "Gold" },
    { proName: "BITSTAMP:BTCUSD", title: "Bitcoin" },
  ],
  showSymbolLogo: true,
  displayMode: "adaptive",
});

const heatSel = $("heatmapSource");
function loadHeatmap(source) {
  tvWidget("heatmapWidget", "stock-heatmap", {
    ...COMMON, exchanges: [], dataSource: source, grouping: "sector", blockSize: "market_cap_basic", blockColor: "change",
    hasTopBar: true, isDataSetEnabled: true, isZoomEnabled: true, hasSymbolTooltip: true, isMonoSize: false, width: "100%", height: "100%",
  });
}
heatSel.addEventListener("change", () => loadHeatmap(heatSel.value));
const loadHotlist = () => tvWidget("hotlistWidget", "hotlists", { ...COMMON, dateRange: "1D", exchange: "US", showChart: true, showSymbolLogo: true, showFloatingTooltip: false, width: "100%", height: "100%" });
const loadNews = () => tvWidget("newsWidget", "timeline", { ...COMMON, feedMode: "market", market: "stock", displayMode: "regular", width: "100%", height: "100%" });
const loadCalendar = () => tvWidget("calendarWidget", "events", { ...COMMON, importanceFilter: "0,1", countryFilter: "us,eu,de", width: "100%", height: "100%" });

const symIn = $("symbolInput");
function loadSymbol(sym) {
  tvWidget("chartWidget", "advanced-chart", {
    ...COMMON, isTransparent: false, backgroundColor: "#000000", gridColor: "rgba(255,255,255,0.06)", autosize: true, symbol: sym, interval: "15",
    timezone: "Europe/Berlin", style: "1", studies: ["STD;VWAP", "STD;Average_True_Range"], allow_symbol_change: true, hide_side_toolbar: false,
  });
  tvWidget("taWidget", "technical-analysis", { ...COMMON, interval: "15m", symbol: sym, showIntervalTabs: true, displayMode: "single", width: "100%", height: "100%" });
}
$("symbolBtn").addEventListener("click", () => loadSymbol(symIn.value.trim().toUpperCase()));
symIn.addEventListener("keydown", e => { if (e.key === "Enter") loadSymbol(symIn.value.trim().toUpperCase()); });

// ---------- Reiter-Navigation ----------
// Zusammengelegt: News → Markt, Journal (mit Steuer) → Portfolio, Copy-Trading und Trader-Vergleich → „daily“ (Reiter Copy-Trading).
// Alte Adressen wie #news, #journal, #copy, #compare springen zum Abschnitt im neuen Bereich.
const VIEWS = ["home", "portfolio", "markt", "aktie", "tools", "ideen", "hot", "swing", "bot", "setup", "daily", "theorie"];
const TITLES = { home: "Übersicht", portfolio: "Portfolio", markt: "Markt", aktie: "Aktien-Check", tools: "Werkzeuge", ideen: "Trade-Ideen", hot: "HotStuff", swing: "Swing-Planer", bot: "Trend-Bot", setup: "Trade-Setup", daily: "Copy-Trading", theorie: "Theorie" };
// Erst laden, wenn der Abschnitt in die Nähe kommt (TradingView-Fenster sind schwer)
function whenNear(el, fn) {
  if (!el || !("IntersectionObserver" in window)) return fn();
  const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { io.disconnect(); fn(); } }, { rootMargin: "900px 0px" });
  io.observe(el);
}
const VIEW_INIT = {
  portfolio: () => { window.DTD.startPortfolio(); window.DTD.renderWatch(); },
  markt: () => { loadHeatmap(heatSel.value); loadHotlist(); window.DTD.loadMarketLive(); whenNear($("news"), () => { loadNews(); loadCalendar(); if (window.DTD.startNews) window.DTD.startNews(); }); },
  aktie: () => window.DTD.startStock(),
  tools: () => window.DTD.startTools(),
  ideen: () => window.DTD.renderIdeas(),
  hot: () => window.DTD.startHot(),
  swing: () => window.DTD.startSwing(),
  bot: () => window.DTD.startBot(),
  setup: () => loadSymbol(symIn.value.trim().toUpperCase()),
  daily: () => window.DTD.startBacktest(),
  theorie: () => window.DTD.renderTheory(),
};
const initialized = new Set();
function showView(id, { scrollTo = null } = {}) {
  if (!VIEWS.includes(id)) id = "home";
  for (const name of VIEWS) {
    const on = name === id;
    $(name).hidden = !on;
    const tab = $(`tab-${name}`);
    tab.setAttribute("aria-selected", String(on));
    tab.tabIndex = on ? 0 : -1;
  }
  store.set("dtd-tab", id);
  document.title = `${TITLES[id]} · RojkoMoney`;
  window.dispatchEvent(new CustomEvent("dtd:view", { detail: id }));
  if (!initialized.has(id)) { initialized.add(id); if (VIEW_INIT[id]) VIEW_INIT[id](); }
  // Diagramme kennen ihre Breite erst, wenn der Bereich sichtbar ist
  requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
  $(`tab-${id}`).scrollIntoView({ block: "nearest", inline: "nearest" });
  if (scrollTo && $(scrollTo)) jumpTo($(scrollTo));
  else if (scrollTo) waitAndJump(scrollTo);
  else window.scrollTo({ top: 0 });
}
// Abschnitte, die erst beim ersten Öffnen ihres Bereichs entstehen (Werkzeuge, Portfolio): kurz warten, dann springen
const LAZY = { vergleich: "tools", screener: "tools", branchen: "tools", lexikon: "tools", kalender: "tools", pfTax: "portfolio", hinweise: "home" };
function waitAndJump(id, tries = 50) {
  if ($(id)) return jumpTo($(id));
  if (tries > 0) setTimeout(() => waitAndJump(id, tries - 1), 100);
}
// Sprung zu einem Abschnitt: Inhalte darüber laden oft noch nach und schieben ihn weg – bis zu 3 Sekunden nachführen,
// aber sofort aufhören, sobald der Besucher selbst scrollt oder tippt.
function jumpTo(el) {
  const evs = ["wheel", "touchstart", "keydown", "pointerdown"];
  let ro = null, done = false;
  const go = () => { if (!done) el.scrollIntoView({ block: "start" }); };
  const stop = () => { done = true; if (ro) ro.disconnect(); evs.forEach(t => window.removeEventListener(t, stop, true)); };
  evs.forEach(t => window.addEventListener(t, stop, { capture: true, passive: true }));
  const view = el.closest(".view");
  if ("ResizeObserver" in window && view) { ro = new ResizeObserver(go); ro.observe(view); }
  go();
  setTimeout(stop, 3000);
}
// Beim Öffnen springt der Browser sonst zum Anker (#home …) und schiebt Kopfzeile mit Logo und Live-Uhr aus dem Bild
window.addEventListener("load", () => { const h = decodeURIComponent(location.hash.slice(1)); if (!h || VIEWS.includes(h)) setTimeout(() => window.scrollTo(0, 0), 0); });
function route() {
  const h = decodeURIComponent(location.hash.slice(1));
  if (VIEWS.includes(h)) return showView(h);
  const el = h && document.getElementById(h);
  const view = el && el.closest(".view");
  if (view) return showView(view.id, { scrollTo: h });
  if (LAZY[h]) return showView(LAZY[h], { scrollTo: h });
  // gespeicherter Reiter von früher (z. B. „journal“) → der Bereich, in dem er jetzt steckt
  const saved = store.get("dtd-tab", "home"), home = !VIEWS.includes(saved) && document.getElementById(saved);
  showView(home && home.closest(".view") ? home.closest(".view").id : saved);
}
document.querySelector(".tabs").addEventListener("click", e => {
  const tab = e.target.closest(".tab");
  if (!tab) return;
  if (location.hash === `#${tab.dataset.tab}`) showView(tab.dataset.tab);
  else location.hash = tab.dataset.tab;
});
document.querySelector(".tabs").addEventListener("keydown", e => {
  const i = VIEWS.indexOf(document.activeElement.dataset.tab);
  if (i < 0) return;
  const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: VIEWS.length - 1 }[e.key];
  if (next === undefined) return;
  e.preventDefault();
  const id = VIEWS[(next + VIEWS.length) % VIEWS.length];
  location.hash = id;
  $(`tab-${id}`).focus();
});
window.addEventListener("hashchange", route);

// ---------- Börsenzeiten mit Countdown (ohne Feiertage) ----------
const MARKETS = [
  { name: "Xetra", tz: "Europe/Berlin", open: [9, 0], close: [17, 30] },
  { name: "NYSE", tz: "America/New_York", open: [9, 30], close: [16, 0] },
];
function tzParts(tz, d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric", weekday: "short",
  }).formatToParts(d).map(x => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, H: +p.hour % 24, M: +p.minute, S: +p.second, wd: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday) };
}
function marketState(mk, now = new Date()) {
  const t = tzParts(mk.tz, now);
  const nowL = Date.UTC(t.y, t.m - 1, t.d, t.H, t.M, t.S);
  const at = (off, [h, mi]) => Date.UTC(t.y, t.m - 1, t.d + off, h, mi);
  const weekday = off => { const wd = (t.wd + off) % 7; return wd >= 1 && wd <= 5; };
  if (weekday(0) && nowL >= at(0, mk.open) && nowL < at(0, mk.close)) return { open: true, ms: at(0, mk.close) - nowL };
  for (let off = 0; off < 8; off++) if (weekday(off) && at(off, mk.open) > nowL) return { open: false, ms: at(off, mk.open) - nowL };
  return { open: false, ms: NaN };
}
function duration(ms) {
  const m = Math.max(0, Math.round(ms / 6e4)), h = Math.floor(m / 60);
  if (h >= 24) return `${Math.floor(h / 24)} T. ${h % 24} Std.`;
  return h ? `${h} Std. ${m % 60} Min.` : `${m} Min.`;
}
const marketsNow = () => MARKETS.map(mk => ({ ...mk, ...marketState(mk) }));
function renderSessions() {
  $("sessions").innerHTML = marketsNow().map(mk =>
    `<span class="pill"><span class="status-dot ${mk.open ? "open" : ""}"></span><b>${mk.name}</b> ${mk.open ? "offen" : "zu"}<span class="pill-x"> · ${mk.open ? "schließt" : "öffnet"} in ${duration(mk.ms)}</span></span>`).join("");
  window.dispatchEvent(new Event("dtd:clock"));
}
renderSessions();
setInterval(renderSessions, 1000);   // Börsenzeiten im Sekundentakt

// ---------- Setup-Rechner ----------
const STYLES = {
  scalp:    { stopAtr: 1.0, rr: 1.5 },
  momentum: { stopAtr: 1.5, rr: 2.0 },
  trend:    { stopAtr: 2.0, rr: 3.0 },
};

function calc() {
  const account = +$("cAccount").value, riskPct = +$("cRisk").value;
  const entry = +$("cEntry").value, atr = +$("cAtr").value;
  const long = $("cDir").value === "long";
  const cur = $("cCur").value;
  const lev = +$("cLev").value;
  const st = STYLES[$("cStyle").value];
  const P = n => fmt(n, Math.abs(entry) < 10 ? 4 : 2);  // Kurs
  const M = n => `${fmt(n)} ${cur}`;                       // Geldbetrag
  const sym = esc(symIn.value.split(":").pop().trim().toUpperCase() || "AAPL");

  const sign = long ? 1 : -1;
  const stopDist = atr * st.stopAtr;
  const stop = entry - sign * stopDist;
  const tp1 = entry + sign * stopDist;
  const tp2 = entry + sign * stopDist * st.rr;

  if (!(account > 0 && entry > 0 && atr > 0) || stop <= 0) {
    $("calcResult").innerHTML = warnBox(["Bitte Kontostand, Einstiegskurs und ATR eintragen (ATR kleiner als der Kurs)."]);
    $("etoroSteps").innerHTML = $("etoroFollow").innerHTML = "";
    return;
  }

  let qty = Math.floor(account * riskPct / 100 / stopDist);
  const maxQty = Math.floor(account * lev / entry);       // mehr erlaubt das Konto mit diesem Hebel nicht
  const capped = qty > maxQty;
  if (capped) qty = maxQty;
  const amount = qty * entry / lev;                       // eToro-Feld „Betrag“ = eigenes eingesetztes Geld
  const maxLoss = qty * stopDist;
  const gain = maxLoss * st.rr;
  const half = Math.floor(qty / 2);

  $("calcResult").innerHTML =
    kpi("Stop-Loss", P(stop), "down") +
    kpi("Teilgewinn (1R)", P(tp1), "up") +
    kpi(`Ziel (${String(st.rr).replace(".", ",")}R)`, P(tp2), "up") +
    kpi("Stückzahl", qty.toLocaleString("de-DE")) +
    kpi("Betrag in eToro", M(amount)) +
    kpi("Max. Verlust", M(maxLoss), "down") +
    kpi("Möglicher Gewinn", M(gain), "up");

  const warnings = [];
  if (qty === 0) warnings.push(`Bei diesem Kurs reicht das Konto nicht für 1 Stück – kleinere Aktie wählen.`);
  else if (capped) warnings.push(`Mit x${lev} reicht Ihr Konto nur für ${qty} Stück. Dadurch riskieren Sie nur ${M(maxLoss)} (${fmt(maxLoss / account * 100)} %) statt ${fmt(riskPct, 1)} %. Das ist in Ordnung – mehr Hebel ist für Einsteiger nicht empfohlen.`);
  if (riskPct > 2) warnings.push(`Mehr als 2 % Risiko pro Trade ist für Einsteiger sehr aggressiv.`);
  if (!long) warnings.push(`Short-Trades auf Aktien führt eToro immer als CFD (Differenzkontrakt), auch mit x1.`);
  if (lev > 1) warnings.push(`Mit Hebel handelt eToro einen CFD. Über Nacht kostet er Gebühren – auch deshalb vor Börsenschluss schließen.`);
  $("calcResult").innerHTML += warnBox(warnings);

  $("etoroSteps").innerHTML = qty === 0 ? "" : [
    `In eToro oben in die Suche ${v(sym)} eingeben, die Aktie öffnen und auf <b>„Trade“</b> (bzw. „Investieren“) tippen.`,
    `Oben <b>${long ? "„Kaufen“" : "„Verkaufen“"}</b> wählen.`,
    `Steht der Kurs gerade bei ${v(P(entry))}: direkt weiter. Sonst auf <b>„Order“</b> umschalten und als Kurs ${v(P(entry))} eintragen – eToro eröffnet den Trade dann erst bei diesem Kurs.`,
    `Den Schalter von „Betrag“ auf <b>„Einheiten“</b> stellen und ${v(qty)} eintragen. eToro zeigt dann einen Betrag von ca. ${M(amount)}.`,
    `<b>„Hebel“</b>: ${v("x" + lev)} wählen.`,
    `<b>„Stop-Loss“</b> antippen, auf Kurs umschalten und ${v(P(stop))} eintragen. eToro zeigt dann ca. −${M(maxLoss)}.`,
    `<b>„Take-Profit“</b> antippen, auf Kurs umschalten und ${v(P(tp2))} eintragen. eToro zeigt dann ca. +${M(gain)}.`,
    `Alles prüfen und auf <b>„Trade eröffnen“</b> (bzw. „Order setzen“) tippen.`,
  ].map(s => `<li>${s}</li>`).join("");

  $("etoroFollow").innerHTML = qty === 0 ? "" : [
    half > 0
      ? `Kurs erreicht ${v(P(tp1))}: unter <b>„Portfolio“</b> die Position antippen → <b>„Schließen“</b> → nur einen Teil schließen: ${v(half)} Einheiten. Danach die Position <b>bearbeiten</b> und den Stop-Loss auf ${v(P(entry))} (Einstiegskurs) setzen.`
      : `Kurs erreicht ${v(P(tp1))}: unter <b>„Portfolio“</b> die Position antippen, <b>bearbeiten</b> und den Stop-Loss auf ${v(P(entry))} (Einstiegskurs) setzen.`,
    `Wird der Stop-Loss erreicht, schließt eToro den Trade automatisch. Nicht sofort neu einsteigen – Tagesregeln beachten.`,
    `Spätestens um ${v("21:45 Uhr")} (US-Aktien) bzw. ${v("17:15 Uhr")} (deutsche Aktien) alles schließen: Position antippen → <b>„Schließen“</b>. eToro schließt zum Tagesende nicht von selbst.`,
  ].map(s => `<li>${s}</li>`).join("");
}
$("calc").addEventListener("input", calc);
symIn.addEventListener("input", calc);
calc();

// ---------- Copy-Rechner (eToro CopyTrader) ----------
function copyCalc() {
  const acc = +$("kAccount").value, share = +$("kShare").value, loss = +$("kLoss").value;
  const amount = Math.floor(acc * share / 100);
  const warnings = [];
  let csl = amount > 0 ? Math.floor(loss / amount * 100) : 0;
  if (csl < 5) {
    csl = 5;
    warnings.push(`eToro erlaubt mindestens 5 % Copy Stop Loss. Damit Ihr Verlust bei ${fmt(loss)} $ bleibt, höchstens ${fmt(Math.floor(loss / 0.05), 0)} $ kopieren.`);
  }
  if (csl > 95) { csl = 95; warnings.push(`Mehr als 95 % Copy Stop Loss sind bei eToro nicht möglich.`); }
  if (amount < 200) warnings.push(`eToro verlangt mindestens 200 $ pro kopiertem Trader – Anteil erhöhen oder Konto aufstocken.`);
  if (share > 20) warnings.push(`Mehr als 20 % des Kontos bei einem einzigen Trader ist riskant – lieber auf 2–3 Trader verteilen.`);
  const maxLoss = amount * csl / 100;

  $("copyResult").innerHTML =
    kpi("Betrag", `${fmt(amount, 0)} $`) +
    kpi("Copy Stop Loss", `${csl} %`, "down") +
    kpi("Max. Verlust", `${fmt(maxLoss)} $`, "down") +
    kpi("Offene Trades kopieren", "Ja") +
    warnBox(warnings);

  $("copySteps").innerHTML = [
    `Im Profil des Traders oben auf <b>„Kopieren“</b> tippen.`,
    `Feld <b>„Betrag“</b>: ${v(fmt(amount, 0) + " $")} eintragen.`,
    `<b>„Copy Stop Loss“</b> (steht beim Stop-Loss bzw. hinter dem Zahnrad, Standard 40 %) auf ${v(csl + " %")} stellen. Damit verlieren Sie mit dieser Kopie höchstens ca. ${fmt(maxLoss)} $.`,
    `Häkchen <b>„Offene Trades kopieren“</b>: ${v("anhaken")}. Nur so läuft Ihre Kopie wie die Zahlen, nach denen der Trader ausgewählt wurde – ohne Häkchen starten Sie mit leerem Portfolio und bekommen nur neue Trades.`,
    `Mit <b>„Kopieren“</b> bestätigen.`,
  ].map(s => `<li>${s}</li>`).join("");
}
$("copyCalc").addEventListener("input", copyCalc);
copyCalc();

// ---------- Trade-Journal (nur lokal im Browser) ----------
const J_KEY = "daytrade-journal-v1";
const DAY_LIMIT_PCT = 3, DAY_LIMIT_LOSSES = 3;   // Tagesregeln: −3 % des Kontos oder 3 Verlusttrades
const jCur = () => $("cCur").value || "$";
const pl = t => (t.out - t.in) * t.qty * (t.dir === "Short" ? -1 : 1);
const dayKey = d => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
function parseOldDate(s) {   // ältere Einträge: „04.11.26, 19:05“
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{2,4}),?\s*(\d{1,2}):(\d{2})/.exec(s || "");
  if (!m) return null;
  const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
  return new Date(y, +m[2] - 1, +m[1], +m[4], +m[5]).toISOString();
}
let journal = store.get(J_KEY, []).filter(t => t && typeof t === "object").map((t, i) => ({
  ...t, id: t.id || `j${Date.now().toString(36)}${i}`, ts: t.ts || parseOldDate(t.date) || new Date(0).toISOString(),
}));
const saveJ = () => store.set(J_KEY, journal);
const jState = { key: "ts", dir: "desc" };
const J_COLS = [
  { key: "ts", label: "Datum", get: t => t.ts },
  { key: "sym", label: "Symbol", get: t => t.sym },
  { key: "dir", label: "Richtung", get: t => t.dir },
  { key: "in", label: "Ein", num: true, get: t => t.in },
  { key: "out", label: "Aus", num: true, get: t => t.out },
  { key: "qty", label: "Stück", num: true, get: t => t.qty },
  { key: "pl", label: "Gewinn/Verlust", num: true, get: t => pl(t) },
  { key: "note", label: "Notiz", get: t => t.note || "" },
  { key: "del", label: "", sortable: false },
];
const account = () => { const x = parseFloat($("cAccount").value); return Number.isFinite(x) && x > 0 ? x : null; };

function journalSummary() {
  const today = dayKey(new Date());
  const todays = journal.filter(t => dayKey(new Date(t.ts)) === today);
  const todayPl = todays.reduce((s, t) => s + pl(t), 0);
  const losses = todays.filter(t => pl(t) < 0).length;
  const acc = account();
  const lossPct = acc && todayPl < 0 ? -todayPl / acc * 100 : 0;
  const usage = Math.max(lossPct / DAY_LIMIT_PCT, losses / DAY_LIMIT_LOSSES);
  const pls = journal.map(pl);
  const wins = pls.filter(p => p > 0).length;
  return {
    trades: todays.length, todayPl, losses, lossPct, usage, stop: usage >= 1, acc,
    total: pls.reduce((a, b) => a + b, 0), count: journal.length, winRate: journal.length ? wins / journal.length : null,
  };
}
window.DTD.journalSummary = journalSummary;

function limitHtml(s) {
  const pct = Math.min(100, Math.round(s.usage * 100));
  const cls = s.stop ? "stop" : s.usage >= 0.66 ? "warn-bar" : "";
  const text = s.stop
    ? `<b class="down">Tageslimit erreicht – heute nicht mehr handeln.</b>`
    : `Noch ${Math.max(0, DAY_LIMIT_LOSSES - s.losses)} Verlusttrade(s)${s.acc ? ` bzw. ${fmt(Math.max(0, DAY_LIMIT_PCT - s.lossPct), 1)} % des Kontos` : ""} bis zum Tageslimit.`;
  return `<div class="meter ${cls}"><span style="width:${pct}%"></span></div><p class="small muted">${text}</p>`;
}

function renderJ() {
  const s = journalSummary(), cur = jCur();
  $("jToday").innerHTML = `
    <article class="card ${s.stop ? "reco no" : ""}">
      <h2 class="card-title">Heute</h2>
      <div class="result" style="margin-top:0">
        ${kpi("Gewinn/Verlust heute", `${fmt(s.todayPl)} ${cur}`, s.todayPl < 0 ? "down" : s.todayPl > 0 ? "up" : "")}
        ${kpi("Trades heute", s.trades)}
        ${kpi("Verlusttrades heute", `${s.losses} / ${DAY_LIMIT_LOSSES}`, s.losses ? "down" : "")}
        ${kpi("Verlust in % vom Konto", s.acc ? `${fmt(s.lossPct, 1)} / ${DAY_LIMIT_PCT} %` : "–", s.lossPct ? "down" : "")}
      </div>
      ${limitHtml(s)}
      ${s.acc ? "" : `<p class="small muted">Kontostand im Trade-Setup eintragen, dann wird auch das Limit in Prozent geprüft.</p>`}
    </article>`;

  const thead = $("jTable").querySelector("thead");
  thead.innerHTML = sortHead(J_COLS, jState);
  $("jTable").querySelector("tbody").innerHTML = sortRows(journal, J_COLS, jState).map(t => {
    const p = pl(t);
    const when = new Date(t.ts).getTime() ? new Date(t.ts).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }) : esc(t.date || "–");
    return `<tr><td>${when}</td><td>${/^[A-Z0-9][A-Z0-9.\-_:]{0,24}$/.test(String(t.sym || "")) ? `<button type="button" class="name-link" data-open="${esc(t.sym)}">${esc(t.sym)}</button>` : esc(t.sym)}</td><td>${t.dir === "Short" ? "Short" : "Long"}</td><td class="num">${fmt(t.in)}</td><td class="num">${fmt(t.out)}</td>
      <td class="num">${fmt(t.qty, 0)}</td><td class="num ${p >= 0 ? "up" : "down"}">${fmt(p)} ${cur}</td><td>${esc(t.note || "")}</td>
      <td class="actions"><button type="button" data-del="${esc(t.id)}" title="Löschen" aria-label="Trade löschen">✕</button></td></tr>`;
  }).join("") || `<tr><td colspan="9" class="muted">Noch keine Trades eingetragen.</td></tr>`;

  const pls = journal.map(pl);
  const wins = pls.filter(p => p > 0), losses = pls.filter(p => p < 0);
  const sum = a => a.reduce((x, y) => x + y, 0);
  const pf = losses.length ? sum(wins) / Math.abs(sum(losses)) : null;
  $("jStats").innerHTML =
    kpi("Trades gesamt", journal.length) +
    kpi("Trefferquote", journal.length ? `${fmt(wins.length / journal.length * 100, 0)} %` : "–") +
    kpi("Gesamt", `${fmt(s.total)} ${cur}`, s.total >= 0 ? "up" : "down") +
    kpi("Ø Gewinn", wins.length ? `${fmt(sum(wins) / wins.length)} ${cur}` : "–", "up") +
    kpi("Ø Verlust", losses.length ? `${fmt(sum(losses) / losses.length)} ${cur}` : "–", "down") +
    kpi("Profit-Faktor", pf === null ? "–" : fmt(pf), pf !== null && pf >= 1 ? "up" : "down");
  renderEquity();
  window.dispatchEvent(new Event("dtd:journal"));
}
bindSort($("jTable").querySelector("thead"), J_COLS, jState, renderJ);

// Verlaufskurve: aufsummierter Gewinn/Verlust in zeitlicher Reihenfolge
function renderEquity() {
  const host = $("jChart");
  if (!host || host.closest(".view").hidden) return;
  const trades = [...journal].sort((a, b) => a.ts.localeCompare(b.ts));
  if (trades.length < 2) { host.innerHTML = `<p class="muted">Ab zwei eingetragenen Trades erscheint hier die Verlaufskurve.</p>`; return; }
  let run = 0;
  const pts = [{ i: 0, y: 0, t: null }, ...trades.map((t, i) => ({ i: i + 1, y: (run += pl(t)), t }))];
  const W = Math.max(240, host.clientWidth), H = 220, m = { l: 64, r: 14, t: 12, b: 26 };
  const pw = W - m.l - m.r, ph = H - m.t - m.b;
  const ys = pts.map(p => p.y);
  const raw = (Math.max(0, ...ys) - Math.min(0, ...ys) || 1) / 4, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(s => s * mag).find(s => s >= raw);
  const lo = Math.floor(Math.min(0, ...ys) / step) * step, hi = Math.ceil(Math.max(0, ...ys) / step) * step;
  const ticks = [];
  for (let t = lo; t <= hi + step / 2; t += step) ticks.push(+t.toFixed(10));
  const X = i => m.l + i / (pts.length - 1) * pw, Y = y => m.t + (hi - y) / (hi - lo || 1) * ph;
  const cur = jCur(), last = pts[pts.length - 1].y, color = last >= 0 ? PAL.up : PAL.down;
  const line = pts.map((p, k) => `${k ? "L" : "M"}${X(p.i).toFixed(1)},${Y(p.y).toFixed(1)}`).join("");
  const area = `${line}L${X(pts.length - 1).toFixed(1)},${Y(0).toFixed(1)}L${X(0).toFixed(1)},${Y(0).toFixed(1)}Z`;
  host.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Verlauf des Gewinns über ${trades.length} Trades, zuletzt ${fmt(last)} ${cur}">
    ${ticks.map(t => `<line class="grid" x1="${m.l}" x2="${m.l + pw}" y1="${Y(t)}" y2="${Y(t)}"/><text class="tick" x="${m.l - 8}" y="${Y(t) + 4}" text-anchor="end">${fmt(t, 0)} ${cur}</text>`).join("")}
    <line class="base" x1="${m.l}" x2="${m.l + pw}" y1="${Y(0)}" y2="${Y(0)}"/>
    <path d="${area}" fill="${color}" opacity=".10"/>
    <path d="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>
    <circle cx="${X(pts.length - 1)}" cy="${Y(last)}" r="4.5" fill="${color}" stroke="${PAL.surface}" stroke-width="2"/>
    <text class="tick" x="${m.l}" y="${H - 6}">1. Trade</text><text class="tick" x="${m.l + pw}" y="${H - 6}" text-anchor="end">${trades.length}. Trade</text>
  </svg>`;
}
window.addEventListener("resize", () => { if (!$("portfolio").hidden) renderEquity(); });

$("jForm").addEventListener("submit", e => {
  e.preventDefault();
  const now = new Date();
  journal.push({
    id: `j${now.getTime().toString(36)}`, ts: now.toISOString(),
    date: now.toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }),
    sym: $("jSym").value.trim().toUpperCase(), dir: $("jDir").value,
    in: +$("jIn").value, out: +$("jOut").value, qty: +$("jQty").value, note: $("jNote").value.trim(),
  });
  saveJ(); renderJ(); e.target.reset();
  const s = journalSummary();
  if (s.stop) toast("Tageslimit erreicht", " Für heute nicht mehr handeln – so steht es in Ihren Tagesregeln.");
});
$("jTable").querySelector("tbody").addEventListener("click", e => {
  const b = e.target.closest("button[data-del]");
  if (!b) return;
  journal = journal.filter(t => t.id !== b.dataset.del);
  saveJ(); renderJ();
});
// CSV-Export (Semikolon und Dezimalkomma – passt für Excel auf Deutsch)
$("jExport").addEventListener("click", () => {
  const n = x => (Number.isFinite(x) ? String(x).replace(".", ",") : "");
  const q = s => `"${String(s ?? "").replace(/"/g, '""')}"`;
  const rows = [["Datum", "Symbol", "Richtung", "Einstieg", "Ausstieg", "Stück", "Gewinn/Verlust", "Notiz"]]
    .concat([...journal].sort((a, b) => a.ts.localeCompare(b.ts)).map(t => [new Date(t.ts).toLocaleString("de-DE"), t.sym, t.dir, n(t.in), n(t.out), n(t.qty), n(Math.round(pl(t) * 100) / 100), t.note]));
  const csv = "﻿" + rows.map(r => r.map(q).join(";")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = `journal-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});
$("cCur").addEventListener("change", renderJ);
$("cAccount").addEventListener("input", renderJ);
renderJ();

// Erst ganz am Ende: den passenden Reiter anzeigen
// Erst starten, wenn alle Skripte geladen sind (Cockpit, Wissen, Rückblick-Test, Psychologie-Check)
document.addEventListener("DOMContentLoaded", route);

// ---------- App-Modus: Service Worker (schneller Start, Offline-Ansicht) und Hinweis ohne Netz ----------
if ("serviceWorker" in navigator && (location.protocol === "https:" || /[?&]sw=1/.test(location.search))) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => { /* ohne Service Worker geht alles weiter */ }));
}
(() => {
  const bar = document.createElement("div");
  bar.className = "offline-bar";
  bar.setAttribute("role", "status");
  bar.textContent = "Offline – Sie sehen den zuletzt geladenen Stand. Kurse und Diagramme kommen zurück, sobald wieder Netz da ist.";
  bar.hidden = navigator.onLine !== false;
  document.body.append(bar);
  window.addEventListener("offline", () => { bar.hidden = false; });
  window.addEventListener("online", () => { bar.hidden = true; });
})();

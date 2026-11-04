// =====================================================================
// DayTrade Desk – Grundfunktionen: Hilfsfunktionen, Reiter, Börsenzeiten,
// TradingView-Grafiken, Setup- und Copy-Rechner, Journal.
// =====================================================================

// ---------- Hilfsfunktionen (auch von compare.js, daily.js, overview.js genutzt) ----------
const $ = id => document.getElementById(id);
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
    ...COMMON, isTransparent: false, backgroundColor: "#10151d", gridColor: "rgba(255,255,255,0.04)", autosize: true, symbol: sym, interval: "15",
    timezone: "Europe/Berlin", style: "1", studies: ["STD;VWAP", "STD;Average_True_Range"], allow_symbol_change: true, hide_side_toolbar: false,
  });
  tvWidget("taWidget", "technical-analysis", { ...COMMON, interval: "15m", symbol: sym, showIntervalTabs: true, displayMode: "single", width: "100%", height: "100%" });
}
$("symbolBtn").addEventListener("click", () => loadSymbol(symIn.value.trim().toUpperCase()));
symIn.addEventListener("keydown", e => { if (e.key === "Enter") loadSymbol(symIn.value.trim().toUpperCase()); });

// ---------- Reiter-Navigation ----------
const VIEWS = ["home", "markt", "news", "setup", "daily", "copy", "compare", "journal"];
const TITLES = { home: "Übersicht", markt: "Markt", news: "News", setup: "Trade-Setup", daily: "Tagesempfehlung", copy: "Copy-Trading", compare: "Trader-Vergleich", journal: "Journal" };
const VIEW_INIT = {
  markt: () => { loadHeatmap(heatSel.value); loadHotlist(); },
  news: () => { loadNews(); loadCalendar(); },
  setup: () => loadSymbol(symIn.value.trim().toUpperCase()),
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
  document.title = `${TITLES[id]} · DayTrade Desk`;
  if (!initialized.has(id)) { initialized.add(id); if (VIEW_INIT[id]) VIEW_INIT[id](); }
  // Diagramme kennen ihre Breite erst, wenn der Bereich sichtbar ist
  requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
  $(`tab-${id}`).scrollIntoView({ block: "nearest", inline: "nearest" });
  if (scrollTo && $(scrollTo)) $(scrollTo).scrollIntoView({ behavior: "smooth", block: "start" });
  else window.scrollTo({ top: 0 });
}
function route() {
  const h = decodeURIComponent(location.hash.slice(1));
  if (VIEWS.includes(h)) return showView(h);
  const el = h && document.getElementById(h);
  const view = el && el.closest(".view");
  if (view) return showView(view.id, { scrollTo: h });
  showView(store.get("dtd-tab", "home"));
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
    `<span class="pill"><span class="status-dot ${mk.open ? "open" : ""}"></span><b>${mk.name}</b> ${mk.open ? "offen" : "zu"} · ${mk.open ? "schließt" : "öffnet"} in ${duration(mk.ms)}</span>`).join("");
  window.dispatchEvent(new Event("dtd:clock"));
}
renderSessions();
setInterval(renderSessions, 30000);

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
    return `<tr><td>${when}</td><td>${esc(t.sym)}</td><td>${t.dir === "Short" ? "Short" : "Long"}</td><td class="num">${fmt(t.in)}</td><td class="num">${fmt(t.out)}</td>
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
  const W = Math.max(300, host.clientWidth), H = 220, m = { l: 64, r: 14, t: 12, b: 26 };
  const pw = W - m.l - m.r, ph = H - m.t - m.b;
  const ys = pts.map(p => p.y);
  const raw = (Math.max(0, ...ys) - Math.min(0, ...ys) || 1) / 4, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(s => s * mag).find(s => s >= raw);
  const lo = Math.floor(Math.min(0, ...ys) / step) * step, hi = Math.ceil(Math.max(0, ...ys) / step) * step;
  const ticks = [];
  for (let t = lo; t <= hi + step / 2; t += step) ticks.push(+t.toFixed(10));
  const X = i => m.l + i / (pts.length - 1) * pw, Y = y => m.t + (hi - y) / (hi - lo || 1) * ph;
  const cur = jCur(), last = pts[pts.length - 1].y, color = last >= 0 ? "#22c55e" : "#f05252";
  const line = pts.map((p, k) => `${k ? "L" : "M"}${X(p.i).toFixed(1)},${Y(p.y).toFixed(1)}`).join("");
  const area = `${line}L${X(pts.length - 1).toFixed(1)},${Y(0).toFixed(1)}L${X(0).toFixed(1)},${Y(0).toFixed(1)}Z`;
  host.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Verlauf des Gewinns über ${trades.length} Trades, zuletzt ${fmt(last)} ${cur}">
    ${ticks.map(t => `<line class="grid" x1="${m.l}" x2="${m.l + pw}" y1="${Y(t)}" y2="${Y(t)}"/><text class="tick" x="${m.l - 8}" y="${Y(t) + 4}" text-anchor="end">${fmt(t, 0)} ${cur}</text>`).join("")}
    <line class="base" x1="${m.l}" x2="${m.l + pw}" y1="${Y(0)}" y2="${Y(0)}"/>
    <path d="${area}" fill="${color}" opacity=".10"/>
    <path d="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>
    <circle cx="${X(pts.length - 1)}" cy="${Y(last)}" r="4.5" fill="${color}" stroke="#10151d" stroke-width="2"/>
    <text class="tick" x="${m.l}" y="${H - 6}">1. Trade</text><text class="tick" x="${m.l + pw}" y="${H - 6}" text-anchor="end">${trades.length}. Trade</text>
  </svg>`;
}
window.addEventListener("resize", () => { if (!$("journal").hidden) renderEquity(); });

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
route();

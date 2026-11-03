// ---------- TradingView-Widget-Helfer ----------
function tvWidget(containerId, script, config) {
  const host = document.getElementById(containerId);
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

// Ticker-Leiste
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

// Heatmap
function loadHeatmap(source) {
  tvWidget("heatmapWidget", "stock-heatmap", {
    ...COMMON,
    exchanges: [],
    dataSource: source,
    grouping: "sector",
    blockSize: "market_cap_basic",
    blockColor: "change",
    hasTopBar: true,
    isDataSetEnabled: true,
    isZoomEnabled: true,
    hasSymbolTooltip: true,
    isMonoSize: false,
    width: "100%",
    height: "100%",
  });
}
const heatSel = document.getElementById("heatmapSource");
heatSel.addEventListener("change", () => loadHeatmap(heatSel.value));
loadHeatmap(heatSel.value);

// News
tvWidget("newsWidget", "timeline", {
  ...COMMON,
  feedMode: "market",
  market: "stock",
  displayMode: "regular",
  width: "100%",
  height: "100%",
});

// Wirtschaftskalender
tvWidget("calendarWidget", "events", {
  ...COMMON,
  importanceFilter: "0,1",
  countryFilter: "us,eu,de",
  width: "100%",
  height: "100%",
});

// Chart + Technische Analyse für Symbol
function loadSymbol(sym) {
  tvWidget("chartWidget", "advanced-chart", {
    ...COMMON,
    isTransparent: false,
    autosize: true,
    symbol: sym,
    interval: "5",
    timezone: "Europe/Berlin",
    style: "1",
    studies: ["STD;VWAP", "STD;RSI"],
    allow_symbol_change: true,
    hide_side_toolbar: false,
  });
  tvWidget("taWidget", "technical-analysis", {
    ...COMMON,
    interval: "15m",
    symbol: sym,
    showIntervalTabs: true,
    displayMode: "single",
    width: "100%",
    height: "100%",
  });
}
const symIn = document.getElementById("symbolInput");
document.getElementById("symbolBtn").addEventListener("click", () => loadSymbol(symIn.value.trim().toUpperCase()));
symIn.addEventListener("keydown", e => { if (e.key === "Enter") loadSymbol(symIn.value.trim().toUpperCase()); });
loadSymbol(symIn.value);

// ---------- Marktuhr ----------
function marketStatus(tz, openH, openM, closeH, closeM) {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: tz }));
  const day = now.getDay();
  const mins = now.getHours() * 60 + now.getMinutes();
  return day >= 1 && day <= 5 && mins >= openH * 60 + openM && mins < closeH * 60 + closeM;
}
function updateClock() {
  const t = new Date().toLocaleTimeString("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" });
  const nyse = marketStatus("America/New_York", 9, 30, 16, 0);
  const xetra = marketStatus("Europe/Berlin", 9, 0, 17, 30);
  const tag = (name, open) => `${name} <span class="${open ? "open" : "closed"}">${open ? "offen" : "geschlossen"}</span>`;
  document.getElementById("marketClock").innerHTML = `${t} MEZ · ${tag("Xetra", xetra)} · ${tag("NYSE", nyse)}`;
}
updateClock();
setInterval(updateClock, 30000);

// ---------- Setup-Rechner ----------
const STYLES = {
  scalp:    { stopAtr: 1.0, rr: 1.5 },
  momentum: { stopAtr: 1.5, rr: 2.0 },
  trend:    { stopAtr: 2.0, rr: 3.0 },
};
const fmt = (n, d = 2) => Number.isFinite(n) ? n.toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d }) : "–";
const $ = id => document.getElementById(id);

function calc() {
  const account = +$("cAccount").value, riskPct = +$("cRisk").value;
  const entry = +$("cEntry").value, atr = +$("cAtr").value;
  const long = $("cDir").value === "long";
  const st = STYLES[$("cStyle").value];
  const stopDist = atr * st.stopAtr;
  const stop = long ? entry - stopDist : entry + stopDist;
  const tp1 = long ? entry + stopDist : entry - stopDist;
  const tp2 = long ? entry + stopDist * st.rr : entry - stopDist * st.rr;
  const riskEur = account * riskPct / 100;
  const qty = stopDist > 0 ? Math.floor(riskEur / stopDist) : 0;
  const posValue = qty * entry;
  const kpi = (lbl, val, cls = "") => `<div class="kpi"><div class="lbl">${lbl}</div><div class="val ${cls}">${val}</div></div>`;
  let html =
    kpi("Stop-Loss", fmt(stop), "down") +
    kpi("Teilgewinn (1R)", fmt(tp1), "up") +
    kpi(`Ziel (${st.rr}R)`, fmt(tp2), "up") +
    kpi("Stückzahl", qty.toLocaleString("de-DE")) +
    kpi("Positionswert", fmt(posValue) + " €") +
    kpi("Max. Verlust", fmt(qty * stopDist) + " €", "down") +
    kpi("Möglicher Gewinn", fmt(qty * stopDist * st.rr) + " €", "up");
  const warnings = [];
  if (posValue > account) warnings.push(`Positionswert übersteigt das Konto – nur mit Hebel möglich. Stop weiter oder Risiko kleiner wählen.`);
  if (riskPct > 2) warnings.push(`Mehr als 2 % Risiko pro Trade ist für Einsteiger sehr aggressiv.`);
  warnings.push(`Plan: Bei 1R die Hälfte schließen und Stop auf Einstand ziehen. Rest spätestens 15 Min. vor Börsenschluss schließen.`);
  html += warnings.map(w => `<div class="warn">⚠ ${w}</div>`).join("");
  $("calcResult").innerHTML = html;
}
$("calc").addEventListener("input", calc);
calc();

// ---------- Trade-Journal (localStorage) ----------
const KEY = "daytrade-journal-v1";
function loadJ() { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } }
function saveJ(list) { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch {} }
let journal = loadJ();

function pl(t) { return (t.out - t.in) * t.qty * (t.dir === "Short" ? -1 : 1); }
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function renderJ() {
  const tb = document.querySelector("#jTable tbody");
  tb.innerHTML = journal.map((t, i) => {
    const p = pl(t);
    return `<tr><td>${esc(t.date)}</td><td>${esc(t.sym)}</td><td>${t.dir}</td><td>${fmt(t.in)}</td><td>${fmt(t.out)}</td><td>${t.qty}</td>
      <td class="${p >= 0 ? "up" : "down"}">${fmt(p)} €</td><td>${esc(t.note)}</td><td><button data-i="${i}" title="Löschen">✕</button></td></tr>`;
  }).reverse().join("");
  const pls = journal.map(pl);
  const wins = pls.filter(p => p > 0), losses = pls.filter(p => p < 0);
  const total = pls.reduce((a, b) => a + b, 0);
  const avgW = wins.length ? wins.reduce((a, b) => a + b, 0) / wins.length : 0;
  const avgL = losses.length ? losses.reduce((a, b) => a + b, 0) / losses.length : 0;
  const k = (l, v, c = "") => `<div class="kpi"><div class="lbl">${l}</div><div class="val ${c}">${v}</div></div>`;
  $("jStats").innerHTML =
    k("Trades", journal.length) +
    k("Trefferquote", journal.length ? fmt(wins.length / journal.length * 100, 0) + " %" : "–") +
    k("Gesamt P/L", fmt(total) + " €", total >= 0 ? "up" : "down") +
    k("Ø Gewinn", fmt(avgW) + " €", "up") +
    k("Ø Verlust", fmt(avgL) + " €", "down");
}
$("jForm").addEventListener("submit", e => {
  e.preventDefault();
  journal.push({
    date: new Date().toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }),
    sym: $("jSym").value.toUpperCase(), dir: $("jDir").value,
    in: +$("jIn").value, out: +$("jOut").value, qty: +$("jQty").value, note: $("jNote").value,
  });
  saveJ(journal); renderJ(); e.target.reset();
});
document.querySelector("#jTable tbody").addEventListener("click", e => {
  const i = e.target.dataset.i;
  if (i !== undefined) { journal.splice(+i, 1); saveJ(journal); renderJ(); }
});
renderJ();

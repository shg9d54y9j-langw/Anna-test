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
    interval: "15",
    timezone: "Europe/Berlin",
    style: "1",
    studies: ["STD;VWAP", "STD;Average_True_Range"],
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
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const kpi = (lbl, val, cls = "") => `<div class="kpi"><div class="lbl">${lbl}</div><div class="val ${cls}">${val}</div></div>`;
const v = x => `<span class="v">${x}</span>`;
const warnBox = list => list.map(w => `<div class="warn">⚠ ${w}</div>`).join("");

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
    `Wird der Stop-Loss erreicht, schließt eToro den Trade automatisch. Nicht sofort neu einsteigen – Tagesregeln unten beachten.`,
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
    kpi("Offene Trades kopieren", "Nein") +
    warnBox(warnings);

  $("copySteps").innerHTML = [
    `Im Profil des Traders oben auf <b>„Kopieren“</b> tippen.`,
    `Feld <b>„Betrag“</b>: ${v(fmt(amount, 0) + " $")} eintragen.`,
    `<b>„Copy Stop Loss“</b> (steht beim Stop-Loss bzw. hinter dem Zahnrad, Standard 40 %) auf ${v(csl + " %")} stellen. Damit verlieren Sie mit dieser Kopie höchstens ca. ${fmt(maxLoss)} $.`,
    `Häkchen <b>„Offene Trades kopieren“</b>: ${v("nicht setzen")}. Sonst steigen Sie in schon laufende Trades zum aktuellen, oft schlechteren Kurs ein.`,
    `Mit <b>„Kopieren“</b> bestätigen.`,
  ].map(s => `<li>${s}</li>`).join("");
}
$("copyCalc").addEventListener("input", copyCalc);
copyCalc();

// ---------- Trade-Journal (localStorage) ----------
const KEY = "daytrade-journal-v1";
function loadJ() { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } }
function saveJ(list) { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch {} }
let journal = loadJ();

function pl(t) { return (t.out - t.in) * t.qty * (t.dir === "Short" ? -1 : 1); }

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

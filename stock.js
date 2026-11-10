// ---------- Aktien-Check ----------
// Symbol eingeben → Überblick, Termine, Experten & Nachrichten, Theorie & Faktoren, Kauf- und Verkaufsmarken.
// Kennzahlen aus data/stocks.json (täglich aus eToro-Tageskerzen), Live-Grafiken von TradingView für jedes Symbol.
// Suche mit Vorschlägen (Name oder Kürzel), Diagramm mit ein- und ausblendbaren Linien und Kennzahlen.
(() => {
  const RAW = "https://raw.githubusercontent.com/shg9d54y9j-langw/Anna-test/stock-data/stocks.json";
  const get = url => fetch(url, { cache: "no-store" }).then(r => (r.ok ? r.json() : null)).catch(() => null);
  const A = (url, text) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`;
  const DOI = (doi, text) => A(`https://doi.org/${doi}`, text);
  const sign = (x, d = 1) => (Number.isFinite(x) ? (x > 0 ? "+" : "") + fmt(x, d) : "–");
  const pctCell = (x, d = 1) => (Number.isFinite(x) ? `<span class="${x < 0 ? "down" : "up"}">${sign(x, d)} %</span>` : "–");
  const price = x => (!Number.isFinite(x) ? "–" : x >= 1000 ? fmt(x, 0) : x >= 10 ? fmt(x, 2) : fmt(x, 4));
  const COST = 0.3;   // geschätzte Kosten hin und zurück in % (Spread)
  let data = null, current = null, style = store.get("dtd-stock-style", "swing");
  const RECENT = "dtd-stock-recent";
  const recent = () => { const r = store.get(RECENT, []); return Array.isArray(r) ? r.filter(v => typeof v === "string").slice(0, 8) : []; };

  // ---------- Diagramm: Linien und Kennzahlen zum Ein- und Ausblenden ----------
  const avgOf = (x, d) => (Number.isFinite(x.last) && Number.isFinite(d) ? x.last / (1 + d / 100) : null);
  const MA = n => ({ id: "MASimple@tv-basicstudies", inputs: { length: n } });
  const IND = [
    { k: "ma20", group: "Linien", label: "Ø 20 Tage", study: MA(20), val: x => avgOf(x, x.d20), why: "kurzfristiger Trend – Rücksetzer bis hierher sind im Aufwärtstrend normal." },
    { k: "ma50", group: "Linien", label: "Ø 50 Tage", study: MA(50), val: x => avgOf(x, x.d50), why: "mittelfristiger Trend – hier beginnt die Kaufzone des Swing-Planers." },
    { k: "ma200", group: "Linien", label: "Ø 200 Tage", study: MA(200), val: x => avgOf(x, x.d200), why: "langfristiger Trend – darüber gilt der Aufwärtstrend, darunter kauft der Swing-Planer nicht." },
    { k: "bb", group: "Linien", label: "Bollinger-Bänder", study: "BB@tv-basicstudies", why: "Ø 20 Tage ± 2 Standardabweichungen: Am oberen Band läuft der Kurs gerade ungewöhnlich stark, am unteren ungewöhnlich schwach." },
    { k: "vol", group: "Kennzahlen", label: "Volumen", why: "wie viel gehandelt wird – Ausbrüche mit hohem Volumen sind verlässlicher." },
    { k: "rsi", group: "Kennzahlen", label: "RSI", study: "RSI@tv-basicstudies", why: "Stärke der letzten 14 Tage: über 70 überhitzt, unter 30 überverkauft – in starken Trends bleibt er oft lange oben." },
    { k: "macd", group: "Kennzahlen", label: "MACD", study: "MACD@tv-basicstudies", why: "Schwung: Kreuzt die MACD-Linie ihre Signallinie nach oben, nimmt der Aufwärtsschwung zu." },
    { k: "atr", group: "Kennzahlen", label: "ATR", study: "ATR@tv-basicstudies", val: x => x.atr, why: "durchschnittliche Tagesspanne der letzten 14 Tage – Grundlage für den Abstand des Stop-Loss." },
    { k: "lvl", group: "Marken", label: "Kauf, Stop, Ziel", why: "die Marken dieser Seite auf einer Skala mit Kurs, Ø-Linien und 52-Wochen-Spanne." },
  ];
  const chartSet = (() => {
    const c = store.get("dtd-stock-chart2", null) || {};
    const on = Array.isArray(c.on) ? c.on.filter(k => IND.some(i => i.k === k)) : ["ma50", "ma200", "vol"];
    return { style: c.style === "2" ? "2" : "1", on };
  })();
  const saveChart = () => store.set("dtd-stock-chart2", chartSet);
  // TradingView-Symbol für Werte ohne tägliche Kennzahlen (wie scripts/stock-universe.mjs)
  const SUFFIX = { DE: "XETR", L: "LSE", PA: "EURONEXT", AS: "EURONEXT", NV: "EURONEXT", BR: "EURONEXT", LSB: "EURONEXT", MI: "MIL", MC: "BME", ZU: "SIX", SW: "SIX", HK: "HKEX", OL: "OSL", ST: "OMXSTO", CO: "OMXCOP", HE: "OMXHEX", VI: "VIE", LS: "EURONEXT" };
  const tvGuess = q => { const t = q.trim().toUpperCase(); if (t.includes(":")) return t; const m = /^([A-Z0-9-]+)\.([A-Z]+)$/.exec(t); return m && SUFFIX[m[2]] ? `${SUFFIX[m[2]]}:${m[1].replace(/-/g, "_")}` : t; };

  async function load() {
    const t = Date.now();
    const list = (await Promise.all([get(`data/stocks.json?t=${t}`), get(`${RAW}?t=${t}`)])).filter(d => d && Array.isArray(d.items));
    data = list.sort((a, b) => new Date(b.updated) - new Date(a.updated))[0] || null;
    renderQuick();
    if (current) show(current.query, false);
  }
  const find = q => {
    if (!data) return null;
    const s = q.trim().toUpperCase();
    return data.items.find(x => x.sym === s) || data.items.find(x => x.tv.toUpperCase() === s) || data.items.find(x => x.name.toUpperCase() === s)
      || data.items.find(x => x.sym.split(".")[0] === s.split(":").pop()) || null;
  };
  function renderQuick() {
    const host = $("stockQuick");
    if (!host) return;
    const top = data ? data.items.filter(x => x.type === "Aktie").slice(0, 8).concat(data.items.filter(x => x.type === "ETF").slice(0, 3)) : [];
    host.innerHTML = top.length ? `<span class="muted small">Beliebt bei eToro:</span> ${top.map(x => `<button type="button" class="chip-btn" data-sym="${esc(x.sym)}">${esc(x.sym)}</button>`).join("")}` : "";
    host.querySelectorAll("[data-sym]").forEach(b => b.addEventListener("click", () => { $("stockInput").value = b.dataset.sym; show(b.dataset.sym); }));
  }

  // ---------- Bewertung nach Faktoren ----------
  function factors(x) {
    const out = [];
    if (Number.isFinite(x.d200) && Number.isFinite(x.mom)) {
      const up = x.d200 > 0 && x.mom > 0, down = x.d200 < 0 && x.mom < 0;
      out.push({ v: up ? 1 : down ? -1 : 0, name: "Trend", value: `${sign(x.d200)} % zum 200-Tage-Schnitt`,
        text: up ? "Kurs über dem 200-Tage-Durchschnitt und positives Momentum – Aufwärtstrend nach der Trendfolge-Regel." : down ? "Kurs unter dem 200-Tage-Durchschnitt und negatives Momentum – Abwärtstrend." : "Uneinheitlich: Trend und Momentum zeigen in verschiedene Richtungen.",
        src: DOI("10.1016/j.jfineco.2011.11.003", "Moskowitz, Ooi &amp; Pedersen 2012") });
    }
    if (Number.isFinite(x.momRank)) {
      const hi = x.momRank >= 70, lo = x.momRank <= 30;
      out.push({ v: hi ? 1 : lo ? -1 : 0, name: "Momentum", value: `${sign(x.mom)} % (12 bis 1 Monat) · Rang ${x.momRank} von 100`,
        text: hi ? "Unter den stärksten Werten der letzten 12 Monate. Gewinner blieben im Schnitt noch 3–12 Monate leicht überdurchschnittlich – mit Crash-Gefahr nach Panikphasen." : lo ? "Unter den schwächsten Werten. Verlierer blieben im Schnitt eher Verlierer." : "Mittelfeld – kein Signal.",
        src: `${DOI("10.1111/j.1540-6261.1993.tb04702.x", "Jegadeesh &amp; Titman 1993")}, ${DOI("10.1016/j.jfineco.2015.12.002", "Daniel &amp; Moskowitz 2016")}` });
    }
    if (Number.isFinite(x.dHi52)) {
      const near = x.dHi52 > -5, far = x.dHi52 < -30;
      out.push({ v: near ? 1 : far ? -1 : 0, name: "52-Wochen-Hoch", value: `${sign(x.dHi52)} % zum Jahreshoch`,
        text: near ? "Nahe am Jahreshoch: Die Nähe zum 52-Wochen-Hoch erklärt einen großen Teil der Momentum-Gewinne." : far ? "Weit unter dem Jahreshoch – oft ein Zeichen anhaltender Schwäche." : "Weder nahe am Hoch noch weit darunter.",
        src: DOI("10.1111/j.1540-6261.2004.00695.x", "George &amp; Hwang 2004") });
    }
    if (Number.isFinite(x.vol60Rank)) {
      const hi = x.vol60Rank >= 70, lo = x.vol60Rank <= 30;
      out.push({ v: hi ? -1 : lo ? 1 : 0, name: "Schwankung", value: `${fmt(x.vol60, 1)} % p. a. · Rang ${x.vol60Rank} von 100`,
        text: hi ? "Sehr schwankend. Solche Aktien brachten im Schnitt risikobereinigt weniger – trotz Lotto-Reiz." : lo ? "Ruhig. Wenig schwankende Aktien schnitten risikobereinigt im Schnitt besser ab." : "Durchschnittliche Schwankung.",
        src: `${DOI("10.1111/j.1540-6261.2006.00836.x", "Ang u. a. 2006")}, ${DOI("10.1016/j.jfineco.2013.10.005", "Frazzini &amp; Pedersen 2014")}` });
    }
    if (Number.isFinite(x.beta)) {
      out.push({ v: 0, name: "Beta", value: fmt(x.beta, 2),
        text: x.beta > 1.3 ? "Bewegt sich deutlich stärker als der Markt. Hohes Beta wurde historisch nicht mit entsprechend mehr Rendite belohnt." : x.beta < 0.7 ? "Defensiv: schwankt weniger mit dem Gesamtmarkt." : "Bewegt sich etwa wie der Gesamtmarkt.",
        src: DOI("10.1016/j.jfineco.2013.10.005", "Frazzini &amp; Pedersen 2014") });
    }
    return out;
  }

  // ---------- Kauf- und Verkaufsmarken ----------
  function levels(x) {
    const acc = account() || 0, risk = Math.min(5, Math.max(0.1, parseFloat($("skRisk") ? $("skRisk").value : "1") || 1));
    const day = style === "day", mStop = day ? 0.5 : 2, mTarget = day ? 1 : 4;
    const entry = x.last, stopD = mStop * x.atr, tgtD = mTarget * x.atr;
    const stop = entry - stopD, target = entry + tgtD;
    const m = window.DTD.market, size = m && m.overall && Number.isFinite(m.overall.sizeFactor) ? m.overall.sizeFactor : 1;
    // Betrag statt Stückzahl (eToro erlaubt Bruchteile): Risiko ÷ Stop-Abstand, angepasst an die Marktlage, höchstens 20 % des Kontos
    const byRisk = acc > 0 ? acc * risk / 100 / (stopD / entry) * size : 0, cap = acc * 0.2;
    const amount = Math.floor(Math.min(byRisk, cap));
    const costD = entry * COST / 100;
    return {
      day, entry, stop, target, stopPct: stopD / entry * 100, tgtPct: tgtD / entry * 100, amount, units: amount / entry, capped: byRisk > cap, size, risk,
      pNoEdge: stopD / (stopD + tgtD), pNeeded: (stopD + costD) / (stopD + tgtD), lossMax: amount * (stopD + costD) / entry,
      trendOk: x.d200 > 0 && x.mom > 0, trendDown: x.d200 < 0 && x.mom < 0,
    };
  }

  function recBar(r) {
    const total = r.sb + r.b + r.h + r.s + r.ss;
    if (!total) return "";
    const part = (n, cls, label) => (n ? `<span class="rb ${cls}" style="flex:${n}" title="${label}: ${n}">${n}</span>` : "");
    return `<div class="recbar" role="img" aria-label="${r.sb} starker Kauf, ${r.b} Kauf, ${r.h} Halten, ${r.s} Verkauf, ${r.ss} starker Verkauf">
      ${part(r.sb, "r1", "Starker Kauf")}${part(r.b, "r2", "Kauf")}${part(r.h, "r3", "Halten")}${part(r.s, "r4", "Verkauf")}${part(r.ss, "r5", "Starker Verkauf")}</div>
      <div class="recleg"><span>Starker Kauf ${r.sb}</span><span>Kauf ${r.b}</span><span>Halten ${r.h}</span><span>Verkauf ${r.s}</span><span>Starker Verkauf ${r.ss}</span></div>
      <p class="muted small">${total} Analysten, Stand ${esc(r.period || "")} · Quelle: Finnhub</p>`;
  }

  // Kennzahlen (nächtlich von Finnhub, nur US-Aktien) und Links zu Insider-, Investoren- und Konferenz-Werkzeugen
  async function fillFund(x) {
    const f = window.DTD.fundData ? await window.DTD.fundData() : null;
    const el = $("skFund");
    if (!el || $("stockInput").value.trim().toUpperCase() !== x.sym && current && String(current.query).toUpperCase() !== x.sym) return;
    const it = f && f.items ? f.items[x.sym] : null, us = !x.sym.includes(".");
    const A = (u, t) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${t}</a>`;
    const n = (v, d = 1, suf = "") => (Number.isFinite(v) ? `${fmt(v, d)}${suf}` : "–");
    const links = [
      us ? A(`http://openinsider.com/screener?s=${encodeURIComponent(x.sym)}`, "Insider-Geschäfte bei OpenInsider ↗") : null,
      us ? A(`https://www.dataroma.com/m/stock.php?sym=${encodeURIComponent(x.sym)}`, "Große Investoren bei Dataroma ↗") : null,
      A("https://quartr.com/app", "Telefonkonferenzen in der Quartr-App ↗"),
      it && it.web ? A(it.web.replace(/"/g, ""), "Webseite der Firma ↗") : null,
    ].filter(Boolean).join(" · ");
    if (!it) {
      el.innerHTML = `<p class="muted small">${us ? (f ? "Für diese Aktie liefert Finnhub keine Kennzahlen." : "Die Kennzahlen kommen mit dem ersten nächtlichen Lauf.") : "Kennzahlen gibt es hier nur für US-Aktien."}</p><p class="small">${links}</p>`;
      return;
    }
    // Finnhub gibt den Börsenwert in Millionen an – bei Firmen mit Sitz im Ausland teils in der Heimatwährung (TSMC in
    // Taiwan-Dollar, Sony in Yen). Dort und bei unmöglichen Werten (über 10 Billionen) keine Dollar-Angabe.
    const abroad = it.cty && it.cty !== "US";
    const T = (k, l) => (window.DTD.term ? window.DTD.term(k, l, x.sym) : l);
    const cap = Number.isFinite(it.mcap) && !abroad && it.mcap < 1e7 ? it.mcap : null;
    const ins = it.ins, mcap = cap === null ? (Number.isFinite(it.mcap) ? "siehe eToro" : "–") : cap >= 1e6 ? `${fmt(cap / 1e6, 2)} Bio. $` : cap >= 1000 ? `${fmt(cap / 1000, 1)} Mrd. $` : `${fmt(cap, 0)} Mio. $`;
    el.innerHTML = `<div class="stats-grid">
        ${kpi(T("kgv", "KGV"), n(it.pe))}${kpi(T("kuv", "KUV"), n(it.ps))}${kpi(T("kbv", "Kurs/Buchwert"), n(it.pb))}${kpi(T("umsatz", "Umsatzwachstum"), n(it.revG, 1, " %"), it.revG < 0 ? "down" : "up")}
        ${kpi(T("gewinn", "Gewinnwachstum"), n(it.epsG, 1, " %"), it.epsG < 0 ? "down" : "up")}${kpi(T("marge", "Nettomarge"), n(it.netM, 1, " %"))}${kpi(T("ekr", "Eigenkapitalrendite"), n(it.roe, 1, " %"))}${kpi(T("schulden", "Schulden/Eigenkapital"), n(it.de, 2))}
        ${kpi(T("dividende", "Dividendenrendite"), n(it.div, 2, " %"))}${kpi(T("boersenwert", "Börsenwert"), mcap)}${kpi("Branche", esc(it.ind || "–"))}
        ${kpi(T("insider", "Insider (90 Tage)"), ins ? `${ins.buyers} kaufen · ${ins.sellers} verkaufen` : "–")}
      </div>
      <p class="hint">KGV = Kurs geteilt durch den Gewinn je Aktie der letzten 12 Monate: unter 15 gilt meist als günstig, über 30 als teuer – je nach Branche sehr verschieden. Insider-Käufe am Markt haben mehr Aussagekraft als Verkäufe.${abroad ? ` <b>Sitz außerhalb der USA (${esc(it.cty)}):</b> Die Firma meldet meist nicht nach SEC-Formular 4, die Insider-Zahlen sind nur eingeschränkt vergleichbar; Finnhub rechnet hier teils in der Heimatwährung – Bewertungen mit Vorsicht lesen.` : ""} Stand ${new Date(f.updated).toLocaleDateString("de-DE")}, Quelle Finnhub.</p>
      <p class="small">${links}</p>`;
  }

  const ladderRows = (x, L) => [
    { label: "Kurs jetzt", v: x.last, kind: "now" },
    { label: "Stop-Loss", v: L.stop, kind: "stop" },
    { label: "Ziel", v: L.target, kind: "target" },
    { label: "50-Tage-Schnitt", v: avgOf(x, x.d50), kind: "avg" },
    { label: "200-Tage-Schnitt", v: avgOf(x, x.d200), kind: "avg" },
    { label: "52-Wochen-Hoch", v: x.hi52, kind: "range" },
    { label: "52-Wochen-Tief", v: x.lo52, kind: "range" },
  ];
  // Unter dem Diagramm: was jede eingeblendete Linie bedeutet, mit dem heutigen Wert aus den eToro-Tageskerzen
  function chartInfo(x, L) {
    const act = IND.filter(i => chartSet.on.includes(i.k) && i.k !== "lvl");
    const line = i => {
      const v = x && i.val ? i.val(x) : null;
      const now = !Number.isFinite(v) ? "" : i.k === "atr" ? ` <b class="num">${price(v)}</b> <span class="muted">(${fmt(x.atrPct, 2)} % vom Kurs)</span>`
        : ` <b class="num">${price(v)}</b> <span class="muted">· Kurs</span> ${pctCell((x.last / v - 1) * 100)} <span class="muted">${x.last >= v ? "darüber" : "darunter"}</span>`;
      return `<li><span class="tchip-dot"></span><b>${i.label}</b>${now} – ${i.why}</li>`;
    };
    const lvl = chartSet.on.includes("lvl") && x && L ? levelLadder(ladderRows(x, L), `Marken für den ${L.day ? "Tageshandel" : "Swing-Trade"} – Einstellung unten bei „Kauf &amp; Verkauf“`) : "";
    return (act.length ? `<ul class="chart-legend">${act.map(line).join("")}</ul>` : `<p class="muted small">Keine Linien eingeblendet – oben antippen, was Sie sehen möchten.</p>`) + lvl
      + `<p class="hint">Die Linien zeichnet TradingView aus Tageskerzen; die Ø-Linien erkennen Sie oben links in der Legende am Zusatz „MA 20“, „MA 50“ und „MA 200“. Weitere Kennzahlen, Farben und Längen: im Diagramm auf „Indikatoren“ tippen. Ihre Auswahl bleibt in diesem Browser gespeichert.</p>`;
  }

  let lastSize = null;
  function render(x, q) {
    const host = $("stockBody");
    const tv = x ? x.tv : tvGuess(q);
    const T = (k, l) => (window.DTD.term && x ? window.DTD.term(k, l, x.sym) : l);   // Kennzahl antippen → Erklärung
    const etoroUrl = `https://www.etoro.com/markets/${encodeURIComponent((x ? x.sym : q).toLowerCase())}`;
    const dates = window.DTD.nextMarketDates ? window.DTD.nextMarketDates() : [];
    const f = x ? factors(x) : [];
    const score = f.reduce((s, y) => s + y.v, 0);
    const L = x && Number.isFinite(x.atr) ? levels(x) : null;
    lastSize = L ? L.size : lastSize;
    const cur = $("cCur") ? $("cCur").value || "$" : "$";
    host.innerHTML = `
      <section class="block" data-section="Überblick">
        <div class="stock-head">
          <div>
            <p class="eyebrow">${x ? `${esc(x.type)} · ${esc(x.sym)}` : esc(q.toUpperCase())}</p>
            <h2 class="stock-name">${x ? esc(x.name) : esc(q.toUpperCase())}</h2>
            ${x ? `<p class="stock-price">${price(x.last)} <span class="${x.chg1d < 0 ? "down" : "up"}">${sign(x.chg1d, 2)} %</span></p>
              <p class="muted small">Schlusskurs ${esc(x.asOf)} laut eToro · Live-Kurs in der Grafik</p>${Math.abs(x.chg1d) >= 3 ? `<p class="why" data-why="${esc(x.sym)}"></p>` : ""}` : `<p class="muted">Nicht unter den ${data ? data.count : "beliebtesten"} Werten mit täglichen Kennzahlen – unten nur Live-Daten von TradingView.</p>`}
          </div>
          <div class="btn-row">${x && window.DTD.watch ? window.DTD.watch.star(x.sym, "big") : ""}${x && window.DTD.compare ? window.DTD.compare.button(x.sym) : ""}${x ? `<a class="btn ghost" href="${etoroUrl}" target="_blank" rel="noopener noreferrer">In eToro öffnen ↗</a>` : `<a class="btn ghost" href="https://www.tradingview.com/symbols/${encodeURIComponent(tv.replace(":", "-"))}/" target="_blank" rel="noopener noreferrer">Bei TradingView öffnen ↗</a>`}</div>
        </div>
        ${x ? `<div class="stats-grid">
          ${kpi(T("rendite", "1 Monat"), sign(x.ret1m) + " %", x.ret1m < 0 ? "down" : "up")}
          ${kpi(T("rendite", "3 Monate"), sign(x.ret3m) + " %", x.ret3m < 0 ? "down" : "up")}
          ${kpi(T("rendite", "12 Monate"), sign(x.ret12m) + " %", x.ret12m < 0 ? "down" : "up")}
          ${kpi(T("d200", "Zum 200-Tage-Schnitt"), sign(x.d200) + " %", x.d200 < 0 ? "down" : "up")}
          ${kpi(T("schwankung", "Schwankung 60 Tage"), fmt(x.vol60, 1) + " %")}
          ${kpi(T("atr", "Tagesspanne (ATR)"), fmt(x.atrPct, 2) + " %")}
          ${kpi(T("rueckgang", "Größter Rückgang 1 J."), "−" + fmt(x.mdd, 1) + " %", "down")}
          ${kpi(T("beta", "Beta"), fmt(x.beta, 2))}
        </div>` : ""}
        <div class="chart-tools" id="skTools">
          <div class="seg chart-seg" role="group" aria-label="Diagramm-Art">
            <button type="button" data-cstyle="1" aria-pressed="${chartSet.style === "1"}">Kerzen</button>
            <button type="button" data-cstyle="2" aria-pressed="${chartSet.style === "2"}">Linie</button>
          </div>
          ${["Linien", "Kennzahlen", "Marken"].map(g => { const its = IND.filter(i => i.group === g && (i.k !== "lvl" || L)); return its.length ? `<div class="tchips" role="group" aria-label="${g}"><span class="tchips-lbl">${g}</span>${its.map(i => `<button type="button" class="tchip" data-ind="${i.k}" aria-pressed="${chartSet.on.includes(i.k)}">${i.label}</button>`).join("")}</div>` : ""; }).join("")}
        </div>
        <div class="widget big-chart" id="skChart"></div>
        <div id="skChartInfo" class="chart-info"></div>
      </section>

      ${x ? `<section class="block" data-section="Note">
        <h2 class="card-title">${window.DTD.term ? window.DTD.term("note", "Gesamtnote", x.sym) : "Gesamtnote"}</h2>
        <div id="skNote"><p class="muted small">Rechne die Note …</p></div>
      </section>` : ""}

      ${x && x.type === "Aktie" ? `<section class="block" data-section="Kennzahlen">
        <h2 class="card-title">Kennzahlen und Insider</h2>
        <div id="skFund"><p class="muted small">Lade Kennzahlen …</p></div>
      </section>
      <section class="block" data-section="Konkurrenz">
        <h2 class="card-title">Konkurrenz-Vergleich</h2>
        <div id="skPeers"><p class="muted small">Lade die Branche …</p></div>
      </section>` : ""}

      <section class="block" data-section="Termine">
        <h2 class="card-title">Termine</h2>
        ${x && x.earn ? `<div class="when-card soon"><div class="when-date"><b>${new Date(x.earn.date).toLocaleDateString("de-DE", { day: "2-digit" })}</b><span>${new Date(x.earn.date).toLocaleDateString("de-DE", { month: "short" }).replace(".", "")}</span></div>
            <div class="when-text"><b>Quartalszahlen</b><p>${new Date(x.earn.date).toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}${x.earn.hour === "bmo" ? " · vor Börsenbeginn" : x.earn.hour === "amc" ? " · nach Börsenschluss" : ""}${Number.isFinite(x.earn.eps) ? ` · erwarteter Gewinn je Aktie ${fmt(x.earn.eps, 2)}` : ""}. Am Tag danach sind Kurssprünge von mehreren ATR möglich – Stops können übersprungen werden.</p></div></div>`
          : `<p class="muted">${data && /^an/.test(data.finnhub || "") ? "Kein Quartalszahlen-Termin in den nächsten 100 Tagen bekannt." : "Quartalszahlen-Termine brauchen eine zusätzliche Datenquelle (kostenloser Finnhub-Schlüssel, siehe unten). Bis dahin: Termin in eToro unter „Analyse“ bzw. auf der Investor-Relations-Seite des Unternehmens."}</p>`}
        ${dates.length ? `<div class="timeline" style="margin-top:10px">${dates.slice(0, 3).map(dd => `<div class="when-card"><div class="when-date"><b>${dd.day}</b><span>${dd.mon}</span></div><div class="when-text"><b>${dd.title}</b><p>${dd.text}</p></div></div>`).join("")}</div>` : ""}
      </section>

      <section class="block" data-section="Experten">
        <h2 class="card-title">Was Analysten, Anleger und Nachrichten sagen</h2>
        <div class="grid-2">
          <div>
            <h3 style="margin-top:0">Analysten</h3>
            ${x && x.rec ? recBar(x.rec) : `<p class="muted">${x && x.type === "ETF" ? "Für ETFs gibt es keine Analysten-Empfehlungen." : "Analysten-Übersicht nicht verfügbar (Finnhub-Schlüssel fehlt oder nur US-Aktien)."} Die Einschätzungen der Analysten stehen auch in eToro beim Wert unter „Analyse“.</p>`}
            <p class="small"><b>Wie viel taugt das?</b> Strategien nach den Empfehlungen brachten vor Kosten über 4 % pro Jahr Mehrrendite, nach Kosten nicht verlässlich mehr als null (${DOI("10.1111/0022-1082.00336", "Barber u. a., JF 2001")}). Analysten von Banken, die selbst an der Firma verdienen, empfehlen zu optimistisch (${DOI("10.1093/rfs/12.4.653", "Michaely &amp; Womack, RFS 1999")}).</p>
            ${x && Number.isFinite(x.crowd) ? `<h3>eToro-Anleger</h3><p><b>${fmt(x.crowd, 0)} %</b> der eToro-Positionen in diesem Wert sind Käufe.</p>
              <p class="small muted">Vorsicht: Was viele Kleinanleger gleichzeitig kaufen, lief danach im Schnitt eher schlechter (${DOI("10.1111/jofi.13183", "Barber u. a., JF 2022")}).</p>` : ""}
          </div>
          <div><h3 style="margin-top:0">Nachrichten zu ${esc(x ? x.sym : q.toUpperCase())}</h3><div id="skNewsList" class="sk-news-list"></div><div class="widget" id="skNews" style="height:420px"></div></div>
        </div>
      </section>

      <section class="block" data-section="Theorie">
        <h2 class="card-title">Theorie: Was die Forschung für die Zukunft erwarten lässt</h2>
        ${x ? `<p class="hero-sub" style="margin-top:0">${score >= 2 ? "Die belegten Faktoren sprechen <b>eher für</b> diesen Wert." : score <= -2 ? "Die belegten Faktoren sprechen <b>eher gegen</b> diesen Wert." : "Die belegten Faktoren ergeben <b>ein gemischtes Bild</b>."} Faktoren erklären nur kleine Unterschiede im Durchschnitt vieler Aktien – für einen einzelnen Wert bleibt das Ergebnis weitgehend offen.</p>
          <div class="factor-list">${f.map(y => `<div class="factor"><div class="factor-head"><b>${y.name}</b><span class="light ${y.v > 0 ? "green" : y.v < 0 ? "red" : "yellow"}">${y.v > 0 ? "dafür" : y.v < 0 ? "dagegen" : "neutral"}</span></div>
            <div class="factor-val">${y.value}</div><p>${y.text}</p><p class="muted small">${y.src}</p></div>`).join("")}</div>
          ${window.DTD.market && window.DTD.market.overall ? `<p class="hint">Marktlage heute: <b>${({ green: "Rückenwind", yellow: "gemischt", red: "Gegenwind" })[window.DTD.market.overall.light] || "–"}</b> (siehe <a href="#markt">Markt</a>).</p>` : ""}`
          : `<p class="muted">Für Werte ohne tägliche Kennzahlen kann die Seite keine Faktor-Bewertung rechnen.</p>`}
        <div class="widget" id="skProfile" style="height:360px;margin-top:14px"></div>
      </section>

      <section class="block" data-section="Kauf &amp; Verkauf">
        <h2 class="card-title">Kauf und Verkauf nach belegten Regeln</h2>
        ${L ? `
          <div class="toolbar">
            <div class="seg" role="group" aria-label="Haltedauer">
              <button type="button" data-style="day" aria-pressed="${style === "day"}">Tagestrade (max. 1 Tag)</button>
              <button type="button" data-style="swing" aria-pressed="${style === "swing"}">Swing (Tage bis Wochen)</button>
            </div>
            <label class="inline">Risiko pro Trade <input id="skRisk" type="number" min="0.1" max="5" step="0.1" value="${fmt(L.risk, 1).replace(",", ".")}"> %</label>
          </div>
          <div class="signal ${L.trendOk ? "ok" : "no"}">
            <b>${L.trendOk ? "Kauf-Setup erlaubt: Aufwärtstrend" : L.trendDown ? "Kein Kauf-Setup: Abwärtstrend" : "Kein klares Kauf-Setup: Trend uneinheitlich"}</b>
            <p>${L.trendOk ? "Trendfilter erfüllt – Kurs über dem 200-Tage-Schnitt, Momentum positiv." : "Nach der Studienlage lieber abwarten: Stops helfen nur, wenn Kurse Trends haben; gegen den Trend sinkt die Erfolgschance."} (${DOI("10.1016/j.finmar.2013.07.001", "Kaminski &amp; Lo 2014")})</p>
          </div>
          <div class="levels">
            <div class="level"><span>Kauf (Einstieg)</span><b>${price(L.entry)}</b><small>aktueller Kurs</small></div>
            <div class="level"><span>Stop-Loss</span><b class="down">${price(L.stop)}</b><small>−${fmt(L.stopPct, 2)} % · ${L.day ? "0,5" : "2"} × ATR</small></div>
            <div class="level"><span>Ziel (Take-Profit)</span><b class="up">${price(L.target)}</b><small>+${fmt(L.tgtPct, 2)} % · ${L.day ? "1" : "4"} × ATR</small></div>
            <div class="level"><span>Betrag</span><b>${L.amount ? `${fmt(L.amount, 0)} ${cur}` : "–"}</b><small>${L.amount ? `≈ ${fmt(L.units, L.units < 10 ? 3 : 1)} Stück` : "Kontostand eintragen"}</small></div>
          </div>
          ${levelLadder(ladderRows(x, L), "Stop und Ziel neben den Trendlinien")}
          <div class="stats-grid">
            ${kpi("Chance aufs Ziel ohne Vorteil", `${fmt(L.pNoEdge * 100, 0)} %`)}
            ${kpi("Nötige Trefferquote nach Kosten", `${fmt(L.pNeeded * 100, 0)} %`)}
            ${kpi("Max. Verlust inkl. Kosten", L.amount ? `−${fmt(L.lossMax, 0)} ${cur}` : "–", "down")}
            ${kpi("Positionsgröße laut Marktlage", `${fmt(L.size * 100, 0)} %`)}
          </div>
          <ul class="checklist">
            <li><b>Stop und Ziel aus der Schwankung:</b> ATR = durchschnittliche Tagesspanne der letzten 14 Tage. ${L.day ? "Für Tagestrades ½ ATR Stop und 1 ATR Ziel – ungefähr eine normale Tagesbewegung." : "Für Swing-Trades 2 ATR Stop, damit normales Rauschen den Trade nicht beendet, und 4 ATR Ziel."} Chance-Risiko-Verhältnis 1 : 2.</li>
            <li><b>Ehrliche Rechnung:</b> Ohne echten Vorteil erreicht ein Kurs das doppelt so weite Ziel nur in etwa einem Drittel der Fälle vor dem Stop. Nach Kosten müssen ${fmt(L.pNeeded * 100, 0)} % der Trades aufgehen – sonst verliert die Regel auf Dauer.</li>
            <li><b>Betrag:</b> ${fmt(L.risk, 1)} % des Kontos Risiko ÷ Stop-Abstand, angepasst an die Marktlage (${fmt(L.size * 100, 0)} %, ${DOI("10.1111/jofi.12513", "Moreira &amp; Muir 2017")})${L.capped ? ", begrenzt auf 20 % des Kontos" : ""}. eToro erlaubt Bruchteile von Aktien.</li>
          </ul>
          <h3>So tragen Sie es in eToro ein</h3>
          <ol class="steps">
            <li>In eToro ${v(esc(x.sym))} suchen und öffnen, auf <b>„Handeln“</b> tippen, <b>„Kaufen“</b> wählen.</li>
            <li>Feld <b>„Betrag“</b>: ${v(L.amount ? `${fmt(L.amount, 0)} ${cur}` : "Kontostand eintragen")}. Hebel ${v("x1")}.</li>
            <li><b>„Stop-Loss“</b> → auf Kurs umschalten → ${v(price(L.stop))}.</li>
            <li><b>„Take-Profit“</b> → auf Kurs umschalten → ${v(price(L.target))}.</li>
            <li>${L.trendOk ? "Mit <b>„Trade eröffnen“</b> bestätigen." : "Nicht handeln, solange der Trendfilter nicht erfüllt ist – höchstens im Demokonto üben."}${L.day ? " Spätestens 15 Minuten vor Börsenschluss schließen." : " Stop nie nach unten verschieben."}</li>
          </ol>
          <p class="muted small">Vor dem Klick: <a href="#psychCheck">Psychologie-Check</a>. Mechanische Regel, keine Anlageberatung.</p>`
          : `<p class="muted">Für Werte ohne tägliche Kennzahlen rechnet die Seite keine Marken. Im <a href="#setup">Trade-Setup</a> können Sie Kurs und ATR selbst eintragen.</p>`}
      </section>`;

    // Live-Diagramm von TradingView (funktioniert für jedes Symbol) mit den gewählten Linien und Kennzahlen
    const drawChart = () => {
      const el = $("skChart");
      if (!el) return;
      const phone = window.matchMedia("(max-width: 720px)").matches;
      const panes = ["rsi", "macd", "atr"].filter(k => chartSet.on.includes(k)).length;
      el.style.height = `${(phone ? 420 : 520) + panes * (phone ? 90 : 110)}px`;
      const studies = IND.filter(i => i.study && chartSet.on.includes(i.k)).map(i => i.study);
      window.DTD.tvChart("skChart", tv, { style: chartSet.style, studies, hideVolume: !chartSet.on.includes("vol"), compact: phone });
    };
    const drawInfo = () => { const el = $("skChartInfo"); if (el) el.innerHTML = chartInfo(x, L); };
    drawChart();
    drawInfo();
    if (x && x.type === "Aktie") fillFund(x);
    if (x && window.DTD.scoreReady) window.DTD.scoreReady().then(() => { const el = $("skNote"); if (el && current && current.query === x.sym) el.innerHTML = window.DTD.scoreCard(x.sym) || `<p class="muted small">Für diesen Wert reichen die Daten nicht für eine Note.</p>`; const pe = $("skPeers"); if (pe && window.DTD.peersHtml && current && current.query === x.sym) pe.innerHTML = window.DTD.peersHtml(x.sym); });
    host.querySelectorAll("[data-cstyle]").forEach(b => b.addEventListener("click", () => {
      chartSet.style = b.dataset.cstyle; saveChart();
      host.querySelectorAll("[data-cstyle]").forEach(o => o.setAttribute("aria-pressed", String(o.dataset.cstyle === chartSet.style)));
      drawChart();
    }));
    host.querySelectorAll("[data-ind]").forEach(b => b.addEventListener("click", () => {
      const k = b.dataset.ind, on = !chartSet.on.includes(k);
      chartSet.on = on ? [...chartSet.on, k] : chartSet.on.filter(v => v !== k);
      saveChart();
      b.setAttribute("aria-pressed", String(on));
      if (k !== "lvl") drawChart();
      drawInfo();
    }));
    tvWidget("skNews", "timeline", { ...COMMON, feedMode: "symbol", symbol: tv, displayMode: "regular", width: "100%", height: "100%" });
    if (window.DTD.fillNews) window.DTD.fillNews($("skNewsList"), x ? x.sym : q.trim().toUpperCase());
    if (window.DTD.fillWhy) window.DTD.fillWhy(host);
    tvWidget("skProfile", "symbol-profile", { ...COMMON, symbol: tv, width: "100%", height: "100%" });
    host.querySelectorAll("[data-style]").forEach(b => b.addEventListener("click", () => { style = b.dataset.style; store.set("dtd-stock-style", style); render(x, q); }));
    const r = $("skRisk"); if (r) r.addEventListener("change", () => render(x, q));
    window.dispatchEvent(new CustomEvent("dtd:sections", { detail: "aktie" }));
  }

  function show(q, push = true) {
    if (!q || !q.trim()) return;
    // genaues Kürzel oder genauer Name – sonst der beste Vorschlag (z. B. „apple“ → AAPL)
    const x = find(q) || (data ? window.DTD.matchStocks(data.items, q, 1)[0] || null : null);
    if (x && $("stockInput").value.trim().toUpperCase() !== x.sym) $("stockInput").value = x.sym;
    current = { query: x ? x.sym : q.trim() };
    store.set("dtd-stock", current.query);
    if (x) store.set(RECENT, [x.sym, ...recent().filter(v => v !== x.sym)].slice(0, 8));
    render(x, q.trim());
    if (push) $("stockBody").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  $("stockForm").addEventListener("submit", e => { e.preventDefault(); show($("stockInput").value); });
  // Vorschläge unter dem Suchfeld: beim Tippen die passenden Werte, im leeren Feld die zuletzt angesehenen
  window.DTD.attachSuggest($("stockInput"), {
    source: text => (!data ? [] : text ? window.DTD.matchStocks(data.items, text, 8) : recent().map(v => data.items.find(y => y.sym === v)).filter(Boolean)),
    onPick: sym => show(sym),
    emptyTitle: "Zuletzt angesehen",
  });
  window.DTD.startStock = () => {
    load();
    const last = store.get("dtd-stock", "");
    if (last && !current) { $("stockInput").value = last; current = { query: last }; }
    if (current) show(current.query, false);
  };
  // Marktlage beeinflusst nur die Positionsgröße: neu zeichnen, wenn sich der Faktor geändert hat (sonst lädt das Diagramm doppelt)
  const sizeNow = () => { const m = window.DTD.market; return m && m.overall && Number.isFinite(m.overall.sizeFactor) ? m.overall.sizeFactor : 1; };
  window.addEventListener("dtd:market", () => { if (current && !$("aktie").hidden && sizeNow() !== lastSize) show(current.query, false); });
  // Von anderen Bereichen (HotStuff) direkt einen Wert öffnen
  window.DTD.openStock = sym => { store.set("dtd-stock", sym); $("stockInput").value = sym; current = { query: sym }; location.hash = "aktie"; if (data) show(sym); };
  window.DTD.stockData = () => data;
  window.DTD.reloadStocks = async () => {
    const t = Date.now();
    const list = (await Promise.all([get(`data/stocks.json?t=${t}`), get(`${RAW}?t=${t}`)])).filter(d => d && Array.isArray(d.items));
    const next = list.sort((a, b) => new Date(b.updated) - new Date(a.updated))[0];
    if (!next || (data && next.updated === data.updated)) return false;
    data = next;
    renderQuick();
    if (current && !$("aktie").hidden) show(current.query, false);
    return true;
  };
})();

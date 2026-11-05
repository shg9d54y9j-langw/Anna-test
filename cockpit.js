// ---------- Marktlage-Cockpit ----------
// Liest data/market.json (berechnet in jeder Runde des Live-Wächters) und zeigt Gesamtampel, Kacheln und Live-Kurse.
(() => {
  const RAW = "https://raw.githubusercontent.com/shg9d54y9j-langw/Anna-test/live-data/market.json";
  const get = url => fetch(url, { cache: "no-store" }).then(r => (r.ok ? r.json() : null)).catch(() => null);
  const n1 = x => fmt(x, 1), sign1 = x => (x > 0 ? "+" : "") + fmt(x, 1);
  const LIGHT_TEXT = { green: "Rückenwind", yellow: "Gemischt", red: "Gegenwind", unknown: "Keine Daten" };
  const SRC = (url, text) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`;
  let market = null;

  function priceFmt(x) {
    if (!Number.isFinite(x)) return "–";
    return x >= 1000 ? fmt(x, 0) : x >= 10 ? fmt(x, 2) : fmt(x, 4);
  }
  function dist(p) {
    if (!Number.isFinite(p)) return "";
    const w = Math.min(50, Math.abs(p) * 2.5);   // 20 % Abstand füllen die halbe Leiste
    return `<div class="dist" role="img" aria-label="${sign1(p)} % zum 200-Tage-Durchschnitt"><i></i><b class="${p >= 0 ? "up" : "down"}" style="width:${w}%"></b></div>`;
  }
  function assetTile(a) {
    const has = Number.isFinite(a.last);
    const trendTxt = a.light === "green" ? "Aufwärtstrend" : a.light === "red" ? "Abwärtstrend" : a.light === "yellow" ? "uneinheitlich" : "keine Daten";
    return `<article class="tile ${a.light}">
      <div class="tile-head"><span class="tile-name">${esc(a.name)}</span><span class="light ${a.light}">${trendTxt}</span></div>
      <div class="tile-value">${has ? priceFmt(a.last) : "–"}</div>
      <div class="tile-delta ${a.chg1d < 0 ? "down" : "up"}">${Number.isFinite(a.chg1d) ? `${sign1(a.chg1d)} % heute` : ""}</div>
      ${dist(a.distSma200)}
      <div class="tile-rule">${Number.isFinite(a.distSma200) ? `${sign1(a.distSma200)} % zum 200-Tage-Schnitt` : "200-Tage-Schnitt: –"} · 12 Monate ${Number.isFinite(a.ret12m) ? `<b class="${a.ret12m < 0 ? "down" : "up"}">${sign1(a.ret12m)} %</b>` : "–"}</div>
      <div class="tile-rule">Schwankung (20 Tage, p. a.): ${Number.isFinite(a.vol20) ? `${n1(a.vol20)} %` : "–"}</div>
    </article>`;
  }
  function macroTile(key, m) {
    if (!m) return "";
    if (key === "curve") {
      const txt = m.light === "red" ? "invertiert" : m.light === "yellow" ? "flach" : "normal";
      return `<article class="tile ${m.light}">
        <div class="tile-head"><span class="tile-name">Zinskurve 10 J. − 3 M.</span><span class="light ${m.light}">${txt}</span></div>
        <div class="tile-value">${sign1(m.value)} <span class="small muted">Pp.</span></div>
        <div class="tile-rule">Eine Kurve unter null ging in den USA den meisten Rezessionen seit den 1960ern voraus, oft 6–18 Monate vorher. Auf die lange Inversion 2022–2024 folgte zunächst keine Rezession – ein Rahmen, kein Tagessignal. ${m.days12m ? `In den letzten 12 Monaten ${m.invertedDays12m} von ${m.days12m} Tagen unter null.` : ""}</div>
        <div class="tile-rule">Stand ${dateShort(m.asOf)} · ${SRC("https://doi.org/10.1162/003465398557320", "Estrella &amp; Mishkin 1998")}</div>
      </article>`;
    }
    if (key === "nfci") {
      const txt = m.light === "red" ? "straff" : m.light === "yellow" ? "neutral" : "locker";
      return `<article class="tile ${m.light}">
        <div class="tile-head"><span class="tile-name">Finanzbedingungen</span><span class="light ${m.light}">${txt}</span></div>
        <div class="tile-value">${fmt(m.value, 2)}</div>
        <div class="tile-rule">Index der Chicago Fed: 0 = langjähriger Durchschnitt, über 0 = Kredit und Liquidität knapper als üblich.</div>
        <div class="tile-rule">Stand ${dateShort(m.asOf)} · ${SRC("https://www.chicagofed.org/research/data/nfci/about", "Chicago Fed")}</div>
      </article>`;
    }
    if (key === "dollar") {
      return `<article class="tile">
        <div class="tile-head"><span class="tile-name">US-Dollar (breit)</span><span class="chip">${m.trend || "–"}</span></div>
        <div class="tile-value">${fmt(m.value, 1)}</div>
        ${dist(m.distSma200)}
        <div class="tile-rule">${Number.isFinite(m.distSma200) ? `${sign1(m.distSma200)} % zum 200-Tage-Schnitt` : ""}${Number.isFinite(m.ret1m) ? ` · 1 Monat ${sign1(m.ret1m)} %` : ""}. Ein steigender Dollar drückt US-Gewinne in Euro gerechnet.</div>
        <div class="tile-rule">Stand ${dateShort(m.asOf)} · Fed (FRED)</div>
      </article>`;
    }
    return "";
  }
  const dateShort = iso => (iso ? new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "–");

  function heroHtml(d, compact) {
    const o = d.overall || { light: "unknown" };
    const spx = (d.assets || []).find(a => a.key === "spx") || {};
    const size = Number.isFinite(o.sizeFactor) ? Math.round(o.sizeFactor * 100) : null;
    const reason = [];
    if (Number.isFinite(spx.distSma200)) reason.push(`S&amp;P 500 ${spx.distSma200 > 0 ? "über" : "unter"} dem 200-Tage-Schnitt`);
    if (Number.isFinite(spx.vol20)) reason.push(`Schwankung ${spx.vol20 < d.rules.volCalm ? "ruhig" : spx.vol20 > d.rules.volHigh ? "hoch" : "erhöht"} (${n1(spx.vol20)} % p. a.)`);
    if (d.macro && d.macro.nfci) reason.push(`Finanzbedingungen ${d.macro.nfci.value > 0 ? "straffer" : "lockerer"} als im Schnitt`);
    const age = (Date.now() - new Date(d.updated)) / 6e4;
    return `<section class="hero ${o.light}">
      <div class="hero-top">
        <span class="light big ${o.light}">${LIGHT_TEXT[o.light]}</span>
        <span class="muted small">Marktlage · Stand ${new Date(d.updated).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })} Uhr${age > 90 ? " (außerhalb der Börsenzeit normal)" : ""}</span>
      </div>
      <div class="hero-title" style="margin-top:14px">${o.light === "green" ? "Rückenwind für Käufer" : o.light === "red" ? "Gegenwind – vorsichtig sein" : o.light === "yellow" ? "Gemischte Lage" : "Noch keine Marktdaten"}</div>
      <p class="hero-sub">${reason.join(" · ") || "Die Werte erscheinen nach der nächsten Runde des Live-Wächters."}</p>
      ${compact ? "" : `<div class="hero-grid">
        ${kpi("Empfohlene Positionsgröße", size !== null ? `${size} %` : "–", size !== null && size < 50 ? "down" : "")}
        ${kpi("S&P 500 Trend", Number.isFinite(spx.distSma200) ? `${sign1(spx.distSma200)} %` : "–", spx.distSma200 < 0 ? "down" : "up")}
        ${kpi("Schwankung 20 Tage", Number.isFinite(spx.vol20) ? `${n1(spx.vol20)} %` : "–", spx.vol20 > d.rules.volHigh ? "down" : "")}
        ${kpi("Punkte", Number.isFinite(o.score) ? `${o.score > 0 ? "+" : ""}${o.score} von ±${o.parts}` : "–")}
      </div>
      <p class="hint">Positionsgröße: Anteil Ihrer normalen Größe, damit das Risiko gleich bleibt – bei doppelter Schwankung nur halb so groß (${SRC("https://doi.org/10.1111/jofi.12513", "Moreira &amp; Muir, Journal of Finance 2017")}). Trend: Kurs über dem 200-Tage-Durchschnitt und positive 12-Monats-Rendite (${SRC("https://doi.org/10.1016/j.jfineco.2011.11.003", "Moskowitz, Ooi &amp; Pedersen 2012")}, ${SRC("https://www.aqr.com/Insights/Research/Journal-Article/A-Century-of-Evidence-on-Trend-Following-Investing", "Hurst, Ooi &amp; Pedersen 2017")}).</p>`}
      ${compact ? `<p style="margin:14px 0 0"><a class="btn ghost" href="#markt">Marktlage im Detail →</a></p>` : ""}
    </section>`;
  }

  function render() {
    const host = $("cockpit");
    if (host) {
      if (!market) {
        host.innerHTML = `<section class="hero"><div class="hero-title">Marktlage wird geladen …</div><p class="hero-sub">Die Werte berechnet der Live-Wächter an Börsentagen etwa alle 15 Minuten.</p></section>`;
      } else {
        const d = market;
        host.innerHTML = `${heroHtml(d, false)}
          <div class="tiles">
            ${(d.assets || []).map(assetTile).join("")}
            ${["curve", "nfci", "dollar"].map(k => macroTile(k, d.macro && d.macro[k])).join("")}
          </div>
          <details class="info card">
            <summary>So entstehen die Ampeln</summary>
            <ul class="checklist">
              <li><b>Trend</b> grün: Kurs über dem Durchschnitt der letzten 200 Handelstage <i>und</i> positive 12-Monats-Rendite; rot: beides negativ; sonst gelb. Trendfolge ist über mehr als 100 Jahre und viele Märkte belegt, hat aber Fehlsignale in Seitwärtsphasen.</li>
              <li><b>Schwankung</b>: Standardabweichung der Tagesrenditen der letzten 20 Tage aufs Jahr gerechnet. Unter ${d.rules.volCalm} % ruhig, über ${d.rules.volHigh} % hoch. Hohe Schwankung hält meist eine Weile an – deshalb kleinere Positionen.</li>
              <li><b>Gesamtampel</b>: Punkte für den S&amp;P-500-Trend (±1), die Schwankung (+1/0/−1) und die Finanzbedingungen (±1). Ab 2 Punkten grün, ab 0 gelb, darunter rot.</li>
              <li><b>Zinskurve</b> und <b>Dollar</b> sind Rahmen für Wochen und Monate, keine Signale für den einzelnen Handelstag.</li>
              <li>Quellen: Kurse aus eToro-Marktdaten, Makrodaten von ${SRC("https://fred.stlouisfed.org/", "FRED (Federal Reserve Bank of St. Louis)")}. Veröffentlicht werden nur abgeleitete Kennzahlen.${(d.errors || []).length ? ` Hinweise dieser Runde: ${esc(d.errors.join(" · "))}` : ""}</li>
            </ul>
          </details>`;
      }
    }
    const ov = $("ovMarket");
    if (ov) ov.innerHTML = market ? heroHtml(market, true) : "";
  }

  async function load() {
    const t = Date.now();
    const [local, raw] = await Promise.all([get(`data/market.json?t=${t}`), get(`${RAW}?t=${t}`)]);
    const next = [local, raw].filter(d => d && d.updated && d.overall).sort((a, b) => new Date(b.updated) - new Date(a.updated))[0] || null;
    if (next) market = next;
    window.DTD.market = market;
    window.dispatchEvent(new Event("dtd:market"));
    render();
  }
  window.DTD.loadMarketLive = () => tvWidget("marketOverview", "market-overview", {
    ...COMMON, dateRange: "1D", showChart: true, width: "100%", height: "100%", showSymbolLogo: true, showFloatingTooltip: true,
    plotLineColorGrowing: PAL.up, plotLineColorFalling: PAL.down, gridLineColor: "rgba(255,255,255,0.06)", scaleFontColor: "#8d8d96",
    belowLineFillColorGrowing: "rgba(0,230,118,0.12)", belowLineFillColorFalling: "rgba(255,61,87,0.12)",
    belowLineFillColorGrowingBottom: "rgba(0,230,118,0)", belowLineFillColorFallingBottom: "rgba(255,61,87,0)",
    symbolActiveColor: "rgba(255,255,255,0.08)",
    tabs: [
      { title: "Indizes", symbols: [{ s: "FOREXCOM:SPXUSD", d: "S&P 500" }, { s: "FOREXCOM:NSXUSD", d: "Nasdaq 100" }, { s: "XETR:DAX", d: "DAX" }, { s: "TVC:VIX", d: "VIX (Angst-Index)" }] },
      { title: "Rohstoffe", symbols: [{ s: "TVC:GOLD", d: "Gold" }, { s: "TVC:USOIL", d: "Öl (WTI)" }, { s: "TVC:SILVER", d: "Silber" }] },
      { title: "Krypto & Devisen", symbols: [{ s: "BITSTAMP:BTCUSD", d: "Bitcoin" }, { s: "BITSTAMP:ETHUSD", d: "Ethereum" }, { s: "FX:EURUSD", d: "EUR/USD" }] },
    ],
  });

  render();
  load();
  setInterval(load, 5 * 60 * 1000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
})();

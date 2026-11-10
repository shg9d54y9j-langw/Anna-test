// ---------- Depot-Verlauf: Ihr Depot Tag für Tag gegen S&P 500 und MSCI World ----------
// Bei jedem neuen Stand der Aktien-Daten merkt sich die Seite die Kurse Ihrer Aktien und zweier Vergleichs-ETFs – nur in diesem
// Browser (dtd-pf-hist, Teil der Sicherung). Die Rendite ist zeitgewichtet: Von einem gemerkten Tag zum nächsten zählen nur die
// Aktien, die schon am ersten Tag im Depot waren, gewichtet nach ihrem Wert (ohne Stückzahl gleich gewichtet). Käufe und Verkäufe
// verzerren den Verlauf deshalb nicht. Währungen bleiben außen vor; Tage ohne Besuch werden überbrückt.
(() => {
  const KEY = "dtd-pf-hist", MAX = 400;
  const BENCH = [{ k: "spx", name: "S&P 500", syms: ["SPY", "IVV", "VOO"] }, { k: "world", name: "MSCI World", syms: ["SWDA.L", "ACWI"] }];
  const S = window.DTD.shared;
  const fin = Number.isFinite;
  const DAY = /^\d{4}-\d{2}-\d{2}$/;
  const pct = v => (fin(v) ? `${v > 0 ? "+" : v < 0 ? "−" : "±"}${fmt(Math.abs(v), 1)} %` : "–");
  const dLong = iso => new Date(`${iso}T12:00:00Z`).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
  const read = () => { const h = store.get(KEY, null); return h && Array.isArray(h.days) ? { v: 1, days: h.days.filter(x => x && DAY.test(x.d) && x.px && typeof x.px === "object") } : { v: 1, days: [] }; };
  const holdings = () => { const l = store.get("dtd-portfolio", []); return Array.isArray(l) ? l.filter(h => h && typeof h.sym === "string" && fin(h.buy) && h.buy > 0) : []; };

  // Momentaufnahme zum Datenstand (ein Eintrag je Tag; ein späterer Lauf am selben Tag ersetzt ihn)
  function snapshot() {
    const st = S.get("stocks"), hs = holdings();
    if (!st || !Array.isArray(st.items) || !hs.length) return false;
    const d = String(st.updated || "").slice(0, 10);
    if (!DAY.test(d)) return false;
    const px = {}, val = {};
    for (const h of hs) {
      const x = S.item(h.sym);
      if (!x || !fin(x.last) || !(x.last > 0)) continue;
      px[h.sym] = x.last;
      if (val[h.sym] !== null) val[h.sym] = fin(h.qty) && h.qty > 0 ? (val[h.sym] || 0) + h.qty * x.last : null;
    }
    if (!Object.keys(px).length) return false;
    const bench = {};
    for (const b of BENCH) for (const s of b.syms) { const x = S.item(s); if (x && fin(x.last) && x.last > 0) { bench[b.k] = [s, x.last]; break; } }
    const hist = read(), rec = { d, px, val, bench };
    const i = hist.days.findIndex(x => x.d === d);
    if (i >= 0) hist.days[i] = rec; else hist.days.push(rec);
    hist.days.sort((a, b) => (a.d < b.d ? -1 : 1));
    store.set(KEY, { v: 1, days: hist.days.slice(-MAX) });
    return true;
  }

  // Verlauf in % seit dem ersten Tag: Depot (zeitgewichtet) und die Vergleichs-ETFs
  function series() {
    const days = read().days;
    if (!days.length) return null;
    const out = { dates: [days[0].d], dep: [0], spx: [], world: [] };
    let idx = 1;
    for (let k = 1; k < days.length; k++) {
      const a = days[k - 1], b = days[k];
      const syms = Object.keys(a.px).filter(s => fin(a.px[s]) && a.px[s] > 0 && fin(b.px[s]));
      if (syms.length) {
        const byVal = syms.every(s => fin(a.val && a.val[s]) && a.val[s] > 0);
        const tot = byVal ? syms.reduce((t, s) => t + a.val[s], 0) : syms.length;
        idx *= 1 + syms.reduce((t, s) => t + (byVal ? a.val[s] / tot : 1 / tot) * (b.px[s] / a.px[s] - 1), 0);
      }
      out.dates.push(b.d);
      out.dep.push((idx - 1) * 100);
    }
    for (const bm of BENCH) {
      const first = days.find(x => x.bench && x.bench[bm.k]);
      out[bm.k] = days.map(x => (first && x.bench && x.bench[bm.k] && x.bench[bm.k][0] === first.bench[bm.k][0] ? (x.bench[bm.k][1] / first.bench[bm.k][1] - 1) * 100 : null));
    }
    return out;
  }
  const lastOf = a => { for (let i = a.length - 1; i >= 0; i--) if (fin(a[i])) return a[i]; return null; };

  function card() {
    if (!holdings().length) return "";
    const sr = series();
    if (!sr || sr.dates.length < 2) {
      return `<article class="card" id="pfHist" data-section="Verlauf"><h2 class="card-title">Depot-Verlauf</h2>
        <p class="small">Der Verlauf beginnt${sr ? ` am ${dLong(sr.dates[0])}` : " mit dem nächsten Datenstand"}: Bei jedem neuen Stand der Aktien-Daten (an Börsentagen zweimal) merkt sich die Seite die Kurse Ihrer Aktien – nur in diesem Browser. Ab dem nächsten Stand sehen Sie hier eine Linie im Vergleich mit dem S&amp;P 500 und dem MSCI World.</p></article>`;
    }
    const dep = lastOf(sr.dep), spx = lastOf(sr.spx), world = lastOf(sr.world);
    const lead = fin(dep) && fin(world) ? dep - world : fin(dep) && fin(spx) ? dep - spx : null;
    return `<article class="card" id="pfHist" data-section="Verlauf"><div class="card-head"><h2 class="card-title">Depot-Verlauf</h2><span class="muted small">seit ${dLong(sr.dates[0])} · ${sr.dates.length} Tage</span></div>
      <div class="stats">${kpi("Ihr Depot", `<span class="${dep < 0 ? "down" : "up"}">${pct(dep)}</span>`)}${kpi("S&amp;P 500", pct(spx))}${kpi("MSCI World", pct(world))}${kpi(fin(world) ? "Vorsprung zum MSCI World" : "Vorsprung zum S&amp;P 500", fin(lead) ? `<span class="${lead < 0 ? "down" : "up"}">${pct(lead).replace(" %", " Pkt.")}</span>` : "–")}</div>
      <div class="legend-row" style="margin-top:12px"><span class="legend-item"><span class="lkey" style="background:${PAL.series1}"></span>Ihr Depot</span><span class="legend-item"><span class="lkey dash" style="color:${PAL.gray}"></span>S&amp;P 500</span><span class="legend-item"><span class="lkey dot" style="color:${PAL.series2}"></span>MSCI World</span></div>
      <div class="chart-host" id="pfHistChart"></div>
      <p class="hint">Zeitgewichtet: Käufe und Verkäufe verzerren die Linie nicht. Gerechnet in der Währung jeder Aktie, ohne Wechselkurse, Gebühren und Dividenden. Nur in diesem Browser gespeichert – Tage ohne Besuch werden überbrückt.</p></article>`;
  }
  function draw() {
    const host = document.getElementById("pfHistChart"), sr = series();
    if (!host || !sr || sr.dates.length < 2 || !window.DTD.lineChart) return;
    window.DTD.lineChart(host, { dates: sr.dates, label: "Depot-Verlauf", series: [
      { name: "Ihr Depot", short: "Depot", color: PAL.series1, width: 2.5, values: sr.dep },
      { name: "S&P 500", short: "S&P 500", color: PAL.gray, dash: "5 4", values: sr.spx },
      { name: "MSCI World", short: "World", color: PAL.series2, dash: "1.5 3.5", values: sr.world },
    ] });
  }
  // bei jedem neuen Datenstand merken
  window.addEventListener("dtd:shared", e => { if (e.detail === "stocks") snapshot(); });
  setTimeout(() => { if (S.get("stocks")) snapshot(); }, 0);
  let lastW = 0;
  window.addEventListener("resize", () => { const el = document.getElementById("pfHistChart"); if (el && Math.abs(el.clientWidth - lastW) > 30) { lastW = el.clientWidth; draw(); } });
  window.DTD.depotHistoryCard = card;
  window.DTD.drawDepotHistory = draw;
  window.DTD.depotHistorySnapshot = snapshot;
  window.DTD.depotHistorySeries = series;
})();

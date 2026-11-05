// ---------- Rückblick-Test der Tageswahl-Methode ----------
// Ehrlicher Test „außerhalb der Stichprobe“: In jedem Monat wird nur mit den Daten bis zum Vormonat gewählt –
// genau wie die echte Tageswahl (Schrumpfung, Bewertung je Schwankung, Drawdown-Grenze, Wechsel nur außerhalb der Top 5).
// Verglichen mit dem Durchschnitt aller zulässigen Trader und mit der naiven Wahl „höchste bisherige Rendite“.
(() => {
  const RAW = "https://raw.githubusercontent.com/shg9d54y9j-langw/Anna-test/claude/daytrade-website/data/returns.json";
  const COST = 0.3, MIN_MONTHS = 24, MAX_DD = 20, KEEP = 5, CORR_WINDOW = 24;
  const okName = u => typeof u === "string" && /^[A-Za-z0-9_.-]{1,40}$/.test(u);
  const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
  const sd = a => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
  const get = url => fetch(url, { cache: "no-store" }).then(r => (r.ok ? r.json() : null)).catch(() => null);
  const sign = (x, d = 1) => (x > 0 ? "+" : "") + fmt(x, d);
  let result = null, loading = false, showNaive = false;

  function maxDD(rets) {
    let eq = 1, peak = 1, dd = 0;
    for (const r of rets) { eq *= 1 + Math.max(r, -99) / 100; peak = Math.max(peak, eq); dd = Math.max(dd, 1 - eq / peak); }
    return dd * 100;
  }
  function avgCorr(rows) {
    // mittlere paarweise Korrelation über gemeinsame Monate
    let sum = 0, cnt = 0;
    for (let a = 0; a < rows.length; a++) for (let b = a + 1; b < rows.length; b++) {
      const x = [], y = [];
      for (let k = 0; k < rows[a].length; k++) if (rows[a][k] !== null && rows[b][k] !== null) { x.push(rows[a][k]); y.push(rows[b][k]); }
      if (x.length < 12) continue;
      const c = TradeStats.correlation(x, y);
      if (Number.isFinite(c)) { sum += c; cnt++; }
    }
    return cnt ? sum / cnt : 0;
  }

  function run(data) {
    const traders = (data.traders || []).filter(t => okName(t.userName) && Array.isArray(t.months));
    const months = [...new Set(traders.flatMap(t => t.months.map(m => m[0])))].sort();
    const at = new Map(months.map((m, i) => [m, i]));
    const R = traders.map(t => { const a = new Array(months.length).fill(null); for (const [m, g] of t.months) if (Number.isFinite(g)) a[at.get(m)] = g; return a; });
    let pickM = null, pickN = null;
    const rows = [];
    for (let t = MIN_MONTHS; t < months.length; t++) {
      const pool = [];
      for (let i = 0; i < traders.length; i++) {
        if (R[i][t] === null) continue;
        const hist = R[i].slice(Math.max(0, t - 60), t).filter(x => x !== null);
        if (hist.length < MIN_MONTHS || maxDD(hist) > MAX_DD) continue;
        pool.push({ i, mu: mean(hist), sd: sd(hist), n: hist.length });
      }
      if (pool.length < 5) continue;
      const rho = avgCorr(pool.map(p => R[p.i].slice(t - CORR_WINDOW, t)));
      const noise = 1 - Math.min(0.95, Math.max(0, rho));
      const shr = TradeStats.shrink(pool.map(p => ({ mean: p.mu, se2: (p.sd * p.sd) / p.n * noise })));
      pool.forEach((p, k) => { p.score = p.sd > 0 ? shr.post[k].mean / p.sd : 0; });
      const byScore = pool.filter(p => p.score > 0).sort((a, b) => b.score - a.score);
      const byMean = pool.slice().sort((a, b) => b.mu - a.mu);
      const choose = (list, prev) => {
        const pos = prev === null ? -1 : list.findIndex(p => p.i === prev);
        return pos >= 0 && pos < KEEP ? prev : list.length ? list[0].i : null;
      };
      const nm = choose(byScore, pickM), nn = choose(byMean, pickN);
      const cost = (now, before) => (now === before ? 0 : now === null || before === null ? COST / 2 : COST);
      rows.push({
        month: months[t],
        method: (nm === null ? 0 : R[nm][t]) - cost(nm, pickM),
        naive: (nn === null ? 0 : R[nn][t]) - cost(nn, pickN),
        avg: mean(pool.map(p => R[p.i][t])),
        pick: nm === null ? null : traders[nm].userName, naivePick: nn === null ? null : traders[nn].userName,
        switched: nm !== pickM, pool: pool.length,
      });
      pickM = nm; pickN = nn;
    }
    const series = key => rows.map(r => r[key]);
    const growth = arr => { let e = 100; return [100, ...arr.map(r => (e *= 1 + r / 100))]; };
    const summarize = a => {
      const g = growth(a);
      return { cagr: (Math.pow(g[g.length - 1] / 100, 12 / a.length) - 1) * 100, mdd: maxDD(a), vol: sd(a) * Math.sqrt(12),
        sharpe: mean(a) / sd(a) * Math.sqrt(12), end: g[g.length - 1], growth: g };
    };
    const m = series("method"), av = series("avg");
    const excess = m.map((x, k) => x - av[k]);
    // Fairer Vergleich bei gleichem Risiko: Methode auf die Schwankung des Durchschnitts skaliert (größerer Anteil am Konto)
    const k = sd(av) / sd(m), matched = m.map(x => x * k), mex = matched.map((x, j) => x - av[j]);
    const tval = a => mean(a) / (sd(a) / Math.sqrt(a.length));
    return { rows, months: rows.map(r => r.month), method: summarize(m), naive: summarize(series("naive")), avg: summarize(av),
      matched: { ...summarize(matched), scale: k, mean: mean(mex), t: tval(mex) },
      excess: { mean: mean(excess), t: tval(excess), hit: excess.filter(x => x > 0).length / excess.length },
      switches: rows.filter((r, j) => j > 0 && r.switched).length, pool: Math.round(mean(rows.map(r => r.pool))), updated: data.updated };
  }

  // ---------- Diagramm: Wachstum von 100 $ (drei Linien, Fadenkreuz mit Werten) ----------
  const monthLabel = k => { const [y, m] = k.split("-"); return `${["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"][+m - 1]} ${y.slice(2)}`; };
  function niceTicks(min, max, count) {
    const span = max - min || 1, step0 = span / count, mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const step = [1, 2, 2.5, 5, 10].map(s => s * mag).find(s => span / s <= count) || 10 * mag;
    const out = [];
    for (let v = Math.floor(min / step) * step; v <= max + step * 0.001; v += step) out.push(+v.toFixed(6));
    if (out[out.length - 1] < max) out.push(out[out.length - 1] + step);
    return out;
  }
  function draw(host, res) {
    const W = Math.max(300, host.clientWidth), H = W < 520 ? 240 : 300, m = { l: 54, r: W < 520 ? 12 : 128, t: 14, b: 26 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    const S = [
      { key: "method", name: "Tageswahl-Methode", short: "Methode", color: PAL.series1, width: 2.5, dash: "" },
      { key: "naive", name: "Höchste bisherige Rendite", short: "Naiv", color: PAL.series2, width: 2, dash: "" },
      { key: "avg", name: "Durchschnitt aller Trader", short: "Schnitt", color: PAL.gray, width: 2, dash: "5 4" },
    ].filter(x => showNaive || x.key !== "naive");
    const all = S.flatMap(s => res[s.key].growth);
    const ticks = niceTicks(Math.min(100, ...all), Math.max(100, ...all), 4);
    const y0 = ticks[0], y1 = ticks[ticks.length - 1], N = res.months.length;
    const X = i => m.l + i / N * pw, Y = v => m.t + (y1 - v) / (y1 - y0) * ph;
    const path = g => g.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join("");
    const labels = W < 520 ? "" : S.map(s => { const g = res[s.key].growth; return { s, y: Y(g[g.length - 1]), v: g[g.length - 1] }; })
      .sort((a, b) => a.y - b.y).map((o, k, arr) => { if (k && o.y - arr[k - 1].y < 15) o.y = arr[k - 1].y + 15; return o; })
      .map(o => `<text class="dlabel" x="${m.l + pw + 8}" y="${o.y + 4}">${fmt(o.v, 0)} $ · ${o.s.short}</text>`).join("");
    host.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Wachstum von 100 $: Methode ${fmt(res.method.end, 0)} $, Durchschnitt ${fmt(res.avg.end, 0)} $, naive Wahl ${fmt(res.naive.end, 0)} $">
      ${ticks.map(t => `<line class="${t === 100 ? "base" : "grid"}" x1="${m.l}" x2="${m.l + pw}" y1="${Y(t)}" y2="${Y(t)}"/><text class="tick" x="${m.l - 6}" y="${Y(t) + 4}" text-anchor="end">${fmt(t, 0)} $</text>`).join("")}
      ${S.slice().reverse().map(s => `<path d="${path(res[s.key].growth)}" fill="none" stroke="${s.color}" stroke-width="${s.width}" stroke-dasharray="${s.dash}" stroke-linejoin="round" stroke-linecap="round"/>`).join("")}
      ${S.map(s => { const g = res[s.key].growth; return `<circle cx="${X(N)}" cy="${Y(g[N])}" r="4" fill="${s.color}" stroke="${PAL.surface}" stroke-width="2"/>`; }).join("")}
      ${labels}
      <text class="tick" x="${m.l}" y="${H - 6}">${monthLabel(res.months[0])}</text>
      <text class="tick" x="${m.l + pw}" y="${H - 6}" text-anchor="end">${monthLabel(res.months[N - 1])}</text>
      <line class="cross" x1="0" x2="0" y1="${m.t}" y2="${m.t + ph}" visibility="hidden"/>
      <rect class="hit" x="${m.l}" y="${m.t}" width="${pw}" height="${ph}" fill="transparent" tabindex="0" aria-label="Werte je Monat anzeigen"/>
    </svg>`;
    const svg = host.querySelector("svg"), cross = svg.querySelector(".cross"), hit = svg.querySelector(".hit");
    let tip = host.querySelector(".viz-tip");
    if (!tip) { tip = document.createElement("div"); tip.className = "viz-tip"; tip.hidden = true; host.append(tip); }
    let idx = N;
    const show = i => {
      idx = Math.max(1, Math.min(N, i));
      const x = X(idx);
      cross.setAttribute("x1", x); cross.setAttribute("x2", x); cross.setAttribute("visibility", "visible");
      const r = res.rows[idx - 1];
      tip.innerHTML = `<div class="tip-head">${monthLabel(r.month)} · Wahl: ${r.pick ? esc(r.pick) : "keine (Kasse)"}</div>` + S.map(s =>
        `<div class="tip-row"><span class="lkey" style="background:${s.color}"></span>${s.name}: <strong>${fmt(res[s.key].growth[idx], 0)} $</strong> <span class="${r[s.key] < 0 ? "down" : "up"}">${sign(r[s.key])} %</span></div>`).join("");
      tip.hidden = false;
      const wTip = tip.offsetWidth;
      tip.style.left = `${x + 12 + wTip > host.clientWidth ? Math.max(8, x - wTip - 12) : x + 12}px`;
      tip.style.top = "8px";
    };
    const hide = () => { cross.setAttribute("visibility", "hidden"); tip.hidden = true; };
    const fromEvent = e => { const b = svg.getBoundingClientRect(); return Math.round(((e.clientX - b.left) * (W / b.width) - m.l) / pw * N); };
    hit.addEventListener("pointermove", e => show(fromEvent(e)));
    hit.addEventListener("pointerleave", hide);
    hit.addEventListener("focus", () => show(idx));
    hit.addEventListener("blur", hide);
    hit.addEventListener("keydown", e => { if (e.key === "ArrowLeft") { show(idx - 1); e.preventDefault(); } if (e.key === "ArrowRight") { show(idx + 1); e.preventDefault(); } });
  }

  function render() {
    const host = $("backtest");
    if (!host) return;
    if (!result) { host.innerHTML = `<article class="card"><h2 class="card-title">Rückblick-Test</h2><p class="muted">${loading ? "Rechne mit allen Monatsrenditen …" : "Noch keine Monatsrenditen vorhanden."}</p></article>`; return; }
    const r = result, mt = r.matched;
    const verdict = mt.t > 2 ? `<span class="light green">Bei gleichem Risiko besser – statistisch auffällig</span>`
      : mt.mean > 0 ? `<span class="light yellow">Bei gleichem Risiko etwas besser – könnte Zufall sein</span>`
      : `<span class="light red">Bei gleichem Risiko nicht besser</span>`;
    const lessRet = r.method.cagr < r.avg.cagr, calmer = r.method.vol < r.avg.vol;
    const plain = `${lessRet ? "Weniger" : "Mehr"} Rendite als der Schnitt (${sign(r.method.cagr)} % statt ${sign(r.avg.cagr)} % pro Jahr), ${calmer ? "aber" : "und"} ${calmer ? "deutlich weniger" : "mehr"} Schwankung (${fmt(r.method.vol, 1)} % statt ${fmt(r.avg.vol, 1)} %) und ein größter Rückgang von nur ${fmt(r.method.mdd, 1)} % (Schnitt ${fmt(r.avg.mdd, 1)} %). Mit ${fmt(mt.scale, 1)}-fachem Betrag – also gleicher Schwankung wie der Schnitt – wären es ${sign(mt.cagr)} % pro Jahr gewesen (t-Wert ${fmt(mt.t, 2)}).`;
    const row = (label, f, cls) => `<tr><td>${label}</td>${["method", "avg", "naive"].map(k2 => `<td class="num ${cls ? cls(r[k2]) : ""}">${f(r[k2])}</td>`).join("")}</tr>`;
    host.innerHTML = `<article class="card">
      <div class="card-head"><h2 class="card-title">Rückblick-Test: Hätte die Methode früher funktioniert?</h2>${verdict}</div>
      <p class="muted small">Jeden Monat von ${monthLabel(r.months[0])} bis ${monthLabel(r.months[r.months.length - 1])} wurde nur mit den Daten bis zum Vormonat gewählt – mit denselben Regeln wie die Tageswahl. Kosten von ${fmt(COST, 1)} % je Wechsel sind abgezogen. Im Schnitt standen ${r.pool} Trader zur Auswahl.</p>
      <p style="margin:12px 0 0">${plain}</p>
      <div class="table-wrap" style="margin-top:12px"><table>
        <thead><tr><th></th><th class="num">Tageswahl-Methode</th><th class="num">Ø aller Trader</th><th class="num">Naive Wahl</th></tr></thead>
        <tbody>
          ${row("Rendite pro Jahr", x => `${sign(x.cagr)} %`, x => (x.cagr < 0 ? "down" : "up"))}
          ${row("Schwankung pro Jahr", x => `${fmt(x.vol, 1)} %`)}
          ${row("Rendite je Schwankung (Sharpe)", x => fmt(x.sharpe, 2))}
          ${row("Größter Rückgang", x => `${fmt(x.mdd, 1)} %`, () => "down")}
          ${row("Aus 100 $ wurden", x => `${fmt(x.end, 0)} $`)}
        </tbody></table></div>
      <p class="muted small">Monate, in denen die Methode besser war als der Schnitt: ${fmt(r.excess.hit * 100, 0)} %. Wechsel der Wahl: ${r.switches}. Die naive Wahl („höchste bisherige Rendite“) sieht nur wegen der Überlebens-Verzerrung so gut aus – siehe unten – und schwankte am stärksten.</p>
      <div class="card-head" style="margin:18px 0 8px"><h3 style="margin:0">Wachstum von 100 $</h3>
        <div class="seg" role="group" aria-label="Linien wählen">
          <button type="button" data-naive="0" aria-pressed="${!showNaive}">Methode und Schnitt</button>
          <button type="button" data-naive="1" aria-pressed="${showNaive}">Mit naiver Wahl</button>
        </div></div>
      <div class="legend-row"><span class="legend-item"><span class="lkey" style="background:${PAL.series1}"></span>Tageswahl-Methode</span>${showNaive ? `<span class="legend-item"><span class="lkey" style="background:${PAL.series2}"></span>Höchste bisherige Rendite (naiv)</span>` : ""}<span class="legend-item"><span class="lkey dash" style="color:${PAL.gray}"></span>Durchschnitt aller Trader</span></div>
      <div class="chart-host" id="btChart"></div>
      <details class="info">
        <summary>Was der Test aussagt – und was nicht</summary>
        <ul class="checklist">
          <li><b>Überlebens-Verzerrung:</b> Getestet wird mit den heute meistkopierten Tradern. Wer zwischendurch aufgegeben hat, fehlt. Alle drei Linien sehen deshalb besser aus als in Wirklichkeit – der <i>Vergleich</i> der Methoden bleibt aber aussagekräftig.</li>
          <li><b>Monate statt Tage:</b> Getestet wird monatlich. Die Tageswahl wechselt ohnehin nur selten.</li>
          <li><b>t-Wert:</b> Ab etwa 2 ist ein Vorsprung selten Zufall; die Forschung verlangt bei vielen ausprobierten Regeln sogar 3 (${DOI("10.1093/rfs/hhv059")}).</li>
          <li><b>Naive Wahl:</b> immer der Trader mit der höchsten bisherigen Durchschnittsrendite – so wählen viele Kopierer. Sie profitiert am stärksten von der Überlebens-Verzerrung: Wer mit hohem Risiko Pech hatte, ist heute nicht mehr unter den Meistkopierten und fehlt im Test.</li>
          <li><b>Gleiches Risiko:</b> Die Methode wählt bewusst ruhige Trader. Fair ist deshalb der Vergleich bei gleicher Schwankung: Methode mit entsprechend größerem Anteil am Konto gegen den Schnitt. Ein t-Wert unter 2 heißt: kein gesicherter Vorsprung.</li>
          <li><b>Fehlende Angaben:</b> Den Risiko-Score der Vergangenheit kennt die Seite nicht; geprüft wird nur der Drawdown bis ${MAX_DD} %.</li>
        </ul>
      </details>
      <details class="info">
        <summary>Alle Monate mit der jeweiligen Wahl</summary>
        <div class="table-wrap"><table><thead><tr><th>Monat</th><th>Wahl der Methode</th><th class="num">Methode</th><th class="num">Ø Trader</th><th class="num">Naiv</th></tr></thead>
          <tbody>${r.rows.slice().reverse().map(x => `<tr><td>${monthLabel(x.month)}</td><td>${x.pick ? esc(x.pick) : "–"}${x.switched ? ` <span class="chip">neu</span>` : ""}</td><td class="num ${x.method < 0 ? "down" : "up"}">${sign(x.method)} %</td><td class="num">${sign(x.avg)} %</td><td class="num">${sign(x.naive)} %</td></tr>`).join("")}</tbody></table></div>
      </details>
    </article>`;
    draw($("btChart"), r);
    host.querySelectorAll("[data-naive]").forEach(b => b.addEventListener("click", () => { showNaive = b.dataset.naive === "1"; render(); }));
  }
  const DOI = doi => `<a href="https://doi.org/${doi}" target="_blank" rel="noopener noreferrer">Harvey, Liu &amp; Zhu 2016</a>`;

  async function start() {
    if (result || loading) return;
    loading = true; render();
    const t = Date.now();
    const list = (await Promise.all([get(`data/returns.json?t=${t}`), get(`${RAW}?t=${t}`)])).filter(d => d && Array.isArray(d.traders));
    const data = list.sort((a, b) => new Date(b.updated) - new Date(a.updated))[0];
    loading = false;
    if (data) { try { result = run(data); } catch (e) { result = null; console.error(e); } }
    window.DTD.backtest = result;
    render();
  }
  window.DTD.startBacktest = start;
  let rt;
  window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { if (result && $("btChart") && $("btChart").clientWidth) draw($("btChart"), result); }, 120); });
})();

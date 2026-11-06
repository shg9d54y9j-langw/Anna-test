// ---------- Trend-Bot: Status, Start/Stopp, heutige Signale, Rückblick-Test, Bot-Tagebuch, Forschung ----------
// Daten: trend-bot.json vom Zweig trend-data (schreibt der Workflow „Trend-Bot“ einmal pro Börsentag).
(() => {
  const RAW = "https://raw.githubusercontent.com/shg9d54y9j-langw/Anna-test/trend-data/trend-bot.json";
  const WORKFLOW = "https://github.com/shg9d54y9j-langw/Anna-test/actions/workflows/trend-bot.yml";
  const SECRETS = "https://github.com/shg9d54y9j-langw/Anna-test/settings/secrets/actions";
  const VARIABLES = "https://github.com/shg9d54y9j-langw/Anna-test/settings/variables/actions";
  const get = url => fetch(url, { cache: "no-store" }).then(r => (r.ok ? r.json() : null)).catch(() => null);
  const sign = (x, d = 1) => (Number.isFinite(x) ? (x > 0 ? "+" : "") + fmt(x, d) : "–");
  const pct = (x, d = 0) => (Number.isFinite(x) ? `${fmt(x * 100, d)} %` : "–");
  const cls = x => (x < 0 ? "down" : x > 0 ? "up" : "");
  const v = t => `<code>${esc(t)}</code>`;
  const SRC = (href, text) => `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`;
  const DOI = (doi, text) => SRC(`https://doi.org/${doi}`, text);
  const dateDe = d => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00Z`).toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" }) : "–");
  const timeDe = d => (d ? new Date(d).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }) : "–");
  let st = null, loading = false, range = null;   // Standard: der längste Rückblick (aussagekräftiger als wenige Jahre)

  // Vergleichsdepot im Rückblick: 60/40 (der Kern allein) – ältere Stände: alle 6 ETFs gleich gewichtet
  const benchLabel = bt => (bt && bt.benchName === "60/40" ? "60/40 fest (Kern allein)" : "Alle 6 ETFs gleich gewichtet");
  const benchShort = bt => (bt && bt.benchName === "60/40" ? "60/40" : "6 ETFs");
  // nächster planmäßiger Lauf: Mo–Fr 14:17 UTC (London und Frankfurt offen)
  function nextRun() {
    const t = new Date();
    for (let i = 0; i < 8; i++) {
      const d = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() + i, 14, 17));
      if (d > t && d.getUTCDay() % 6 !== 0) return d;
    }
    return null;
  }

  function status() {
    if (!st) return { light: "", text: "Lädt", title: "Trend-Bot", sub: "" };
    if (st.setup === false) return { light: "red", text: "Nicht eingerichtet", title: "Bot-Schlüssel fehlt", sub: "Zum Starten braucht der Bot einen eToro-Schlüssel nur für das Demokonto – Anleitung unten, drei Schritte." };
    if (st.enabled && st.stopRequested) return { light: "yellow", text: "Wird gestoppt", title: "Verkauft gerade seine Positionen", sub: "Beim nächsten Lauf sind alle Bot-Positionen geschlossen." };
    if (st.enabled) return { light: "green", text: "Läuft · Demokonto", title: "Handelt selbstständig", sub: `Seit ${dateDe(st.startedAt)} – an jedem Börsentag einmal: prüfen, bei Bedarf umschichten, Tagebuch schreiben.${st.waiting ? ` Gerade: ${esc(st.waiting)}.` : ""}` };
    if (st.stoppedAt) return { light: "yellow", text: "Gestoppt", title: "Pausiert", sub: `Gestoppt am ${dateDe(st.stoppedAt)}. Alle Bot-Positionen wurden verkauft. Neu starten jederzeit mit dem Knopf.` };
    return { light: "yellow", text: "Bereit", title: "Bereit zum Start", sub: "Schlüssel ist eingerichtet, die Signale werden täglich gerechnet. Der Bot kauft erst, wenn Sie ihn starten." };
  }

  function hero() {
    const s = status(), M = st && st.model, nr = nextRun();
    // das Modell-Depot zählt erst ab dem ersten ausgeführten Kauf (vorher: „–“)
    const live = !!(M && M.live), model = live && Number.isFinite(M.index) ? M.index - 100 : null;
    return `<section class="hero ${s.light}">
      <div class="hero-top"><span class="light big ${s.light}">${s.text}</span><span class="muted small">Trend-Bot · nur Demokonto (Spielgeld)${st && st.updated ? ` · Stand ${timeDe(st.updated)} Uhr` : ""}</span></div>
      <div class="hero-title" style="margin-top:14px">${s.title}</div>
      <p class="hero-sub">${s.sub}</p>
      <div class="hero-grid">
        <div class="kpi"><div class="lbl">Spielgeld des Bots</div><div class="val">${st && Number.isFinite(st.capitalEur) ? `${fmt(st.capitalEur, 0)} €` : st && Number.isFinite(st.budgetEur) ? `${fmt(st.budgetEur, 0)} €` : "–"}</div></div>
        <div class="kpi"><div class="lbl">Davon investiert</div><div class="val">${st && st.enabled ? pct(st.exposure) : "–"}</div></div>
        <div class="kpi"><div class="lbl">Modell-Depot seit Start</div><div class="val ${cls(model)}">${model !== null ? `${sign(model)} %` : "–"}</div></div>
        <div class="kpi"><div class="lbl">Rückgang vom Hoch</div><div class="val ${live && st.liveDd > 0 ? "down" : ""}">${live && Number.isFinite(st.liveDd) ? `${fmt(-st.liveDd, 1)} %` : "–"}</div></div>
        <div class="kpi"><div class="lbl">Offene Positionen</div><div class="val ${cls(st && st.openPnlPct)}">${st && Number.isFinite(st.openPnlPct) ? `${sign(st.openPnlPct)} %` : "–"}</div></div>
        <div class="kpi"><div class="lbl">Nächster Lauf</div><div class="val" style="font-size:16px">${nr ? timeDe(nr) : "–"}</div></div>
      </div>
      <div class="btn-row" style="margin-top:18px">
        <a class="btn" href="${WORKFLOW}" target="_blank" rel="noopener noreferrer" data-go-bot="starten">▶ Bot starten</a>
        <a class="btn ghost" href="${WORKFLOW}" target="_blank" rel="noopener noreferrer" data-go-bot="stoppen">■ Bot stoppen</a>
        <button type="button" class="btn ghost" id="botReload">↻ Stand neu laden</button>
      </div>
      <p class="hint" id="botHint">Start und Stopp laufen über GitHub, damit nur Sie den Bot steuern können: Der Knopf öffnet die Seite <b>„Trend-Bot“</b> → dort <b>„Run workflow“</b> → Befehl <b>starten</b> bzw. <b>stoppen</b> wählen → grünen Knopf <b>„Run workflow“</b>. Nach etwa einer Minute steht der neue Stand hier.</p>
    </section>`;
  }

  function signalsCard() {
    const S = st && st.signals;
    if (!S || !S.assets) return `<article class="card" data-section="Heute"><h2 class="card-title">Heute</h2><p class="muted">Die Signale erscheinen nach dem ersten Lauf des Workflows „Trend-Bot“ (an Börsentagen gegen 15:20 Uhr, im Sommer 16:20 Uhr).${st && st.signalErrors && st.signalErrors.length ? ` Meldung: ${esc(st.signalErrors.join(" · "))}` : ""}</p></article>`;
    const held = new Map((st.holdings || []).map(h => [h.key, h]));
    const target = st.enabled && st.target ? st.target : null;
    const blocked = st.blocked || {};
    // gekauft wird ein europäisches Gegenstück (UCITS); zuletzt der US-ETF selbst – den lehnt eToro bei gesperrten CFDs ab
    // kaufbar: nicht gesperrt, laut eToro offen und – wenn das Konto keine CFDs darf – als echter Anteil erhältlich
    const usable = t => !blocked[t.id] && !(t.elig && t.elig.open === false) && !(st.cfdBlocked && t.elig && t.elig.real === false);
    const viaSym = a => { const h = held.get(a.key), list = (a.trade || []).filter(usable); return (h && h.via) || (list[0] && list[0].sym) || null; };
    // Handy: statt der Spalte „Gekauft als“ eine Zeile unter dem Signal
    const viaSm = a => { const s = viaSym(a); return `<span class="only-sm muted small">${s ? `gekauft als <b>${esc(s)}</b>` : "Anteil im Geldmarkt"}</span>`; };
    const via = a => {
      const sym = viaSym(a);
      const v = (a.trade || []).find(t => t.sym === sym);
      if (!sym) return `<span class="muted small">kein kaufbares ETF – Anteil im Geldmarkt</span>`;
      return `<b>${esc(sym)}</b>${v && v.name && !v.us ? ` <span class="muted small vname">${esc(v.name)}</span>` : v && v.us ? ` <span class="muted small">US-ETF</span>` : ""}`;
    };
    const sq = checks => `<span class="sq-row" aria-label="${checks.filter(Boolean).length} von 4 Prüfungen erfüllt">${checks.map((c, i) => `<span class="sq ${c ? "on" : ""}" title="${["3 Monate", "6 Monate", "12 Monate", "200-Tage-Schnitt"][i]}: ${c ? "positiv" : "negativ"}"></span>`).join("")}</span>`;
    const split = a => (Number.isFinite(a.core) ? `<div class="muted small">${a.core > 0 ? `Kern ${pct(a.core, 0)}<br>` : ""}Trend ${pct(a.trend, 1)}</div>` : "");
    const rows = S.assets.map(a => {
      const goal = target ? target[a.key] : a.weightBase ?? a.weight, have = held.get(a.key);
      return `<tr><td><b>${esc(a.sym)}</b> <span class="muted small aname">${esc(a.name)}</span>${viaSm(a)}</td><td class="opt">${via(a)}</td>
        <td>${sq(a.checks || [])} <span class="muted small opt">${fmt(a.score * 4, 0)}/4</span></td>
        <td class="num opt ${cls(a.r12)}">${sign(a.r12)} %</td><td class="num opt">${fmt(a.vol, 1)} %</td>
        <td class="num"><b>${pct(goal, 1)}</b>${split(a)}</td><td class="num">${st.enabled && have ? pct(have.pct, 1) : "–"}</td></tr>`;
    }).join("");
    const C = S.cash;
    const cashRow = C ? (() => {
      const goal = target ? target.cash : C.weight, have = held.get("cash");
      return `<tr><td><b>Geldmarkt</b> <span class="muted small aname">freies Geld des Trend-Teils${C.rate ? `, Zins ${fmt(C.rate.value, 2)} % p. a.` : ""}</span>${viaSm(C)}</td><td class="opt">${via(C)}</td>
        <td class="muted small">immer<span class="opt"> – kein Trend nötig</span></td><td class="num opt">–</td><td class="num opt">–</td>
        <td class="num"><b>${pct(goal, 1)}</b></td><td class="num">${st.enabled && have ? pct(have.pct, 1) : "–"}</td></tr>`;
    })() : "";
    const sum = target ? Object.entries(target).filter(([k]) => k !== "cash").reduce((x, [, y]) => x + y, 0) : S.assets.reduce((x, a) => x + (a.weightBase ?? a.weight), 0);
    const brake = st.enabled ? st.ddMult : 1;
    return `<article class="card" data-section="Heute">
      <div class="card-head"><h2 class="card-title">Heute: was der Bot halten will</h2><span class="muted small">Kurse bis ${dateDe(S.asOf)}</span></div>
      <div class="table-wrap"><table class="sig">
        <thead><tr><th>Signal</th><th class="opt">Gekauft als</th><th>Trend<span class="opt"> (3M · 6M · 12M · 200T)</span></th><th class="num opt">12 Monate</th><th class="num opt">Schwankung</th><th class="num">Ziel</th><th class="num">Ist</th></tr></thead>
        <tbody>${rows}${cashRow}</tbody></table></div>
      <p class="hint">${S.core ? `<b>Aufbau:</b> Die Hälfte des Spielgelds ist fester Kern und immer investiert (60 % S&amp;P 500, 40 % US-Staatsanleihen), die andere Hälfte steuert der selbstlernende Trend-Teil; was er nicht braucht, liegt verzinst im Geldmarkt. ` : ""}In Märkten zusammen: <b>${pct(sum, 0)}</b>${C ? `, im Geldmarkt ${pct(target ? target.cash : C.weight, 0)}` : ", der Rest bleibt als Geld im Konto"}. Depot-Schwankung ${fmt(S.portVol, 1)} % pro Jahr.
        Verlustbremse im Trend-Teil: ${brake < 1 ? `<b>aktiv – nur ${fmt(brake * 100, 0)} % des üblichen Einsatzes</b>` : "aus"}. Ein Kästchen pro Prüfung: gefüllt = positiv; Trends mit Dividenden und Zinsen gerechnet.
        Die Signale kommen aus US-ETFs mit langer Kurshistorie. Gekauft werden gleichwertige europäische UCITS-ETFs als echte Anteile, weil eToro US-ETFs Kunden in der EU nur als CFD anbietet${Object.keys(blocked).length ? ` – gesperrt für Ihr Konto: ${Object.values(blocked).map(b => esc(b.sym)).join(", ")}` : ""}.</p>
    </article>`;
  }

  // Wachstum von 100 im Rückblick: Bot, Vergleichsdepot (60/40 bzw. alle 6 ETFs gleich), S&P 500
  function chart(host, bt) {
    const c = bt.curve, N = c.length - 1;
    if (N < 2) { host.innerHTML = ""; return; }
    const W = Math.max(240, host.clientWidth), H = W < 520 ? 240 : 300, m = { l: 48, r: W < 520 ? 12 : 150, t: 14, b: 26 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    const S = [
      { i: 1, name: "Trend-Bot", short: "Bot", color: PAL.series1, width: 2.5, dash: "" },
      { i: 2, name: benchLabel(bt), short: benchShort(bt), color: PAL.series2, width: 2, dash: "" },
      { i: 3, name: "S&P 500 (SPY)", short: "S&P 500", color: PAL.gray, width: 2, dash: "5 4" },
    ];
    const val = (row, i) => row[i] / c[0][i] * 100;
    const all = S.flatMap(s => c.map(row => val(row, s.i)));
    const lo = Math.min(100, ...all), hi = Math.max(100, ...all);
    const step = [5, 10, 20, 25, 50, 100, 200].find(x => (hi - lo) / x <= 5) || 500;
    const y0 = Math.floor(lo / step) * step, y1 = Math.ceil(hi / step) * step;
    const X = k => m.l + k / N * pw, Y = x => m.t + (y1 - x) / (y1 - y0) * ph;
    const ticks = []; for (let t = y0; t <= y1 + 1e-9; t += step) ticks.push(t);
    const path = s => c.map((row, k) => `${k ? "L" : "M"}${X(k).toFixed(1)},${Y(val(row, s.i)).toFixed(1)}`).join("");
    const labels = W < 520 ? "" : S.map(s => ({ s, y: Y(val(c[N], s.i)), v: val(c[N], s.i) })).sort((a, b) => a.y - b.y)
      .map((o, k, arr) => { if (k && o.y - arr[k - 1].y < 15) o.y = arr[k - 1].y + 15; return o; })
      .map(o => `<text class="dlabel" x="${m.l + pw + 8}" y="${o.y + 4}">${fmt(o.v, 0)} · ${o.s.short}</text>`).join("");
    host.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Wachstum von 100: Bot ${fmt(val(c[N], 1), 0)}, sechs ETFs ${fmt(val(c[N], 2), 0)}, S&P 500 ${fmt(val(c[N], 3), 0)}">
      ${ticks.map(t => `<line class="${t === 100 ? "base" : "grid"}" x1="${m.l}" x2="${m.l + pw}" y1="${Y(t)}" y2="${Y(t)}"/><text class="tick" x="${m.l - 6}" y="${Y(t) + 4}" text-anchor="end">${fmt(t, 0)}</text>`).join("")}
      ${S.slice().reverse().map(s => `<path d="${path(s)}" fill="none" stroke="${s.color}" stroke-width="${s.width}" stroke-dasharray="${s.dash}" stroke-linejoin="round" stroke-linecap="round"/>`).join("")}
      ${S.map(s => `<circle cx="${X(N)}" cy="${Y(val(c[N], s.i))}" r="4" fill="${s.color}" stroke="${PAL.surface}" stroke-width="2"/>`).join("")}
      ${labels}
      <text class="tick" x="${m.l}" y="${H - 6}">${dateDe(c[0][0]).slice(5)}</text><text class="tick" x="${m.l + pw}" y="${H - 6}" text-anchor="end">${dateDe(c[N][0]).slice(5)}</text>
      <line class="cross" x1="0" x2="0" y1="${m.t}" y2="${m.t + ph}" visibility="hidden"/>
      <rect class="hit" x="${m.l}" y="${m.t}" width="${pw}" height="${ph}" fill="transparent" tabindex="0" aria-label="Werte je Zeitpunkt anzeigen"/>
    </svg>`;
    const svg = host.querySelector("svg"), cross = svg.querySelector(".cross"), hit = svg.querySelector(".hit");
    let tip = host.querySelector(".viz-tip");
    if (!tip) { tip = document.createElement("div"); tip.className = "viz-tip"; tip.hidden = true; host.append(tip); }
    let idx = N;
    const show = k => {
      idx = Math.max(0, Math.min(N, k));
      const x = X(idx);
      cross.setAttribute("x1", x); cross.setAttribute("x2", x); cross.setAttribute("visibility", "visible");
      tip.innerHTML = `<div class="tip-head">${dateDe(c[idx][0])} · Bot investiert ${fmt(c[idx][4] * 100, 0)} %</div>` + S.map(s => `<div class="tip-row"><span class="lkey${s.dash ? " dash" : ""}" style="${s.dash ? `color:${s.color}` : `background:${s.color}`}"></span>${s.name}: <strong>${fmt(val(c[idx], s.i), 1)}</strong></div>`).join("");
      tip.hidden = false;
      const w = tip.offsetWidth;
      tip.style.left = `${x + 12 + w > host.clientWidth ? Math.max(8, x - w - 12) : x + 12}px`; tip.style.top = "8px";
    };
    const hide = () => { cross.setAttribute("visibility", "hidden"); tip.hidden = true; };
    const fromEvent = e => { const b = svg.getBoundingClientRect(); return Math.round(((e.clientX - b.left) * (W / b.width) - m.l) / pw * N); };
    hit.addEventListener("pointermove", e => show(fromEvent(e)));
    hit.addEventListener("pointerleave", hide);
    hit.addEventListener("focus", () => show(idx));
    hit.addEventListener("blur", hide);
    hit.addEventListener("keydown", e => { if (e.key === "ArrowLeft") { show(idx - 1); e.preventDefault(); } if (e.key === "ArrowRight") { show(idx + 1); e.preventDefault(); } });
  }

  function backtestCard() {
    const B = st && st.backtest;
    if (!B || !B.daily) return `<article class="card" data-section="Rückblick"><h2 class="card-title">Rückblick-Test</h2><p class="muted">Erscheint nach dem ersten Lauf des Workflows „Trend-Bot“.</p></article>`;
    if (!range) range = B.weekly ? "weekly" : "daily";
    const bt = range === "weekly" && B.weekly ? B.weekly : B.daily;
    const k = ["bot", "ew", "spy"];
    const row = (label, f, color) => `<tr><td>${label}</td>${k.map(x => `<td class="num ${color ? color(bt[x]) : ""}">${f(bt[x])}</td>`).join("")}</tr>`;
    const years = bt.bot.years.map((y, i) => ({ y: y.year, partial: y.partial, b: y.ret, e: bt.ew.years[i] && bt.ew.years[i].ret, s: bt.spy.years[i] && bt.spy.years[i].ret }));
    const negYears = years.filter(y => !y.partial && y.b < 0).length, fullYears = years.filter(y => !y.partial).length;
    return `<article class="card" data-section="Rückblick">
      <div class="card-head"><h2 class="card-title">Rückblick-Test: Wie hätte der Bot früher abgeschnitten?</h2>
        <div class="seg" role="group" aria-label="Zeitraum wählen">
          ${B.weekly ? `<button type="button" data-range="weekly" aria-pressed="${range === "weekly"}">Wochenkurse ${esc(B.weekly.start.slice(0, 4))}–heute</button>` : ""}
          <button type="button" data-range="daily" aria-pressed="${range === "daily"}">Tageskurse ${esc(B.daily.start.slice(0, 4))}–heute</button>
        </div></div>
      <p class="muted small">${dateDe(bt.start)} bis ${dateDe(bt.end)}, mit genau den Regeln des Bots und eToro-Kursen, Dividenden und Zinsen geschätzt dazugerechnet, freies Geld verzinst wie T-Bills. Gehandelt wird immer erst am Tag nach dem Signal; ${fmt(0.15, 2)} % Kosten je umgeschichtetem Anteil sind abgezogen. ${range === "weekly" ? "Wochenkurse: längerer Zeitraum, dafür wöchentlich statt täglich geprüft." : ""}${B.trendOnly && B.trendOnly[range] ? ` Der Trend-Teil allein hätte ${sign(B.trendOnly[range].cagr)} % pro Jahr gebracht (größter Rückgang −${fmt(B.trendOnly[range].maxDD, 1)} %).` : ""}</p>
      <p style="margin:12px 0 0">In <b>${fmt(bt.bot.pos12, 0)} %</b> aller 12-Monats-Zeiträume lag der Bot im Plus; der schlechteste brachte <b class="down">${sign(bt.bot.worst12)} %</b>, der größte Rückgang war <b class="down">−${fmt(bt.bot.maxDD, 1)} %</b>${fullYears ? `, ${negYears} von ${fullYears} vollen Kalenderjahren endeten im Minus` : ""}. Zum Vergleich S&amp;P 500: größter Rückgang −${fmt(bt.spy.maxDD, 1)} %.</p>
      <div class="table-wrap" style="margin-top:12px"><table>
        <thead><tr><th></th><th class="num">Trend-Bot</th><th class="num">${benchLabel(bt)}</th><th class="num">S&amp;P 500</th></tr></thead>
        <tbody>
          ${row("Rendite pro Jahr", x => `${sign(x.cagr)} %`, x => cls(x.cagr))}
          ${row("Schwankung pro Jahr", x => `${fmt(x.vol, 1)} %`)}
          ${row("Größter Rückgang", x => `−${fmt(x.maxDD, 1)} %`, () => "down")}
          ${row("Schlechteste 12 Monate", x => `${sign(x.worst12)} %`, x => cls(x.worst12))}
          ${row("12-Monats-Zeiträume im Plus", x => `${fmt(x.pos12, 0)} %`)}
          ${row("Rendite je Schwankung (Sharpe)", x => fmt(x.sharpe, 2))}
        </tbody></table></div>
      <p class="muted small">Im Schnitt investiert: ${fmt(bt.avgExposure, 0)} % · Umschlag ${fmt(bt.turnoverPerYear, 0)} % pro Jahr. Ein Rückblick auf wenige Jahre ist kein Beweis – er zeigt, wie die Regeln in genau dieser Zeit gewirkt hätten.</p>
      <h3 style="margin:18px 0 8px">Wachstum von 100</h3>
      <div class="legend-row"><span class="legend-item"><span class="lkey" style="background:${PAL.series1}"></span>Trend-Bot</span><span class="legend-item"><span class="lkey" style="background:${PAL.series2}"></span>${benchLabel(bt)}</span><span class="legend-item"><span class="lkey dash" style="color:${PAL.gray}"></span>S&amp;P 500 (SPY)</span></div>
      <div class="chart-host" id="botChart"></div>
      <details class="info"><summary>Kalenderjahre</summary>
        <div class="table-wrap"><table><thead><tr><th>Jahr</th><th class="num">Trend-Bot</th><th class="num">${benchShort(bt)}</th><th class="num">S&amp;P 500</th></tr></thead>
        <tbody>${years.slice().reverse().map(y => `<tr><td>${esc(y.y)}${y.partial ? ' <span class="chip">Teiljahr</span>' : ""}</td><td class="num ${cls(y.b)}">${sign(y.b)} %</td><td class="num ${cls(y.e)}">${sign(y.e)} %</td><td class="num ${cls(y.s)}">${sign(y.s)} %</td></tr>`).join("")}</tbody></table></div>
      </details>
    </article>`;
  }

  function learnCard() {
    const L = st && st.learning;
    if (!L || !L.variants) return `<article class="card" data-section="Lernen"><h2 class="card-title">Lernen</h2><p class="muted">Erscheint nach dem nächsten Lauf des Workflows „Trend-Bot“.</p></article>`;
    const src = v => (v.doi ? DOI(v.doi, esc(v.src)) : v.url ? SRC(v.url, esc(v.src)) : esc(v.src));
    const hist = (L.history || []).slice(-6).reverse();
    const bar = w => `<span class="wbar"><span style="width:${Math.max(0, Math.min(100, w * 100 / 0.4))}%"></span></span>`;
    return `<article class="card" data-section="Lernen">
      <div class="card-head"><h2 class="card-title">Lernen im Trend-Teil: fünf erforschte Regeln, der Bot gewichtet selbst</h2><span class="muted small">Gewichte neu am ersten Handelstag jedes Monats</span></div>
      <p class="small">Der Trend-Teil (die Hälfte des Spielgelds) verlässt sich nicht auf eine Regel, sondern verteilt sein Geld auf fünf vorab festgelegte, belegte Regeln. Einmal im Monat schaut er, welche in den letzten 36 Monaten mehr Rendite je Risiko gebracht hat, und gibt ihr etwas mehr Gewicht – höchstens 10 Prozentpunkte pro Monat und immer zur Hälfte gleich verteilt. So passt er sich an, ohne einer Glückssträhne hinterherzulaufen. Die Gewichte entstehen nur aus vergangenen Daten; im Rückblick-Test unten ist genau dieses Lernen schon eingerechnet.</p>
      <div class="table-wrap" style="margin-top:12px"><table>
        <thead><tr><th>Regel</th><th class="num">Gewicht</th><th class="num">Rendite je Risiko (36 M)</th><th class="num">Rückblick ${esc((st.backtest && st.backtest.weekly && st.backtest.weekly.start || "").slice(0, 4))}–heute</th><th class="num">Größter Rückgang</th><th class="num">Heute investiert</th><th>Quelle</th></tr></thead>
        <tbody>${L.variants.map(v => `<tr><td><b>${esc(v.name)}</b></td><td class="num">${bar(v.weight)} ${pct(v.weight, 0)}</td><td class="num">${Number.isFinite(v.score) ? fmt(v.score, 2) : "–"}</td>
          <td class="num ${cls(v.weekly && v.weekly.cagr)}">${v.weekly ? `${sign(v.weekly.cagr)} %` : "–"}</td><td class="num down">${v.weekly ? `−${fmt(v.weekly.maxDD, 1)} %` : "–"}</td><td class="num">${pct(v.exposure, 0)}</td><td class="small">${src(v)}</td></tr>`).join("")}</tbody></table></div>
      ${hist.length ? `<details class="info"><summary>Lernverlauf der letzten Monate</summary><div class="table-wrap"><table><thead><tr><th>Monat</th>${L.variants.map(v => `<th class="num">${esc(v.name.split(" (")[0].split(":")[0])}</th>`).join("")}</tr></thead>
        <tbody>${hist.map(h => `<tr><td>${esc(h[0].slice(0, 7))}</td>${h.slice(1).map(w => `<td class="num">${fmt(w * 100, 0)} %</td>`).join("")}</tr>`).join("")}</tbody></table></div></details>` : ""}
      <p class="hint">Neueste Informationen: täglich die eToro-Kurse aller sechs Märkte, Schwankung und Zusammenhang der Märkte, wöchentlich die Finanzlage der US-Notenbank Chicago (NFCI${L.nfci ? `, zuletzt ${fmt(L.nfci.value, 2).replace("-", "−")} am ${dateDe(L.nfci.asOf)} – ${L.nfci.value > 0 ? "<b>angespannt</b>: die Finanzlage-Regel halbiert riskante Anlagen" : "entspannt"}` : ""}). Einmal im Monat prüft zusätzlich Claude Leistung, Fehler und neue Forschung und schlägt Verbesserungen vor – geändert wird der Bot nur nach Ihrer Freigabe.</p>
    </article>`;
  }

  function journalCard() {
    const J = (st && st.journal) || [];
    const name = k => (k === "cash" ? "Geldmarkt" : (st && st.signals && st.signals.assets || []).find(a => a.key === k)?.sym || k);
    const items = J.slice().reverse().map((j, i, arr) => {
      const prev = arr[i + 1], chg = prev && Number.isFinite(j.model) && Number.isFinite(prev.model) ? (j.model / prev.model - 1) * 100 : null;
      const trades = (j.trades || []).map(t => { const main = `${t.side === "kauf" ? "Kauf" : "Verkauf"} ${esc(t.sym === "alle" ? "aller Positionen" : t.sym)} ${t.pct ? `${fmt(t.pct, 1)} %` : ""}`; return `${t.rejected ? `<s class="muted">${main}</s>` : main}${t.reason || t.units ? ` <span class="muted">(${esc([t.reason, t.units && !/Stückzahl/.test(t.reason || "") ? "nach Stückzahl" : ""].filter(Boolean).join(", "))})</span>` : ""}`; });
      const tgt = j.target ? Object.entries(j.target).filter(([, w]) => w > 0).map(([k, w]) => `${esc(name(k))} ${fmt(w * 100, 0)} %`).join(" · ") : "";
      return `<li class="jr">
        <div class="jr-day"><b>${dateDe(j.day)}</b>${chg !== null ? ` <span class="nowrap ${cls(chg)}">${sign(chg, 2)} %</span>` : ""}</div>
        <div class="jr-body">
          <div>${trades.length ? trades.join("<br>") : `<span class="muted">Keine Umschichtung – alles im Band${j.note ? ` · ${esc(j.note)}` : ""}.</span>`}</div>
          ${j.learnNote ? `<div class="small"><b>${esc(j.learnNote)}</b></div>` : ""}
          <div class="muted small">Modell-Depot ${Number.isFinite(j.model) ? fmt(j.model, 2) : "–"} · Rückgang vom Hoch ${Number.isFinite(j.liveDd) ? `${fmt(j.liveDd, 1)} %` : "–"}${j.ddMult < 1 ? ` · Verlustbremse ${fmt(j.ddMult * 100, 0)} %` : ""} · Ziel investiert ${pct(j.exposureTarget)}${tgt ? ` (${tgt})` : ""}</div>
        </div></li>`;
    }).join("");
    const events = ((st && st.events) || []).slice(-8).reverse().map(e => `<li><span class="muted small">${timeDe(e.at)}</span> · <b>${esc(e.kind)}</b>: ${esc(e.text)}</li>`).join("");
    return `<article class="card" data-section="Bot-Tagebuch">
      <div class="card-head"><h2 class="card-title">Bot-Tagebuch</h2><span class="muted small">schreibt sich jeden Börsentag selbst · nur Prozentwerte</span></div>
      ${items ? `<ol class="journal-list">${items}</ol>` : `<p class="muted">Das Tagebuch füllt sich automatisch ab dem ersten Börsentag nach dem Start: Signale, Käufe und Verkäufe, Modell-Depot und Bremsen – ohne dass Sie etwas tun müssen.</p>`}
      ${events ? `<details class="info"><summary>Meldungen des Bots</summary><ul class="checklist">${events}</ul></details>` : ""}
    </article>`;
  }

  function guideCard() {
    return `<article class="card" data-section="Starten">
      <h2 class="card-title">So starten Sie den Bot – einmal einrichten, dann läuft er allein</h2>
      <ol class="steps">
        <li><b>eToro-Schlüssel nur für das Demokonto:</b> In eToro <b>Einstellungen</b> → <b>Trading</b> → <b>API-Key-Verwaltung</b> → <b>„Neuen Schlüssel erstellen“</b>. Nur ${v("Trading – Demo → Write")} ankreuzen – nichts bei „Trading – Real“, nichts unter „Geld“. (Haben Sie den Schlüssel schon für den Copy-Bot angelegt, überspringen Sie die Schritte 1 und 2.)</li>
        <li><b>Schlüssel sicher hinterlegen:</b> ${SRC(SECRETS, "GitHub → Settings → Secrets → Actions")} → <b>„New repository secret“</b>: ${v("ETORO_BOT_API_KEY")} = öffentlicher Schlüssel, ${v("ETORO_BOT_USER_KEY")} = privater Schlüssel. Schlüssel nie in einen Chat oder eine Nachricht kopieren.</li>
        <li><b>Starten:</b> oben <b>„▶ Bot starten“</b> → GitHub zeigt „Trend-Bot“ → <b>„Run workflow“</b> → Befehl ${v("starten")} → grüner Knopf <b>„Run workflow“</b>.</li>
        <li><b>Fertig.</b> Ab jetzt prüft der Bot an jedem Börsentag gegen 15:20 Uhr (Sommerzeit 16:20 Uhr) selbstständig die Trends, schichtet bei Bedarf um und schreibt das Tagebuch. Wichtige Ereignisse (Start, Stopp, Verlustbremse, Fehler) kommen als GitHub-Benachrichtigung aufs Handy.</li>
        <li><b>Optional – Spielgeld:</b> Standard sind 1.000 € (eToro rechnet in Dollar, der Bot rechnet zum Tageskurs um). Ändern unter ${SRC(VARIABLES, "Variables")}: ${v("TREND_BOT_BUDGET_EUR")} = z. B. ${v("2000")}. Für den Copy-Bot gilt ${v("COPY_BOT_BUDGET_EUR")} (ebenfalls 1.000 €).</li>
        <li><b>Stoppen:</b> gleicher Weg, Befehl ${v("stoppen")}. Der Bot verkauft dann alle seine Positionen; Ihre eigenen Positionen und Kopien fasst er nie an.</li>
      </ol>
      <p class="hint">Sicherheit: Der Bot kennt nur die Demo-Adressen von eToro – Echtgeld ist im Programm gesperrt. Er kauft ohne Hebel, setzt nie auf fallende Kurse, legt bei jeder Position eine Notbremse 30 % unter dem Kaufkurs fest und sendet unklare Aufträge nie ein zweites Mal. Alles ist mit einem nachgebauten eToro-Server automatisch getestet.</p>
    </article>`;
  }

  function rulesCard() {
    return `<article class="card" data-section="Regeln">
      <h2 class="card-title">Was der Bot tut – und warum genau so</h2>
      <ul class="checklist">
        <li><b>Kern + Trend – warum so:</b> Ein Forschungs-Lauf auf echten eToro-Kursen 2011–2026 (getrennt nach zwei Hälften, damit nichts auf Zufall getrimmt ist) zeigte: Reine Trendfolge schützt vor Abstürzen, verpasst aber in langen Aufwärtsjahren viel Rendite. Deshalb ist die Hälfte des Spielgelds ein fester Kern, der immer investiert bleibt – 60 % S&amp;P 500, 40 % US-Staatsanleihen –, die andere Hälfte steuert der selbstlernende Trend-Teil. Diese Aufteilung empfehlen Faber &amp; Richardson in „The Ivy Portfolio“ (2009). Im Rückblick brachte sie deutlich mehr Rendite als der Trend-Teil allein, bei weiterhin kleineren Rückgängen als Aktien allein – die Zahlen stehen unten im Rückblick-Test.</li>
        <li><b>Freies Geld arbeitet mit:</b> Was der Trend-Teil gerade nicht investiert, liegt in einem Geldmarkt-ETF (kurzlaufende US-Staatsanleihen bis 1 Jahr) und bekommt den T-Bill-Zins, statt zinslos im Konto zu liegen. Dividenden und Zinsen der Märkte rechnet der Bot in seine Trends ein – eToros Kurse enthalten sie nicht, Anleihen sahen dadurch früher schlechter aus, als sie waren.</li>
        <li><b>Sechs breite Märkte statt Einzelaktien:</b> US-Aktien (SPY), Aktien anderer Industrieländer (EFA), US-Staatsanleihen (IEF), Gold (GLD), Rohstoffe (DBC), Immobilien (VNQ). Breite Streuung ist der einzige „kostenlose“ Risikoschutz; die Märkte laufen oft gegeneinander.</li>
        <li><b>Gekauft werden europäische Gegenstücke:</b> US-ETFs haben kein Basisinformationsblatt nach der ${SRC("https://eur-lex.europa.eu/eli/reg/2014/1286/oj", "PRIIPs-Verordnung")} und sind für Kunden in der EU bei eToro nur als CFD zu haben – CFDs sind in Ihrem Konto gesperrt. Der Bot sucht deshalb selbst in der eToro-Liste gleichwertige UCITS-ETFs (z. B. einen S&amp;P-500-ETF aus London statt SPY), prüft Name, aktuelle Kurse und Gleichlauf mit dem US-ETF und kauft sie als echte Anteile. Lehnt eToro eines ab, sperrt er es und nimmt sofort das nächste.</li>
        <li><b>Fünf Regeln statt einer:</b> Trend 3–6–12 Monate, schneller Trend 1–3–12, die 10-Monats-Linie, Dual Momentum (nur die drei stärksten Märkte) und Trend plus Finanzlage. Kombinieren ist robuster als jede Einzelregel (${DOI("10.1093/rfs/hhp063", "Rapach, Strauss &amp; Zhou 2010")}); die Gewichte lernt der Bot nur vorsichtig, weil geschätzte Gewichte sonst mehr schaden als nützen (${DOI("10.1093/rfs/hhm075", "DeMiguel, Garlappi &amp; Uppal 2009")}) und Regeln mit gutem Lauf eher weiterlaufen (${DOI("10.1111/jofi.13131", "Ehsani &amp; Linnainmaa 2022")}).</li>
        <li><b>Trend je Markt aus vier Prüfungen (Grundregel):</b> Rendite über 3, 6 und 12 Monate positiv, Kurs über dem 200-Tage-Schnitt. Je mehr erfüllt, desto größer der Anteil; bei 0 von 4 wird sofort verkauft. Zeitreihen-Momentum ist über mehr als 100 Jahre und viele Märkte belegt (${DOI("10.1016/j.jfineco.2011.11.003", "Moskowitz, Ooi &amp; Pedersen 2012")}, ${DOI("10.3905/jpm.2017.44.1.015", "Hurst, Ooi &amp; Pedersen 2017")}, ${DOI("10.3905/jwm.2007.674809", "Faber 2007")}).</li>
        <li><b>Passt sich dem Markt an – automatisch:</b> Ruhige Märkte bekommen mehr Gewicht, unruhige weniger; steigt die Schwankung des ganzen Depots über 10 % pro Jahr, wird alles kleiner (${DOI("10.1111/jofi.12513", "Moreira &amp; Muir 2017")}, ${DOI("10.3905/jpm.2018.45.1.014", "Harvey u. a. 2018")}). Fällt das Modell-Depot mehr als 5 % unter sein Hoch, sinkt der Einsatz schrittweise bis auf die Hälfte (${DOI("10.1111/j.1467-9965.1993.tb00044.x", "Grossman &amp; Zhou 1993")}). In Abwärtsphasen ist der Bot so großteils in Geld.</li>
        <li><b>Täglich prüfen, selten handeln:</b> Voll umgeschichtet wird einmal pro Woche und erst ab 3 Prozentpunkten Abweichung; Ausstiege bei gebrochenem Trend sofort. Wer viel handelt, verliert vor allem an Kosten (${DOI("10.1111/0022-1082.00226", "Barber &amp; Odean 2000")}).</li>
        <li><b>Warum nicht „mit möglichst vielen Informationen füttern“?</b> Jede zusätzliche Regel lässt sich auf die Vergangenheit passend machen – und versagt dann in der Zukunft. Von hunderten veröffentlichten „Erfolgsfaktoren“ halten die meisten strengen Tests nicht stand (${DOI("10.1093/rfs/hhv059", "Harvey, Liu &amp; Zhu 2016")}, ${DOI("10.1090/noti1105", "Bailey u. a. 2014")}). Deshalb nutzt der Bot nur die robustesten Größen: Trend, Schwankung, Zusammenhang der Märkte und den eigenen Verlust. Die Regeln wurden vor dem Test festgelegt und nicht auf gute Rückblick-Zahlen getrimmt.</li>
      </ul>
    </article>`;
  }

  function researchCard() {
    const R = [
      ["Trendfolge (Zeitreihen-Momentum)", "stark", "Über 100 Jahre und viele Märkte positiv, schützt in langen Abschwüngen; Schwäche: Seitwärtsphasen mit Fehlsignalen.", `${DOI("10.3905/jpm.2017.44.1.015", "Hurst u. a. 2017")}`, "gewählt"],
      ["Schwankungssteuerung", "gemischt", "Senkt verlässlich das Risiko großer Verluste; ob sie die Rendite erhöht, ist umstritten.", `${DOI("10.1111/jofi.12513", "Moreira &amp; Muir 2017")}, ${DOI("10.1016/j.jfineco.2020.04.015", "Cederburg u. a. 2020")}`, "als Bremse gewählt"],
      ["Querschnitts-Momentum (Gewinner-Aktien kaufen)", "stark", "Belegt, aber mit seltenen, sehr heftigen Crashs und hohem Umschlag – für ein kleines Konto teuer.", `${DOI("10.1111/j.1540-6261.1993.tb04702.x", "Jegadeesh &amp; Titman 1993")}, ${DOI("10.1016/j.jfineco.2015.12.002", "Daniel &amp; Moskowitz 2016")}`, "im Aktien-Check"],
      ["Kurzfristige Umkehr (Mean Reversion)", "schwach nach Kosten", "Verlierer der Woche erholen sich oft leicht – der Vorteil ist meist kleiner als Spread und Gebühren.", `${DOI("10.2307/2937816", "Lehmann 1990")}`, "nein"],
      ["Paarhandel (Pairs Trading)", "nachlassend", "War profitabel, die Renditen sind seit den 2000ern stark gesunken.", `${DOI("10.1093/rfs/hhj020", "Gatev u. a. 2006")}, ${DOI("10.2469/faj.v66.n4.1", "Do &amp; Faff 2010")}`, "nein"],
      ["Chart-Regeln (Indikatoren)", "nicht belegt", "Nach Korrektur für das Ausprobieren vieler Regeln bleibt kein verlässlicher Vorteil.", `${DOI("10.1111/j.1540-6261.1992.tb04681.x", "Brock u. a. 1992")}, ${DOI("10.1111/0022-1082.00163", "Sullivan u. a. 1999")}`, "nein"],
      ["Maschinelles Lernen", "vielversprechend, schwer", "Kann Renditen in Studien besser vorhersagen, braucht aber riesige Datenmengen und ist sehr anfällig für Selbsttäuschung.", `${DOI("10.1093/rfs/hhaa009", "Gu, Kelly &amp; Xiu 2020")}`, "nein"],
      ["Daytrading- und Hochfrequenz-Bots", "negativ für Privatanleger", "Fast alle privaten Daytrader verlieren; Hochfrequenzhändler gewinnen durch Millisekunden-Vorsprung in Rechenzentren an der Börse.", `${DOI("10.1016/j.finmar.2013.05.006", "Barber u. a. 2014")}, ${DOI("10.1093/qje/qjv027", "Budish u. a. 2015")}`, "nein"],
    ];
    return `<article class="card" data-section="Forschung">
      <h2 class="card-title">Welche Trading-Bots sind erforscht – und welche funktionieren?</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>Art</th><th>Beleglage</th><th>Was die Forschung zeigt</th><th>Quellen</th><th>Hier</th></tr></thead>
        <tbody>${R.map(r => `<tr><td><b>${r[0]}</b></td><td>${r[1]}</td><td>${r[2]}</td><td class="small">${r[3]}</td><td>${r[4]}</td></tr>`).join("")}</tbody></table></div>
      <p class="hint">Am besten belegt für einen automatischen Bot sind Trendfolge über breite Märkte und Risikosteuerung – genau das macht dieser Bot. „Sehr ertragreich“ und „sicher“ schließen sich aus: Mehr erwartete Rendite gibt es nur mit mehr Schwankung.</p>
    </article>`;
  }

  function honestCard() {
    const L = st && st.backtest && (st.backtest.weekly || st.backtest.daily), b = L && L.bot, spy = L && L.spy;
    const neg = b ? b.years.filter(y => !y.partial && y.ret < 0) : [], full = b ? b.years.filter(y => !y.partial).length : 0;
    return `<article class="card" data-section="Ehrlich">
      <h2 class="card-title">Ehrlich: Kann der Bot ein Minus-Jahr haben?</h2>
      <p>Ja. <b>Kein Bot kann garantieren, dass er nach einem Jahr im Plus ist</b> – jede Anlage mit mehr Rendite als Tagesgeld kann Verluste machen. Wer etwas anderes verspricht, lügt oder verkauft etwas.</p>
      <ul class="checklist">
        <li><b>Was die Regeln leisten:</b> Sie machen große Verluste unwahrscheinlicher. In Abwärtsmärkten steigt der Bot schrittweise aus, die Verlustbremse senkt den Einsatz, jede Position hat eine Notbremse.${b ? ` Im Rückblick ${esc(L.start.slice(0, 4))}–heute lagen ${fmt(b.pos12, 0)} % der 12-Monats-Zeiträume im Plus, der schlechteste bei ${sign(b.worst12)} % (S&amp;P 500: ${sign(spy.worst12)} %); ${neg.length} von ${full} vollen Jahren endeten im Minus${neg.length ? ` (${neg.map(y => `${esc(y.year)}: ${sign(y.ret)} %`).join(", ")})` : ""}.` : ""}</li>
        <li><b>Was sie nicht leisten:</b> In Seitwärtsmärkten kauft und verkauft der Bot öfter zur falschen Zeit („Whipsaw“) – das kostet. Auch Trendfolge-Fonds mit Milliarden hatten Jahre im Minus.</li>
        <li><b>Erwartung – der Preis der Sicherheit:</b> deutlich weniger Rendite als „nur Aktien“, dafür viel kleinere Verluste.${b ? ` Im Rückblick ${esc(L.start.slice(0, 4))}–heute: Bot ${sign(b.cagr)} % pro Jahr bei höchstens −${fmt(b.maxDD, 0)} % Rückgang, S&amp;P 500 ${sign(spy.cagr)} % pro Jahr bei bis zu −${fmt(spy.maxDD, 0)} %.` : ""} Gerade in langen Aufwärtsphasen mit kurzen, heftigen Rücksetzern (wie 2011–2021) hinkt Trendfolge hinterher, weil sie nach dem Fall aus- und nach der Erholung wieder einsteigt – deshalb bleibt die Hälfte des Geldes als fester Kern immer investiert. Fallen Aktien und Anleihen gleichzeitig wie 2022, verliert auch der Kern.</li>
        <li><b>„Sehr ertragreich“ und „sicher im Plus“ gibt es nicht zusammen.</b> Wer mehr Rendite will, muss mehr Schwankung aushalten – die belegte Alternative ist ein breiter Aktien-ETF über viele Jahre, mit Rückgängen von 30 % und mehr zwischendurch.</li>
        <li><b>Erst Demo, dann vielleicht echt:</b> Lassen Sie den Bot mindestens 6–12 Monate im Demokonto laufen und vergleichen Sie Tagebuch und Rückblick. Echtgeld ist bewusst gesperrt und wird nur auf Ihren ausdrücklichen Wunsch freigeschaltet.</li>
      </ul>
    </article>`;
  }

  function render() {
    const host = $("botBody");
    if (!host) return;
    if (!st && loading) { host.innerHTML = `<article class="card"><p class="muted">Lade den Stand des Trend-Bots …</p></article>`; return; }
    host.innerHTML = hero() + signalsCard() + learnCard() + backtestCard() + journalCard() + guideCard() + rulesCard() + researchCard() + honestCard();
    const B = st && st.backtest;
    if (B && B.daily && $("botChart")) chart($("botChart"), range === "weekly" && B.weekly ? B.weekly : B.daily);
    host.querySelectorAll("[data-range]").forEach(b => b.addEventListener("click", () => { range = b.dataset.range; render(); }));
    const rl = $("botReload");
    if (rl) rl.addEventListener("click", () => load(true, false));
    host.querySelectorAll("[data-go-bot]").forEach(a => a.addEventListener("click", () => {
      const h = $("botHint");
      if (h) h.innerHTML = `GitHub ist geöffnet: <b>„Run workflow“</b> → Befehl <b>${esc(a.dataset.goBot)}</b> wählen → grüner Knopf <b>„Run workflow“</b>. Danach hier <b>„↻ Stand neu laden“</b>.`;
    }));
    window.dispatchEvent(new Event("dtd:sections"));
  }

  async function load(force = false, quiet = false) {
    if (loading || (st && !force)) return;
    loading = true;
    if (!st) render();
    const t = Date.now();
    const list = (await Promise.all([get(`data/trend-bot.json?t=${t}`), get(`${RAW}?t=${t}`)])).filter(d => d && Array.isArray(d.journal));
    const next = list.sort((a, b) => new Date(b.updated) - new Date(a.updated))[0] || null;
    loading = false;
    if (st && (!next || next.updated === st.updated)) {   // nichts Neues → nicht neu zeichnen
      if (!quiet && $("botHint")) $("botHint").innerHTML = `Kein neuer Stand. Zuletzt aktualisiert: ${timeDe(st.updated)} Uhr. Nach einem Start oder Stopp dauert es etwa eine Minute.`;
      return;
    }
    st = next || { setup: false, journal: [], events: [] };
    window.DTD.trendBot = st;
    window.dispatchEvent(new Event("dtd:trendbot"));
    if (!$("bot").hidden || !st.updated) render(); else needsRender = true;
  }
  let needsRender = false;
  window.addEventListener("hashchange", () => setTimeout(() => { if (needsRender && !$("bot").hidden) { needsRender = false; render(); } }, 0));
  window.DTD.startBot = () => load(false);
  window.DTD.reloadBot = (quiet = true) => load(true, quiet);
  let rt;
  window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { const B = st && st.backtest; if (B && B.daily && $("botChart") && $("botChart").clientWidth) chart($("botChart"), range === "weekly" && B.weekly ? B.weekly : B.daily); }, 120); });
})();

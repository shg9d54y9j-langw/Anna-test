// ---------- Sparplan-Rechner: monatlich in einen ETF sparen – Zinseszins, Kosten, KESt (Österreich), Inflation, Ziel ----------
// Steht unter Werkzeuge → „Sparplan“ (#sparplan). Die Eingaben bleiben nur in diesem Browser (localStorage dtd-sparplan).
// Gerechnet wird Monat für Monat: Rate am Monatsanfang (abzüglich Gebühr), Rendite nach laufenden Kosten (TER); an jedem
// Jahresende 27,5 % KESt auf die Dividenden bzw. ausschüttungsgleichen Erträge (Meldefonds; der Rest bleibt angelegt), beim
// Verkauf 27,5 % auf den übrigen Kursgewinn. Gebühren mindern die Steuer im Privatvermögen nicht (§ 27a Abs. 4 Z 2 EStG).
(() => {
  const KEY = "dtd-sparplan", KEST = 0.275, MAX_M = 720;
  // Feld, Eingabe, Vorgabe, kleinster und größter Wert
  const F = [
    ["start", "spStart", 1000, 0, 1e8], ["rate", "spRate", 200, 0, 1e6], ["years", "spYears", 20, 1, 60], ["ret", "spRet", 7, -10, 20],
    ["goal", "spGoal", 100000, 0, 1e9], ["ter", "spTer", 0.2, 0, 3], ["fee", "spFee", 0, 0, 100], ["dyn", "spDyn", 0, 0, 20],
    ["infl", "spInfl", 2, 0, 15], ["div", "spDiv", 1.8, 0, 10],
  ];
  const PRESETS = [[4, "Vorsichtig ", "4 %"], [7, "Welt-Aktien ", "Ø 7 %"], [9, "Optimistisch ", "9 %"]];   // am Handy nur die Zahl
  const fin = Number.isFinite;
  const num = v => { const x = parseFloat(String(v ?? "").trim().replace(",", ".")); return fin(x) ? x : null; };
  const eur = v => (fin(v) ? `${v < 0 ? "−" : ""}${fmt(Math.abs(v), 0)} €` : "–");
  const eurS = v => (fin(v) ? `${v < 0 ? "−" : v > 0 ? "+" : "±"}${fmt(Math.abs(v), 0)} €` : "–");
  const tickFmt = v => (v >= 1e6 ? `${fmt(v / 1e6, v % 1e6 ? 1 : 0)} Mio. €` : v >= 1e3 ? `${fmt(v / 1e3, v % 1e3 ? 1 : 0)} Tsd. €` : `${fmt(v, 0)} €`);
  const short = v => (v >= 1e6 ? `${fmt(v / 1e6, 2)} Mio. €` : v >= 1e5 ? `${fmt(v / 1e3, 0)} Tsd. €` : v >= 1e3 ? `${fmt(v / 1e3, 1)} Tsd. €` : `${fmt(v, 0)} €`);
  const years = n => `${n} ${n === 1 ? "Jahr" : "Jahren"}`;

  function read() {   // gespeicherte Eingaben; Ungültiges durch die Vorgabe ersetzt
    const s = store.get(KEY, {}) || {}, p = {};
    for (const [k, , d, lo, hi] of F) p[k] = k === "goal" && s.goal === null ? null : fin(s[k]) ? Math.min(hi, Math.max(lo, s[k])) : d;
    p.years = Math.round(p.years);
    return p;
  }
  let P = read(), moreOpen = false;   // „Kosten, Steuer und Inflation“ bleibt offen, wenn die Werkzeuge neu gezeichnet werden
  function fromInputs() {   // leeres Feld (gerade beim Tippen) behält den alten Wert – nur beim Ziel heißt leer „kein Ziel“
    for (const [k, id, , lo, hi] of F) {
      const el = $(id), v = el ? num(el.value) : null;
      if (!el) continue;
      if (k === "goal") P.goal = v === null || v <= 0 ? null : Math.min(hi, v);
      else if (v !== null) P[k] = Math.min(hi, Math.max(lo, v));
    }
    P.years = Math.round(P.years);
    store.set(KEY, P);
  }

  // Monat für Monat; Eintrag m = Stand am Ende von Monat m (0 = heute, nach dem Startbetrag)
  function simulate(p, months = p.years * 12, rate0 = p.rate) {
    const g = Math.pow((1 + p.ret / 100) * (1 - p.ter / 100), 1 / 12) - 1;
    let V = p.start, basis = p.start, paid = p.start, tax = 0, fees = 0, rate = rate0;
    const out = [{ V, basis, paid, tax, fees }];
    for (let m = 1; m <= months; m++) {
      if (m > 1 && (m - 1) % 12 === 0) rate *= 1 + p.dyn / 100;
      if (rate > 0) { const f = Math.min(rate, p.fee); V += rate - f; basis += rate - f; paid += rate; fees += f; }
      V *= 1 + g;
      // Jahresende: KESt auf die Dividenden (bzw. ausschüttungsgleichen Erträge), der Rest bleibt angelegt und zählt als Kaufpreis
      if (m % 12 === 0 && p.div > 0 && V > 0) { const d = V * p.div / 100, t = d * KEST; V -= t; tax += t; basis += d - t; }
      out.push({ V, basis, paid, tax, fees });
    }
    return out;
  }
  const net = s => s.V - Math.max(0, s.V - s.basis) * KEST;   // was nach dem Verkauf und der KESt bleibt
  // nötige Monatsrate für das Ziel in der Laufzeit (auf ganze Euro aufgerundet); 0 = Startbetrag reicht, null = nicht erreichbar
  function neededRate(p) {
    const M = p.years * 12, at = r => net(simulate(p, M, r)[M]);
    if (at(0) >= p.goal) return 0;
    let lo = 0, hi = Math.max(10, p.goal / M);
    for (let k = 0; k < 40 && at(hi) < p.goal; k++) hi *= 2;
    if (at(hi) < p.goal) return null;
    for (let k = 0; k < 60; k++) { const mid = (lo + hi) / 2; if (at(mid) >= p.goal) hi = mid; else lo = mid; }
    return Math.ceil(hi - 1e-9);
  }
  const monthName = m => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + m); return d.toLocaleDateString("de-AT", { month: "long", year: "numeric" }); };
  const span = m => [Math.floor(m / 12) ? years(Math.floor(m / 12)) : "", m % 12 ? `${m % 12} ${m % 12 === 1 ? "Monat" : "Monaten"}` : ""].filter(Boolean).join(" und ");

  function calc() {
    const M = P.years * 12, s = simulate(P), e = s[M];
    const V0 = simulate({ ...P, ter: 0, fee: 0 })[M].V;
    const fTax = Math.max(0, e.V - e.basis) * KEST, nv = e.V - fTax, rf = Math.pow(1 + P.infl / 100, P.years);
    return { M, s, e, fTax, nv, real: nv / rf, costs: Math.max(0, V0 - e.V) };
  }
  function goalHtml() {
    if (!(P.goal > 0)) return `<p class="muted small sp-goal">Tipp: Ein Ziel eintragen – dann steht hier, wann Sie es erreichen und welche Rate dafür nötig ist.</p>`;
    const s = simulate(P, MAX_M), m = s.findIndex(x => net(x) >= P.goal), need = neededRate(P);
    const when = m === 0 ? `Ihr Startbetrag deckt das Ziel von <b>${eur(P.goal)}</b> nach Steuer bereits.`
      : m < 0 ? `Mit ${eur(P.rate)} im Monat erreichen Sie <b>${eur(P.goal)}</b> nach Steuer nicht innerhalb von 60 Jahren.`
      : `Mit ${eur(P.rate)} im Monat erreichen Sie <b>${eur(P.goal)}</b> nach Steuer im <b>${monthName(m)}</b> – in ${span(m)}.`;
    const how = need === null ? `In ${years(P.years)} ist das Ziel mit diesen Annahmen nicht erreichbar.`
      : need === 0 ? `Für das Ziel in ${years(P.years)} reicht schon der Startbetrag.`
      : `Für das Ziel in ${years(P.years)} sind <b>${eur(need)} im Monat</b> nötig${P.dyn ? ` (jedes Jahr um ${fmt(P.dyn, 1)} % mehr)` : ""}.`;
    return `<ul class="sp-goal">
      <li><span class="sa-icon ${m >= 0 ? "up" : "warn-t"}" aria-hidden="true">${m >= 0 ? "✓" : "!"}</span><span>${when}</span></li>
      <li><span class="sa-icon muted" aria-hidden="true">€</span><span>${how}</span></li></ul>`;
  }
  function tableHtml(r) {
    const step = P.years <= 10 ? 1 : P.years <= 30 ? 5 : 10, ys = [], y0 = new Date().getFullYear(), rf = y => Math.pow(1 + P.infl / 100, y);
    for (let y = step; y < P.years; y += step) ys.push(y);
    ys.push(P.years);
    return `<h3 class="swing-h3">Jahr für Jahr</h3><div class="table-wrap"><table class="scr sp-t"><thead><tr><th>Jahr</th><th class="num">Eingezahlt</th><th class="num">Depotwert</th><th class="num opt">Ertrag</th><th class="num">Nach KESt</th><th class="num opt">Kaufkraft heute</th></tr></thead><tbody>
      ${ys.map(y => { const x = r.s[y * 12], n = net(x); return `<tr><td>${y0 + y} <span class="muted opt">(${y} J.)</span></td><td class="num">${eur(x.paid)}</td><td class="num">${eur(x.V)}</td><td class="num opt ${x.V < x.paid ? "down" : "up"}">${eurS(x.V - x.paid)}</td><td class="num">${eur(n)}</td><td class="num opt">${eur(n / rf(y))}</td></tr>`; }).join("")}
    </tbody></table></div>`;
  }
  function outHtml() {
    const r = calc(), e = r.e, gain = e.V - e.paid;
    return `<div class="stats">
        ${kpi("Eingezahlt", eur(e.paid))}
        ${kpi(`Depotwert nach ${years(P.years)}`, eur(e.V))}
        ${kpi("Nach KESt (beim Verkauf)", eur(r.nv))}
        ${kpi("In heutiger Kaufkraft", eur(r.real))}
      </div>
      <p class="sp-sum">Ertrag <b class="${gain < 0 ? "down" : "up"}">${eurS(gain)}</b>${e.paid > 0 ? ` (das ${fmt(e.V / e.paid, 1)}-Fache der Einzahlungen)` : ""} · Steuer insgesamt ${eur(e.tax + r.fTax)} · ${r.costs >= 0.5 ? `Kosten insgesamt ${eur(r.costs)} (${e.fees > 0 ? `davon Gebühren ${eur(e.fees)}, ` : ""}mit entgangenem Zinseszins)` : "keine Kosten"}</p>
      ${P.fee > 0 && P.rate > 0 && P.fee / P.rate >= 0.015 ? `<div class="warn">⚠ Die Gebühr frisst ${fmt(P.fee / P.rate * 100, 1)} % jeder Rate – viele Broker bieten ETF-Sparpläne ohne Gebühr.</div>` : ""}
      ${goalHtml()}
      <div class="legend-row" aria-hidden="true">
        <span class="legend-item"><span class="lkey" style="background:${PAL.up}"></span>Depotwert</span>
        <span class="legend-item"><span class="lkey" style="background:${PAL.gray}"></span>Eingezahlt</span>
        <span class="legend-item"><span class="lkey dash" style="color:${PAL.series1}"></span>Nach Steuer, in heutiger Kaufkraft</span>
      </div>
      <div class="chart-host" id="spChart"></div>
      ${tableHtml(r)}`;
  }
  function card() {
    const val = k => (P[k] === null ? "" : String(P[k]));
    const field = (k, label, step, extra = "") => `<label>${label}<input id="${F.find(f => f[0] === k)[1]}" type="number" inputmode="decimal" step="${step}" min="${F.find(f => f[0] === k)[3]}" max="${F.find(f => f[0] === k)[4]}" value="${val(k)}"${extra}></label>`;
    return `<article class="card" id="sparplan" data-section="Sparplan">
      <div class="card-head"><h2 class="card-title">Sparplan-Rechner</h2><span class="muted small">ETF-Sparplan · Steuer Österreich</span></div>
      <p class="muted small sp-lead">Was aus einer monatlichen Rate wird – mit Zinseszins, Kosten, 27,5 % KESt und Inflation. Ihre Eingaben bleiben nur in diesem Browser.</p>
      <div class="calc sp-in">
        ${field("start", "Startbetrag (€)", 100)}
        ${field("rate", "Monatliche Rate (€)", 25)}
        ${field("years", "Laufzeit (Jahre)", 1, ' inputmode="numeric"')}
        ${field("ret", "Rendite pro Jahr (%)", 0.1)}
        ${field("goal", "Ziel nach Steuer (€)", 1000, ' placeholder="optional"')}
        <div class="wide sp-presets"><span class="muted small">Rendite-Annahme:</span><div class="seg" role="group" aria-label="Rendite-Annahme">
          ${PRESETS.map(([v, w, n]) => `<button type="button" data-sp-ret="${v}" aria-pressed="${P.ret === v}" aria-label="${w}${n}"><span class="sp-word">${w}</span>${n}</button>`).join("")}</div></div>
      </div>
      <details class="info sp-more"${moreOpen ? " open" : ""}><summary>Kosten, Steuer und Inflation</summary>
        <div class="calc">
          ${field("ter", "Laufende Kosten (TER, % pro Jahr)", 0.01)}
          ${field("fee", "Gebühr je Rate (€)", 0.5)}
          ${field("dyn", "Rate jährlich erhöhen um (%)", 0.5)}
          ${field("infl", "Inflation (% pro Jahr)", 0.1)}
          ${field("div", "Davon Dividenden (% pro Jahr)", 0.1)}
        </div>
        <p class="hint">Die Dividenden sind Teil der Rendite. Sie werden in Österreich jedes Jahr mit 27,5 % KESt versteuert – auch bei thesaurierenden ETFs (ausschüttungsgleiche Erträge, vereinfacht = Dividenden). Welt-Aktien-ETFs: etwa 1,5–2 %.</p>
      </details>
      <div id="spOut">${outHtml()}</div>
      <p class="hint">Annahmen: gleichmäßige Rendite – in Wirklichkeit schwankt sie stark (Welt-Aktien fielen 2008 um rund 40 %); die 7 % sind etwa der langjährige Durchschnitt von Welt-Aktien, keine Zusage. Rate am Monatsanfang, laufende Kosten von der Rendite abgezogen. Steuer für Meldefonds (fast alle großen ETFs): jährlich auf die Dividenden, beim Verkauf auf den restlichen Kursgewinn; Gebühren mindern die Steuer nicht. Keine Anlageberatung.</p>
    </article>`;
  }

  // Diagramm: Einzahlungen und Depotwert als Flächen, Kaufkraft nach Steuer gestrichelt; Fadenkreuz mit Werten je Jahr
  function niceTicks(max, count) {
    const raw = (max || 1) / count, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map(s => s * mag).find(s => s >= raw);
    const out = [];
    for (let v = 0; v < max + step * 0.999; v += step) out.push(+v.toFixed(6));
    return out;
  }
  function draw() {
    const host = $("spChart");
    if (!host || !host.clientWidth) return;
    const r = calc(), N = P.years, y0 = new Date().getFullYear();
    const pts = Array.from({ length: N + 1 }, (_, y) => { const x = r.s[y * 12]; return { V: x.V, paid: x.paid, real: net(x) / Math.pow(1 + P.infl / 100, y) }; });
    const W = Math.max(240, host.clientWidth), wide = W >= 560, H = wide ? 260 : 220, m = { l: 66, r: wide ? 150 : 14, t: 12, b: 26 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    const ticks = niceTicks(Math.max(...pts.map(p => Math.max(p.V, p.paid, p.real)), 1), 4), top = ticks[ticks.length - 1];
    const X = i => m.l + (i / N) * pw, Y = v => m.t + (top - v) / (top || 1) * ph;
    const line = k => pts.map((p, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(p[k]).toFixed(1)}`).join("");
    const back = k => pts.map((p, i) => [i, p]).reverse().map(([i, p]) => `L${X(i).toFixed(1)},${Y(p[k]).toFixed(1)}`).join("");
    const paidArea = `${line("paid")}L${X(N).toFixed(1)},${Y(0).toFixed(1)}L${X(0).toFixed(1)},${Y(0).toFixed(1)}Z`;
    const gainArea = `${line("V")}${back("paid")}Z`;
    const xStep = N <= 10 ? 2 : N <= 30 ? 5 : 10, xt = [];
    for (let y = xStep; y < N; y += xStep) if (X(N) - X(y) > 34) xt.push(y);
    const S = [["V", "Depotwert", "Depot", PAL.up, ""], ["paid", "Eingezahlt", "Eingezahlt", PAL.gray, ""], ["real", "Nach Steuer, in heutiger Kaufkraft", "Kaufkraft", PAL.series1, "5 4"]];
    const labels = wide ? S.map(([k, , sh]) => ({ sh, v: pts[N][k], y: Y(pts[N][k]) })).sort((a, b) => a.y - b.y)
      .map((o, i, a) => { if (i && o.y - a[i - 1].y < 15) o.y = a[i - 1].y + 15; return o; })
      .map(o => `<text class="dlabel" x="${m.l + pw + 8}" y="${o.y + 4}">${short(o.v)} · ${o.sh}</text>`).join("") : "";
    host.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="group" aria-label="Sparplan über ${years(N)}: Depotwert ${eur(pts[N].V)}, eingezahlt ${eur(pts[N].paid)}, nach Steuer in heutiger Kaufkraft ${eur(pts[N].real)}">
      ${ticks.map(t => `<line class="${t === 0 ? "base" : "grid"}" x1="${m.l}" x2="${m.l + pw}" y1="${Y(t)}" y2="${Y(t)}"/><text class="tick" x="${m.l - 6}" y="${Y(t) + 4}" text-anchor="end">${tickFmt(t)}</text>`).join("")}
      <path d="${paidArea}" fill="${PAL.gray}" opacity=".16"/>
      <path d="${gainArea}" fill="${PAL.up}" opacity=".13"/>
      <path d="${line("paid")}" fill="none" stroke="${PAL.gray}" stroke-width="1.5" stroke-linejoin="round"/>
      <path d="${line("real")}" fill="none" stroke="${PAL.series1}" stroke-width="2" stroke-dasharray="5 4" stroke-linejoin="round"/>
      <path d="${line("V")}" fill="none" stroke="${PAL.up}" stroke-width="2" stroke-linejoin="round"/>
      ${S.map(([k, , , c]) => `<circle cx="${X(N)}" cy="${Y(pts[N][k])}" r="4" fill="${c}" stroke="${PAL.surface}" stroke-width="2"/>`).join("")}
      ${labels}
      <text class="tick" x="${m.l}" y="${H - 6}">heute</text>
      ${xt.map(y => `<text class="tick" x="${X(y)}" y="${H - 6}" text-anchor="middle">${y0 + y}</text>`).join("")}
      <text class="tick" x="${m.l + pw}" y="${H - 6}" text-anchor="end">${y0 + N}</text>
      <line class="cross" x1="0" x2="0" y1="${m.t}" y2="${m.t + ph}" visibility="hidden"/>
      <rect class="hit" x="${m.l}" y="${m.t}" width="${pw}" height="${ph}" fill="transparent" tabindex="0" role="slider" aria-valuemin="0" aria-valuemax="${N}" aria-valuenow="${N}" aria-label="Werte je Jahr anzeigen (Pfeiltasten)"/>
    </svg>`;
    const svg = host.querySelector("svg"), cross = svg.querySelector(".cross"), hit = svg.querySelector(".hit");
    const tip = document.createElement("div");
    tip.className = "viz-tip"; tip.hidden = true; host.append(tip);
    let idx = N;
    const show = i => {
      idx = Math.max(0, Math.min(N, i));
      const x = X(idx), p = pts[idx];
      cross.setAttribute("x1", x); cross.setAttribute("x2", x); cross.setAttribute("visibility", "visible");
      tip.innerHTML = `<div class="tip-head">${idx ? `${y0 + idx} · in ${years(idx)}` : "heute"}</div>`
        + S.map(([k, name, , c, dash]) => `<div class="tip-row"><span class="lkey${dash ? " dash" : ""}" style="${dash ? `color:${c}` : `background:${c}`}"></span>${name}: <strong>${eur(p[k])}</strong></div>`).join("")
        + `<div class="tip-row"><span class="lkey" style="background:transparent"></span>Ertrag: <strong class="${p.V < p.paid ? "down" : "up"}">${eurS(p.V - p.paid)}</strong></div>`;
      tip.hidden = false;
      hit.setAttribute("aria-valuenow", String(idx)); hit.setAttribute("aria-valuetext", tip.textContent.replace(/\s+/g, " ").trim());
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

  function update() {
    const o = $("spOut");
    if (!o) return;
    o.innerHTML = outHtml();
    document.querySelectorAll("#sparplan [data-sp-ret]").forEach(b => b.setAttribute("aria-pressed", String(+b.dataset.spRet === P.ret)));
    draw();
  }
  document.addEventListener("input", e => { if (e.target.closest && e.target.closest("#sparplan .calc")) { fromInputs(); update(); } });
  // Feld verlassen: angezeigten Wert auf den gerechneten setzen (z. B. 80 Jahre → 60)
  document.addEventListener("change", e => {
    const f = e.target.closest && e.target.closest("#sparplan .calc") ? F.find(x => x[1] === e.target.id) : null;
    if (f) e.target.value = P[f[0]] === null ? "" : String(P[f[0]]);
  });
  document.addEventListener("click", e => {
    const b = e.target.closest("#sparplan [data-sp-ret]");
    if (!b || !$("spRet")) return;
    $("spRet").value = b.dataset.spRet;
    fromInputs(); update();
  });
  document.addEventListener("toggle", e => { if (e.target.classList && e.target.classList.contains("sp-more")) moreOpen = e.target.open; }, true);
  let queued = false;
  window.addEventListener("resize", () => { if (queued || !$("spChart")) return; queued = true; requestAnimationFrame(() => { queued = false; if (!$("tools").hidden) draw(); }); });
  window.DTD.sparplanCard = card;
  window.DTD.sparplanDraw = draw;
  window.DTD.sparplanCalc = p => { const s = simulate({ ...read(), ...p }); return { last: s[s.length - 1], net: net(s[s.length - 1]) }; };
})();

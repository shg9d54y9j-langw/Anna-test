// ---------- Vermögen: langfristig anlegen – Profil, Musterportfolio, Bandbreite, Rebalancing, Forschung, Zinsen, Steuern ----------
// Inhalte aus data/wealth.json (monatlich geprüfter Forschungsstand mit Quellen, Profilregeln, Beispiel-ETFs, Steuerlage
// Österreich), Zinsen und Inflation aus macro.json (an jedem Werktag von der EZB, Zweig wealth-data). Erwartete Renditen nach
// der Bausteinmethode: Geldmarkt = €STR, Anleihen = Rendite 5-jähriger AAA-Staatsanleihen, Aktien = Geldmarkt + Aktienprämie.
// Ihre Angaben bleiben nur in diesem Browser (localStorage dtd-wealth). Keine Anlageberatung.
(() => {
  const KEY = "dtd-wealth";
  const fin = Number.isFinite;
  let W = null, M = null, loading = false, started = false;
  const st = Object.assign({ horizon: "10to20", reserve: "yes", income: "mid", reaction: "hold", loss: 30, rebal: {} }, store.get(KEY, {}) || {});
  const save = () => store.set(KEY, st);
  const eur = v => (fin(v) ? `${v < 0 ? "−" : ""}${fmt(Math.abs(Math.round(v)), 0)} €` : "–");
  const pc = (v, d = 1) => (fin(v) ? `${v < 0 ? "−" : ""}${fmt(Math.abs(v), d)} %` : "–");
  const short = v => (v >= 1e6 ? `${fmt(v / 1e6, 2)} Mio. €` : v >= 1e5 ? `${fmt(v / 1e3, 0)} Tsd. €` : v >= 1e3 ? `${fmt(v / 1e3, 1)} Tsd. €` : `${fmt(v, 0)} €`);
  const tickFmt = v => (v >= 1e6 ? `${fmt(v / 1e6, v % 1e6 ? 1 : 0)} Mio. €` : v >= 1e3 ? `${fmt(v / 1e3, v % 1e3 ? 1 : 0)} Tsd. €` : `${fmt(v, 0)} €`);
  const dLong = iso => (iso ? new Date(`${String(iso).slice(0, 10)}T12:00:00Z`).toLocaleDateString("de-AT", { day: "numeric", month: "long", year: "numeric" }) : "–");
  const dMonth = iso => new Date(`${String(iso).slice(0, 7)}-15T12:00:00Z`).toLocaleDateString("de-AT", { month: "long", year: "numeric" });
  const dObs = iso => (String(iso).length === 7 ? dMonth(iso) : dLong(iso));
  const safeUrl = u => { try { const x = new URL(u); return x.protocol === "https:" ? x.href : null; } catch { return null; } };
  const srcList = l => (Array.isArray(l) ? l : []).map(s => { const u = safeUrl(s && s.url); return u ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(s.t)}</a>` : esc(s && s.t); }).filter(Boolean).join(" · ");

  const OPTS = {
    horizon: [["lt3", "unter 3 Jahren"], ["3to5", "3 bis 5 Jahren"], ["5to10", "5 bis 10 Jahren"], ["10to20", "10 bis 20 Jahren"], ["gt20", "mehr als 20 Jahren"]],
    reserve: [["yes", "Ja, 3–6 Monatsausgaben"], ["part", "Teilweise"], ["no", "Nein"]],
    income: [["safe", "Sehr sicher (z. B. unbefristet angestellt, Pension)"], ["mid", "Eher sicher"], ["unsafe", "Unsicher oder schwankend (z. B. selbstständig)"]],
    reaction: [["sell", "Alles verkaufen"], ["some", "Einen Teil verkaufen"], ["hold", "Nichts tun, abwarten"], ["buy", "Nachkaufen"]],
    loss: [[10, "10 %"], [20, "20 %"], [30, "30 %"], [40, "40 %"], [50, "50 % und mehr"]],
  };
  const LEVEL = { stark: ["Stark belegt", "lv-strong"], mittel: ["Mittel belegt", "lv-mid"], umstritten: ["Umstritten", "lv-dispute"], neu: ["Neu, noch nicht begutachtet", "lv-new"], praxis: ["Bewährte Praxis", "lv-practice"] };
  const BLOCK_COLOR = { aktien: () => PAL.series1, anleihen: () => PAL.series2, geldmarkt: () => PAL.gray };

  // ---------- Rechnung ----------
  // Aktienquote: Fähigkeit (Horizont, Einkommen) und Bereitschaft (erträglicher Verlust, Reaktion) – das Vorsichtigere zählt
  function quota() {
    const p = W.profile;
    const caps = [
      { v: p.horizonCap[st.horizon], why: "Ihren Anlagehorizont" },
      { v: Math.min(100, Math.round(st.loss / p.crashEquity * 100)), why: "den Verlust, den Sie aushalten" },
      { v: p.reactionCap[st.reaction], why: "Ihre Reaktion auf einen Kurssturz" },
    ];
    const lim = caps.reduce((a, c) => (c.v < a.v ? c : a));
    const adj = p.incomeAdj[st.income] || 0;
    return { q: Math.max(0, Math.min(100, Math.floor((lim.v + adj) / 10) * 10)), lim, adj };
  }
  function allocation(q) {
    const [b] = W.profile.safeSplit[st.horizon], safe = 100 - q, bonds = Math.round(safe * b / 100);
    return { aktien: q, anleihen: bonds, geldmarkt: safe - bonds };
  }
  function rates() {
    const s = (M && M.series) || {}, lr = W.model.longRun;
    const cash = s.estr ? s.estr.v : s.deposit ? s.deposit.v : lr.cash;
    return { cash, bonds: s.y5 ? s.y5.v : lr.bonds, equity: cash + W.model.equityPremium, live: !!(s.estr || s.deposit), liveBonds: !!s.y5, infl: lr.inflation };
  }
  const expected = (a, r) => (a.aktien * r.equity + a.anleihen * r.bonds + a.geldmarkt * r.cash) / 100 - W.model.terAvg;
  const crash = a => { const c = W.model.crash; return (a.aktien * c.equity + a.anleihen * c.bonds + a.geldmarkt * c.cash) / 100; };
  function vol(a) {
    const m = W.model, e = a.aktien / 100 * m.equityVol, b = a.anleihen / 100 * m.bondVol, c = a.geldmarkt / 100 * m.cashVol;
    return Math.sqrt(e * e + b * b + 2 * m.corrEquityBonds * e * b + c * c);
  }
  // Bandbreite: Zufallspfade mit festem Startwert (gleiche Eingaben → gleiches Ergebnis), Monat für Monat, Rate am Monatsanfang.
  // Gerechnet auf Depotebene: Median-Wachstum = erwartete Rendite des Musterportfolios (nach Kosten), Schwankung = Depot-Schwankung
  // aus den Schwankungen der Anlageklassen und ihrer Korrelation – so passen Kennzahl, Bandbreite und Sparplan-Rechner zusammen.
  function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function fan(a, r, plan, paths = 1000) {
    const rnd = mulberry(20261111), months = plan.years * 12;
    let spare = null;
    const gauss = () => { if (spare !== null) { const s = spare; spare = null; return s; } let u = 0; while (u === 0) u = rnd(); const v = rnd(), R = Math.sqrt(-2 * Math.log(u)); spare = R * Math.sin(2 * Math.PI * v); return R * Math.cos(2 * Math.PI * v); };
    const mu = Math.log(1 + expected(a, r) / 100) / 12, sd = vol(a) / 100 / Math.sqrt(12);
    const at = Array.from({ length: plan.years + 1 }, () => new Float64Array(paths));
    for (let p = 0; p < paths; p++) {
      let v = plan.start;
      at[0][p] = v;
      for (let t = 1; t <= months; t++) {
        v = (v + plan.rate) * Math.exp(mu + sd * gauss());
        if (t % 12 === 0) at[t / 12][p] = v;
      }
    }
    return at.map((arr, y) => {
      const s = Array.from(arr).sort((x, z) => x - z), q = f => s[Math.min(s.length - 1, Math.floor(f * s.length))], paid = plan.start + plan.rate * 12 * y;
      return { y, p10: q(0.1), p50: q(0.5), p90: q(0.9), paid, below: y ? s.filter(v => v < paid).length / s.length : 0 };
    });
  }
  const plan = () => { const p = window.DTD.sparplanGet ? window.DTD.sparplanGet() : {}; return { start: fin(p.start) ? p.start : 1000, rate: fin(p.rate) ? p.rate : 200, years: fin(p.years) ? p.years : 20 }; };

  // ---------- Karten ----------
  const sel = (name, label, hint = "") => `<label>${label}<select id="w-${name}" data-w="${name}">${OPTS[name].map(([v, t]) => `<option value="${v}"${String(st[name]) === String(v) ? " selected" : ""}>${t}</option>`).join("")}</select>${hint ? `<span class="w-hint">${hint}</span>` : ""}</label>`;
  function profileCard() {
    return `<article class="card" id="wProfil" data-section="Profil">
      <div class="card-head"><h2 class="card-title">Ihr Anlegerprofil</h2><span class="muted small">bleibt nur in diesem Browser</span></div>
      <p class="muted small">Fünf Fragen bestimmen, wie viel Aktien zu Ihnen passen. Bewertet werden Fähigkeit (Horizont, Einkommen) und Bereitschaft (Verlust, Reaktion) – das Vorsichtigere zählt.</p>
      <div class="calc w-form">
        ${sel("horizon", "Ich brauche das Geld in …")}
        ${sel("loss", "Größter Verlust, den ich aushalte, ohne zu verkaufen")}
        ${sel("reaction", "Mein Depot fällt in einem Jahr um 30 %. Ich würde …")}
        ${sel("income", "Mein Einkommen ist …")}
        ${sel("reserve", "Notgroschen auf Tagesgeld vorhanden?")}
      </div>
      <div id="wProfilOut"></div>
    </article>`;
  }
  function profileOut() {
    const { q, lim, adj } = quota(), a = allocation(q);
    const notes = [];
    if (st.reserve !== "yes") notes.push(`<li><span class="sa-icon warn-t" aria-hidden="true">!</span><span><b>Zuerst den Notgroschen:</b> ${st.income === "unsafe" ? "6–12" : "3–6"} Monatsausgaben auf ein Tagesgeldkonto (gesichert bis 100.000 € je Bank). Er gehört nicht ins Depot – so müssen Sie in einem Kurssturz nichts verkaufen.</span></li>`);
    if (adj) notes.push(`<li><span class="sa-icon muted" aria-hidden="true">i</span><span>Wegen des unsicheren Einkommens ${Math.abs(adj)} Prozentpunkte weniger Aktien.</span></li>`);
    if (st.horizon === "lt3") notes.push(`<li><span class="sa-icon muted" aria-hidden="true">i</span><span>Geld, das Sie in weniger als drei Jahren brauchen, gehört aufs Tagesgeld oder in den Geldmarkt – Aktien können in dieser Zeit um die Hälfte fallen.</span></li>`);
    return `<div class="w-result">
        <div class="w-q"><span class="w-q-num">${q} %</span><span class="w-q-lbl">Aktien</span></div>
        <div class="w-q-text"><p><b>${q} % Aktien, ${100 - q} % sicherer Teil</b> (${a.anleihen} % Anleihen, ${a.geldmarkt} % Geldmarkt).</p>
          <p class="muted small">Begrenzt durch ${lim.why}. In einem Absturz wie 2008 fiele ein solches Depot vorübergehend um etwa ${fmt(crash(a), 0)}&nbsp;%.</p></div>
      </div>${notes.length ? `<ul class="sp-goal">${notes.join("")}</ul>` : ""}`;
  }
  function allocBar(a) {
    const parts = W.blocks.map(b => ({ b, v: a[b.id] })).filter(x => x.v > 0);
    return `<div class="w-alloc" role="img" aria-label="Aufteilung: ${parts.map(x => `${x.b.name} ${x.v} %`).join(", ")}">${parts.map(x => `<span style="flex:${x.v};background:${BLOCK_COLOR[x.b.id]()}"></span>`).join("")}</div>
      <ul class="w-alloc-legend">${parts.map(x => `<li><span class="lkey" style="background:${BLOCK_COLOR[x.b.id]()};height:10px;width:10px;border-radius:2px"></span><b>${x.v} %</b> ${esc(x.b.name)}</li>`).join("")}</ul>`;
  }
  function portfolioCard() {
    return `<article class="card" id="wPortfolio" data-section="Musterportfolio"><div id="wPortfolioBody"></div>
      <div class="legend-row" aria-hidden="true"><span class="legend-item"><span class="lkey" style="background:${PAL.series1}"></span>Mitte</span><span class="legend-item"><span class="lkey" style="background:${PAL.series1};opacity:.35;height:8px"></span>Bandbreite (8 von 10 Verläufen)</span><span class="legend-item"><span class="lkey" style="background:${PAL.gray}"></span>Eingezahlt</span></div>
      <div class="chart-host" id="wFan"></div>
      <div id="wFanTable"></div>
      <p class="hint">Bandbreite: 1.000 Zufallsverläufe mit der erwarteten Rendite und der Schwankung Ihres Musterportfolios (aus den langjährigen Schwankungen: Aktien ${fmt(W.model.equityVol, 0)} %, Anleihen ${fmt(W.model.bondVol, 0)} % pro Jahr), nach Kosten, vor Steuer. Echte Krisen können heftiger sein; die Mitte ist kein Versprechen. ${esc(W.model.note)}</p>
    </article>`;
  }
  function portfolioBody() {
    const { q } = quota(), a = allocation(q), r = rates(), exp = expected(a, r), p = plan();
    const blocks = W.blocks.filter(b => a[b.id] > 0).map(b => `<div class="w-block">
        <h3 class="swing-h3"><span class="lkey" style="background:${BLOCK_COLOR[b.id]()};height:10px;width:10px;border-radius:2px"></span> ${a[b.id]} % ${esc(b.name)} <span class="muted small">· ${esc(b.role)}</span></h3>
        <p class="small">${esc(b.what)}</p>
        <ul class="w-prod">${b.products.map(x => `<li><span>${esc(x.name)}${x.note ? ` <span class="muted">– ${esc(x.note)}</span>` : ""}</span><span class="w-prod-meta">${x.isin ? `<code>${esc(x.isin)}</code> · ` : ""}${x.ter ? `Kosten ${fmt(x.ter, 2)} %` : "keine Kosten"}</span></li>`).join("")}</ul>
      </div>`).join("");
    return `<div class="card-head"><h2 class="card-title">Ihr Musterportfolio</h2><span class="muted small">${q} % Aktien</span></div>
      ${allocBar(a)}
      <div class="stats">
        ${kpi("Erwartete Rendite pro Jahr", `<span class="up">${pc(exp)}</span>`)}
        ${kpi("Nach Inflation (2 %)", pc(exp - r.infl))}
        ${kpi("Schwankung pro Jahr", pc(vol(a), 0))}
        ${kpi("Absturz wie 2008", `<span class="down">−${fmt(crash(a), 0)} %</span>`)}
      </div>
      <p class="small muted">Erwartung nach Kosten, vor Steuer: Aktien ${pc(r.equity)} (Geldmarkt ${pc(r.cash)} + Aktienprämie ${pc(W.model.equityPremium, 0)}), Anleihen ${pc(r.bonds)}, Geldmarkt ${pc(r.cash)} – ${r.live ? `mit den Zinsen der EZB vom ${dObs(((M.series.estr || M.series.deposit) || {}).d)}` : "mit langfristigen Annahmen (aktuelle EZB-Daten fehlen noch)"}. Steigen oder fallen die Zinsen, passt sich die Erwartung von selbst an.</p>
      <div class="w-blocks">${blocks}</div>
      <p class="hint">${esc(W.productNote)}</p>
      <h3 class="swing-h3">Was daraus werden kann</h3>
      <p class="small">Mit ${eur(p.start)} Start und ${eur(p.rate)} im Monat über ${p.years} ${p.years === 1 ? "Jahr" : "Jahre"} <a href="#sparplan">(im Sparplan-Rechner ändern)</a>:</p>
      <div class="btn-row"><button type="button" class="btn ghost" data-w-act="toSparplan">Erwartete Rendite (${pc(exp)}) in den Sparplan-Rechner übernehmen</button></div>`;
  }
  function fanTable(f) {
    const step = f.length - 1 <= 10 ? 2 : f.length - 1 <= 30 ? 5 : 10, rows = f.filter(x => x.y && (x.y % step === 0 || x.y === f.length - 1));
    const last = f[f.length - 1];
    return `<p class="small">Nach ${last.y} Jahren: eingezahlt ${eur(last.paid)} – in der Mitte ${eur(last.p50)}, ungünstig (1 von 10 Verläufen schlechter) ${eur(last.p10)}, günstig ${eur(last.p90)}. Weniger als eingezahlt in ${fmt(last.below * 100, 0)} % der Verläufe.</p>
      <div class="table-wrap"><table class="scr w-fan-t"><thead><tr><th>Jahr</th><th class="num">Eingezahlt</th><th class="num">Ungünstig</th><th class="num">Mitte</th><th class="num">Günstig</th></tr></thead><tbody>
      ${rows.map(x => `<tr><td>${new Date().getFullYear() + x.y} <span class="muted opt">(${x.y} J.)</span></td><td class="num">${eur(x.paid)}</td><td class="num">${eur(x.p10)}</td><td class="num">${eur(x.p50)}</td><td class="num">${eur(x.p90)}</td></tr>`).join("")}
      </tbody></table></div>`;
  }
  function drawFan() {
    const host = $("wFan");
    if (!host || !host.clientWidth || !W) return;
    const { q } = quota(), a = allocation(q), p = plan(), f = fan(a, rates(), p), N = p.years, y0 = new Date().getFullYear();
    if ($("wFanTable")) $("wFanTable").innerHTML = fanTable(f);
    const Wd = Math.max(240, host.clientWidth), wide = Wd >= 560, H = wide ? 260 : 220, m = { l: 66, r: wide ? 140 : 14, t: 12, b: 26 };
    const pw = Wd - m.l - m.r, ph = H - m.t - m.b;
    const max = Math.max(...f.map(x => x.p90), 1), raw = max / 4, mag = Math.pow(10, Math.floor(Math.log10(raw))), step = [1, 2, 2.5, 5, 10].map(s => s * mag).find(s => s >= raw);
    const ticks = []; for (let v = 0; v < max + step * 0.999; v += step) ticks.push(+v.toFixed(6));
    const top = ticks[ticks.length - 1], X = i => m.l + (i / N) * pw, Y = v => m.t + (top - v) / (top || 1) * ph;
    const line = k => f.map((x, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(x[k]).toFixed(1)}`).join("");
    const band = `${line("p90")}${f.map((x, i) => [i, x]).reverse().map(([i, x]) => `L${X(i).toFixed(1)},${Y(x.p10).toFixed(1)}`).join("")}Z`;
    const xs = N <= 10 ? 2 : N <= 30 ? 5 : 10, xt = []; for (let y = xs; y < N; y += xs) if (X(N) - X(y) > 34) xt.push(y);
    const L = [["p90", "günstig"], ["p50", "Mitte"], ["p10", "ungünstig"], ["paid", "eingezahlt"]];
    const labels = wide ? L.map(([k, t]) => ({ t, v: f[N][k], y: Y(f[N][k]) })).sort((u, v) => u.y - v.y).map((o, i, arr) => { if (i && o.y - arr[i - 1].y < 14) o.y = arr[i - 1].y + 14; return o; })
      .map(o => `<text class="dlabel" x="${m.l + pw + 8}" y="${o.y + 4}">${short(o.v)} · ${o.t}</text>`).join("") : "";
    host.innerHTML = `<svg width="${Wd}" height="${H}" viewBox="0 0 ${Wd} ${H}" role="group" aria-label="Bandbreite nach ${N} Jahren: Mitte ${eur(f[N].p50)}, ungünstig ${eur(f[N].p10)}, günstig ${eur(f[N].p90)}, eingezahlt ${eur(f[N].paid)}">
      ${ticks.map(t => `<line class="${t === 0 ? "base" : "grid"}" x1="${m.l}" x2="${m.l + pw}" y1="${Y(t)}" y2="${Y(t)}"/><text class="tick" x="${m.l - 6}" y="${Y(t) + 4}" text-anchor="end">${tickFmt(t)}</text>`).join("")}
      <path d="${band}" fill="${PAL.series1}" opacity=".16"/>
      <path d="${line("paid")}" fill="none" stroke="${PAL.gray}" stroke-width="1.5" stroke-linejoin="round"/>
      <path d="${line("p50")}" fill="none" stroke="${PAL.series1}" stroke-width="2" stroke-linejoin="round"/>
      <circle cx="${X(N)}" cy="${Y(f[N].p50)}" r="4" fill="${PAL.series1}" stroke="${PAL.surface}" stroke-width="2"/>
      ${labels}
      <text class="tick" x="${m.l}" y="${H - 6}">heute</text>
      ${xt.map(y => `<text class="tick" x="${X(y)}" y="${H - 6}" text-anchor="middle">${y0 + y}</text>`).join("")}
      <text class="tick" x="${m.l + pw}" y="${H - 6}" text-anchor="end">${y0 + N}</text>
      <line class="cross" x1="0" x2="0" y1="${m.t}" y2="${m.t + ph}" visibility="hidden"/>
      <rect class="hit" x="${m.l}" y="${m.t}" width="${pw}" height="${ph}" fill="transparent" tabindex="0" role="slider" aria-valuemin="0" aria-valuemax="${N}" aria-valuenow="${N}" aria-label="Bandbreite je Jahr anzeigen (Pfeiltasten)"/>
    </svg>`;
    const svg = host.querySelector("svg"), cross = svg.querySelector(".cross"), hit = svg.querySelector(".hit"), tip = document.createElement("div");
    tip.className = "viz-tip"; tip.hidden = true; host.append(tip);
    let idx = N;
    const show = i => {
      idx = Math.max(0, Math.min(N, i));
      const x = X(idx), v = f[idx];
      cross.setAttribute("x1", x); cross.setAttribute("x2", x); cross.setAttribute("visibility", "visible");
      tip.innerHTML = `<div class="tip-head">${idx ? `${y0 + idx} · in ${idx} ${idx === 1 ? "Jahr" : "Jahren"}` : "heute"}</div>
        <div class="tip-row"><span class="lkey" style="background:${PAL.series1};opacity:.45"></span>günstig: <strong>${eur(v.p90)}</strong></div>
        <div class="tip-row"><span class="lkey" style="background:${PAL.series1}"></span>Mitte: <strong>${eur(v.p50)}</strong></div>
        <div class="tip-row"><span class="lkey" style="background:${PAL.series1};opacity:.45"></span>ungünstig: <strong>${eur(v.p10)}</strong></div>
        <div class="tip-row"><span class="lkey" style="background:${PAL.gray}"></span>eingezahlt: <strong>${eur(v.paid)}</strong></div>`;
      tip.hidden = false;
      hit.setAttribute("aria-valuenow", String(idx)); hit.setAttribute("aria-valuetext", tip.textContent.replace(/\s+/g, " ").trim());
      const wTip = tip.offsetWidth;
      tip.style.left = `${x + 12 + wTip > host.clientWidth ? Math.max(8, x - wTip - 12) : x + 12}px`;
      tip.style.top = "8px";
    };
    const hide = () => { cross.setAttribute("visibility", "hidden"); tip.hidden = true; };
    const fromEvent = e => { const b = svg.getBoundingClientRect(); return Math.round(((e.clientX - b.left) * (Wd / b.width) - m.l) / pw * N); };
    hit.addEventListener("pointermove", e => show(fromEvent(e)));
    hit.addEventListener("pointerleave", hide);
    hit.addEventListener("focus", () => show(idx));
    hit.addEventListener("blur", hide);
    hit.addEventListener("keydown", e => { if (e.key === "ArrowLeft") { show(idx - 1); e.preventDefault(); } if (e.key === "ArrowRight") { show(idx + 1); e.preventDefault(); } });
  }

  // Rebalancing: neue Einzahlung zuerst dorthin, wo am meisten fehlt (kein Verkauf, keine Steuer); umschichten erst ab 5 Punkten
  function rebalPlan(a, cur, add) {
    const ids = W.blocks.map(b => b.id), total = ids.reduce((s, k) => s + cur[k], 0) + add;
    if (!(total > 0)) return null;
    const target = Object.fromEntries(ids.map(k => [k, total * a[k] / 100]));
    const gap = Object.fromEntries(ids.map(k => [k, Math.max(0, target[k] - cur[k])])), gapSum = ids.reduce((s, k) => s + gap[k], 0);
    const buy = Object.fromEntries(ids.map(k => [k, gapSum > add ? add * gap[k] / gapSum : gap[k] + (add - gapSum) * a[k] / 100]));
    const after = Object.fromEntries(ids.map(k => [k, cur[k] + buy[k]]));
    const dev = Object.fromEntries(ids.map(k => [k, (after[k] / total - a[k] / 100) * 100]));
    return { total, target, buy, after, dev, maxDev: Math.max(...ids.map(k => Math.abs(dev[k]))) };
  }
  function rebalCard() {
    const v = k => (fin(st.rebal[k]) ? String(st.rebal[k]) : "");
    return `<article class="card" id="wRebal" data-section="Rebalancing">
      <h2 class="card-title">Rebalancing-Helfer: wohin mit der nächsten Einzahlung?</h2>
      <p class="muted small">Einmal im Jahr die aktuellen Werte eintragen. Der Helfer verteilt neues Geld so, dass Ihre Aufteilung wieder stimmt – ohne Verkauf und damit ohne Steuer.</p>
      <div class="calc w-reb-in">
        ${W.blocks.map(b => `<label>${esc(b.name)} (€)<input type="number" inputmode="decimal" min="0" step="100" data-w-reb="${b.id}" value="${v(b.id)}"></label>`).join("")}
        <label>Neue Einzahlung (€)<input type="number" inputmode="decimal" min="0" step="50" data-w-reb="add" value="${v("add")}"></label>
      </div>
      <div id="wRebalOut"></div>
    </article>`;
  }
  function rebalOut() {
    const { q } = quota(), a = allocation(q), n = k => (fin(st.rebal[k]) && st.rebal[k] > 0 ? st.rebal[k] : 0);
    const cur = Object.fromEntries(W.blocks.map(b => [b.id, n(b.id)])), add = n("add"), r = rebalPlan(a, cur, add);
    if (!r) return `<p class="muted small">Tragen Sie die heutigen Werte Ihrer ETFs ein (oder nur die geplante Einzahlung).</p>`;
    const rows = W.blocks.map(b => `<tr><td>${esc(b.name)}</td><td class="num">${a[b.id]} %</td><td class="num">${r.total - add > 0 ? `${fmt(cur[b.id] / (r.total - add) * 100, 0)} %` : "–"}</td><td class="num"><b>${eur(r.buy[b.id])}</b></td><td class="num">${fmt(r.after[b.id] / r.total * 100, 0)} %</td></tr>`).join("");
    const big = r.maxDev > 5;
    const moves = big ? W.blocks.map(b => ({ b, d: r.target[b.id] - r.after[b.id] })).filter(x => Math.abs(x.d) >= 1) : [];
    return `<div class="table-wrap"><table class="scr w-reb-t"><thead><tr><th>Baustein</th><th class="num">Ziel</th><th class="num">Jetzt</th><th class="num">Einzahlung</th><th class="num">Danach</th></tr></thead><tbody>${rows}</tbody></table></div>
      ${big ? `<div class="warn">⚠ Auch nach der Einzahlung weicht ein Teil um ${fmt(r.maxDev, 1)} Prozentpunkte vom Ziel ab. Umschichten: ${moves.map(x => `${x.d > 0 ? "+" : "−"}${eur(Math.abs(x.d))} ${esc(x.b.name)}`).join(", ")}. Verkäufe mit Gewinn kosten 27,5 % KESt – oft reicht es, die nächsten Einzahlungen gezielt zu lenken.</div>`
        : `<p class="small"><span class="up">✓</span> Danach liegt jeder Teil höchstens ${fmt(r.maxDev, 1)} Prozentpunkte neben dem Ziel – kein Verkauf nötig (Regel: erst ab 5 Punkten umschichten).</p>`}`;
  }
  function researchCard() {
    const items = W.evidence.map(e => { const [lbl, cls] = LEVEL[e.level] || [e.level, "lv-new"]; return `<details class="w-ev">
        <summary><span class="w-ev-title">${esc(e.title)}</span><span class="w-lv ${cls}">${lbl}</span></summary>
        <p>${esc(e.claim)}</p>
        <p class="w-foryou"><b>Für Sie:</b> ${esc(e.forYou)}</p>
        <p class="w-src small">Quellen: ${srcList(e.sources)}</p>
      </details>`; }).join("");
    const ch = (W.changes || []).slice(0, 3).map(c => `<li><b>${dLong(c.date)}:</b> ${esc(c.text)}</li>`).join("");
    return `<article class="card" id="wForschung" data-section="Forschung">
      <div class="card-head"><h2 class="card-title">Was die Forschung sagt</h2><span class="muted small">geprüft am ${dLong(W.reviewed)}</span></div>
      <p class="muted small">Jede Empfehlung oben stützt sich auf diese Befunde. Stufen: stark belegt (viele begutachtete Studien), mittel, umstritten (Studien widersprechen sich), neu (noch nicht begutachtet), bewährte Praxis. Nächste Prüfung: ${dMonth(W.nextReview)}.</p>
      <div class="w-evs">${items}</div>
      <details class="info"><summary>Wie der Forschungsstand aktuell bleibt</summary><p class="small">${esc(W.method)}</p>${ch ? `<h3 class="swing-h3">Zuletzt geändert</h3><ul class="small w-changes">${ch}</ul>` : ""}</details>
    </article>`;
  }
  function macroCard() {
    const s = (M && M.series) || {}, r = rates();
    const ROWS = [["deposit", "EZB-Einlagezins"], ["estr", "Tagesgeld unter Banken (€STR)"], ["y2", "Staatsanleihen AAA, 2 Jahre"], ["y5", "Staatsanleihen AAA, 5 Jahre"], ["y10", "Staatsanleihen AAA, 10 Jahre"], ["hicpEA", "Inflation Euroraum"], ["hicpAT", "Inflation Österreich"]];
    // Verlauf: ältester gespeicherter Wert (Monatsreihen gut ein Jahr, Tagesreihen gut zwei Wochen, Leitzins die letzten Änderungen)
    const rows = ROWS.filter(([k]) => s[k]).map(([k, t]) => { const h = s[k].hist || [], o = h.length > 1 ? h[0] : null; return `<tr><td>${t}<span class="mob js-meta">Stand ${dObs(s[k].d)}</span></td><td class="num"><b>${pc(s[k].v, 2)}</b></td><td class="opt">${o ? `${s[k].v - o[1] > 0 ? "▲" : s[k].v - o[1] < 0 ? "▼" : "="} von ${pc(o[1], 2)} (${dObs(o[0])})` : "–"}</td><td class="opt">${dObs(s[k].d)}</td></tr>`; }).join("");
    const realCash = s.hicpEA ? r.cash - s.hicpEA.v : null;
    return `<article class="card" id="wZinsen" data-section="Zinsen &amp; Inflation">
      <div class="card-head"><h2 class="card-title">Zinsen und Inflation</h2><span class="muted small">${M ? `EZB, Stand ${dLong(M.updated)}` : "noch keine Daten"}</span></div>
      ${rows ? `<div class="table-wrap"><table class="scr w-macro-t"><thead><tr><th>Reihe</th><th class="num">Aktuell</th><th class="opt">Verlauf</th><th class="opt">Stand</th></tr></thead><tbody>${rows}</tbody></table></div>
        ${fin(realCash) ? `<p class="small">Tagesgeld nach Inflation: <b class="${realCash < 0 ? "down" : "up"}">${pc(realCash, 2)}</b> pro Jahr${realCash < 0 ? " – Bargeld verliert gerade an Kaufkraft." : "."}</p>` : ""}`
        : `<p class="muted small">Die täglichen EZB-Daten sind noch nicht da. Bis dahin rechnet die Seite mit langfristigen Annahmen (Geldmarkt ${pc(W.model.longRun.cash)}, Anleihen ${pc(W.model.longRun.bonds)}).</p>`}
      <p class="hint">Diese Werte fließen in die erwarteten Renditen oben ein. Für die Aufteilung selbst zählen sie nicht: Sie folgt Ihrem Profil, nicht der Zinslage – den richtigen Zeitpunkt trifft niemand verlässlich. Quelle: EZB Data Portal, an jedem Werktag aktualisiert.</p>
    </article>`;
  }
  function taxCard() {
    return `<article class="card" id="wSteuer" data-section="Steuern">
      <div class="card-head"><h2 class="card-title">Steuern in Österreich</h2><span class="muted small">geprüft am ${dLong(W.reviewed)}</span></div>
      <ul class="w-tax">${W.tax.map(t => `<li><b>${esc(t.t)}:</b> ${esc(t.text)} <span class="w-src small">${srcList(t.sources)}</span></li>`).join("")}</ul>
      <p class="hint">Allgemeine Information, keine Steuerberatung. Den Steuer-Schätzer für Ihre Trades finden Sie im <a href="#pfTax">Portfolio</a>.</p>
    </article>`;
  }

  // ---------- Anzeige ----------
  function render() {
    const host = $("wealthBody");
    if (!host) return;
    if (!W) { host.innerHTML = `<article class="card"><p class="muted">${loading ? "Lade den Forschungsstand …" : "Die Inhalte sind gerade nicht erreichbar – bitte später noch einmal."}</p></article>`; return; }
    host.innerHTML = profileCard() + portfolioCard() + (window.DTD.sparplanCard ? window.DTD.sparplanCard() : "") + rebalCard() + researchCard() + macroCard() + taxCard();
    update();
    if (window.DTD.sparplanDraw) window.DTD.sparplanDraw();
    window.dispatchEvent(new Event("dtd:sections"));
  }
  function update() {
    if (!W) return;
    if ($("wProfilOut")) $("wProfilOut").innerHTML = profileOut();
    if ($("wPortfolioBody")) $("wPortfolioBody").innerHTML = portfolioBody();
    if ($("wRebalOut")) $("wRebalOut").innerHTML = rebalOut();
    drawFan();
  }
  async function load() {
    if (loading) return;
    loading = true;
    if (!W) render();
    const S = window.DTD.shared;
    const [w, m] = await Promise.all([S.load("wealth"), S.load("macro")]);
    loading = false;
    if (w) W = w;
    if (m) M = m;
    render();
  }
  document.addEventListener("change", e => {
    const k = e.target.dataset && e.target.dataset.w;
    if (!k || !W) return;
    st[k] = k === "loss" ? Number(e.target.value) : e.target.value;
    save(); update();
  });
  document.addEventListener("input", e => {
    const k = e.target.dataset && e.target.dataset.wReb;
    if (!k || !W) return;
    const x = parseFloat(String(e.target.value).replace(",", "."));
    st.rebal[k] = fin(x) && x >= 0 ? Math.min(x, 1e9) : null;
    save();
    if ($("wRebalOut")) $("wRebalOut").innerHTML = rebalOut();
  });
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-w-act]");
    if (!b || !W) return;
    if (b.dataset.wAct === "toSparplan" && window.DTD.sparplanSet) {
      const exp = expected(allocation(quota().q), rates());
      window.DTD.sparplanSet({ ret: Math.round(exp * 10) / 10 });
      toast("Sparplan-Rechner", `Rendite ${pc(Math.round(exp * 10) / 10)} übernommen.`, 4000);
      if ($("sparplan")) $("sparplan").scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
  window.addEventListener("dtd:sparplan", () => { if (W && !$("vermoegen").hidden) { if ($("wPortfolioBody")) $("wPortfolioBody").innerHTML = portfolioBody(); drawFan(); } });
  let queued = false;
  window.addEventListener("resize", () => { if (queued || !$("wFan")) return; queued = true; requestAnimationFrame(() => { queued = false; if (!$("vermoegen").hidden) drawFan(); }); });
  window.DTD.startWealth = () => { if (!started) { started = true; load(); } else render(); };
  window.DTD.reloadWealth = () => { started = true; return window.DTD.shared.load("macro", true).then(m => { if (m) M = m; if (W) update(); }); };
  // für Tests und die Startseite: Aktienquote und Aufteilung zum gespeicherten Profil
  window.DTD.wealthProfile = () => (W ? { ...quota(), alloc: allocation(quota().q), rates: rates() } : null);
})();

// ---------- Tagesempfehlung & Top 25 ----------
// Liest data/ranking.json (wird jeden Börsentag vom GitHub-Job aktualisiert).
// Nutzt fmt, esc, kpi, v, warnBox und $ aus app.js.
(() => {
  const RAW = "https://raw.githubusercontent.com/shg9d54y9j-langw/Anna-test/claude/daytrade-website/data/ranking.json";
  const body = $("dailyBody");
  let data = null;

  const pct = p => (p > 0.995 ? "über 99 %" : p < 0.005 ? "unter 1 %" : `${fmt(p * 100, 0)} %`);
  const n1 = x => (Number.isFinite(x) ? fmt(x, 1) : "–");
  const profile = u => `https://www.etoro.com/people/${encodeURIComponent(u)}`;
  const link = u => `<a href="${profile(u)}" target="_blank" rel="noopener noreferrer">${esc(u)}</a>`;
  const okName = u => typeof u === "string" && /^[A-Za-z0-9_.-]{1,40}$/.test(u);   // nur gültige eToro-Namen anzeigen
  const dateDe = iso => new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
  const hold = h => (!Number.isFinite(h) ? "–" : h < 48 ? `${fmt(h, h < 10 ? 1 : 0)} Std.` : `${fmt(h / 24, 0)} Tage`);
  const account = () => { const x = parseFloat(($("sAccount") || {}).value); return Number.isFinite(x) && x > 0 ? x : null; };

  async function load() {
    const get = url => fetch(url, { cache: "no-store" }).then(r => (r.ok ? r.json() : null)).catch(() => null);
    const [local, raw] = await Promise.all([get("data/ranking.json"), get(RAW)]);
    const list = [local, raw].filter(d => d && d.updated);
    data = list.sort((a, b) => new Date(b.updated) - new Date(a.updated))[0] || null;
    render();
  }

  function setup() {
    $("dailyUpdated").textContent = "";
    body.innerHTML = `
      <div class="reco no">
        <div class="reco-head"><span class="icon-no">●</span> Noch keine Live-Daten</div>
        <p>Die Top 25 und die Tagesempfehlung werden jeden Börsentag um ca. 7 Uhr automatisch aus eToro-Daten berechnet. Dafür einmalig:</p>
        <ol class="steps">
          <li>In eToro: <b>Einstellungen</b> → <b>Trading</b> → <b>API-Key-Verwaltung</b> → <b>„Neuen Schlüssel erstellen“</b>. Name: ${v("DayTrade Desk")}, Berechtigung: ${v("nur Lesen")}. Mit dem SMS-Code bestätigen und <b>beide</b> Schlüssel kopieren – der User Key wird nur einmal angezeigt.</li>
          <li>In GitHub: Repository → <b>Settings</b> → <b>Secrets and variables</b> → <b>Actions</b> → <b>„New repository secret“</b>. Zweimal anlegen: Name ${v("ETORO_API_KEY")} mit dem öffentlichen API-Schlüssel und Name ${v("ETORO_USER_KEY")} mit dem User Key.</li>
          <li>Unter <b>Actions</b> → <b>„Tagesempfehlung“</b> → <b>„Run workflow“</b> einmal von Hand starten. Nach ca. 5 Minuten erscheinen hier die Daten.</li>
        </ol>
        <p class="muted small">Die Schlüssel niemals in einen Chat oder in Dateien kopieren – nur in die GitHub-Secrets.</p>
      </div>`;
  }

  function render() {
    if (!data) return setup();
    const d = data, cfg = d.config || {};
    const rec = d.recommendation && okName(d.recommendation.userName) ? d.recommendation : null;
    if (rec && rec.previous && !okName(rec.previous)) rec.previous = null;
    const top = Array.isArray(d.top) ? d.top.filter(r => r && okName(r.userName)) : [];
    const ageDays = (Date.now() - new Date(d.updated)) / 864e5;
    $("dailyUpdated").textContent = `Stand: ${new Date(d.updated).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })} Uhr`;
    const acc = account();
    const notes = [];
    if (ageDays > 4) notes.push(`Die Daten sind ${fmt(ageDays, 0)} Tage alt – läuft die GitHub-Aktion „Tagesempfehlung“ noch?`);

    let head;
    if (rec) {
      const amount = acc ? Math.floor(rec.amountPct * acc + 1e-9) : null;
      const bindTxt = { share: `Ihren Max. Anteil von ${fmt((cfg.share || 0) * 100, 0)} % des Kontos`, loss: `das Verlustbudget von ${fmt((cfg.lossPct || 0) * 100, 0)} % des Kontos`, kelly: "das halbe Kelly-Kriterium" }[rec.bind] || "";
      const status = rec.changed
        ? `<p class="reco-sub"><b>Neu seit heute.</b> ${esc(rec.note || "")}</p>`
        : `<p class="reco-sub">Unverändert seit ${dateDe(rec.since)} · ${esc(rec.note || "")}</p>`;
      const steps = [];
      if (rec.changed && rec.previous) steps.push(`Bisherige Kopie beenden: <b>„Portfolio“</b> → ${v(esc(rec.previous))} antippen → Zahnrad → <b>„Kopieren beenden“</b>.`);
      steps.push(
        `Profil von ${link(rec.userName)} öffnen und auf <b>„Kopieren“</b> tippen.`,
        `<b>„Betrag“</b>: ${v(amount !== null ? `${fmt(amount, 0)} $` : `${fmt(rec.amountPct * 100, 0)} % Ihres Kontos`)} – begrenzt durch ${bindTxt}.`,
        `<b>„Copy Stop Loss“</b>: ${v(rec.csl + " %")} (1,25 × bisher größter Rückgang von ${n1(rec.mdd)} %).`,
        `Häkchen <b>„Offene Trades kopieren“</b>: ${v("nicht setzen")}, dann mit <b>„Kopieren“</b> bestätigen.`,
      );
      head = `
        <div class="reco ok">
          <div class="reco-head"><span class="icon-ok">✓</span> Heute kopieren: ${link(rec.userName)}</div>
          ${status}
          <div class="result">
            ${kpi("Betrag", amount !== null ? `${fmt(amount, 0)} $` : `${fmt(rec.amountPct * 100, 0)} % vom Konto`)}
            ${kpi("Copy Stop Loss", `${rec.csl} %`, "down")}
            ${kpi("Können-Sicherheit", pct(rec.dsr), "up")}
            ${kpi("Rendite p.a.", `${n1(rec.cagr)} %`, "up")}
            ${kpi("Max. Drawdown", `${n1(rec.mdd)} %`, "down")}
          </div>
          <ol class="steps">${steps.map(s => `<li>${s}</li>`).join("")}</ol>
          ${acc ? "" : `<p class="muted small">Tragen Sie unten im Trader-Vergleich unter „Ihre Grenzen“ Ihren Kontostand ein, dann steht hier der Betrag in Dollar.</p>`}
        </div>`;
    } else {
      head = `
        <div class="reco no">
          <div class="reco-head"><span class="icon-no">✗</span> Heute keine Empfehlung</div>
          <p>${esc(d.notice || "Heute erfüllt kein Trader alle Bedingungen.")}</p>
          <p class="muted small">Das ist kein Fehler: Kein geprüfter Trader erreicht nach der Glücks-Korrektur eine Können-Sicherheit von ${pct(cfg.threshold || 0.9)}. Lieber keine Empfehlung als eine geratene.</p>
        </div>`;
    }

    const basis = `Geprüft: ${d.evaluated} der ${d.screened} meistkopierten Popular Investors mit Risiko-Score bis ${cfg.maxRisk} und mindestens ${cfg.minMonths} Monaten Historie.
      Glücks-Korrektur für effektiv ${fmt(d.nEff, 0)} unabhängige Trader (mittlere Korrelation ${fmt(d.avgCorrelation, 2)}).
      ${d.qualifiedCount} ${d.qualifiedCount === 1 ? "erfüllt" : "erfüllen"} alle Bedingungen (Können-Sicherheit ab ${pct(cfg.threshold || 0.9)}, Drawdown bis ${cfg.maxDd} %).`;

    const rows = top.map(r => `<tr>
        <td>${r.rank}</td>
        <td>${link(r.userName)}</td>
        <td>${r.qualified ? `<span class="tag good">✓ sicher</span>` : `<span class="tag bad"><span class="x">✗</span> ${esc(r.reason || "")}</span>`}</td>
        <td>${pct(r.dsr)}</td>
        <td>${n1(r.cagr)} %</td>
        <td>${n1(r.mdd)} %</td>
        <td>${Number.isFinite(r.sharpe) ? fmt(r.sharpe, 2) : "–"}</td>
        <td>${r.risk ?? "–"}</td>
        <td>${Number.isFinite(r.copiers) ? r.copiers.toLocaleString("de-DE") : "–"}</td>
        <td>${hold(r.avgHoldHours)}</td>
        <td>${r.months}</td>
      </tr>`).join("");

    body.innerHTML = `
      ${head}
      ${warnBox(notes)}
      <p class="hint">${basis}</p>
      <h3>Abbildung: Sicherheit und Rendite aller geprüften Trader</h3>
      <p class="muted small">Jeder Punkt ist ein Trader. Rechts der gestrichelten Linie liegt die Können-Sicherheit bei mindestens ${pct(cfg.threshold || 0.9)}, je höher der Punkt, desto mehr Rendite pro Jahr. Gesucht wird also oben rechts.</p>
      <div class="legend-row" id="dailyLegend"></div>
      <div class="chart-host" id="dailyChart"></div>
      <h3>Top 25</h3>
      <p class="muted small">Sortierung: zuerst alle sicheren Trader nach Rendite, danach die übrigen nach Können-Sicherheit. Rendite und Drawdown aus den Monatsrenditen der letzten bis zu ${cfg.maxMonths} Monate.</p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Platz</th><th>Trader</th><th>Ergebnis</th><th>Können-Sicherheit</th><th>Rendite p.a.</th><th>Max. Drawdown</th><th>Sharpe</th><th>Risiko</th><th>Kopierer</th><th>Ø Haltedauer</th><th>Monate</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="11" class="muted">Keine Trader innerhalb der Grenzen.</td></tr>`}</tbody>
        </table>
      </div>
      <p class="muted small">Vergangene Renditen garantieren nichts. Die Sicherheit gibt an, wie wahrscheinlich die bisherige Leistung Können statt Glück war – nicht, dass sie weitergeht.</p>`;
    scatter(Array.isArray(d.all) && d.all.length ? d.all : top, cfg, rec ? rec.userName : null);
  }

  // ---------- Abbildung: Können-Sicherheit (x) gegen Rendite p.a. (y) ----------
  const NS = "http://www.w3.org/2000/svg";
  const BLUE = "#3987e5", GRAY = "#8b949e", INK = "#e6edf3", SURFACE = "#161b22";
  const STYLE = {
    rec:    { r: 7,   fill: BLUE,   stroke: INK,     sw: 2,   label: "Tagesempfehlung" },
    safe:   { r: 4.5, fill: BLUE,   stroke: SURFACE, sw: 1.5, label: "Sicher – alle Bedingungen erfüllt" },
    unsafe: { r: 4.5, fill: GRAY,   stroke: SURFACE, sw: 1.5, label: "Zu unsicher – könnte Glück sein" },
    out:    { r: 4,   fill: "none", stroke: GRAY,    sw: 1.5, label: "Außerhalb Ihrer Grenzen (Drawdown/Risiko)" },
  };
  const svgEl = (tag, attrs, parent) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  };
  function niceTicks(min, max, count) {
    const raw = (max - min || 1) / count, mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map(s => s * mag).find(s => s >= raw);
    const out = [];
    for (let x = Math.floor(min / step) * step; x <= Math.ceil(max / step) * step + step / 2; x += step) out.push(+x.toFixed(10));
    return out;
  }

  function scatter(points, cfg, recName) {
    const host = $("dailyChart"), legend = $("dailyLegend");
    if (!host) return;
    const thr = cfg.threshold || 0.9;
    const kind = p => (p.userName === recName ? "rec" : p.qualified ? "safe" : p.inLimits === false ? "out" : "unsafe");
    const pts = points.filter(p => p && okName(p.userName) && Number.isFinite(p.dsr) && Number.isFinite(p.cagr)).map(p => ({ ...p, k: kind(p) }));
    if (!pts.length) { host.innerHTML = `<p class="muted">Keine Daten für die Abbildung.</p>`; legend.replaceChildren(); return; }

    // Legende: Symbole wie im Diagramm
    legend.replaceChildren();
    for (const k of ["rec", "safe", "unsafe", "out"]) {
      if (!pts.some(p => p.k === k)) continue;
      const s = STYLE[k], item = document.createElement("span"), sym = svgEl("svg", { width: 16, height: 16, viewBox: "0 0 16 16", "aria-hidden": "true" });
      svgEl("circle", { cx: 8, cy: 8, r: Math.min(s.r, 6), fill: s.fill, stroke: s.stroke === SURFACE ? "none" : s.stroke, "stroke-width": s.sw }, sym);
      item.className = "legend-item";
      item.append(sym, document.createTextNode(`${s.label} (${pts.filter(p => p.k === k).length})`));
      legend.append(item);
    }

    const W = Math.max(300, host.clientWidth), H = W < 560 ? 320 : 400;
    const m = { l: 56, r: 18, t: 26, b: 44 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    const yt = niceTicks(Math.min(0, ...pts.map(p => p.cagr)), Math.max(0, ...pts.map(p => p.cagr)), 5);
    const y0 = yt[0], y1 = yt[yt.length - 1];
    const X = s => m.l + s * pw;
    const Y = c => m.t + (y1 - c) / (y1 - y0) * ph;

    const svg = svgEl("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img",
      "aria-label": `Streudiagramm: ${pts.length} Trader nach Können-Sicherheit und Rendite pro Jahr, davon ${pts.filter(p => p.k === "safe" || p.k === "rec").length} sicher.` });
    // Bereich „sicher“ dezent hinterlegen
    svgEl("rect", { x: X(thr), y: m.t, width: X(1) - X(thr), height: ph, fill: "rgba(57,135,229,.07)" }, svg);
    for (const t of yt) {
      svgEl("line", { x1: m.l, x2: m.l + pw, y1: Y(t), y2: Y(t), class: t === 0 ? "base" : "grid" }, svg);
      svgEl("text", { x: m.l - 8, y: Y(t) + 4, "text-anchor": "end", class: "tick" }, svg).textContent = `${fmt(t, 0)} %`;
    }
    for (const s of [0, 0.25, 0.5, 0.75, 1]) {
      svgEl("text", { x: X(s), y: m.t + ph + 18, "text-anchor": s === 0 ? "start" : s === 1 ? "end" : "middle", class: "tick" }, svg).textContent = `${fmt(s * 100, 0)} %`;
    }
    svgEl("text", { x: m.l + pw, y: H - 4, "text-anchor": "end", class: "axis-title" }, svg).textContent = "Können-Sicherheit →";
    svgEl("text", { x: m.l - 48, y: 12, class: "axis-title" }, svg).textContent = "↑ Rendite p.a.";
    svgEl("line", { x1: X(thr), x2: X(thr), y1: m.t, y2: m.t + ph, class: "threshold" }, svg);
    svgEl("text", { x: X(thr) - 6, y: m.t + 12, "text-anchor": "end", class: "tick" }, svg).textContent = `Schwelle ${pct(thr)}`;

    // Punkte: unwichtige zuerst, Empfehlung zuletzt (oben)
    const order = { out: 0, unsafe: 1, safe: 2, rec: 3 };
    const sorted = [...pts].sort((a, b) => order[a.k] - order[b.k]);
    for (const p of sorted) {
      const s = STYLE[p.k];
      p.cx = X(p.dsr); p.cy = Y(p.cagr);
      svgEl("circle", { cx: p.cx, cy: p.cy, r: s.r, fill: s.fill, stroke: s.stroke, "stroke-width": s.sw }, svg);
    }
    const recPt = pts.find(p => p.k === "rec");
    if (recPt) {
      const left = recPt.cx > m.l + pw - 140;
      svgEl("text", { x: recPt.cx + (left ? -12 : 12), y: recPt.cy - 10, "text-anchor": left ? "end" : "start", class: "dlabel" }, svg).textContent = recPt.userName;
    }

    // Hover: nächster Punkt im Umkreis von 24 px, Tooltip zeigt die Werte
    const ring = svgEl("circle", { r: 9, fill: "none", stroke: INK, "stroke-width": 1.5, visibility: "hidden" }, svg);
    const hit = svgEl("rect", { x: 0, y: 0, width: W, height: H, fill: "transparent", tabindex: 0, class: "hit" }, svg);
    host.replaceChildren(svg);
    const tip = document.createElement("div");
    tip.className = "viz-tip";
    tip.hidden = true;
    host.append(tip);
    const byX = [...pts].sort((a, b) => a.dsr - b.dsr || a.cagr - b.cagr);
    let curIdx = byX.indexOf(recPt || byX[byX.length - 1]);

    function show(p) {
      ring.setAttribute("cx", p.cx); ring.setAttribute("cy", p.cy); ring.setAttribute("visibility", "visible");
      const head = document.createElement("div");
      head.className = "tip-head";
      head.textContent = `${p.userName} · ${STYLE[p.k].label}`;
      tip.replaceChildren(head);
      for (const [label, val] of [["Können-Sicherheit", pct(p.dsr)], ["Rendite p.a.", `${n1(p.cagr)} %`], ["Max. Drawdown", `${n1(p.mdd)} %`], ["Monate Historie", String(p.months ?? "–")]]) {
        const row = document.createElement("div"), b = document.createElement("strong"), l = document.createElement("span");
        row.className = "tip-row"; b.textContent = val; l.className = "muted"; l.textContent = label;
        row.append(b, l);
        tip.append(row);
      }
      tip.hidden = false;
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      tip.style.left = `${Math.max(0, p.cx + 14 + tw > W ? p.cx - tw - 14 : p.cx + 14)}px`;
      tip.style.top = `${Math.max(0, Math.min(H - th, p.cy - th / 2))}px`;
    }
    function hide() { ring.setAttribute("visibility", "hidden"); tip.hidden = true; }
    hit.addEventListener("pointermove", ev => {
      const r = svg.getBoundingClientRect(), sx = W / r.width;
      const x = (ev.clientX - r.left) * sx, y = (ev.clientY - r.top) * sx;
      let best = null, bd = 24 * 24;
      for (const p of pts) { const d2 = (p.cx - x) ** 2 + (p.cy - y) ** 2; if (d2 < bd) { bd = d2; best = p; } }
      best ? show(best) : hide();
    });
    hit.addEventListener("pointerleave", hide);
    hit.addEventListener("focus", () => show(byX[curIdx]));
    hit.addEventListener("blur", hide);
    hit.addEventListener("keydown", ev => {
      if (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight") return;
      curIdx = Math.max(0, Math.min(byX.length - 1, curIdx + (ev.key === "ArrowRight" ? 1 : -1)));
      show(byX[curIdx]);
      ev.preventDefault();
    });
  }

  const settings = $("cmpSettings");
  if (settings) settings.addEventListener("input", () => data && render());
  let rt;
  window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => data && render(), 200); });
  load();
})();

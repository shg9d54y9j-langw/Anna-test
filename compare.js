// ---------- Trader-Vergleich ----------
// Statistik nach Bailey & López de Prado: Probabilistic Sharpe Ratio (2012)
// und Deflated Sharpe Ratio (2014, Korrektur für die Auswahl des Besten aus N).
// Nutzt fmt, esc, kpi, v, warnBox und $ aus app.js.
(() => {
  const STORE = "daytrade-traders-v1";
  const COLORS = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];
  const SURFACE = "#161b22";
  const MAX_TRADERS = COLORS.length;
  const MIN_COPY = 200; // eToro-Mindestbetrag pro kopiertem Trader ($)

  const EXAMPLES = [
    { id: "ex-a", slot: 0, name: "Beispiel A – konstant", mdd: 7.5, risk: 4, hold: 5, win: 58, avgWin: 1.4, avgLoss: 1.0, tpw: 18,
      returns: [2.1, 1.4, -0.8, 3.2, 1.9, 0.6, 2.8, -1.5, 1.7, 2.4, 0.9, 1.6, 3.0, -0.4, 1.8, 2.2, 0.3, 1.1, 2.6, -1.1, 1.9, 2.7, 1.3, 0.8] },
    { id: "ex-b", slot: 1, name: "Beispiel B – Glückssträhne", mdd: 18, risk: 5, hold: 8, win: 52, avgWin: 2.8, avgLoss: 2.2, tpw: 30,
      returns: [12.5, -8.2, 15.1, 3.4, -11.6, 9.8, 18.2, -6.5, 4.1, -3.9, 11.7, 2.4] },
    { id: "ex-c", slot: 2, name: "Beispiel C – Swingtrader", mdd: 9, risk: 4, hold: 96, win: 63, avgWin: 3.5, avgLoss: 2.6, tpw: 3,
      returns: [1.9, 0.8, 2.5, -1.2, 1.6, 2.2, 0.4, 1.8, -0.7, 2.9, 1.3, 0.6, 2.0, 1.5, -0.3, 2.4, 1.1, 1.7] },
  ];
  const NUM_FIELDS = ["mdd", "risk", "hold", "win", "avgWin", "avgLoss", "tpw"];
  const SETTINGS = ["sAccount", "sShare", "sLoss", "sRisk", "sHold", "sDd", "sMonths", "sThr", "sSeen", "sRf"];

  // ---------- Speicher (nur lokal im Browser) ----------
  const clone = list => list.map(t => ({ ...t, returns: [...t.returns] }));
  function normalize(t) {
    const o = { ...t, returns: (t.returns || []).map(Number).filter(Number.isFinite) };
    for (const k of NUM_FIELDS) o[k] = o[k] === null || o[k] === undefined || o[k] === "" ? NaN : Number(o[k]);
    return o;
  }
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE));
      if (s && Array.isArray(s.traders)) return { traders: s.traders.map(normalize), settings: s.settings || {} };
    } catch {}
    return { traders: clone(EXAMPLES), settings: {} };
  }
  function save() { try { localStorage.setItem(STORE, JSON.stringify(state)); } catch {} }
  const state = load();

  // ---------- Auswertung (die Mathematik steht in stats.js) ----------
  const TS = window.TradeStats;
  const mean = TS.mean;

  function analyze(t, cfg, N) {
    const n = t.returns.length;
    const res = { t, n, ok: n >= 3, fails: [] };
    if (!res.ok) { res.fails.push("weniger als 3 Monatswerte"); return res; }
    Object.assign(res, TS.metrics(t.returns, { rf: cfg.rf, N, mddInput: t.mdd }));
    if ([t.win, t.avgWin, t.avgLoss].every(Number.isFinite)) {
      const p = t.win / 100, W = t.avgWin, L = Math.abs(t.avgLoss);
      res.expectancy = p * W - (1 - p) * L;
      res.profitFactor = (1 - p) * L > 0 ? p * W / ((1 - p) * L) : Infinity;
    }

    if (n < cfg.minMonths) res.fails.push(`nur ${n} Monate Daten (mind. ${cfg.minMonths})`);
    if (t.hold > cfg.maxHold) res.fails.push(`Ø Haltedauer ${fmtHold(t.hold)} > ${fmtHold(cfg.maxHold)}`);
    if (t.risk > cfg.maxRisk) res.fails.push(`Risiko-Score ${t.risk} > ${cfg.maxRisk}`);
    if (res.mdd > cfg.maxDd) res.fails.push(`Drawdown ${fmt(res.mdd, 1)} % > ${fmt(cfg.maxDd, 0)} %`);
    if (res.expectancy !== undefined && res.expectancy <= 0) res.fails.push("Erwartung je Trade nicht positiv");
    if (Number.isFinite(t.tpw) && t.tpw < 1) res.fails.push("weniger als 1 Trade pro Woche");
    res.inLimits = res.fails.length === 0;
    res.qualified = res.inLimits && res.dsr >= cfg.thr;
    if (res.inLimits && !res.qualified) res.fails.push(`Können-Sicherheit ${pct(res.dsr)} < ${pct(cfg.thr)}`);
    return res;
  }

  function allocation(r, cfg) {
    const a = TS.allocation(r, { share: cfg.share / 100, lossPct: cfg.account > 0 ? cfg.loss / cfg.account : 0 });
    const why = {
      share: `Ihren Max. Anteil von ${fmt(cfg.share, 0)} % des Kontos`,
      loss: `Ihr Verlustbudget von ${fmt(cfg.loss, 0)} $`,
      kelly: `das halbe Kelly-Kriterium (${fmt(r.halfKelly * 100, 0)} % des Kontos)`,
    }[a.bind];
    const amount = Math.max(0, Math.floor(a.frac * cfg.account + 1e-9));
    return { csl: a.csl, amount, why, maxLoss: amount * a.csl / 100, ddLoss: amount * r.mdd / 100 };
  }

  // ---------- Formatierung ----------
  function fmtHold(h) {
    if (!Number.isFinite(h)) return "–";
    if (h < 48) return `${fmt(h, Number.isInteger(h) ? 0 : 1)} Std.`;
    const d = h / 24;
    return `${fmt(d, Number.isInteger(d) ? 0 : 1)} Tage`;
  }
  function pct(p) {
    if (p > 0.995) return "über 99 %";
    if (p < 0.005) return "unter 1 %";
    return `${fmt(p * 100, 0)} %`;
  }
  const num = (x, d = 2) => (x === Infinity ? "∞" : Number.isFinite(x) ? fmt(x, d) : "–");
  const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
  const byDsr = (a, b) => b.dsr - a.dsr || b.calmar - a.calmar;

  // ---------- Einstellungen ----------
  function readCfg() {
    const g = (id, d) => { const x = parseFloat($(id).value); return Number.isFinite(x) ? x : d; };
    return {
      account: g("sAccount", 0), share: g("sShare", 20), loss: g("sLoss", 0),
      maxRisk: g("sRisk", 5), maxHold: g("sHold", 24), maxDd: g("sDd", 20),
      minMonths: Math.max(3, Math.round(g("sMonths", 12))), thr: Number($("sThr").value),
      seen: g("sSeen", NaN), rf: g("sRf", 0),
    };
  }
  for (const id of SETTINGS) if (state.settings[id] !== undefined) $(id).value = state.settings[id];

  // ---------- Ausgabe ----------
  function render() {
    state.settings = Object.fromEntries(SETTINGS.map(id => [id, $(id).value]));
    save();
    const cfg = readCfg();
    const valid = state.traders.filter(t => t.returns.length >= 3).length;
    const N = Math.max(1, valid, Number.isFinite(cfg.seen) ? Math.floor(cfg.seen) : 0);
    const rows = state.traders.map(t => analyze(t, cfg, N));
    renderReco(rows, cfg, N);
    renderTable(rows, cfg);
    renderChart(rows);
  }

  function renderReco(rows, cfg, N) {
    const box = $("cmpReco");
    const valid = rows.filter(r => r.ok);
    const basis = `Glücks-Korrektur für N = ${N} angesehene Trader, geforderte Sicherheit ${pct(cfg.thr)}.`;
    if (!valid.length) {
      box.className = "reco";
      box.innerHTML = `<p>Noch keine Trader eingetragen. Unten Werte aus eToro eintragen oder „Beispiele laden“.</p>`;
      return;
    }
    const qualified = valid.filter(r => r.qualified).sort(byDsr);
    if (qualified.length) {
      const best = qualified[0], al = allocation(best, cfg), name = esc(best.t.name);
      const others = qualified.slice(1).map(r => esc(r.t.name));
      const notes = [];
      if (al.amount < MIN_COPY) notes.push(`Mit Ihren Grenzen ergibt sich weniger als der eToro-Mindestbetrag von ${MIN_COPY} $. Verlustbudget oder Max. Anteil erhöhen – oder nicht kopieren.`);
      if (String(best.t.id).startsWith("ex-")) notes.push("Das sind erfundene Beispieldaten. Für eine echte Empfehlung bitte echte Trader aus eToro eintragen.");
      box.className = "reco ok";
      box.innerHTML = `
        <div class="reco-head"><span class="icon-ok">✓</span> Mathematische Empfehlung: ${name}</div>
        <p class="reco-sub">Können-Sicherheit <b>${pct(best.dsr)}</b> · Rendite p.a. ${num(best.cagr, 1)} % · Max. Drawdown ${num(best.mdd, 1)} % · Sharpe ${num(best.sharpe)}</p>
        <div class="result">
          ${kpi("Betrag", `${fmt(al.amount, 0)} $`)}
          ${kpi("Copy Stop Loss", `${al.csl} %`, "down")}
          ${kpi("Max. Verlust", `${fmt(al.maxLoss, 0)} $`, "down")}
          ${kpi("Offene Trades kopieren", "Nein")}
        </div>
        <ol class="steps">
          <li>In eToro das Profil von ${v(name)} öffnen und auf <b>„Kopieren“</b> tippen.</li>
          <li><b>„Betrag“</b>: ${v(fmt(al.amount, 0) + " $")} – begrenzt durch ${al.why}.</li>
          <li><b>„Copy Stop Loss“</b>: ${v(al.csl + " %")} (1,25 × bisher größter Rückgang von ${fmt(best.mdd, 1)} %).</li>
          <li>Häkchen <b>„Offene Trades kopieren“</b>: ${v("nicht setzen")}, dann mit <b>„Kopieren“</b> bestätigen.</li>
        </ol>
        <p class="muted small">So verlieren Sie mit dieser Kopie höchstens ca. ${fmt(al.maxLoss, 0)} $. Ein Rückgang wie der bisher schlimmste würde ca. ${fmt(al.ddLoss, 0)} $ kosten. ${basis}</p>
        ${others.length ? `<p class="small">Ebenfalls geeignet: ${others.join(", ")} – zum Verteilen des Risikos auf mehrere Trader.</p>` : ""}
        ${warnBox(notes)}`;
      return;
    }
    const cand = valid.filter(r => r.inLimits).sort(byDsr)[0];
    let detail = `<p>Kein eingetragener Trader hält alle Ihre Grenzen ein – die Gründe stehen in der Tabelle unter „Ergebnis“.</p>`;
    if (cand) {
      const need = TS.monthsNeeded(cand, N, cfg.thr);
      detail = `<p>Bester Kandidat innerhalb Ihrer Grenzen: <b>${esc(cand.t.name)}</b> mit Können-Sicherheit <b>${pct(cand.dsr)}</b> (nötig: ${pct(cfg.thr)}).
        ${need < Infinity
          ? `Bei gleichbleibender Leistung wären ca. ${need} Monate Daten nötig (jetzt ${cand.n}).`
          : "Mit dieser Leistung wäre die Sicherheit auch mit viel längerer Historie nicht erreichbar."}</p>`;
    }
    box.className = "reco no";
    box.innerHTML = `
      <div class="reco-head"><span class="icon-no">✗</span> Keine mathematisch belastbare Empfehlung</div>
      ${detail}
      <p class="muted small">Eine hohe Rendite allein reicht nicht: Bei wenigen Monaten und starken Schwankungen kann sie gut Zufall sein. Weitere Trader eintragen oder in einigen Monaten erneut prüfen. ${basis}</p>`;
  }

  function renderTable(rows, cfg) {
    const rank = r => (!r.ok ? 3 : r.qualified ? 0 : r.inLimits ? 1 : 2);
    const sorted = [...rows].sort((a, b) => rank(a) - rank(b) || (b.dsr || 0) - (a.dsr || 0));
    const bestId = sorted[0] && sorted[0].qualified ? sorted[0].t.id : null;
    $("cmpTable").querySelector("tbody").innerHTML = sorted.map(r => {
      const t = r.t;
      const result = r.qualified
        ? `<span class="tag good">✓ ${t.id === bestId ? "Empfohlen" : "Geeignet"}</span>`
        : `<span class="tag bad"><span class="x">✗</span> ${esc(r.fails[0] || "")}</span>`;
      const sure = r.ok && r.dsr >= cfg.thr;
      const safety = r.ok ? `<span class="${sure ? "up" : "down"}">${sure ? "✓" : "✗"}</span> ${pct(r.dsr)}` : "–";
      return `<tr>
        <td class="actions"><span class="lkey" style="background:${COLORS[t.slot]}"></span> ${esc(t.name)}
          <button type="button" data-edit="${esc(t.id)}" title="Bearbeiten">✎</button><button type="button" data-del="${esc(t.id)}" title="Löschen">✕</button></td>
        <td>${result}</td>
        <td>${safety}</td>
        <td>${r.n}</td>
        <td>${r.ok ? num(r.cagr, 1) + " %" : "–"}</td>
        <td>${r.ok ? num(r.mdd, 1) + " %" : "–"}</td>
        <td>${r.ok ? num(r.sharpe) : "–"}</td>
        <td>${r.ok ? num(r.sortino) : "–"}</td>
        <td>${r.ok ? num(r.calmar) : "–"}</td>
        <td>${r.expectancy !== undefined ? num(r.expectancy) + " %" : "–"}</td>
        <td>${r.profitFactor !== undefined ? num(r.profitFactor) : "–"}</td>
        <td>${fmtHold(t.hold)}</td>
        <td>${Number.isFinite(t.risk) ? t.risk : "–"}</td>
      </tr>`;
    }).join("") || `<tr><td colspan="13" class="muted">Noch keine Trader eingetragen.</td></tr>`;
  }

  function niceTicks(min, max, count) {
    const raw = (max - min || 1) / count;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map(s => s * mag).find(s => s >= raw);
    const out = [];
    for (let x = Math.floor(min / step) * step; x <= Math.ceil(max / step) * step + step / 2; x += step) out.push(+x.toFixed(10));
    return out;
  }

  function renderChart(rows) {
    const host = $("cmpChart"), legend = $("cmpLegend");
    host.replaceChildren();
    legend.replaceChildren();
    const series = rows.filter(r => r.ok).sort((a, b) => a.t.slot - b.t.slot);
    if (!series.length) { host.innerHTML = `<p class="muted">Noch keine Daten.</p>`; return; }
    if (series.length >= 2) for (const s of series) {
      const item = document.createElement("span"), key = document.createElement("span");
      item.className = "legend-item"; key.className = "lkey"; key.style.background = COLORS[s.t.slot];
      item.append(key, document.createTextNode(s.t.name));
      legend.append(item);
    }

    const W = Math.max(280, host.clientWidth), H = W < 520 ? 240 : 300;
    const direct = series.length <= 4 && W >= 560;
    const m = { l: 58, r: direct ? 190 : 14, t: 12, b: 28 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    const maxN = Math.max(...series.map(s => s.n));
    const all = series.flatMap(s => s.curve);
    const ticks = niceTicks(Math.min(100, ...all), Math.max(100, ...all), 5);
    const y0 = ticks[0], y1 = ticks[ticks.length - 1];
    const X = k => m.l + (k + maxN) / maxN * pw;
    const Y = val => m.t + (y1 - val) / (y1 - y0) * ph;

    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    const add = (tag, attrs, parent = svg) => {
      const e = document.createElementNS(NS, tag);
      for (const k in attrs) e.setAttribute(k, attrs[k]);
      parent.appendChild(e);
      return e;
    };
    for (const [k, val] of Object.entries({ width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Wachstum von 100 $ je Trader über die Monate" })) svg.setAttribute(k, val);

    for (const tk of ticks) {
      add("line", { x1: m.l, x2: m.l + pw, y1: Y(tk), y2: Y(tk), class: "grid" });
      add("text", { x: m.l - 8, y: Y(tk) + 4, "text-anchor": "end", class: "tick" }).textContent = `${fmt(tk, 0)} $`;
    }
    add("line", { x1: m.l, x2: m.l + pw, y1: Y(100), y2: Y(100), class: "base" });
    const step = maxN > 24 ? 12 : maxN > 12 ? 6 : 3;
    for (let k = 0; k >= -maxN; k -= step) {
      add("text", { x: X(k), y: H - 8, "text-anchor": k === 0 ? "end" : "middle", class: "tick" }).textContent = k === 0 ? "heute" : `vor ${-k} M.`;
    }
    for (const s of series) {
      const d = s.curve.map((val, j) => `${j ? "L" : "M"}${X(j - s.n).toFixed(1)},${Y(val).toFixed(1)}`).join("");
      add("path", { d, fill: "none", stroke: COLORS[s.t.slot], "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" });
    }
    if (direct) {
      const labels = series.map(s => ({ s, y: Y(s.curve[s.n]) })).sort((a, b) => a.y - b.y);
      for (let i = 1; i < labels.length; i++) labels[i].y = Math.max(labels[i].y, labels[i - 1].y + 15);
      const last = labels.length - 1;
      labels[last].y = Math.min(labels[last].y, m.t + ph);
      for (let i = last - 1; i >= 0; i--) labels[i].y = Math.min(labels[i].y, labels[i + 1].y - 15);
      for (const l of labels) add("text", { x: m.l + pw + 8, y: l.y + 4, class: "dlabel" }).textContent = trunc(l.s.t.name, 27);
    }

    // Hover-Ebene: Fadenkreuz rastet auf den nächsten Monat ein, Tooltip zeigt alle Trader
    const cross = add("line", { y1: m.t, y2: m.t + ph, class: "cross", visibility: "hidden" });
    const dots = series.map(s => add("circle", { r: 4, fill: COLORS[s.t.slot], stroke: SURFACE, "stroke-width": 2, visibility: "hidden" }));
    const hit = add("rect", { x: m.l - 6, y: m.t, width: pw + 12, height: ph, fill: "transparent", tabindex: 0, class: "hit" });
    host.append(svg);
    const tip = document.createElement("div");
    tip.className = "viz-tip";
    tip.hidden = true;
    host.append(tip);

    let cur = 0;
    function show(k) {
      cur = k;
      for (const a of ["x1", "x2"]) cross.setAttribute(a, X(k));
      cross.setAttribute("visibility", "visible");
      const items = [];
      series.forEach((s, i) => {
        const j = k + s.n;
        if (j < 0) { dots[i].setAttribute("visibility", "hidden"); return; }
        dots[i].setAttribute("cx", X(k));
        dots[i].setAttribute("cy", Y(s.curve[j]));
        dots[i].setAttribute("visibility", "visible");
        items.push({ s, val: s.curve[j] });
      });
      items.sort((a, b) => b.val - a.val);
      const head = document.createElement("div");
      head.className = "tip-head";
      head.textContent = k === 0 ? "Aktueller Stand" : `vor ${-k} ${k === -1 ? "Monat" : "Monaten"}`;
      tip.replaceChildren(head);
      for (const it of items) {
        const row = document.createElement("div"), key = document.createElement("span");
        const val = document.createElement("strong"), nm = document.createElement("span");
        row.className = "tip-row"; key.className = "lkey"; key.style.background = COLORS[it.s.t.slot];
        val.textContent = `${fmt(it.val)} $`;
        nm.className = "muted"; nm.textContent = it.s.t.name;
        row.append(key, val, nm);
        tip.append(row);
      }
      tip.hidden = false;
      const tw = tip.offsetWidth, left = X(k) + 12;
      tip.style.left = `${Math.max(0, left + tw > W ? X(k) - tw - 12 : left)}px`;
      tip.style.top = `${m.t}px`;
    }
    function hide() {
      cross.setAttribute("visibility", "hidden");
      dots.forEach(dt => dt.setAttribute("visibility", "hidden"));
      tip.hidden = true;
    }
    const toK = ev => {
      const rect = svg.getBoundingClientRect();
      const px = (ev.clientX - rect.left) * (W / rect.width);
      return Math.max(-maxN, Math.min(0, Math.round((px - m.l) / pw * maxN - maxN)));
    };
    hit.addEventListener("pointermove", ev => show(toK(ev)));
    hit.addEventListener("pointerdown", ev => show(toK(ev)));
    hit.addEventListener("pointerleave", hide);
    hit.addEventListener("focus", () => show(0));
    hit.addEventListener("blur", hide);
    hit.addEventListener("keydown", ev => {
      if (ev.key === "ArrowLeft") { show(Math.max(-maxN, cur - 1)); ev.preventDefault(); }
      if (ev.key === "ArrowRight") { show(Math.min(0, cur + 1)); ev.preventDefault(); }
    });
  }

  // ---------- Eingabeformular ----------
  function parseReturns(str) {
    const s = String(str).replace(/[−–]/g, "-").replace(/%/g, " ").trim();
    if (!s) return [];
    const tokens = s.includes(";") ? s.split(/[;\s]+/)       // ; trennt, Komma ist Dezimalzeichen
      : s.includes(".") ? s.split(/[,\s]+/)                    // Punkt ist Dezimalzeichen, Komma trennt
      : s.split(/\s+/);                                         // Komma ist Dezimalzeichen
    return tokens.map(t => t.replace(",", ".")).filter(t => t && t !== "-" && t !== ".").map(Number).filter(Number.isFinite);
  }
  const fnum = id => { const s = $(id).value.trim().replace(",", "."); return s === "" ? NaN : Number(s); };
  const uid = () => "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const freeSlot = () => COLORS.findIndex((_, i) => !state.traders.some(t => t.slot === i));
  let editingId = null;

  function showError(msg) { const e = $("tError"); e.textContent = msg ? `⚠ ${msg}` : ""; e.hidden = !msg; }
  function updateCount() {
    const r = parseReturns($("tReturns").value);
    $("tCount").textContent = `${r.length} ${r.length === 1 ? "Wert" : "Werte"} erkannt` + (r.length ? ` · Ø ${fmt(mean(r))} % pro Monat` : "");
  }
  function resetForm() {
    editingId = null;
    $("tForm").reset();
    $("tSubmit").textContent = "Trader hinzufügen";
    $("tFormTitle").textContent = "Trader eintragen";
    $("tCancel").hidden = true;
    showError("");
    updateCount();
  }

  $("tReturns").addEventListener("input", updateCount);
  $("tCancel").addEventListener("click", resetForm);
  $("tForm").addEventListener("submit", e => {
    e.preventDefault();
    const returns = parseReturns($("tReturns").value);
    if (returns.length < 3) return showError("Bitte mindestens 3 Monatsrenditen eintragen – für eine Empfehlung mindestens 12.");
    if (!editingId && state.traders.length >= MAX_TRADERS) return showError(`Maximal ${MAX_TRADERS} Trader – bitte zuerst einen löschen.`);
    const t = {
      id: editingId || uid(), name: $("tName").value.trim(), returns,
      mdd: fnum("tMdd"), risk: fnum("tRisk"), hold: fnum("tHold") * Number($("tHoldUnit").value),
      win: fnum("tWin"), avgWin: fnum("tAvgWin"), avgLoss: fnum("tAvgLoss"), tpw: fnum("tTpw"),
    };
    const i = state.traders.findIndex(x => x.id === editingId);
    if (i >= 0) { t.slot = state.traders[i].slot; state.traders[i] = t; }
    else { t.slot = freeSlot(); state.traders.push(t); }
    resetForm();
    render();
  });

  $("cmpTable").addEventListener("click", e => {
    const btn = e.target.closest("button");
    if (!btn) return;
    if (btn.dataset.del) {
      state.traders = state.traders.filter(t => t.id !== btn.dataset.del);
      if (editingId === btn.dataset.del) resetForm();
      render();
    }
    if (btn.dataset.edit) {
      const t = state.traders.find(x => x.id === btn.dataset.edit);
      if (!t) return;
      editingId = t.id;
      const days = t.hold >= 48 && Number.isInteger(t.hold / 24);
      const set = (id, val) => { $(id).value = Number.isFinite(val) ? val : ""; };
      $("tName").value = t.name;
      $("tReturns").value = t.returns.map(x => String(x).replace(".", ",")).join("  ");
      set("tMdd", t.mdd); set("tRisk", t.risk); set("tHold", days ? t.hold / 24 : t.hold);
      $("tHoldUnit").value = days ? "24" : "1";
      set("tWin", t.win); set("tAvgWin", t.avgWin); set("tAvgLoss", t.avgLoss); set("tTpw", t.tpw);
      $("tSubmit").textContent = "Änderung speichern";
      $("tFormTitle").textContent = `Trader bearbeiten: ${t.name}`;
      $("tCancel").hidden = false;
      updateCount();
      $("tFormTitle").scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });

  $("cmpExamples").addEventListener("click", () => {
    if (state.traders.length && !confirm("Ihre eingetragenen Trader werden durch die Beispiele ersetzt. Fortfahren?")) return;
    state.traders = clone(EXAMPLES);
    resetForm();
    render();
  });
  $("cmpClear").addEventListener("click", () => {
    if (!state.traders.length || !confirm("Alle eingetragenen Trader löschen?")) return;
    state.traders = [];
    resetForm();
    render();
  });
  $("cmpSettings").addEventListener("input", render);

  let rt;
  window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(render, 150); });

  updateCount();
  render();

  // Für die Gegenprobe im Test
  window.__cmp = { ...TS, analyze, parseReturns };
})();

// ---------- Vergleich von 2–4 Aktien: Ablage per Knopf, Ansicht in den Werkzeugen (#vergleich) ----------
// Die Auswahl bleibt nur in diesem Browser (dtd-cmp). Kennzahlen aus den gemeinsamen Daten, beste Werte je Zeile hervorgehoben,
// darunter je ein Kursdiagramm von TradingView (12 Monate).
(() => {
  const KEY = "dtd-cmp", MAX = 4;
  const SYM = /^[A-Z0-9][A-Z0-9.\-_:]{0,24}$/;
  const S = window.DTD.shared;
  const fin = v => Number.isFinite(v);
  const list = () => { const l = store.get(KEY, []); return Array.isArray(l) ? l.filter(s => typeof s === "string" && SYM.test(s)).slice(0, MAX) : []; };
  const has = sym => list().includes(sym);
  const button = (sym, small = false) => { const on = has(sym); return `<button type="button" class="btn ghost ${small ? "small-btn " : ""}cmp-btn" data-cmp="${esc(sym)}" aria-pressed="${on}" title="${on ? "Aus dem Vergleich nehmen" : "Zum Vergleich hinzufügen (bis zu 4 Aktien)"}">${on ? "✓ im Vergleich" : small ? "+ vergleichen" : "⇄ Vergleichen"}</button>`; };
  function setList(l) {
    store.set(KEY, l);
    document.querySelectorAll("[data-cmp]").forEach(b => { const on = l.includes(b.dataset.cmp), small = b.classList.contains("small-btn"); b.setAttribute("aria-pressed", String(on)); b.textContent = on ? "✓ im Vergleich" : small ? "+ vergleichen" : "⇄ Vergleichen"; });
    pill();
    window.dispatchEvent(new CustomEvent("dtd:compare"));
  }
  function toggle(sym) {
    const l = list();
    if (l.includes(sym)) return setList(l.filter(s => s !== sym));
    if (l.length >= MAX) { toast("Vergleich", `Höchstens ${MAX} Aktien – zuerst eine entfernen.`, 4000); return; }
    setList([...l, sym]);
    toast("Vergleich", l.length ? `${sym} hinzugefügt – ${l.length + 1} Aktien im Vergleich.` : `${sym} vorgemerkt – noch eine Aktie hinzufügen, dann vergleichen.`, 3500);
  }
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-cmp]");
    if (b) { e.preventDefault(); e.stopPropagation(); return toggle(b.dataset.cmp); }
    const r = e.target.closest("[data-cmp-clear]");
    if (r) { e.preventDefault(); setList([]); }
  });
  // Schwebender Hinweis „Vergleich (n) →“ auf allen Seiten, solange etwas ausgewählt ist
  const el = document.createElement("a");
  el.className = "cmp-pill";
  el.href = "#vergleich";
  document.body.append(el);
  function pill() {
    const n = list().length, onTools = !$("tools").hidden;
    el.hidden = !n || onTools;
    el.innerHTML = `⇄ Vergleich <b>${n}</b>${n < 2 ? " · noch eine Aktie wählen" : " →"}`;
  }
  window.addEventListener("dtd:view", pill);
  pill();

  // Zeilen der Vergleichstabelle: Wert, Darstellung und Richtung (1 = höher besser, -1 = niedriger besser, 0 = neutral)
  const total = r => (r ? r.sb + r.b + r.h + r.s + r.ss : 0);
  const buyPct = x => (x.rec && total(x.rec) >= 5 ? (x.rec.sb + x.rec.b) / total(x.rec) * 100 : null);
  const pc = (v, d = 1) => (fin(v) ? `<span class="${v < 0 ? "down" : "up"}">${v > 0 ? "+" : ""}${fmt(v, d)} %</span>` : `<span class="muted">–</span>`);
  const price = v => (!fin(v) ? "–" : v >= 1000 ? fmt(v, 0) : v >= 1 ? fmt(v, 2) : fmt(v, 4));
  const avgOf = (x, d) => (fin(x.last) && fin(d) ? x.last / (1 + d / 100) : null);
  const trendOf = x => { const s50 = avgOf(x, x.d50), s200 = avgOf(x, x.d200); if (s50 === null || s200 === null) return null; return x.d200 > 0 && s50 > s200 && x.mom > 0 ? 2 : x.d200 < 0 && (s50 < s200 || x.mom < 0) ? 0 : 1; };
  const PLAN = { buy: "Kaufzone", wait: "Order", alert: "Kursalarm", watch: "Beobachten", avoid: "Finger weg" };
  const ROWS = [
    ["Kurs", null, 0, c => c.x.last, c => price(c.x.last)],
    ["Heute", null, 1, c => c.x.chg1d, c => pc(c.x.chg1d)],
    ["Gesamtnote", "note", 1, c => (c.s ? c.s.note : null), c => (c.s && fin(c.s.note) ? `<b class="${window.DTD.scoreTone(c.s.note)}">${c.s.note}</b> <span class="muted small">${window.DTD.scoreLabel(c.s.note)}</span>` : "–")],
    ...(window.DTD.scoreParts || []).map(p => [`· ${p.label}`, p.term, 1, c => (c.s ? c.s.parts[p.k] : null), c => (c.s && fin(c.s.parts[p.k]) ? String(c.s.parts[p.k]) : `<span class="muted">–</span>`)]),
    ["1 Monat", "rendite", 1, c => c.x.ret1m, c => pc(c.x.ret1m), "bar"],
    ["3 Monate", "rendite", 1, c => c.x.ret3m, c => pc(c.x.ret3m), "bar"],
    ["12 Monate", "rendite", 1, c => c.x.ret12m, c => pc(c.x.ret12m, 0), "bar"],
    ["Trend", "ma", 1, c => trendOf(c.x), c => { const t = trendOf(c.x); return t === null ? "–" : `<span class="light ${["red", "yellow", "green"][t]}">${["Abwärts", "Offen", "Aufwärts"][t]}</span>`; }],
    ["Zum Jahreshoch", "hoch52", 1, c => c.x.dHi52, c => pc(c.x.dHi52)],
    ["Schwankung", "schwankung", -1, c => c.x.vol60, c => (fin(c.x.vol60) ? `${fmt(c.x.vol60, 0)} %` : "–")],
    ["Größter Rückgang", "rueckgang", -1, c => c.x.mdd, c => (fin(c.x.mdd) ? `−${fmt(c.x.mdd, 0)} %` : "–")],
    ["Beta", "beta", 0, c => c.x.beta, c => (fin(c.x.beta) ? fmt(c.x.beta, 2) : "–")],
    ["KGV", "kgv", -1, c => (fin(c.f.pe) && c.f.pe > 0 ? c.f.pe : null), c => (fin(c.f.pe) ? fmt(c.f.pe, 1) : "–")],
    ["KUV", "kuv", -1, c => (fin(c.f.ps) && c.f.ps > 0 ? c.f.ps : null), c => (fin(c.f.ps) ? fmt(c.f.ps, 1) : "–")],
    ["Umsatz +", "umsatz", 1, c => c.f.revG, c => pc(c.f.revG, 0)],
    ["Gewinn je Aktie +", "gewinn", 1, c => c.f.epsG, c => pc(c.f.epsG, 0)],
    ["Nettomarge", "marge", 1, c => c.f.netM, c => (fin(c.f.netM) ? `${fmt(c.f.netM, 1)} %` : "–")],
    ["Eigenkapitalrendite", "ekr", 1, c => c.f.roe, c => (fin(c.f.roe) ? `${fmt(c.f.roe, 0)} %` : "–")],
    ["Schulden/Eigenkapital", "schulden", -1, c => (fin(c.f.de) && c.f.de >= 0 ? c.f.de : null), c => (fin(c.f.de) ? fmt(c.f.de, 2) : "–")],
    ["Dividende", "dividende", 1, c => c.f.div, c => (fin(c.f.div) ? `${fmt(c.f.div, 2)} %` : "–")],
    ["Analysten Kauf", "analysten", 1, c => buyPct(c.x), c => (fin(buyPct(c.x)) ? `${fmt(buyPct(c.x), 0)} %` : "–")],
    ["Insider-Käufer (90 T.)", "insider", 1, c => (c.f.ins && !(c.f.cty && c.f.cty !== "US") ? c.f.ins.buyers : null), c => (c.f.ins ? String(c.f.ins.buyers) : "–")],
    ["Nächste Zahlen", "zahlen", 0, () => null, c => (c.x.earn && c.x.earn.date ? new Date(`${c.x.earn.date}T12:00:00Z`).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" }) : "–")],
    ["Swing-Planer", null, 0, () => null, c => { const p = S.setup(c.sym); return p && PLAN[p.state] ? PLAN[p.state] : "–"; }],
  ];
  function card() {
    const syms = list();
    if (!syms.length) return "";
    const cols = syms.map(sym => ({ sym, x: S.item(sym), f: S.fund(sym) || {}, s: window.DTD.score ? window.DTD.score(sym) : null }));
    const ok = cols.filter(c => c.x);
    const T = (k, l, sym) => (k && window.DTD.term ? window.DTD.term(k, l, sym) : l);
    const head = cols.map(c => `<th class="cmp-col"><button type="button" class="chip-btn" data-open="${esc(c.sym)}">${esc(c.sym)}</button><button type="button" class="icon-btn cmp-x" data-cmp="${esc(c.sym)}" aria-label="${esc(c.sym)} aus dem Vergleich nehmen" title="Entfernen">✕</button><div class="muted small cmp-name">${esc(c.x ? c.x.name : "ohne Kennzahlen")}</div></th>`).join("");
    const body = ROWS.map(([label, term, dir, get, cell, kind]) => {
      const vals = ok.map(get).filter(fin);
      const best = dir && vals.length >= 2 ? (dir > 0 ? Math.max(...vals) : Math.min(...vals)) : null;
      const maxAbs = kind === "bar" && vals.length ? Math.max(...vals.map(Math.abs)) || 1 : 1;
      return `<tr${label.startsWith("·") ? ` class="cmp-sub"` : ""}><th scope="row">${T(term, label, ok.length === 1 ? ok[0].sym : "")}</th>${cols.map(c => {
        if (!c.x) return `<td class="muted">–</td>`;
        const v = get(c), isBest = best !== null && v === best;
        const bar = kind === "bar" && fin(v) ? `<i class="cmp-bar ${v < 0 ? "neg" : "pos"}" style="width:${Math.max(3, Math.abs(v) / maxAbs * 100).toFixed(0)}%"></i>` : "";
        return `<td class="num${isBest ? " best" : ""}">${cell(c)}${bar}</td>`;
      }).join("")}</tr>`;
    }).join("");
    return `<article class="card" data-section="Vergleich" id="vergleich">
      <div class="card-head"><h2 class="card-title">Vergleich: ${syms.map(esc).join(" · ")}</h2><button type="button" class="btn ghost small-btn" data-cmp-clear>Alle entfernen</button></div>
      ${syms.length < 2 ? `<p class="small">Noch eine Aktie hinzufügen: im Aktien-Check oder bei den Konkurrenten auf „Vergleichen“ tippen.</p>` : ""}
      <div class="table-wrap cmp-wrap"><table class="cmp" style="min-width:${100 + cols.length * 105}px"><thead><tr><th></th>${head}</tr></thead><tbody>${body}</tbody></table></div>
      <p class="hint">Hervorgehoben: der beste Wert je Zeile. Teilnoten und Bilanz-Kennzahlen gibt es nur für US-Aktien. Unterstrichene Begriffe antippen für die Erklärung.</p>
      <div class="cmp-charts">${ok.map(c => `<div class="cmp-chart"><p class="small"><b>${esc(c.sym)}</b> · 12 Monate</p><div class="widget" id="cmpChart-${esc(c.sym.replace(/[^A-Za-z0-9]/g, "_"))}" data-tv="${esc(c.x.tv || c.sym)}" style="height:220px"></div></div>`).join("")}</div>
    </article>`;
  }
  // Nach dem Zeichnen: Kursdiagramme laden
  function charts() {
    document.querySelectorAll("#vergleich [data-tv]").forEach(el => {
      if (el.dataset.done) return;
      el.dataset.done = "1";
      if (typeof tvWidget === "function") tvWidget(el.id, "mini-symbol-overview", { ...COMMON, symbol: el.dataset.tv, width: "100%", height: "100%", dateRange: "12M", trendLineColor: "rgba(255,255,255,1)", underLineColor: "rgba(255,255,255,0.08)", underLineBottomColor: "rgba(255,255,255,0)" });
    });
  }
  window.DTD.compare = { list, has, toggle, button, card, charts };
})();

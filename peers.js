// ---------- Konkurrenz-Vergleich im Aktien-Check: die Aktie neben Firmen derselben Branche ----------
// Branche aus den nächtlichen Kennzahlen (Finnhub, nur US-Aktien); verglichen werden die 6 Firmen mit dem ähnlichsten
// Börsenwert. Daraus Sätze wie „günstiger bewertet als 4 von 6 Konkurrenten“.
(() => {
  const S = window.DTD.shared;
  const fin = v => Number.isFinite(v);
  const total = r => (r ? r.sb + r.b + r.h + r.s + r.ss : 0);
  const buyPct = x => (x && x.rec && total(x.rec) >= 5 ? (x.rec.sb + x.rec.b) / total(x.rec) * 100 : null);
  const pc = (v, d = 0) => (fin(v) ? `<span class="${v < 0 ? "down" : "up"}">${v > 0 ? "+" : ""}${fmt(v, d)} %</span>` : `<span class="muted">–</span>`);
  const num = (v, d = 1) => (fin(v) ? fmt(v, d) : `<span class="muted">–</span>`);
  // Kennzahlen des Vergleichs: Richtung (1 = höher besser, -1 = niedriger besser)
  const METRICS = [
    { k: "note", label: "Note", dir: 1, get: r => r.note, cell: r => (fin(r.note) ? `<b class="${window.DTD.scoreTone(r.note)}">${r.note}</b>` : `<span class="muted">–</span>`) },
    { k: "pe", label: "KGV", term: "kgv", dir: -1, get: r => (fin(r.f.pe) && r.f.pe > 0 ? r.f.pe : null), cell: r => num(r.f.pe > 0 ? r.f.pe : null), good: (w, n) => `ist günstiger bewertet (KGV) als ${w} von ${n} Konkurrenten`, bad: (l, n) => `ist teurer bewertet (KGV) als ${l} von ${n} Konkurrenten` },
    { k: "revG", label: "Umsatz +", term: "umsatz", dir: 1, get: r => r.f.revG, cell: r => pc(r.f.revG), good: (w, n) => `wächst beim Umsatz schneller als ${w} von ${n}`, bad: (l, n) => `wächst beim Umsatz langsamer als ${l} von ${n}` },
    { k: "netM", label: "Marge", term: "marge", dir: 1, get: r => r.f.netM, cell: r => (fin(r.f.netM) ? `${fmt(r.f.netM, 0)} %` : `<span class="muted">–</span>`), good: (w, n) => `hat eine höhere Gewinnmarge als ${w} von ${n}`, bad: (l, n) => `hat eine niedrigere Gewinnmarge als ${l} von ${n}` },
    { k: "ret12m", label: "12 Mon.", term: "rendite", dir: 1, get: r => r.x.ret12m, cell: r => pc(r.x.ret12m), good: (w, n) => `lief in 12 Monaten besser als ${w} von ${n}`, bad: (l, n) => `lief in 12 Monaten schlechter als ${l} von ${n}` },
    { k: "buy", label: "Analysten", term: "analysten", dir: 1, get: r => buyPct(r.x), cell: r => (fin(buyPct(r.x)) ? `${fmt(buyPct(r.x), 0)} %` : `<span class="muted">–</span>`), good: (w, n) => `wird von Analysten positiver gesehen als ${w} von ${n}`, bad: (l, n) => `wird von Analysten skeptischer gesehen als ${l} von ${n}` },
  ];
  function group(sym) {
    const f = S.fund(sym), x = S.item(sym);
    if (!x || !f || !f.ind) return null;
    const fund = S.get("fund"), stocks = S.get("stocks");
    const bySym = new Map(stocks.items.map(y => [y.sym, y]));
    const all = stocks.items.filter(y => y.type === "Aktie" && y.sym !== sym && fund.items[y.sym] && fund.items[y.sym].ind === f.ind);
    const cap = v => (fin(v) && v > 0 ? Math.log(v) : null), me = cap(f.mcap);
    // zuerst die Konkurrenten laut Finnhub, die es in den Daten gibt; aufgefüllt mit Firmen derselben Branche und ähnlichem Börsenwert
    const named = (Array.isArray(f.peers) ? f.peers : []).map(s => bySym.get(s)).filter(y => y && y.type === "Aktie" && y.sym !== sym).slice(0, 6);
    const near = all.filter(y => !named.includes(y)).map(y => ({ y, d: me !== null && cap(fund.items[y.sym].mcap) !== null ? Math.abs(cap(fund.items[y.sym].mcap) - me) : 99 })).sort((a, b) => a.d - b.d).map(o => o.y);
    const pick = [...named, ...near].slice(0, 6);
    const row = y => { const s = window.DTD.score ? window.DTD.score(y.sym) : null; return { sym: y.sym, x: y, f: fund.items[y.sym] || {}, note: s ? s.note : null }; };
    return { ind: f.ind, size: all.length + 1, named: named.length, rows: [row(x), ...pick.map(row)] };
  }
  function html(sym) {
    const g = group(sym);
    if (!g) return `<p class="muted small">Für diese Aktie gibt es keine Branchendaten – sie kommen von Finnhub nur für US-Aktien.</p>`;
    if (g.rows.length < 3) return `<p class="muted small">In der Branche ${esc(g.ind)} gibt es in den Daten dieser Seite zu wenige Vergleichsfirmen.</p>`;
    const me = g.rows[0], n = g.rows.length;
    const T = (k, l) => (k && window.DTD.term ? window.DTD.term(k, l, sym) : l);
    // Sätze: wie viele Konkurrenten die Aktie bei jeder Kennzahl schlägt
    const lines = [];
    for (const m of METRICS) {
      const v = m.get(me);
      if (!fin(v)) continue;
      const others = g.rows.slice(1).map(m.get).filter(fin);
      if (others.length < 2) continue;
      const wins = others.filter(o => (m.dir > 0 ? v > o : v < o)).length, losses = others.filter(o => (m.dir > 0 ? v < o : v > o)).length;
      lines.push({ k: m.k, m, wins, losses, of: others.length });
    }
    const good = lines.filter(l => l.m.good && l.wins / l.of >= 0.6), bad = lines.filter(l => l.m.bad && l.losses / l.of >= 0.6);
    const nl = lines.find(l => l.k === "note");
    const cmp = window.DTD.compare;
    return `<p class="small">${esc(sym)} gegen ${g.named ? `${g.named} direkte Konkurrenten laut Finnhub${n - 1 > g.named ? ` und ${n - 1 - g.named} weitere Firmen` : ""}` : `die ${n - 1} Firmen mit dem ähnlichsten Börsenwert`} aus der Branche <b>${esc(g.ind)}</b> (${g.size} Firmen in den Daten).${nl ? ` Gesamtnote: Platz ${nl.losses + 1} von ${nl.of + 1}.` : ""}</p>
      ${good.length || bad.length ? `<ul class="checklist peer-says">${good.map(l => `<li><span class="up">▲</span> ${esc(sym)} ${l.m.good(l.wins, l.of)}</li>`).join("")}${bad.map(l => `<li><span class="down">▼</span> ${esc(sym)} ${l.m.bad(l.losses, l.of)}</li>`).join("")}</ul>` : ""}
      <div class="table-wrap"><table class="scr peers"><thead><tr><th>Aktie</th>${METRICS.map(m => `<th class="num${["netM", "buy", "ret12m"].includes(m.k) ? " opt" : ""}">${T(m.term, m.label)}</th>`).join("")}${cmp ? `<th class="opt"></th>` : ""}</tr></thead>
        <tbody>${g.rows.map((r, i) => `<tr${i === 0 ? ` class="me"` : ""}><td><button type="button" class="chip-btn" data-open="${esc(r.sym)}">${esc(r.sym)}</button><button type="button" class="name-link muted small scr-name" data-open="${esc(r.sym)}">${esc(r.x.name || "")}</button></td>
          ${METRICS.map(m => `<td class="num${["netM", "buy", "ret12m"].includes(m.k) ? " opt" : ""}">${m.cell(r)}</td>`).join("")}${cmp ? `<td class="opt">${cmp.button(r.sym, true)}</td>` : ""}</tr>`).join("")}</tbody></table></div>
      <div class="btn-row" style="margin-top:10px"><button type="button" class="btn ghost" data-industry="${esc(g.ind)}">Alle ${g.size} der Branche im Screener →</button>${cmp ? cmp.button(sym) : ""}</div>`;
  }
  window.DTD.peersHtml = html;
  window.DTD.peerGroup = group;
  // Branche im Screener öffnen
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-industry]");
    if (!b) return;
    e.preventDefault();
    if (window.DTD.screenerIndustry) window.DTD.screenerIndustry(b.dataset.industry);
  });
})();

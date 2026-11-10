// ---------- Branchen-Rotation: welche Branchen und Theorie-Themen gerade am stärksten laufen ----------
// Je Gruppe der Median der Rendite über 1, 3 und 12 Monate, Anteil über dem 200-Tage-Schnitt und die besten Aktien nach
// Gesamtnote. „Kommt“: kurzfristig vorne, über 12 Monate noch hinten – dorthin fließt gerade Geld; „Geht“ umgekehrt.
(() => {
  const S = window.DTD.shared;
  const fin = v => Number.isFinite(v);
  const median = a => { const v = a.filter(fin).sort((x, y) => x - y), n = v.length; return n ? (n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2) : null; };
  const ui = Object.assign({ mode: "ind", sort: "r3" }, store.get("dtd-sectors", {}) || {});
  const save = () => store.set("dtd-sectors", { mode: ui.mode, sort: ui.sort });
  const pc = (v, d = 1) => (fin(v) ? `<span class="${v < 0 ? "down" : "up"}">${v > 0 ? "+" : ""}${fmt(v, d)} %</span>` : `<span class="muted">–</span>`);
  function groups() {
    const st = S.get("stocks"), fu = S.get("fund"), fi = S.get("firms");
    if (!st) return [];
    const bySym = new Map(st.items.map(x => [x.sym, x]));
    const out = [];
    if (ui.mode === "ind") {
      const m = new Map();
      for (const x of st.items) { const ind = fu && fu.items[x.sym] && fu.items[x.sym].ind; if (x.type === "Aktie" && ind) { if (!m.has(ind)) m.set(ind, []); m.get(ind).push(x); } }
      for (const [name, xs] of m) if (xs.length >= 4) out.push({ key: name, name, xs });
    } else if (fi) {
      const info = window.DTD.themeInfo ? window.DTD.themeInfo() : {};
      const add = (key, syms) => { const xs = [...new Set(syms)].map(s => bySym.get(s)).filter(Boolean); if (xs.length >= 3) out.push({ key, name: info[key] ? info[key].title : key.replace(/^\w+:/, ""), xs }); };
      for (const [id, l] of Object.entries(fi.sectors || {})) add(`sector:${id}`, l);
      for (const [id, mo] of Object.entries(fi.moon || {})) add(`moon:${id}`, mo.firms || []);
      for (const g of out) g.moon = g.key.startsWith("moon:");
    }
    for (const g of out) {
      g.n = g.xs.length;
      g.r1 = median(g.xs.map(x => x.ret1m)); g.r3 = median(g.xs.map(x => x.ret3m)); g.r12 = median(g.xs.map(x => x.ret12m));
      g.up = g.xs.filter(x => x.d200 > 0).length / g.n * 100;
      g.top = g.xs.map(x => ({ x, s: window.DTD.score ? window.DTD.score(x.sym) : null })).sort((a, b) => ((b.s && b.s.note) ?? -1) - ((a.s && a.s.note) ?? -1) || (b.x.ret3m || 0) - (a.x.ret3m || 0)).slice(0, 6);
    }
    // Rotation: Rang nach 1 Monat gegen Rang nach 12 Monaten
    const rank = k => { const l = out.filter(g => fin(g[k])).sort((a, b) => b[k] - a[k]); l.forEach((g, i) => { g[`rk_${k}`] = i; }); return l.length; };
    const n1 = rank("r1"), n12 = rank("r12");
    for (const g of out) {
      g.rot = fin(g.rk_r1) && fin(g.rk_r12) ? (g.rk_r1 < n1 / 3 && g.rk_r12 >= n12 / 2 ? "kommt" : g.rk_r1 >= (2 * n1) / 3 && g.rk_r12 < n12 / 2 ? "geht" : "") : "";
    }
    return out.sort((a, b) => (fin(b[ui.sort]) ? b[ui.sort] : -1e9) - (fin(a[ui.sort]) ? a[ui.sort] : -1e9));
  }
  function card() {
    const gs = groups();
    const max = Math.max(1, ...gs.map(g => Math.abs(g[ui.sort] || 0)));
    const sortBtn = (k, l) => `<button type="button" data-sec-sort="${k}" aria-pressed="${ui.sort === k}">${l}</button>`;
    const rows = gs.map(g => {
      const v = g[ui.sort] || 0, w = (Math.abs(v) / max * 50).toFixed(1);
      return `<details class="sec-row"><summary>
          <span class="sec-name">${esc(g.name)}${g.moon ? ` <span class="muted small">· 1000-%-Idee</span>` : ""} <span class="muted small">${g.n}</span>${g.rot === "kommt" ? ` <span class="light green" title="Kurzfristig vorne, über 12 Monate noch hinten">kommt</span>` : g.rot === "geht" ? ` <span class="light red" title="Kurzfristig hinten, über 12 Monate noch vorne">geht</span>` : ""}</span>
          <span class="sec-bar" aria-hidden="true"><i class="${v < 0 ? "neg" : "pos"}" style="${v < 0 ? `right:50%` : `left:50%`};width:${w}%"></i></span>
          <span class="sec-vals num">${[["r1", pc(g.r1)], ["r3", pc(g.r3)], ["r12", pc(g.r12, 0)]].map(([k, v]) => `<span class="${ui.sort === k ? "on" : ""}">${v}</span>`).join(" ")}</span>
          <span class="sec-up num${ui.sort === "up" ? " on" : ""}">${fmt(g.up, 0)} %</span></summary>
        <div class="sec-top">${g.top.map(t => `<button type="button" class="chip-btn" data-open="${esc(t.x.sym)}" title="${esc(t.x.name)}">${esc(t.x.sym)}${t.s && fin(t.s.note) ? ` <b class="${window.DTD.scoreTone(t.s.note)}">${t.s.note}</b>` : ""} ${pc(t.x.ret3m, 0)}</button>`).join("")}</div>
      </details>`;
    }).join("");
    return `<article class="card" data-section="Branchen" id="branchen">
      <div class="card-head"><h2 class="card-title">Branchen &amp; Themen: wer gerade führt</h2><span class="muted small">${gs.length} Gruppen</span></div>
      <div class="seg wrap-seg" role="group" aria-label="Gruppen"><button type="button" data-sec-mode="ind" aria-pressed="${ui.mode === "ind"}">Branchen (USA)</button><button type="button" data-sec-mode="theme" aria-pressed="${ui.mode === "theme"}">Theorie-Themen</button></div>
      <div class="seg wrap-seg" role="group" aria-label="Sortieren nach" style="margin-left:8px">${sortBtn("r1", "1 Monat")}${sortBtn("r3", "3 Monate")}${sortBtn("r12", "12 Monate")}${sortBtn("up", "über Ø 200")}</div>
      <div class="sec-head muted small"><span>Gruppe · Anzahl</span><span></span><span class="num sec-vals">${[["r1", "1 M"], ["r3", "3 M"], ["r12", "12 M"]].map(([k, l]) => `<span class="${ui.sort === k ? "on" : ""}">${l}</span>`).join(" · ")}</span><span class="num sec-up${ui.sort === "up" ? " on" : ""}">über Ø 200</span></div>
      <div class="sec-list">${rows || `<p class="muted">Noch keine Daten.</p>`}</div>
      <p class="hint">Median der Aktien je Gruppe. Antippen zeigt die besten Aktien der Gruppe (Gesamtnote, 3-Monats-Rendite). „kommt“: in einem Monat unter den besten, über 12 Monate noch hinten – dorthin fließt gerade Geld. Branchen nach Finnhub (nur US-Aktien), Themen von der Theorie-Seite.</p>
    </article>`;
  }
  document.addEventListener("click", e => {
    const m = e.target.closest("[data-sec-mode]"), s = e.target.closest("[data-sec-sort]");
    if (!m && !s) return;
    if (m) ui.mode = m.dataset.secMode;
    if (s) ui.sort = s.dataset.secSort;
    save();
    const el = $("branchen");
    if (el) el.outerHTML = card();
  });
  window.DTD.sectorsCard = card;
})();

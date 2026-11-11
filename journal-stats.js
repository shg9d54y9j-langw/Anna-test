// ---------- Journal-Auswertung: Was funktioniert bei Ihnen? ----------
// Aus den abgeschlossenen Trades im Journal (nur in diesem Browser): Erwartungswert je Trade, Verhältnis von Ø Gewinn zu
// Ø Verlust, Serien, bester und schlechtester Trade; aufgeteilt nach Wochentag, Tageszeit (Wiener Zeit), Long/Short, Aktie
// und Schlagwörtern aus den Notizen (#breakout, #fomo …). Dazu Einsichten in Worten – erst ab 5 Trades, einzelne Gruppen ab 3.
(() => {
  const KEY = "daytrade-journal-v1", MIN = 5, MIN_GROUP = 3;
  const fin = Number.isFinite;
  const pl = t => (t.out - t.in) * t.qty * (t.dir === "Short" ? -1 : 1);
  const cur = () => ($("cCur") && $("cCur").value) || "$";
  const money = (v, sign = true) => (fin(v) ? `${sign ? (v < 0 ? "−" : v > 0 ? "+" : "±") : ""}${fmt(Math.abs(v), 2)} ${cur()}` : "–");
  const DAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
  const vienna = iso => { const p = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Vienna", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso)); const g = k => (p.find(x => x.type === k) || {}).value; return { wd: g("weekday"), h: +g("hour") + +g("minute") / 60 }; };
  const trades = () => {
    const l = store.get(KEY, []);
    return (Array.isArray(l) ? l : []).filter(t => t && fin(t.in) && fin(t.out) && fin(t.qty) && t.qty > 0 && t.ts && fin(Date.parse(t.ts)))
      .map(t => ({ ...t, p: pl(t), at: Date.parse(t.ts) })).sort((a, b) => a.at - b.at);
  };
  // Kennzahlen einer Gruppe
  function stats(l) {
    const w = l.filter(t => t.p > 0), lo = l.filter(t => t.p < 0), sum = a => a.reduce((s, t) => s + t.p, 0);
    const avgW = w.length ? sum(w) / w.length : 0, avgL = lo.length ? sum(lo) / lo.length : 0;
    return { n: l.length, total: sum(l), win: l.length ? w.length / l.length : null, avgW, avgL, exp: l.length ? sum(l) / l.length : null,
      payoff: lo.length && w.length ? avgW / Math.abs(avgL) : null, pf: lo.length ? sum(w) / Math.abs(sum(lo)) : null };
  }
  function streaks(l) {
    let w = 0, lo = 0, bw = 0, bl = 0;
    for (const t of l) { if (t.p > 0) { w++; lo = 0; } else if (t.p < 0) { lo++; w = 0; } else { w = 0; lo = 0; } bw = Math.max(bw, w); bl = Math.max(bl, lo); }
    return { win: bw, loss: bl };
  }
  // Trefferquote direkt nach zwei Verlusten in Folge (Hinweis auf „Revenge Trading“)
  function afterTwoLosses(l) {
    const next = [];
    for (let i = 2; i < l.length; i++) if (l[i - 1].p < 0 && l[i - 2].p < 0) next.push(l[i]);
    return next.length >= MIN_GROUP ? stats(next) : null;
  }
  const group = (l, key) => { const m = new Map(); for (const t of l) { const k = key(t); if (k === null || k === undefined) continue; if (!m.has(k)) m.set(k, []); m.get(k).push(t); } return m; };
  const tagsOf = t => [...new Set((String(t.note || "").toLowerCase().match(/#[a-zäöüß0-9_-]{2,24}/g) || []))];
  const SLOTS = ["vor 12 Uhr", "12–15:30 Uhr", "ab 15:30 Uhr"], SLOT = h => SLOTS[h < 12 ? 0 : h < 15.5 ? 1 : 2];

  function analyse(l = trades()) {
    if (l.length < MIN) return { n: l.length };
    const all = stats(l), st = streaks(l);
    const best = l.reduce((a, t) => (t.p > a.p ? t : a)), worst = l.reduce((a, t) => (t.p < a.p ? t : a));
    const byDay = group(l, t => vienna(t.ts).wd.replace(".", ""));
    const bySlot = group(l, t => SLOT(vienna(t.ts).h));
    const byDir = group(l, t => (t.dir === "Short" ? "Short" : "Long"));
    const bySym = group(l, t => String(t.sym || "").toUpperCase() || null);
    const byTag = new Map();
    for (const t of l) for (const g of tagsOf(t)) { if (!byTag.has(g)) byTag.set(g, []); byTag.get(g).push(t); }
    const rows = m => [...m.entries()].map(([k, v]) => ({ k, ...stats(v) }));
    const tilt = afterTwoLosses(l);
    // Einsichten in Worten
    const ins = [];
    if (all.payoff !== null && all.payoff < 1) ins.push({ tone: "warn", text: `Ihre Verluste sind im Schnitt ${fmt(1 / all.payoff, 1)}-mal so groß wie Ihre Gewinne – mit dieser Trefferquote (${fmt(all.win * 100, 0)} %) ${all.exp < 0 ? "verlieren Sie unterm Strich" : "bleibt wenig übrig"}. Stops konsequenter setzen oder Gewinne länger laufen lassen.` });
    if (all.payoff !== null && all.payoff >= 1.5 && all.win >= 0.4) ins.push({ tone: "up", text: `Gutes Verhältnis: Gewinne im Schnitt ${fmt(all.payoff, 1)}-mal so groß wie Verluste – Ihre Stops wirken.` });
    const dayRows = rows(byDay).filter(r => r.n >= MIN_GROUP);
    if (dayRows.length >= 2) {
      const lo = dayRows.reduce((a, r) => (r.total < a.total ? r : a)), hi = dayRows.reduce((a, r) => (r.total > a.total ? r : a));
      if (lo.total < 0 && lo.k !== hi.k) ins.push({ tone: "warn", text: `${lo.k === "Mo" ? "Montags" : lo.k === "Di" ? "Dienstags" : lo.k === "Mi" ? "Mittwochs" : lo.k === "Do" ? "Donnerstags" : lo.k === "Fr" ? "Freitags" : `Am ${lo.k}`} läuft es am schlechtesten (${money(lo.total)} in ${lo.n} Trades, Trefferquote ${fmt(lo.win * 100, 0)} %).` });
    }
    const slotRows = rows(bySlot).filter(r => r.n >= MIN_GROUP);
    if (slotRows.length >= 2) {
      const lo = slotRows.reduce((a, r) => (r.exp < a.exp ? r : a));
      if (lo.exp < 0) ins.push({ tone: "warn", text: `Trades ${lo.k} bringen im Schnitt ${money(lo.exp)} – prüfen Sie, ob diese Zeit für Sie passt.` });
    }
    const dirRows = rows(byDir);
    const sh = dirRows.find(r => r.k === "Short"), lg = dirRows.find(r => r.k === "Long");
    if (sh && lg && sh.n >= MIN_GROUP && sh.total < 0 && lg.total > 0) ins.push({ tone: "warn", text: `Short-Trades kosten Sie Geld (${money(sh.total)}), Long-Trades bringen ${money(lg.total)} – weniger auf fallende Kurse setzen.` });
    if (tilt && all.win !== null && tilt.win < all.win - 0.15) ins.push({ tone: "warn", text: `Nach zwei Verlusten in Folge sinkt Ihre Trefferquote auf ${fmt(tilt.win * 100, 0)} % (sonst ${fmt(all.win * 100, 0)} %) – nach dem zweiten Verlust eine Pause einlegen.` });
    if (st.loss >= 4) ins.push({ tone: "warn", text: `Längste Verlustserie: ${st.loss} Trades hintereinander – das Tageslimit (3 Verlusttrades) schützt davor.` });
    const tagRows = rows(byTag).filter(r => r.n >= MIN_GROUP).sort((a, b) => a.exp - b.exp);
    if (tagRows.length && tagRows[0].exp < 0) ins.push({ tone: "warn", text: `Schlagwort ${tagRows[0].k}: im Schnitt ${money(tagRows[0].exp)} je Trade (${tagRows[0].n} Trades) – dieses Muster meiden.` });
    if (tagRows.length > 1 && tagRows[tagRows.length - 1].exp > 0) { const g = tagRows[tagRows.length - 1]; ins.push({ tone: "up", text: `Schlagwort ${g.k}: im Schnitt ${money(g.exp)} je Trade (${g.n} Trades) – Ihr bestes Muster.` }); }
    if (!ins.length) ins.push({ tone: "info", text: all.exp >= 0 ? "Kein auffälliges Muster – weiter so, und Trades mit Schlagwörtern in der Notiz markieren (#breakout, #fomo …), dann wird die Auswertung genauer." : "Unterm Strich ein Minus, aber kein einzelnes Muster sticht heraus – Schlagwörter in den Notizen (#breakout, #fomo …) helfen, die Ursache zu finden." });
    return { n: l.length, all, st, best, worst, day: rows(byDay), slot: rows(bySlot), dir: dirRows, sym: rows(bySym), tag: rows(byTag), tilt, ins: ins.slice(0, 5) };
  }

  const ICON = { warn: ["!", "warn-t"], up: ["▲", "up"], info: ["i", "muted"] };
  function table(title, list, order) {
    const l = order ? [...list].sort(order) : list;
    if (!l.length) return "";
    const max = Math.max(...l.map(r => Math.abs(r.total)), 1e-9);
    // am Handy: Anzahl und Trefferquote unter dem Namen statt in eigenen Spalten (passt ohne seitliches Scrollen)
    return `<div><h3 class="swing-h3">${title}</h3><div class="table-wrap"><table class="scr js-t"><thead><tr><th>${title === "Wochentag" ? "Tag" : "Gruppe"}</th><th class="num opt">Trades</th><th class="num opt">Treffer</th><th class="num">Ø je Trade</th><th class="num">Summe</th></tr></thead><tbody>
      ${l.map(r => `<tr${r.n < MIN_GROUP ? ' class="js-few"' : ""}><td>${esc(r.k)}<span class="mob js-meta">${r.n}&nbsp;${r.n === 1 ? "Trade" : "Trades"} · ${fmt(r.win * 100, 0)}&nbsp;%&nbsp;Treffer</span></td><td class="num opt">${r.n}</td><td class="num opt">${fmt(r.win * 100, 0)} %</td><td class="num ${r.exp < 0 ? "down" : "up"}">${money(r.exp)}</td>
        <td class="num"><span class="js-bar"><i class="${r.total < 0 ? "neg" : ""}" style="width:${Math.round(Math.abs(r.total) / max * 100)}%"></i></span><span class="${r.total < 0 ? "down" : "up"}">${money(r.total)}</span></td></tr>`).join("")}
    </tbody></table></div></div>`;
  }
  function card() {
    const a = analyse();
    if (a.n < MIN) return `<article class="card" id="jInsights" data-section="Auswertung"><h2 class="card-title">Auswertung: Was funktioniert bei Ihnen?</h2>
      <p class="muted small">Ab ${MIN} abgeschlossenen Trades zeigt die Auswertung Erwartungswert, Serien, die besten und schlechtesten Wochentage, Tageszeiten und Muster (bisher ${a.n}). Tipp: Schlagwörter in die Notiz schreiben, z. B. #breakout oder #fomo.</p></article>`;
    const A = a.all, DORDER = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
    return `<article class="card" id="jInsights" data-section="Auswertung">
      <div class="card-head"><h2 class="card-title">Auswertung: Was funktioniert bei Ihnen?</h2><span class="muted small">${a.n} Trades</span></div>
      <div class="stats">
        ${kpi("Erwartungswert je Trade", `<span class="${A.exp < 0 ? "down" : "up"}">${money(A.exp)}</span>`)}
        ${kpi("Ø Gewinn : Ø Verlust", A.payoff === null ? "–" : `1 : ${fmt(1 / A.payoff, 2)}`)}
        ${kpi("Längste Serie", `<span class="up">${a.st.win}</span> / <span class="down">${a.st.loss}</span>`)}
        ${kpi("Bester / schlechtester", `<span class="up">${money(a.best.p)}</span> <span class="muted">/</span> <span class="down">${money(a.worst.p)}</span>`)}
      </div>
      <ul class="js-ins">${a.ins.map(i => `<li><span class="sa-icon ${ICON[i.tone][1]}" aria-hidden="true">${ICON[i.tone][0]}</span><span>${i.text}</span></li>`).join("")}</ul>
      <div class="js-grid">
        ${table("Wochentag", a.day, (x, y) => DORDER.indexOf(x.k) - DORDER.indexOf(y.k))}
        ${table("Tageszeit", a.slot, (x, y) => SLOTS.indexOf(x.k) - SLOTS.indexOf(y.k))}
        ${table("Richtung", a.dir)}
        ${table("Aktien (beste und schlechteste)", [...a.sym].sort((x, y) => y.total - x.total).filter((r, i, l) => i < 3 || i >= l.length - 3))}
        ${a.tag.length ? table("Schlagwörter in der Notiz", a.tag, (x, y) => y.exp - x.exp) : ""}
      </div>
      <p class="hint">Erwartungswert = was ein Trade im Schnitt bringt (Trefferquote × Ø Gewinn + Verlustquote × Ø Verlust). Gruppen mit weniger als ${MIN_GROUP} Trades sind grau – zu wenige für eine Aussage. Beträge in der Währung der Trades (Kontowährung ${cur()}); Tageszeit nach Wiener Zeit – ab 15:30 Uhr handelt die US-Börse.</p>
    </article>`;
  }
  function render() {
    const el = $("jInsights");
    if (el) el.outerHTML = card();
  }
  window.addEventListener("dtd:journal", render);
  window.addEventListener("dtd:view", e => { if (e.detail === "portfolio") render(); });
  setTimeout(render, 0);
  window.DTD.journalAnalyse = analyse;
  window.DTD.journalInsightsCard = card;
})();

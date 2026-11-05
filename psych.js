// ---------- Psychologie-Check vor jedem Trade und Verhaltens-Auswertung des Journals ----------
// Jede Frage beruht auf einem in Studien belegten Anlegerfehler. Drei Punkte prüft die Seite selbst
// (Trades heute, Tageslimit, Marktschwankung).
(() => {
  const A = (url, text) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`;
  const DOI = (doi, text) => A(`https://doi.org/${doi}`, text);
  const QUESTIONS = [
    { id: "plan", good: "yes", q: "Stehen Einstieg, Stop-Loss und Ziel fest, bevor ich klicke?",
      why: `Ohne vorher festen Stop hält man Verlierer zu lange und verkauft Gewinner zu früh (Dispositionseffekt, ${DOI("10.1111/0022-1082.00072", "Odean 1998")}).` },
    { id: "risk", good: "yes", q: "Riskiere ich höchstens 1 % meines Kontos?",
      why: `Kleine, feste Einsätze überstehen Pechsträhnen; zu große Einsätze ruinieren auch gute Strategien (${DOI("10.1002/j.1538-7305.1956.tb03809.x", "Kelly 1956")}).` },
    { id: "signal", good: "yes", q: "Handle ich nach meinem Plan – nicht wegen einer Schlagzeile, Langeweile oder Angst, etwas zu verpassen?",
      why: `Privatanleger kaufen bevorzugt, was gerade Aufmerksamkeit bekommt, und schneiden damit schlechter ab (${DOI("10.1093/rfs/hhm079", "Barber &amp; Odean 2008")}, ${DOI("10.1111/jofi.13183", "Barber u. a. 2022")}).` },
    { id: "revenge", good: "no", q: "Will ich mit diesem Trade einen Verlust zurückholen?",
      why: `Nach Verlusten steigt die Risikobereitschaft, sobald sich eine Chance zum Ausgleich bietet (Break-even-Effekt, ${DOI("10.1287/mnsc.36.6.643", "Thaler &amp; Johnson 1990")}).` },
    { id: "sure", good: "no", q: "Bin ich mir ungewöhnlich sicher, dass es klappt?",
      why: `Übermut führt nachweislich zu mehr Trades und weniger Rendite (${DOI("10.1162/003355301556400", "Barber &amp; Odean 2001")}).` },
  ];
  const answers = {};

  function autoChecks() {
    const s = window.DTD.journalSummary ? window.DTD.journalSummary() : null;
    const m = window.DTD.market;
    const spx = m && (m.assets || []).find(a => a.key === "spx");
    const out = [];
    if (s) {
      out.push({ ok: s.trades < 4, text: `Trades heute: <b>${s.trades}</b>`, why: `Wer am meisten handelt, verdient am wenigsten: 11,4 % statt 17,9 % pro Jahr (${DOI("10.1111/0022-1082.00226", "Barber &amp; Odean 2000")}).`, fail: "Schon 4 oder mehr Trades heute – jeder weitere kostet Spread und Konzentration." });
      out.push({ ok: !s.stop, text: s.stop ? "<b>Tageslimit erreicht</b>" : `Tageslimit: noch ${Math.max(0, 3 - s.losses)} Verlusttrade(s)`, why: "Feste Tagesgrenze laut Ihren Tagesregeln (3 Verlusttrades oder −3 % des Kontos).", fail: "Heute nicht mehr handeln." });
    }
    if (spx && Number.isFinite(spx.vol20)) {
      const size = m.overall && Number.isFinite(m.overall.sizeFactor) ? Math.round(m.overall.sizeFactor * 100) : null;
      out.push({ ok: spx.vol20 <= m.rules.volHigh, warn: spx.vol20 > m.rules.volCalm, text: `Marktschwankung: <b>${fmt(spx.vol20, 1)} %</b> p. a.${size !== null ? ` → Positionsgröße ${size} %` : ""}`, why: `Bei hoher Schwankung kleinere Positionen (${DOI("10.1111/jofi.12513", "Moreira &amp; Muir 2017")}).`, fail: "Markt sehr unruhig – Position deutlich verkleinern." });
    }
    return out;
  }

  function renderCheck() {
    const host = $("psychCheck");
    if (!host) return;
    const autos = autoChecks();
    const bad = QUESTIONS.filter(q => answers[q.id] && answers[q.id] !== q.good).length + autos.filter(a => !a.ok).length;
    const open = QUESTIONS.filter(q => !answers[q.id]).length;
    const limit = autos.some(a => !a.ok && /Tageslimit/.test(a.text));
    const verdict = limit || bad >= 2 ? `<span class="light big red">Heute lieber nicht</span><span class="muted">${limit ? "Das Tageslimit ist erreicht." : `${bad} Warnzeichen – den Trade auslassen oder im Demokonto üben.`}</span>`
      : bad === 1 ? `<span class="light big yellow">Vorsicht</span><span class="muted">Ein Warnzeichen – erst klären, dann handeln.</span>`
      : open ? `<span class="light big">Noch ${open} Frage${open > 1 ? "n" : ""} offen</span>`
      : `<span class="light big green">Bereit</span><span class="muted">Plan steht, Kopf ist klar – jetzt genau nach Plan eintragen.</span>`;
    host.innerHTML = `
      <div class="card-head"><h2 class="card-title">Psychologie-Check vor dem Trade</h2><button type="button" class="btn ghost" id="psReset">Zurücksetzen</button></div>
      <p class="muted small">Ehrlich beantworten – jede Frage beruht auf einem in Studien belegten Anlegerfehler.</p>
      <div class="q-list">
        ${QUESTIONS.map(q => {
          const a = answers[q.id], cls = !a ? "" : a === q.good ? "ok" : "bad";
          return `<div class="q ${cls}">
            <div class="q-text"><b>${q.q}</b><span>${q.why}</span></div>
            <div class="yn" role="group" aria-label="${q.q}">
              <button type="button" class="${q.good === "yes" ? "good" : "bad"}" data-q="${q.id}" data-a="yes" aria-pressed="${a === "yes"}">Ja</button>
              <button type="button" class="${q.good === "no" ? "good" : "bad"}" data-q="${q.id}" data-a="no" aria-pressed="${a === "no"}">Nein</button>
            </div>
          </div>`;
        }).join("")}
        ${autos.map(a => `<div class="q ${a.ok ? "ok" : "bad"}">
            <div class="q-text"><b>${a.text}</b><span>${a.ok ? a.why : `${a.fail} ${a.why}`}</span></div>
            <span class="light ${a.ok ? (a.warn ? "yellow" : "green") : "red"}">automatisch</span>
          </div>`).join("")}
      </div>
      <div class="verdict">${verdict}</div>`;
    host.querySelectorAll("[data-q]").forEach(b => b.addEventListener("click", () => { answers[b.dataset.q] = b.dataset.a; renderCheck(); }));
    $("psReset").addEventListener("click", () => { for (const k of Object.keys(answers)) delete answers[k]; renderCheck(); });
  }

  // ---------- Verhaltens-Auswertung des Journals ----------
  function analyze() {
    const list = (typeof journal !== "undefined" ? journal : []).map(t => ({ p: pl(t), d: new Date(t.ts) })).filter(t => Number.isFinite(t.p) && !isNaN(t.d)).sort((a, b) => a.d - b.d);
    if (list.length < 10) return { n: list.length };
    const avg = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
    const wins = list.filter(t => t.p > 0).map(t => t.p), losses = list.filter(t => t.p < 0).map(t => -t.p);
    const dayKey = d => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const byDay = new Map();
    for (const t of list) { const k = dayKey(t.d); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(t); }
    const afterLoss = [], others = [], busy = [], calm = [];
    for (const day of byDay.values()) {
      day.forEach((t, i) => ((i > 0 && day[i - 1].p < 0) ? afterLoss : others).push(t.p));
      (day.length >= 4 ? busy : calm).push(...day.map(t => t.p));
    }
    const hm = d => { const p = Object.fromEntries(new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d).map(x => [x.type, x.value])); return +p.hour * 60 + +p.minute; };
    const opening = [], rest = [];
    for (const t of list) { const x = hm(t.d); ((x >= 540 && x < 570) || (x >= 930 && x < 960) ? opening : rest).push(t.p); }
    return { n: list.length, winRate: wins.length / list.length, avgWin: avg(wins), avgLoss: avg(losses), afterLoss, others, busy, calm, opening, rest, avg };
  }

  function renderJournal() {
    const host = $("psychJournal");
    if (!host) return;
    const r = analyze(), cur = $("cCur").value || "$";
    if (r.n < 10) {
      host.innerHTML = `<h2 class="card-title">Verhaltens-Check Ihres Journals</h2>
        <p class="muted">Ab 10 eingetragenen Trades prüft die Seite hier, ob typische Anlegerfehler in Ihren Zahlen auftauchen (bisher ${r.n}).</p>`;
      return;
    }
    const money = x => `${x > 0 ? "+" : ""}${fmt(x)} ${cur}`;
    const rows = [];
    if (Number.isFinite(r.avgLoss) && Number.isFinite(r.avgWin)) {
      const bad = r.avgLoss > r.avgWin * 1.2;
      rows.push({ bad, title: "Gewinne im Verhältnis zu Verlusten", text: `Trefferquote ${fmt(r.winRate * 100, 0)} %, Ø Gewinn ${money(r.avgWin)}, Ø Verlust ${money(-r.avgLoss)}.`,
        tip: bad ? `Verluste sind deutlich größer als Gewinne – typisch, wenn man Verlierer laufen lässt und Gewinner früh mitnimmt (${DOI("10.1111/0022-1082.00072", "Odean 1998")}). Stop vorher setzen und nicht verschieben.` : "Ausgewogen – Verluste werden nicht größer als Gewinne." });
    }
    if (r.afterLoss.length >= 3 && r.others.length >= 3) {
      const a = r.avg(r.afterLoss), o = r.avg(r.others), bad = a < o && a < 0;
      rows.push({ bad, title: "Trades direkt nach einem Verlust", text: `Ø ${money(a)} je Trade nach einem Verlust am selben Tag, sonst Ø ${money(o)} (${r.afterLoss.length} bzw. ${r.others.length} Trades).`,
        tip: bad ? `Nach Verlusten schlechter – Hinweis auf „Zurückholen-Wollen“ (${DOI("10.1287/mnsc.36.6.643", "Thaler &amp; Johnson 1990")}). Nach einem Verlust 30 Minuten Pause.` : "Kein Hinweis auf Revenge-Trading." });
    }
    if (r.busy.length >= 4 && r.calm.length >= 4) {
      const b = r.avg(r.busy), c = r.avg(r.calm), bad = b < c;
      rows.push({ bad, title: "Viel gehandelte Tage", text: `An Tagen mit 4+ Trades Ø ${money(b)} je Trade, an ruhigeren Tagen Ø ${money(c)}.`,
        tip: bad ? `Mehr Trades, schlechtere Trades – wie in der Forschung (${DOI("10.1111/0022-1082.00226", "Barber &amp; Odean 2000")}). Tageshöchstzahl festlegen.` : "Viele Trades schaden Ihnen bisher nicht." });
    }
    if (r.opening.length >= 3 && r.rest.length >= 3) {
      const op = r.avg(r.opening), rs = r.avg(r.rest), bad = op < rs;
      rows.push({ bad, title: "Erste halbe Stunde nach Börsenstart", text: `Trades 9:00–9:30 bzw. 15:30–16:00 Uhr: Ø ${money(op)}, sonst Ø ${money(rs)} (Zeitpunkt des Eintrags).`,
        tip: bad ? "Zum Börsenstart schlechter – dort sind Spreads und Sprünge am größten. Die Tagesregel „erste 15 Minuten nur beobachten“ hilft." : "Kein Nachteil zum Börsenstart erkennbar." });
    }
    host.innerHTML = `<h2 class="card-title">Verhaltens-Check Ihres Journals</h2>
      <p class="muted small">${r.n} Trades ausgewertet. Mit wenigen Trades ist jedes Ergebnis unsicher – erst ab etwa 50 Trades werden die Muster belastbar.</p>
      <div class="q-list">${rows.map(x => `<div class="q ${x.bad ? "bad" : "ok"}"><div class="q-text"><b>${x.title}</b><span>${x.text} ${x.tip}</span></div><span class="light ${x.bad ? "red" : "green"}">${x.bad ? "Muster" : "unauffällig"}</span></div>`).join("")}</div>`;
  }

  function renderAll() { renderCheck(); renderJournal(); }
  window.DTD.renderPsych = renderAll;
  window.addEventListener("dtd:journal", renderAll);
  window.addEventListener("dtd:market", renderCheck);
  renderAll();
})();

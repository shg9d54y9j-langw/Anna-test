// ---------- Swing-Planer: Aktien mit ihrer Theorie für Swing-Trades über Monate – mit den Einstellungen für eToro ----------
// Daten: swing.json (Zweig stock-data; nach jedem Aktien-Datenlauf neu gerechnet von scripts/swing-planner.mjs) und
// data/firms.json (Firmen-Steckbriefe). Budget und Risiko je Trade stellt der Besitzer ein; das bleibt nur in diesem Browser.
(() => {
  const RAW = "https://raw.githubusercontent.com/shg9d54y9j-langw/Anna-test/stock-data/swing.json";
  const get = url => fetch(url, { cache: "no-store" }).then(r => (r.ok ? r.json() : null)).catch(() => null);
  const A = (url, text) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`;
  const DOI = (doi, text) => A(`https://doi.org/${doi}`, text);
  const sign = (x, d = 1) => (Number.isFinite(x) ? (x > 0 ? "+" : "") + fmt(x, d) : "–");
  const pc = (x, d = 1) => (Number.isFinite(x) ? `<span class="${x < 0 ? "down" : "up"}">${sign(x, d)} %</span>` : "–");
  const price = x => (!Number.isFinite(x) ? "–" : x >= 1000 ? fmt(x, 0) : x >= 1 ? fmt(x, 2) : fmt(x, 4));
  const eur = x => (Number.isFinite(x) ? `${fmt(x, 0)} €` : "–");
  const dDate = iso => (iso ? new Date(`${String(iso).slice(0, 10)}T12:00:00Z`).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }) : "–");
  const link = (u, t) => (/^https:\/\//.test(u) ? A(esc(u), esc(t)) : esc(t));
  const firstSentence = s => { const m = /^(.+?[.!?])(?:\s|$)/.exec(s || ""); return m ? m[1] : s || ""; };
  const ACTIVE = ["buy", "wait", "alert"];
  const STATE = {
    buy: ["Kaufzone", "green"], wait: ["Order setzen", "yellow"], alert: ["Kursalarm", "yellow"],
    watch: ["Beobachten", ""], avoid: ["Finger weg", "red"], nodata: ["Keine Daten", ""],
  };
  const ROLE = { leader: "Marktführer", supplier: "Zulieferer", challenger: "Herausforderer", spec: "Spekulativ" };
  let data = null, firms = null, loading = false;

  // Budget und Risiko je Trade (nur im eigenen Browser gespeichert)
  const pref = { budget: 2000, risk: 1 };
  const saved = store.get("dtd-swing", {}) || {};
  if (Number.isFinite(saved.budget) && saved.budget >= 100 && saved.budget <= 1e7) pref.budget = saved.budget;
  if ([0.5, 1, 2].includes(saved.risk)) pref.risk = saved.risk;
  const savePref = () => store.set("dtd-swing", pref);

  // Betrag je Idee: höchstens pref.risk % des Budgets verlieren, wenn der Stop greift; spekulative Firmen mit halbem Risiko.
  // Höchstens 20 % des Budgets in einer Aktie (spekulativ 10 %), damit mehrere Ideen Platz haben.
  function size(s) {
    if (!(s.stopPct < 0)) return null;
    const spec = s.role === "spec", want = pref.budget * pref.risk / 100 * (spec ? 0.5 : 1), cap = pref.budget * (spec ? 0.1 : 0.2);
    const amount = Math.min(want / (-s.stopPct / 100), cap);
    return { amount, loss: amount * -s.stopPct / 100, capped: amount >= cap - 0.5, spec };
  }
  const themeInfo = () => (window.DTD.themeInfo ? window.DTD.themeInfo() : {});
  const themeName = (key, info) => (info[key] ? info[key].title : key.replace(/^\w+:/, ""));
  const themeChips = (s, info) => {
    const f = firms && firms.firms[s.sym];
    const keys = s.themes || [];
    const chips = keys.map(k => `<span class="chip-tag">${esc(themeName(k, info))}${k.startsWith("moon:") ? " · 1000 %-Idee" : ""}</span>`);
    if (!keys.length && f && f.theme) chips.push(`<span class="chip-tag">${esc(f.theme)}</span>`);
    if (s.src === "scan") chips.push(`<span class="chip-tag">Neu entdeckt${s.found ? ` seit ${dDate(s.found)}` : ""}</span>`);
    return chips.length ? `<div class="chip-tags">${chips.join("")}</div>` : "";
  };
  const label = s => (s.state === "buy" && s.earnSoon ? ["Zahlen abwarten", "yellow"] : STATE[s.state] || STATE.nodata);
  const entryText = s => ({
    market: `zum Marktpreis (jetzt ${price(s.entry)})`,
    limit: `per Order bei ${price(s.entry)}`,
    alert: `erst über ${price(s.entry)} (Kursalarm)`,
  })[s.entryType] || "–";
  function reason(s) {
    if (s.state === "avoid") return "Kurs unter dem 200-Tage-Schnitt, Trend fällt";
    if (s.why === "volatile") return `zu schwankungsreich – der Stop läge über ${data.rules.maxStopPct} % entfernt`;
    if (s.why === "correction") return "starker Rücksetzer weit unter den 50-Tage-Schnitt – Trend beschädigt";
    if (s.state === "nodata") return "zu wenige Kursdaten";
    return s.d200 > 0 ? "über dem 200er, aber 50er darunter oder Momentum schwach – Bestätigung abwarten" : "knapp unter dem 200er – Trend unklar";
  }
  // Theorie: Steckbrief der Firma oder – bei neu entdeckten – was die Daten sagen
  function thesis(s, full) {
    const f = firms && firms.firms[s.sym];
    if (f) {
      if (!full) return `<p class="small idea-why"><b>Theorie:</b> ${esc(firstSentence(f.why))}</p>`;
      return `<p class="small"><b>Was die Firma macht:</b> ${esc(f.what)}</p>
        <p class="small"><b>Warum diese Firma:</b> ${esc(f.why)}</p>
        <p class="small"><b>Worauf achten:</b> ${esc(f.watch)}</p>
        <p class="muted small">${ROLE[f.role] ? `${ROLE[f.role]} · ` : ""}Quelle: ${(f.src || []).map(([u, t]) => link(u, t)).join(" · ")}</p>`;
    }
    const parts = [`Momentum-Rang ${s.momRank ?? "–"} von 100`, `12 Monate ${sign(s.ret12m, 0)} %`];
    if (Number.isFinite(s.buy)) parts.push(`${fmt(s.buy, 0)} % der Analysten sagen Kauf`);
    if (Number.isFinite(s.surprise) && s.surprise > 0) parts.push(`Quartalszahlen ${sign(s.surprise, 0)} % über der Erwartung`);
    const txt = `Die Daten sprechen dafür: ${parts.join(", ")}. Welche Geschichte dahintersteckt, prüft die wöchentliche Recherche – danach steht hier ein Steckbrief mit Quellen.`;
    return `<p class="small idea-why"><b>Theorie:</b> ${full ? txt : `${parts.slice(0, 3).join(", ")}.`}</p>`;
  }
  function howTo(s, z) {
    const half = z ? z.amount / 2 : null;
    const buy = s.state === "buy" && s.earnSoon
      ? `Erst nach den Quartalszahlen am ${dDate(s.earnSoon)} kaufen – an Zahlentagen springt der Kurs oft über den Stop hinweg. Danach gilt der Plan, wenn der Kurs noch in der Kaufzone liegt.`
      : s.entryType === "market" ? `„Kaufen“, Marktpreis – jetzt etwa <b class="num">${price(s.entry)}</b>.`
      : s.entryType === "limit" ? `„Order“ statt sofort kaufen, Kurs <b class="num">${price(s.entry)}</b>: eToro kauft, sobald der Kurs dorthin zurückfällt. Fällt er nicht, entgeht Ihnen nur ein überhitzter Kauf.`
      : `Kursalarm bei <b class="num">${price(s.entry)}</b> setzen – <button type="button" class="btn ghost small-btn" data-alarm="${esc(s.sym)}" data-price="${s.entry}" data-why="${s.why === "high" ? "Ausbruch über das Jahreshoch" : "zurück über den 50-Tage-Schnitt"}">hier in RojkoMoney</button> oder in der eToro-App bzw. bei TradingView. eToro-Orders kaufen nur unter dem aktuellen Kurs – kaufen Sie erst, wenn der Kurs ${s.why === "high" ? "über das Jahreshoch steigt" : "wieder über den 50-Tage-Schnitt steigt"}.`;
    return `<div class="howto">
        <p class="howto-title">So stellen Sie es bei eToro ein</p>
        <ol class="steps">
          <li><b>Kauf:</b> ${buy}</li>
          <li><b>Betrag:</b> ${z ? `<b class="num">${eur(z.amount)}</b>, aufgeteilt in zwei Käufe zu je ${eur(half)}` : "–"} – Hebel x1, also echte Aktien.${z && z.spec ? " Spekulative Firma: halbes Risiko." : ""}${z && z.capped ? " Auf den Höchstanteil je Aktie begrenzt." : ""}</li>
          <li><b>Stop Loss:</b> <b class="num">${price(s.stop)}</b> (${pc(s.stopPct)}) bei beiden Käufen, mit Häkchen bei „Trailing Stop Loss“: Der Stop wandert mit, wenn der Kurs steigt.${z ? ` Greift er, verlieren Sie etwa ${eur(z.loss)}.` : ""}</li>
          <li><b>Take Profit:</b> erster Kauf bei <b class="num">${price(s.target)}</b> (${pc(s.targetPct)}), zweiter Kauf ohne Take Profit – er läuft, solange der Trend hält.</li>
          <li><b>Verkaufen</b> auch ohne Stop, wenn der Kurs unter den 200-Tage-Schnitt fällt (jetzt ${price(s.s200)}); nach 3 Monaten ohne Fortschritt prüfen, ob die Theorie noch stimmt; spätestens nach 12 Monaten neu bewerten.</li>
        </ol>
      </div>`;
  }
  function dataLine(s) {
    const parts = [`Kurs ${price(s.last)}`, `12 Monate ${pc(s.ret12m, 0)}`, `3 Monate ${pc(s.ret3m, 0)}`, `Momentum-Rang ${s.momRank ?? "–"}`, `zum Jahreshoch ${pc(s.dHi52)}`];
    if (Number.isFinite(s.buy)) parts.push(`Analysten ${fmt(s.buy, 0)} % Kauf (${s.nRec})${Number.isFinite(s.recDelta) && Math.abs(s.recDelta) >= 5 ? `, ${sign(s.recDelta, 0)} Punkte zum Vormonat` : ""}`);
    if (s.earn) parts.push(`nächste Zahlen ${dDate(s.earn)}`);
    return `<p class="muted small">${parts.join(" · ")}</p>`;
  }
  function card(s, info) {
    const [lab, cls] = label(s), z = size(s);
    const isNew = s.since && data && s.since === data.updated.slice(0, 10) && s.state === "buy";
    return `<article class="idea swing-card">
      <div class="idea-head"><button type="button" class="idea-sym" data-open="${esc(s.sym)}">${esc(s.sym)}</button><button type="button" class="name-link muted small idea-name" data-open="${esc(s.sym)}">${esc(s.name || "")}</button>${window.DTD.watch ? window.DTD.watch.star(s.sym, "sm") : ""}<span class="light ${cls}">${lab}${isNew ? " · neu" : ""}</span></div>
      ${themeChips(s, info)}
      ${thesis(s, false)}
      <div class="idea-levels"><span>Kauf <b class="num">${price(s.entry)}</b> <span class="muted">${s.entryType === "market" ? "Markt" : s.entryType === "limit" ? "Order" : "Alarm"}</span></span><span>Stop <b class="num">${price(s.stop)}</b> ${pc(s.stopPct)}</span><span>Ziel für die Hälfte <b class="num">${price(s.target)}</b> ${pc(s.targetPct)}</span><span>Betrag <b class="num">${z ? eur(z.amount) : "–"}</b></span></div>
      <details class="swing-more"><summary>Theorie, Daten und eToro-Einstellungen</summary>
        ${thesis(s, true)}
        ${dataLine(s)}
        ${howTo(s, z)}
      </details>
      <details class="swing-more swing-chart" data-tv="${esc(s.tv || s.sym)}"><summary>Diagramm</summary>
        ${window.DTD.levelLadder ? window.DTD.levelLadder([
          { label: "Kurs jetzt", v: s.last, kind: "now" },
          s.entryType !== "market" ? { label: s.entryType === "limit" ? "Kauf-Order" : "Kursalarm", v: s.entry, kind: "buy" } : null,
          { label: "Stop Loss", v: s.stop, kind: "stop" },
          { label: "Ziel für die Hälfte", v: s.target, kind: "target" },
          { label: "50-Tage-Schnitt", v: s.s50, kind: "avg" },
          { label: "200-Tage-Schnitt", v: s.s200, kind: "avg" },
          { label: "52-Wochen-Hoch", v: s.hi52, kind: "range" },
          { label: "52-Wochen-Tief", v: s.lo52, kind: "range" },
        ], `Kauf, Stop und Ziel neben den Trendlinien · Kurs vom ${dDate(s.asOf)}`) : ""}
        <div class="big-chart" id="swChart-${esc(s.sym.replace(/[^A-Za-z0-9_-]/g, "_"))}"></div>
        <p class="small muted">Tageskerzen der letzten 12 Monate, live von TradingView.</p>
      </details>
    </article>`;
  }
  const section = (name, title, sub, body, count) => `<article class="card" data-section="${name}">
      <div class="card-head"><h2 class="card-title">${title}</h2>${count === undefined ? "" : `<span class="muted small">${count} Werte</span>`}</div>
      ${sub ? `<p class="muted small" style="margin:-6px 0 12px">${sub}</p>` : ""}${body}
    </article>`;
  const cards = (list, info, empty) => (list.length ? `<div class="ideas">${list.map(s => card(s, info)).join("")}</div>` : `<p class="muted">${empty}</p>`);

  function headCard() {
    const t = new Date(data.dataUpdated || data.updated).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });
    const theory = data.setups.filter(s => s.src === "theory"), n = st => theory.filter(s => s.state === st).length;
    return `<article class="card" data-section="Einstellungen">
      <div class="card-head"><h2 class="card-title">Kurse vom ${t} Uhr</h2><span class="muted small">${theory.length} Firmen der Theorie-Seite · ${data.setups.length - theory.length} neu entdeckt</span></div>
      <p class="small">Jede Firma hat eine Theorie (warum sie profitieren sollte) – gekauft wird aber nur, wenn der Kurstrend sie bestätigt. Heute: <b>${n("buy")}</b> in der Kaufzone, <b>${n("wait") + n("alert")}</b> bald kaufbar, <b>${n("watch")}</b> zum Beobachten, <b>${n("avoid")}</b> Finger weg.${n("buy") < 3 ? " Wenige Käufe sind Absicht: Die Regeln kaufen nur im Aufwärtstrend und warten in Korrekturen ab." : ""}</p>
      ${data.preview ? `<p class="hint">Vorschau aus den Kursen vom ${dDate(data.dataUpdated)}. Ab dem nächsten Aktien-Datenlauf rechnet der Planer zweimal pro Börsentag selbst neu, und die Bilanz der Signale beginnt.</p>` : ""}
      <div class="calc" style="margin-top:12px">
        <label>Ihr Budget für Swing-Trades (€)<input id="swingBudget" type="number" inputmode="numeric" min="100" step="100" value="${pref.budget}"></label>
        <label>Risiko je Idee, wenn der Stop greift<select id="swingRisk">${[0.5, 1, 2].map(r => `<option value="${r}"${r === pref.risk ? " selected" : ""}>${fmt(r, r % 1 ? 1 : 0)} % des Budgets (${eur(pref.budget * r / 100)})</option>`).join("")}</select></label>
      </div>
      <p class="hint">Daraus rechnet der Planer den Betrag je Idee: Greift der Stop, verlieren Sie höchstens das gewählte Risiko. Höchstens 20 % des Budgets in einer Aktie, spekulative Firmen mit halbem Risiko. Profis riskieren selten mehr als 1–2 % je Trade.</p>
    </article>`;
  }
  function themeCard(info) {
    const LAB = { tail: ["Rückenwind", "green"], mixed: ["Gemischt", "yellow"], head: ["Gegenwind", "red"], nodata: ["Keine Daten", ""] };
    const rows = data.themes.map(t => {
      const [lab, cls] = LAB[t.status] || LAB.nodata;
      const share = t.n ? t.up / t.n : 0;
      return `<div class="trow">
        <div class="trow-name"><b>${esc(themeName(t.key, info))}</b> <span class="muted small">${t.kind === "moon" ? "1000 %-Idee" : "Sparte"}</span></div>
        <div class="trow-state"><span class="light ${cls}">${lab}</span></div>
        <div class="trow-num small"><span class="meter" role="img" aria-label="${t.up} von ${t.n} im Aufwärtstrend"><b style="width:${Math.round(share * 100)}%"></b></span>${t.up} von ${t.n} im Aufwärtstrend</div>
        <div class="trow-num small">3 Monate ${pc(t.med3m, 0)}</div>
        <div class="trow-top">${t.top.length ? t.top.map(s => `<button type="button" class="chip-btn" data-open="${esc(s)}">${esc(s)}</button>`).join(" ") : `<span class="muted small">nichts kaufbar</span>`}</div>
      </div>`;
    }).join("");
    return section("Theorien", "Welche Theorien der Markt gerade bestätigt", "Rückenwind heißt: Mindestens 60 % der Firmen einer Theorie sind im Aufwärtstrend und der Median der letzten 3 Monate ist im Plus. Die Einschätzung der Theorie selbst steht auf der Theorie-Seite – hier zählt, ob der Markt ihr gerade folgt. Rechts die kaufbaren Firmen.",
      `<div class="trows">${rows}</div>`);
  }
  function restCard(list, info) {
    const missing = (data.missing || []).map(sym => {
      const f = firms && firms.firms[sym];
      return f && f.tv ? `<a class="chip-btn ext" href="https://www.tradingview.com/symbols/${encodeURIComponent(f.tv.replace(":", "-"))}/" target="_blank" rel="noopener noreferrer" title="${esc(f.listing || "")}">${esc(sym)} ↗</a>` : `<span class="chip-btn off" title="noch nicht in den Aktien-Daten">${esc(sym)}</span>`;
    }).join(" ");
    const groups = new Map();
    for (const s of list) { const r = reason(s); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(s); }
    const order = s => (s.state === "avoid" ? 2 : s.why ? 0 : 1);
    const blocks = [...groups.entries()].sort((a, b) => order(a[1][0]) - order(b[1][0])).map(([r, xs]) => {
      const [lab, cls] = label(xs[0]);
      const chips = xs.map(s => `<button type="button" class="chip-btn" data-open="${esc(s.sym)}" title="${esc(s.name || "")} – ${esc((s.themes || []).map(k => themeName(k, info)).join(", "))}">${esc(s.sym)} ${pc(s.ret3m, 0)}</button>`).join(" ");
      return `<div class="rest-group"><p class="small"><span class="light ${cls}">${lab}</span> ${r} <span class="muted">(${xs.length})</span></p><div class="chips">${chips}</div></div>`;
    }).join("");
    return section("Abwarten", "Beobachten und Finger weg", "Die Theorie mag stimmen, der Kurs bestätigt sie gerade nicht. Am Kürzel die Rendite der letzten 3 Monate. <b>Halten Sie eine davon?</b> Bei „Finger weg“ den Verkauf prüfen – unter dem 200-Tage-Schnitt verkauft auch der Planer.",
      (blocks || `<p class="muted">Keine.</p>`)
      + (missing ? `<p class="small" style="margin-top:14px"><b>Ohne Kursdaten von eToro</b> (andere Börse oder noch nicht erfasst):</p><div class="chips">${missing}</div>` : ""), list.length);
  }
  function ledgerCard() {
    const L = data.ledger, S = L.stats || {};
    const kpi = (lbl, val) => `<div class="kpi"><div class="lbl">${lbl}</div><div class="val">${val}</div></div>`;
    const open = L.open.map(t => `<tr><td><button type="button" class="chip-btn" data-open="${esc(t.sym)}">${esc(t.sym)}</button><div class="muted small">seit ${dDate(t.opened)}</div></td><td class="num">${price(t.entry)}</td><td class="num">${price(t.stop)}</td><td class="opt">${t.half ? "✓ verkauft" : "–"}</td><td class="num">${pc(t.ret)}</td></tr>`).join("");
    const closed = L.closed.slice(0, 12).map(t => `<tr><td><button type="button" class="chip-btn" data-open="${esc(t.sym)}">${esc(t.sym)}</button><div class="muted small">${dDate(t.opened)} – ${dDate(t.closed)}</div></td><td class="num">${pc(t.ret)}</td><td class="wrap small">${esc(t.exitB.why)}</td></tr>`).join("");
    return section("Bilanz", "Bilanz der Signale", `Jedes Kaufsignal wird verfolgt, als hätte man es genau so bei eToro eingestellt – mit Stop, Trailing-Stop und Teilziel, nach Kosten (${fmt(data.rules.cost, 1)} % je Trade). So sehen Sie ehrlich, ob die Regeln funktionieren. Läuft seit ${dDate(L.startedAt)}.`,
      `<div class="stats">${kpi("Abgeschlossen", S.n || 0)}${kpi("Trefferquote", S.n ? `${fmt(S.winRate, 0)} %` : "–")}${kpi("Ø je Trade", S.n ? pc(S.avgRet) : "–")}${kpi("Offen", `${S.open || 0}${Number.isFinite(S.openRet) ? ` · ${pc(S.openRet)}` : ""}`)}</div>
      ${open ? `<h3 class="swing-h3">Offene Signale</h3><div class="table-wrap"><table class="swing-ledger"><thead><tr><th>Aktie</th><th class="num">Kauf</th><th class="num">Stop jetzt</th><th class="opt">Teilziel</th><th class="num">Stand</th></tr></thead><tbody>${open}</tbody></table></div>` : `<p class="muted" style="margin-top:12px">Noch keine offenen Signale – das erste kommt, sobald eine Firma in die Kaufzone läuft.</p>`}
      ${closed ? `<h3 class="swing-h3">Zuletzt abgeschlossen</h3><div class="table-wrap"><table class="swing-ledger"><thead><tr><th>Aktie</th><th class="num">Ergebnis</th><th>Grund</th></tr></thead><tbody>${closed}</tbody></table></div>` : ""}
      ${S.n >= 5 && S.theory && S.scan && S.theory.n && S.scan.n ? `<p class="hint">Mit Theorie: ${S.theory.n} Trades, Ø ${sign(S.theory.avgRet)} %. Neu entdeckt: ${S.scan.n} Trades, Ø ${sign(S.scan.avgRet)} %.</p>` : ""}`);
  }
  function methodCard() {
    const R = data.rules;
    return `<article class="card" data-section="Regeln">
      <h2 class="card-title">Die Regeln – und warum</h2>
      <ul class="checklist">
        <li><b>Theorie plus Trend:</b> Eine gute Geschichte allein reicht nicht. Gekauft wird nur, wenn der Kurs über dem 200-Tage-Schnitt liegt, der 50er darüber und das Momentum (12 bis 1 Monat) positiv ist. Aktien mit starkem Momentum laufen im Schnitt 3–12 Monate weiter (${DOI("10.1111/j.1540-6261.1993.tb04702.x", "Jegadeesh &amp; Titman 1993")}), besonders nahe am 52-Wochen-Hoch (${DOI("10.1111/j.1540-6261.2004.00695.x", "George &amp; Hwang 2004")}).</li>
        <li><b>Kaufzone statt Hinterherlaufen:</b> zwischen dem 50-Tage-Schnitt und 2 Tagesspannen (ATR) darüber, am Jahreshoch bis 3 ATR. Liegt der Kurs höher, ist er überhitzt – dann eine Order an der Obergrenze der Zone. Käufe über dem aktuellen Kurs (Ausbruch, Rückkehr über den 50er) gehen bei eToro nicht als Order, deshalb Kursalarm.</li>
        <li><b>Stop Loss ${R.stopAtr} ATR unter dem Kauf, mit Trailing Stop Loss:</b> Platz für normale Schwankungen, aber kein großer Verlust. Ein Stop um 10 % hat Momentum-Crashs in der Forschung stark gedämpft (${A("https://doi.org/10.2139/ssrn.2407199", "Han, Zhou &amp; Zhu, Arbeitspapier")}, vor Kosten); Stops helfen vor allem, wenn Kurse Trends haben (${DOI("10.1016/j.finmar.2013.07.001", "Kaminski &amp; Lo 2014")}). Läge der Stop weiter als ${R.maxStopPct} % entfernt, wartet der Planer: In unruhigen Phasen bricht Momentum am ehesten ein (${DOI("10.1016/j.jfineco.2014.11.010", "Barroso &amp; Santa-Clara 2015")}).</li>
        <li><b>Hälfte mit Ziel, Hälfte laufen lassen:</b> Die erste Hälfte nimmt bei ${R.targetR} × Risiko Gewinn mit, die zweite folgt nur dem Trailing-Stop. Anleger verkaufen Gewinner sonst zu früh und halten Verlierer zu lange (${DOI("10.1111/j.1540-6261.1985.tb05002.x", "Shefrin &amp; Statman 1985")}).</li>
        <li><b>Vor Quartalszahlen warten:</b> In den ${R.earnDays} Tagen vor Zahlen keine neuen Käufe – Kurssprünge über den Stop hinweg sind dann häufig.</li>
        <li><b>Verkaufen, wenn der Trend bricht:</b> unter dem 200-Tage-Schnitt raus, spätestens nach 12 Monaten neu bewerten. Seltene, heftige Momentum-Crashs bleiben das größte Risiko (${DOI("10.1016/j.jfineco.2015.12.002", "Daniel &amp; Moskowitz 2016")}).</li>
        <li><b>Immer aktuell:</b> Kurse und Zustände rechnet der Planer an jedem Börsentag zweimal neu, aus eToro-Daten und Finnhub (Analysten, Quartalszahlen). Jede Woche sucht eine Recherche neue Firmen und Theorien mit Quellen und prüft die Steckbriefe der neu Entdeckten.</li>
      </ul>
      <p class="hint">Keine Anlageberatung – mechanische Regeln, die auch oft danebenliegen; deshalb hat jede Idee einen Stop, und die Bilanz zeigt ehrlich, wie sie abschneiden. Stand der Firmen-Steckbriefe: ${dDate(data.firmsAsOf)}.</p>
    </article>`;
  }

  function render() {
    const host = $("swingBody");
    if (!host) return;
    if (!data) { host.innerHTML = `<article class="card"><p class="muted">${loading ? "Lade den Swing-Plan …" : "Noch kein Swing-Plan vorhanden – er entsteht beim nächsten Aktien-Datenlauf (Mo–Fr gegen 6 und 14:35 Uhr)."}</p></article>`; return; }
    const info = themeInfo(), theory = data.setups.filter(s => s.src === "theory");
    const buyNow = theory.filter(s => s.state === "buy" && !s.earnSoon);
    const soon = theory.filter(s => (s.state === "buy" && s.earnSoon) || s.state === "wait" || s.state === "alert");
    const found = data.setups.filter(s => s.src === "scan");
    const rest = theory.filter(s => !ACTIVE.includes(s.state));
    host.innerHTML = headCard() + themeCard(info)
      + section("Kaufzone", "Jetzt in der Kaufzone", "Theorie und Trend passen, der Kurs ist nicht überhitzt. Die stärksten zuerst (Momentum, Trend, Analysten, Rückenwind der Theorie).", cards(buyNow, info, "Heute liegt keine Firma der Theorie-Seite in der Kaufzone."), buyNow.length)
      + section("Bald kaufbar", "Bald kaufbar: Order oder Kursalarm setzen", "Aufwärtstrend, aber der Kurs ist gerade zu hoch, knapp unter dem Jahreshoch, kurz unter den 50-Tage-Schnitt gerutscht – oder es kommen in Kürze Quartalszahlen.", cards(soon, info, "Zurzeit keine."), soon.length)
      + section("Neu entdeckt", "Neu entdeckt: starke Aktien ohne Steckbrief", `Aus den rund ${fmt(700, 0)} beliebtesten Aktien bei eToro: Momentum unter den besten 10 %, Aufwärtstrend, höchstens 10 % unter dem Jahreshoch, Analysten nicht skeptisch. Die wöchentliche Recherche prüft die Geschichte dahinter.`, cards(found, info, "Heute erfüllt keine Aktie ohne Steckbrief alle Bedingungen."), found.length)
      + restCard(rest, info) + ledgerCard() + methodCard();
    host.querySelectorAll("[data-alarm]").forEach(b => b.addEventListener("click", () => {
      const ok = window.DTD.addAlarm && window.DTD.addAlarm(b.dataset.alarm, "up", Number(b.dataset.price), `Swing-Planer: ${b.dataset.why}`);
      if (ok) { b.textContent = "Alarm gesetzt ✓"; b.disabled = true; toast("Kursalarm", `${b.dataset.alarm}: Alarm bei ${b.dataset.price} gesetzt – zu sehen unter Werkzeuge.`, 5000); }
    }));
    // Kursdiagramm erst laden, wenn „Diagramm“ geöffnet wird
    host.querySelectorAll("details.swing-chart").forEach(d => d.addEventListener("toggle", () => {
      const el = d.querySelector(".big-chart");
      if (d.open && el && !el.dataset.loaded && window.DTD.bigChart) { el.dataset.loaded = "1"; window.DTD.bigChart(el.id, d.dataset.tv); }
    }));
    const budget = $("swingBudget"), risk = $("swingRisk");
    if (budget) budget.addEventListener("change", () => { const v = Number(budget.value); if (Number.isFinite(v) && v >= 100 && v <= 1e7) { pref.budget = Math.round(v); savePref(); render(); } else budget.value = pref.budget; });
    if (risk) risk.addEventListener("change", () => { pref.risk = Number(risk.value); savePref(); render(); });
    window.dispatchEvent(new Event("dtd:sections"));
  }

  async function load(force = false) {
    if (loading || (data && !force)) return;
    loading = true;
    if (!data) render();
    const t = Date.now();
    const [local, remote, f] = await Promise.all([get(`data/swing.json?t=${t}`), get(`${RAW}?t=${t}`), firms ? Promise.resolve(firms) : get(`data/firms.json?t=${t}`)]);
    if (f && f.firms) firms = f;
    const next = [local, remote].filter(d => d && Array.isArray(d.setups)).sort((a, b) => new Date(b.updated) - new Date(a.updated))[0] || null;
    loading = false;
    if (data && next && next.updated === data.updated) return;   // nichts Neues
    data = next || data;
    render();
  }
  window.DTD.startSwing = () => load(false);
  window.DTD.reloadSwing = () => load(true);
})();

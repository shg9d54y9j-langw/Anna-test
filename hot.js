// ---------- HotStuff: Experten-Favoriten, Hoch- und Herabstufungen, Swing-Trades über Monate ----------
// Grundlage: dieselben Tagesdaten wie der Aktien-Check (stocks.json: eToro-Kurse, optional Finnhub-Analysten und Quartalszahlen).
// Regeln aus der Forschung: Empfehlungen zählen vor allem, wenn sie zum Kurstrend passen, und Änderungen (Hoch-/Herabstufungen)
// sagen mehr als der Stand (Jegadeesh u. a. 2004). Swing-Ideen: Momentum nahe dem 52-Wochen-Hoch (George & Hwang 2004),
// Kursdrift nach Quartalszahlen-Überraschungen (Bernard & Thomas 1989; heute schwächer, Martineau 2022).
(() => {
  const RAW = "https://raw.githubusercontent.com/shg9d54y9j-langw/Anna-test/stock-data/stocks.json";
  const get = url => fetch(url, { cache: "no-store" }).then(r => (r.ok ? r.json() : null)).catch(() => null);
  const A = (url, text) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`;
  const DOI = (doi, text) => A(`https://doi.org/${doi}`, text);
  const sign = (x, d = 1) => (Number.isFinite(x) ? (x > 0 ? "+" : "") + fmt(x, d) : "–");
  const pc = (x, d = 1) => (Number.isFinite(x) ? `<span class="${x < 0 ? "down" : "up"}">${sign(x, d)} %</span>` : "–");
  const price = x => (!Number.isFinite(x) ? "–" : x >= 1000 ? fmt(x, 0) : x >= 10 ? fmt(x, 2) : fmt(x, 4));
  const COST = 0.3, STOP_ATR = 3, TARGET_ATR = 6;   // Swing über Monate: weiter Stop, Chance/Risiko 2 : 1
  let data = null, loading = false;

  const total = r => (r ? r.sb + r.b + r.h + r.s + r.ss : 0);
  const buyShare = r => (total(r) ? (r.sb + r.b) / total(r) : null);
  const sellShare = r => (total(r) ? (r.s + r.ss) / total(r) : null);
  const delta = x => (x.rec && x.recPrev && total(x.recPrev) ? buyShare(x.rec) - buyShare(x.recPrev) : null);
  const trendUp = x => x.d200 > 0 && x.mom > 0, trendDown = x => x.d200 < 0 && x.mom < 0;

  function lists(items) {
    const st = items.filter(x => Number.isFinite(x.last) && Number.isFinite(x.atr) && x.atr > 0);
    const withRec = st.filter(x => x.rec && total(x.rec) >= 8);
    const fav = withRec.filter(x => buyShare(x.rec) >= 0.65 && trendUp(x))
      .map(x => ({ x, score: buyShare(x.rec) + 0.5 * (x.momRank || 0) / 100 + Math.max(-0.2, Math.min(0.2, delta(x) || 0)) }))
      .sort((a, b) => b.score - a.score).slice(0, 12).map(o => o.x);
    const up = withRec.filter(x => delta(x) >= 0.08).sort((a, b) => delta(b) - delta(a)).slice(0, 10);
    const skeptic = withRec.filter(x => (sellShare(x.rec) >= 0.2 || delta(x) <= -0.08) && trendDown(x)).sort((a, b) => sellShare(b.rec) - sellShare(a.rec)).slice(0, 10);
    const mom = st.filter(x => x.momRank >= 85 && x.d200 > 0 && x.d50 > 0 && x.dHi52 >= -7).sort((a, b) => b.momRank - a.momRank || b.dHi52 - a.dHi52).slice(0, 10);
    const today = Date.now();
    const pead = st.filter(x => x.lastEarn && x.lastEarn.surprisePct >= 5 && (today - new Date(`${x.lastEarn.date}T12:00:00Z`)) / 864e5 <= 45 && x.d50 > 0)
      .sort((a, b) => b.lastEarn.surprisePct - a.lastEarn.surprisePct).slice(0, 8);
    return { fav, up, skeptic, mom, pead, momSet: new Set(mom.map(x => x.sym)) };
  }

  function swing(x) {
    const stopD = STOP_ATR * x.atr, tgtD = TARGET_ATR * x.atr, costD = x.last * COST / 100;
    return { entry: x.last, stop: x.last - stopD, target: x.last + tgtD, stopPct: -stopD / x.last * 100, tgtPct: tgtD / x.last * 100, pNoEdge: stopD / (stopD + tgtD), pNeeded: (stopD + costD) / (stopD + tgtD) };
  }
  function recBar(r, prev) {
    const n = total(r);
    if (!n) return "";
    const part = (k, cls, label) => (r[k] ? `<span class="rb ${cls}" style="flex:${r[k]}" title="${label}: ${r[k]}">${r[k]}</span>` : "");
    const d = prev && total(prev) ? (buyShare(r) - buyShare(prev)) * 100 : null;
    return `<div class="recbar" role="img" aria-label="${r.sb} starker Kauf, ${r.b} Kauf, ${r.h} Halten, ${r.s} Verkauf, ${r.ss} starker Verkauf">
      ${part("sb", "r1", "Starker Kauf")}${part("b", "r2", "Kauf")}${part("h", "r3", "Halten")}${part("s", "r4", "Verkauf")}${part("ss", "r5", "Starker Verkauf")}</div>
      <p class="muted small">${n} Analysten · ${fmt(buyShare(r) * 100, 0)} % Kauf, ${fmt(sellShare(r) * 100, 0)} % Verkauf${d !== null ? ` · zum Vormonat ${d > 0 ? "+" : ""}${fmt(d, 0)} Prozentpunkte Kauf` : ""}</p>`;
  }
  function card(x, { label, kind, why, extra = "" }) {
    const s = swing(x);
    const levels = kind === "sell"
      ? `<div class="idea-levels"><span>Ausstieg prüfen bei <b class="num">${price(x.last)}</b></span><span>Trend: ${pc(x.d200)} zum 200-Tage-Schnitt</span><span>Momentum ${pc(x.mom)}</span></div>`
      : `<div class="idea-levels"><span>Kauf <b class="num">${price(s.entry)}</b></span><span>Stop <b class="num">${price(s.stop)}</b> ${pc(s.stopPct)}</span><span>Ziel <b class="num">${price(s.target)}</b> ${pc(s.tgtPct)}</span><span>Haltedauer 2–6 Monate</span></div>`;
    return `<article class="idea">
      <div class="idea-head"><button type="button" class="idea-sym" data-open="${esc(x.sym)}">${esc(x.sym)}</button><span class="muted small idea-name">${esc(x.name)}</span><span class="light ${kind === "sell" ? "red" : kind === "buy" ? "green" : "yellow"}">${label}</span></div>
      <div class="idea-meta muted small">Kurs ${price(x.last)} · 12 Monate ${pc(x.ret12m)} · Momentum-Rang ${Number.isFinite(x.momRank) ? x.momRank : "–"} von 100 · zum Jahreshoch ${pc(x.dHi52)}</div>
      ${x.rec ? recBar(x.rec, x.recPrev) : ""}
      ${extra}
      ${levels}
      <p class="small idea-why"><b>Theorie dahinter:</b> ${why}</p>
      <button type="button" class="btn ghost idea-open" data-open="${esc(x.sym)}">Im Aktien-Check öffnen →</button>
    </article>`;
  }
  const section = (title, sub, items, render, empty, name) => `<article class="card" data-section="${name}">
      <div class="card-head"><h2 class="card-title">${title}</h2><span class="muted small">${items.length} Werte</span></div>
      <p class="muted small" style="margin:-6px 0 12px">${sub}</p>
      ${items.length ? `<div class="ideas">${items.map(render).join("")}</div>` : `<p class="muted">${empty}</p>`}
    </article>`;

  function keyCard() {
    return `<details class="info card" open data-section="Experten freischalten">
      <summary>Expertenmeinungen freischalten (kostenlos, einmalig 3 Minuten)</summary>
      <p>Die Analysten-Einschätzungen und Quartalszahlen kommen von Finnhub. Ohne Schlüssel zeigt HotStuff nur die Swing-Ideen aus den Kursdaten.</p>
      <ol class="steps">
        <li>Auf ${A("https://finnhub.io/register", "finnhub.io/register")} ein kostenloses Konto anlegen und den <b>API Key</b> kopieren.</li>
        <li>In GitHub: ${A("https://github.com/shg9d54y9j-langw/Anna-test/settings/secrets/actions", "Settings → Secrets → Actions")} → <b>„New repository secret“</b> → Name <code>FINNHUB_API_KEY</code>, Wert = der Schlüssel. Nie in einen Chat kopieren.</li>
        <li>Fertig. Beim nächsten Datenlauf (Mo–Fr gegen 6 und 14:35 Uhr) erscheinen Analysten, Hoch- und Herabstufungen und Quartalszahlen – hier und im Aktien-Check.</li>
      </ol>
      <p class="muted small">Der Schlüssel wird nur an finnhub.io gesendet. Finnhub liefert Analystendaten für US-Aktien.</p>
    </details>`;
  }

  function render() {
    const host = $("hotBody");
    if (!host) return;
    if (!data) { host.innerHTML = `<article class="card"><p class="muted">${loading ? "Lade die Tagesdaten …" : "Noch keine Tagesdaten vorhanden – sie erscheinen nach dem nächsten Datenlauf."}</p></article>`; return; }
    const L = lists(data.items), hasExperts = data.items.some(x => x.rec);
    const t = new Date(data.updated).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });
    const head = `<article class="card"><div class="card-head"><h2 class="card-title">Stand ${t} Uhr</h2><span class="muted small">${data.items.length} Aktien und ETFs · ${hasExperts ? "mit Analystendaten" : "ohne Analystendaten"}</span></div>
      <p class="small">Ausgewählt wird nach festen Regeln, nicht nach Bauchgefühl. <b>Kaufen-Kandidat</b> heißt: Experten und Kurstrend zeigen in dieselbe Richtung – das ist der Fall, in dem Empfehlungen laut Forschung am ehesten etwas taugen. Eine Garantie ist das nie: Auch die besten Signale liegen oft daneben, deshalb hat jede Idee einen Stop.</p></article>`;
    const expertSections = hasExperts ? [
      section("Experten-Favoriten mit Rückenwind", `Mindestens 65 % der Analysten sagen Kauf (ab 8 Analysten) und der Kurs liegt im Aufwärtstrend (über dem 200-Tage-Schnitt, Momentum positiv). Theorie: Empfehlungen wirken vor allem, wenn sie mit dem Momentum übereinstimmen (${DOI("10.1111/j.1540-6261.2004.00657.x", "Jegadeesh u. a. 2004")}); die am besten bewerteten Aktien schlugen die schlechtesten vor Kosten um rund 4 % pro Jahr (${DOI("10.1111/0022-1082.00336", "Barber u. a. 2001")}).`, L.fav,
        x => card(x, { label: "Kaufen-Kandidat", kind: "buy", why: `${fmt(buyShare(x.rec) * 100, 0)} % der Analysten sagen Kauf, Kurs ${sign(x.d200)} % über dem 200-Tage-Schnitt, Momentum-Rang ${x.momRank}.${L.momSet.has(x.sym) ? " <b>Zusätzlich Momentum-Führer nahe am Jahreshoch</b> – die stärkste Kombination." : ""}` }),
        "Heute erfüllt keine Aktie beide Bedingungen.", "Favoriten"),
      section("Hochgestuft", "Der Anteil der Kaufempfehlungen ist zum Vormonat um mindestens 8 Prozentpunkte gestiegen.", L.up,
        x => card(x, { label: trendUp(x) ? "Kaufen-Kandidat" : "Beobachten", kind: trendUp(x) ? "buy" : "watch", why: `Hochstufungen sagen mehr als der Stand der Empfehlungen (${DOI("10.1111/j.1540-6261.2004.00657.x", "Jegadeesh u. a. 2004")}). ${trendUp(x) ? "Der Kurstrend passt." : "Der Kurstrend bestätigt es noch nicht – abwarten, bis der Kurs über dem 200-Tage-Schnitt liegt."}` }),
        "Diesen Monat keine deutlichen Hochstufungen.", "Hochgestuft"),
      section("Experten skeptisch – verkaufen oder meiden", "Mindestens 20 % Verkaufsempfehlungen oder deutlich herabgestuft – und der Kurs im Abwärtstrend.", L.skeptic,
        x => card(x, { label: "Verkaufen / meiden", kind: "sell", why: `Skeptische Analysten und fallender Trend zeigen in dieselbe Richtung. Verkaufsempfehlungen sind selten (Banken empfehlen ungern Verkauf, ${DOI("10.1093/rfs/12.4.653", "Michaely &amp; Womack 1999")}) – wenn sie kommen, haben sie mehr Gewicht. Wenn Sie den Wert halten: Verkauf prüfen. Leerverkauf (auf fallende Kurse setzen) ist für Einsteiger zu riskant.` }),
        "Heute keine Aktie mit skeptischen Analysten und Abwärtstrend.", "Skeptisch"),
    ].join("") : keyCard();
    const swings = section("Swing-Trades über Monate: Momentum-Führer nahe am Jahreshoch", `Momentum-Rang mindestens 85 von 100, Kurs über dem 50- und 200-Tage-Schnitt, höchstens 7 % unter dem 52-Wochen-Hoch. Stop 3 × Tagesspanne (ATR), Ziel 6 × ATR. Theorie: Aktien mit starker Rendite über 12 Monate laufen im Schnitt 3–12 Monate weiter (${DOI("10.1111/j.1540-6261.1993.tb04702.x", "Jegadeesh &amp; Titman 1993")}), besonders nahe am 52-Wochen-Hoch, weil Anleger dort zu früh verkaufen (${DOI("10.1111/j.1540-6261.2004.00695.x", "George &amp; Hwang 2004")}). Risiko: seltene, heftige Momentum-Crashs (${DOI("10.1016/j.jfineco.2015.12.002", "Daniel &amp; Moskowitz 2016")}).`, L.mom,
      x => { const s = swing(x); return card(x, { label: "Swing-Kauf", kind: "buy", why: `${sign(x.mom, 0)} % Momentum (12 bis 1 Monat), ${sign(x.dHi52)} % zum Jahreshoch. Ohne echten Vorteil träfe das Ziel vor dem Stop in ${fmt(s.pNoEdge * 100, 0)} % der Fälle; nach Kosten braucht es ${fmt(s.pNeeded * 100, 0)} %.` }); },
      "Heute erfüllt kein Wert alle Bedingungen.", "Swing Momentum");
    const pead = hasExperts ? section("Swing-Trades nach starken Quartalszahlen", "Gewinn je Aktie mindestens 5 % über der Erwartung, gemeldet in den letzten 45 Tagen, Kurs über dem 50-Tage-Schnitt.", L.pead,
      x => card(x, { label: "Swing-Kauf", kind: "buy", extra: `<p class="small">Gemeldet am ${new Date(`${x.lastEarn.date}T12:00:00Z`).toLocaleDateString("de-DE")}: Gewinn je Aktie ${fmt(x.lastEarn.actual, 2)} statt erwartet ${fmt(x.lastEarn.estimate, 2)} (${pc(x.lastEarn.surprisePct, 0)}).</p>`, why: `Nach positiven Überraschungen driftet der Kurs oft noch Wochen nach (${DOI("10.2307/2491062", "Bernard &amp; Thomas 1989")}) – bei großen, viel beachteten Aktien ist der Effekt heute aber deutlich schwächer (${DOI("10.1561/104.00000122", "Martineau 2022")}). Haltedauer etwa bis 3 Monate nach der Meldung.` }),
      "Zurzeit keine frische positive Überraschung mit Aufwärtstrend.", "Swing Quartalszahlen") : "";
    const method = `<article class="card" data-section="Methode">
      <h2 class="card-title">Was Expertentipps wert sind – und wie HotStuff auswählt</h2>
      <ul class="checklist">
        <li><b>Analysten liegen oft daneben.</b> Strategien nach Empfehlungen brachten vor Kosten Mehrrendite, nach Kosten kaum noch (${DOI("10.1111/0022-1082.00336", "Barber u. a. 2001")}). Analysten von Banken, die an der Firma verdienen, sind zu optimistisch (${DOI("10.1093/rfs/12.4.653", "Michaely &amp; Womack 1999")}).</li>
        <li><b>Deshalb nur mit Bestätigung durch den Kurs:</b> Hervorgehoben wird nur, wo Experten und Trend übereinstimmen; Änderungen zählen mehr als der Stand (${DOI("10.1111/j.1540-6261.2004.00657.x", "Jegadeesh u. a. 2004")}).</li>
        <li><b>Swing über Monate:</b> Stop 3 × ATR (Platz für normale Schwankungen), Ziel 6 × ATR – Chance zu Risiko 2 : 1. Setzen Sie Stop und Ziel bei eToro direkt beim Kauf („Stop Loss“, „Take Profit“), und riskieren Sie pro Idee höchstens 1–2 % des Kontos (Rechner im Aktien-Check).</li>
        <li><b>Streuen:</b> Lieber mehrere kleine Positionen aus verschiedenen Branchen als eine große. Einzelne Ideen scheitern oft – die Regel wirkt erst über viele Trades.</li>
        <li><b>Weitere Expertenmeinungen:</b> In eToro beim Wert unter „Analyse“ (Kursziele der Analysten) und „Nachrichten“; Live-Nachrichten auch im Aktien-Check.</li>
      </ul>
      <p class="muted small">Keine Anlageberatung. Daten: eToro-Kurse${hasExperts ? ", Finnhub (Analysten, Quartalszahlen)" : ""}. Aktualisierung an Börsentagen gegen 6 und 14:35 Uhr.</p>
    </article>`;
    host.innerHTML = head + expertSections + swings + pead + method;
    host.querySelectorAll("[data-open]").forEach(b => b.addEventListener("click", () => window.DTD.openStock && window.DTD.openStock(b.dataset.open)));
    window.dispatchEvent(new Event("dtd:sections"));
  }

  async function load(force = false) {
    if (loading || (data && !force)) return;
    loading = true;
    if (!data) render();
    let next = window.DTD.stockData && window.DTD.stockData();
    if (!next || force) {
      const t = Date.now();
      const list = (await Promise.all([get(`data/stocks.json?t=${t}`), get(`${RAW}?t=${t}`)])).filter(d => d && Array.isArray(d.items));
      next = list.sort((a, b) => new Date(b.updated) - new Date(a.updated))[0] || next || null;
    }
    loading = false;
    if (data && next && next.updated === data.updated) return;   // nichts Neues
    data = next;
    render();
  }
  window.DTD.startHot = () => load(false);
  window.DTD.reloadHot = () => load(true);
  window.DTD.hotLists = () => (data ? lists(data.items) : null);
})();

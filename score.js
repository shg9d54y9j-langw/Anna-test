// ---------- Gesamtnote 0–100 je Aktie: sechs Teilnoten aus belegten Faktoren ----------
// Jede Kennzahl wird mit allen Aktien der Seite verglichen (Perzentil: 80 = besser als 80 % der Werte); Bewertung innerhalb
// der Branche, wenn es dort genug Vergleichswerte gibt. Faktoren aus der Forschung: Momentum (Jegadeesh & Titman 1993),
// Qualität/Profitabilität (Novy-Marx 2013; Asness, Frazzini & Pedersen 2019), Bewertung (Fama & French 1992), Wachstum,
// Analysten-Änderungen (Jegadeesh u. a. 2004), Insider-Käufe (Cohen, Malloy & Pomorski 2012), geringe Schwankung
// (Ang u. a. 2006; Frazzini & Pedersen 2014). Kennzahlen aus der Bilanz gibt es nur für US-Aktien (Finnhub).
(() => {
  const S = window.DTD.shared;
  const PARTS = [
    { k: "trend", label: "Trend", w: 0.25, term: "n-trend" },
    { k: "quality", label: "Qualität", w: 0.2, term: "n-quality" },
    { k: "value", label: "Bewertung", w: 0.15, term: "n-value" },
    { k: "growth", label: "Wachstum", w: 0.15, term: "n-growth" },
    { k: "experts", label: "Experten", w: 0.15, term: "n-experts" },
    { k: "risk", label: "Sicherheit", w: 0.1, term: "n-risk" },
  ];
  const fin = v => Number.isFinite(v);
  const total = r => (r ? r.sb + r.b + r.h + r.s + r.ss : 0);
  const buyShare = r => (total(r) >= 5 ? (r.sb + r.b) / total(r) : null);
  const avg = a => { const v = a.filter(fin); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
  const clamp = v => Math.max(0, Math.min(100, v));
  // Perzentil-Funktion über eine Werteliste: Anteil kleinerer Werte (Gleichstand halb)
  function ranker(values) {
    const v = values.filter(fin).sort((a, b) => a - b), n = v.length;
    if (n < 5) return () => null;
    return x => {
      if (!fin(x)) return null;
      let lo = 0, hi = n; while (lo < hi) { const m = (lo + hi) >> 1; if (v[m] < x) lo = m + 1; else hi = m; }
      let eq = lo; while (eq < n && v[eq] === x) eq++;
      return ((lo + (eq - lo) / 2) / n) * 100;
    };
  }
  let key = "", table = null;
  function build(stocks, fund) {
    const items = stocks.items.filter(x => x.type === "Aktie" || x.type === "ETF");
    const F = sym => (fund && fund.items && fund.items[sym]) || {};
    const pos = v => (fin(v) && v > 0 ? v : null);
    const col = (get, list = items) => list.map(get);
    const stocksOnly = items.filter(x => x.type === "Aktie");
    // Kurs-Kennzahlen über alle Werte, Bilanz-Kennzahlen über die Aktien mit Daten
    const R = {
      d200: ranker(col(x => x.d200)), dHi52: ranker(col(x => x.dHi52)), vol60: ranker(col(x => x.vol60)), mdd: ranker(col(x => x.mdd)), beta: ranker(col(x => x.beta)),
      roe: ranker(col(x => F(x.sym).roe, stocksOnly)), netM: ranker(col(x => F(x.sym).netM, stocksOnly)), grossM: ranker(col(x => F(x.sym).grossM, stocksOnly)),
      de: ranker(col(x => (fin(F(x.sym).de) && F(x.sym).de >= 0 ? F(x.sym).de : null), stocksOnly)),
      revG: ranker(col(x => F(x.sym).revG, stocksOnly)), epsG: ranker(col(x => F(x.sym).epsG, stocksOnly)),
      pe: ranker(col(x => pos(F(x.sym).pe), stocksOnly)), ps: ranker(col(x => pos(F(x.sym).ps), stocksOnly)), pb: ranker(col(x => pos(F(x.sym).pb), stocksOnly)),
      buy: ranker(col(x => buyShare(x.rec), stocksOnly)),
    };
    // Bewertung innerhalb der Branche (ab 8 Firmen mit Werten), sonst über alle
    const byInd = new Map();
    for (const x of stocksOnly) { const ind = F(x.sym).ind; if (ind) { if (!byInd.has(ind)) byInd.set(ind, []); byInd.get(ind).push(x); } }
    const indR = new Map();
    for (const [ind, xs] of byInd) {
      if (xs.length < 8) continue;
      indR.set(ind, { pe: ranker(xs.map(x => pos(F(x.sym).pe))), ps: ranker(xs.map(x => pos(F(x.sym).ps))), pb: ranker(xs.map(x => pos(F(x.sym).pb))), n: xs.length });
    }
    const out = new Map();
    for (const x of items) {
      const f = F(x.sym), ir = f.ind && indR.get(f.ind);
      const vr = k => (ir && ir[k](pos(f[k])) !== null ? ir[k] : R[k]);
      const inv = p => (p === null ? null : 100 - p);
      const P = {
        trend: fin(x.momRank) && fin(x.d200) && fin(x.dHi52) ? 0.4 * x.momRank + 0.3 * R.d200(x.d200) + 0.3 * R.dHi52(x.dHi52) : null,
        quality: x.type === "Aktie" ? (() => { const a = [R.roe(f.roe), R.netM(f.netM), R.grossM(f.grossM), fin(f.de) && f.de >= 0 ? inv(R.de(f.de)) : null].filter(v => v !== null); return a.length >= 2 ? avg(a) : null; })() : null,
        value: x.type === "Aktie" ? (() => { const a = [inv(vr("pe")(pos(f.pe))), inv(vr("ps")(pos(f.ps))), inv(vr("pb")(pos(f.pb)))].filter(v => v !== null); return a.length ? avg(a) : null; })() : null,
        growth: x.type === "Aktie" ? avg([R.revG(f.revG), R.epsG(f.epsG)]) : null,
        experts: (() => {
          const b = buyShare(x.rec);
          if (b === null) return null;
          const prev = buyShare(x.recPrev), d = prev === null ? 0 : b - prev;
          const ins = f.ins && f.ins.buyers >= 2 && !(f.cty && f.cty !== "US") ? 8 : 0;
          return clamp(R.buy(b) + (d >= 0.08 ? 8 : d <= -0.08 ? -8 : 0) + ins);
        })(),
        risk: (() => { const a = [inv(R.vol60(x.vol60)), inv(R.mdd(x.mdd)), inv(R.beta(x.beta))].filter(v => v !== null); return a.length >= 2 ? avg(a) : null; })(),
      };
      let sw = 0, sum = 0;
      for (const p of PARTS) if (P[p.k] !== null && fin(P[p.k])) { sw += p.w; sum += p.w * P[p.k]; }
      const raw = sw >= 0.35 ? sum / sw : null;
      out.set(x.sym, {
        sym: x.sym, raw, note: null, coverage: Math.round(sw * 100) / 100, parts: Object.fromEntries(PARTS.map(p => [p.k, P[p.k] === null ? null : Math.round(P[p.k])])),
        ind: f.ind || null, indN: ir ? ir.n : 0,
        pct: { pe: vr("pe")(pos(f.pe)), ps: vr("ps")(pos(f.ps)), roe: R.roe(f.roe), netM: R.netM(f.netM), revG: R.revG(f.revG), epsG: R.epsG(f.epsG), vol60: R.vol60(x.vol60), mdd: R.mdd(x.mdd), beta: R.beta(x.beta), momRank: x.momRank, d200: R.d200(x.d200), de: R.de(f.de) },
      });
    }
    // Gesamtnote = Rang des gewichteten Mittels: 80 heißt besser als 80 % (gleiche Lesart wie die Teilnoten). Werte mit allen
    // Daten und solche mit Teilnoten (ETFs, Aktien außerhalb der USA) werden je unter sich eingeordnet – sonst verzerrt es.
    const full = s => s.coverage >= 0.6;
    const rkFull = ranker([...out.values()].filter(full).map(s => s.raw)), rkPart = ranker([...out.values()].filter(s => !full(s)).map(s => s.raw));
    for (const s of out.values()) { const v = s.raw === null ? null : (full(s) ? rkFull : rkPart)(s.raw); s.note = v === null ? null : Math.round(v); }
    return out;
  }
  function ensure() {
    const st = S.get("stocks"), fu = S.get("fund");
    if (!st || !Array.isArray(st.items)) return null;
    const k = `${st.updated}|${fu ? fu.updated : "-"}`;
    if (k !== key) { table = build(st, fu); key = k; }
    return table;
  }
  const label = n => (!fin(n) ? "–" : n >= 80 ? "sehr stark" : n >= 60 ? "stark" : n >= 40 ? "durchschnittlich" : n >= 20 ? "schwach" : "sehr schwach");
  const tone = n => (!fin(n) ? "" : n >= 60 ? "up" : n < 40 ? "down" : "");

  // Was spricht dafür, was dagegen – aus den Kennzahlen, je höchstens vier Punkte
  function reasons(x, f, s) {
    const pro = [], con = [], P = s.parts;
    const p = (v, d = 1) => `${v > 0 ? "+" : ""}${fmt(v, d)} %`;
    if (x.d200 > 0 && x.mom > 0) pro.push([P.trend || 0, `Aufwärtstrend: Kurs ${p(x.d200)} über dem 200-Tage-Schnitt`]);
    if (x.d200 < 0) con.push([100 - (P.trend || 0), `Unter dem 200-Tage-Schnitt (${p(x.d200)}) – kein Aufwärtstrend`]);
    if (fin(x.momRank) && x.momRank >= 80) pro.push([x.momRank, `Stärker als ${fmt(x.momRank, 0)} % der Werte über 12 Monate`]);
    if (fin(x.momRank) && x.momRank <= 20) con.push([100 - x.momRank, `Schwächer als ${fmt(100 - x.momRank, 0)} % der Werte über 12 Monate`]);
    if (fin(x.dHi52) && x.dHi52 >= -5 && x.d200 > 0) pro.push([70, `Nahe am Jahreshoch (${p(x.dHi52)})`]);
    if (fin(f.roe) && f.roe >= 20) pro.push([s.pct.roe || 60, `Hohe Eigenkapitalrendite (${fmt(f.roe, 0)} %)`]);
    if (fin(f.netM) && f.netM < 0) con.push([80, `Macht Verlust (Nettomarge ${fmt(f.netM, 1)} %)`]);
    else if (fin(f.netM) && f.netM >= 20) pro.push([s.pct.netM || 60, `Hohe Gewinnmarge (${fmt(f.netM, 0)} % vom Umsatz)`]);
    if (fin(f.de) && f.de >= 2) con.push([65, `Hoch verschuldet (Schulden das ${fmt(f.de, 1)}-Fache des Eigenkapitals)`]);
    const peTxt = s.indN ? `in der Branche ${f.ind}` : "aller Aktien hier";
    if (fin(f.pe) && f.pe > 0 && fin(s.pct.pe) && s.pct.pe <= 25) pro.push([100 - s.pct.pe, `Günstig bewertet: KGV ${fmt(f.pe, 1)} – niedriger als bei ${fmt(100 - s.pct.pe, 0)} % ${peTxt}`]);
    if (fin(f.pe) && f.pe > 0 && fin(s.pct.pe) && s.pct.pe >= 85) con.push([s.pct.pe, `Teuer: KGV ${fmt(f.pe, 0)} – höher als bei ${fmt(s.pct.pe, 0)} % ${peTxt}`]);
    if (fin(f.revG) && f.revG >= 20) pro.push([s.pct.revG || 70, `Umsatz wächst stark (${p(f.revG, 0)})`]);
    if (fin(f.revG) && f.revG < 0) con.push([70, `Umsatz schrumpft (${p(f.revG, 0)})`]);
    const b = buyShare(x.rec);
    if (b !== null && b >= 0.7) pro.push([b * 100, `${fmt(b * 100, 0)} % von ${total(x.rec)} Analysten raten zum Kauf`]);
    if (x.rec && total(x.rec) >= 5 && (x.rec.s + x.rec.ss) / total(x.rec) >= 0.2) con.push([70, `${fmt((x.rec.s + x.rec.ss) / total(x.rec) * 100, 0)} % der Analysten raten zum Verkauf`]);
    const prev = buyShare(x.recPrev);
    if (b !== null && prev !== null && b - prev >= 0.08) pro.push([65, `Analysten zuletzt optimistischer (${p((b - prev) * 100, 0)} Punkte Kauf)`]);
    if (b !== null && prev !== null && b - prev <= -0.08) con.push([65, `Analysten zuletzt skeptischer (${p((b - prev) * 100, 0)} Punkte Kauf)`]);
    if (f.ins && f.ins.buyers >= 2 && !(f.cty && f.cty !== "US")) pro.push([75, `${f.ins.buyers} Insider kauften in 90 Tagen eigene Aktien`]);
    if (fin(s.pct.vol60) && s.pct.vol60 >= 85) con.push([s.pct.vol60, `Schwankt stark (${fmt(x.vol60, 0)} % pro Jahr)`]);
    else if (fin(s.pct.vol60) && s.pct.vol60 <= 20) pro.push([100 - s.pct.vol60, `Ruhiger als ${fmt(100 - s.pct.vol60, 0)} % der Werte`]);
    if (fin(x.mdd) && x.mdd >= 40) con.push([x.mdd, `Fiel im letzten Jahr zeitweise um ${fmt(x.mdd, 0)} %`]);
    if (x.earn && x.earn.date) {
      const days = Math.round((Date.parse(`${x.earn.date}T12:00:00Z`) - Date.now()) / 864e5);
      if (days >= 0 && days <= 10) con.push([60, `Quartalszahlen ${days === 0 ? "heute" : days === 1 ? "morgen" : `in ${days} Tagen`} (${new Date(`${x.earn.date}T12:00:00Z`).toLocaleDateString("de-DE")}) – Kurssprung möglich`]);
    }
    const top = l => l.sort((a, b) => b[0] - a[0]).slice(0, 4).map(r => r[1]);
    return { pro: top(pro), con: top(con) };
  }

  // Teilnoten als waagrechte Balken (je ein Wert, gleiche Skala 0–100)
  function bars(s, sym) {
    const T = (k, l) => (window.DTD.term ? window.DTD.term(k, l, sym) : l);
    return `<div class="nbars">${PARTS.map(p => {
      const v = s.parts[p.k];
      return `<div class="nbar"><span class="nbar-l">${T(p.term, p.label)}</span><span class="nbar-t" role="img" aria-label="${p.label}: ${v === null ? "keine Daten" : `${v} von 100`}">${v === null ? "" : `<i style="width:${Math.max(2, v)}%"></i>`}</span><b class="nbar-v num">${v === null ? `<span class="muted">–</span>` : v}</b></div>`;
    }).join("")}</div>`;
  }
  function card(sym) {
    const t = ensure(), s = t && t.get(sym), x = S.item(sym);
    if (!s || !x) return "";
    const f = S.fund(sym) || {};
    const R = reasons(x, f, s);
    const T = (k, l) => (window.DTD.term ? window.DTD.term(k, l, sym) : l);
    const partial = s.coverage < 0.6;
    return `<div class="note-wrap">
        <div class="note-big"><span class="note-num num ${tone(s.note)}">${fin(s.note) ? s.note : "–"}</span><span class="note-of">von 100</span><span class="note-lbl">${label(s.note)}</span>
          <p class="muted small">${T("note", "Wie entsteht die Note?")}${partial ? ` · Teilnote: ${x.type === "ETF" ? "bei ETFs nur Trend und Sicherheit" : "Bilanz-Kennzahlen fehlen (nur für US-Aktien)"}` : ""} · <a href="#notebilanz">Trifft die Note? Bilanz →</a></p></div>
        ${bars(s, sym)}
      </div>
      <div class="grid-2 note-why">
        <div><h3 class="swing-h3 up">Dafür spricht</h3>${R.pro.length ? `<ul class="checklist">${R.pro.map(r => `<li>${esc(r)}</li>`).join("")}</ul>` : `<p class="muted small">Keine herausragende Stärke in den Daten.</p>`}</div>
        <div><h3 class="swing-h3 down">Dagegen spricht</h3>${R.con.length ? `<ul class="checklist">${R.con.map(r => `<li>${esc(r)}</li>`).join("")}</ul>` : `<p class="muted small">Keine auffällige Schwäche in den Daten.</p>`}</div>
      </div>`;
  }
  // ---------- Finanzkraft nach dem Piotroski-Prinzip (Piotroski 2000) – eigene Ampel, die Gesamtnote bleibt unverändert ----------
  // Bis zu acht Prüfungen aus den letzten zwei Geschäftsjahren (fund.json → fs, nächtlich von Finnhub, nur US-Aktien).
  // Ampel: grün ab 70 % der prüfbaren Punkte, gelb ab 40 %, sonst rot; mindestens fünf prüfbare Punkte.
  const p1 = v => `${fmt(v * 100, 1)} %`, n2 = v => fmt(v, 2);
  const FS_TESTS = [
    { k: "roa", t: "Verdient Geld", has: f => !!f.roa, ok: f => f.roa[0] > 0, txt: f => `Gesamtkapitalrendite ${p1(f.roa[0])}` },
    { k: "cash", t: "Geld fließt zu", has: f => fin(f.cfps) || !!f.fcfm, ok: f => (fin(f.cfps) ? f.cfps > 0 : f.fcfm[0] > 0), txt: f => (fin(f.cfps) ? `Operativer Mittelzufluss je Aktie (12 Monate) ${n2(f.cfps)}` : `Free-Cashflow-Marge ${p1(f.fcfm[0])}`) },
    { k: "droa", t: "Rendite steigt", has: f => !!f.roa, ok: f => f.roa[0] > f.roa[1], txt: f => `${p1(f.roa[0])} nach ${p1(f.roa[1])} im Vorjahr` },
    { k: "accr", t: "Gewinn durch Geld gedeckt", has: f => fin(f.cfps) && fin(f.eps), ok: f => f.cfps > f.eps, txt: f => `Mittelzufluss je Aktie ${n2(f.cfps)} gegen Gewinn je Aktie ${n2(f.eps)}` },
    { k: "lev", t: "Weniger Schulden", has: f => !!f.lev, ok: f => f.lev[0] < f.lev[1] || (f.lev[0] === 0 && f.lev[1] === 0), txt: f => `Schulden ${p1(f.lev[0])} der Bilanzsumme nach ${p1(f.lev[1])}` },
    { k: "cr", t: "Mehr Liquidität", has: f => !!f.cr, ok: f => f.cr[0] > f.cr[1], txt: f => `Liquidität (kurzfristiges Vermögen zu Schulden) ${n2(f.cr[0])} nach ${n2(f.cr[1])}` },
    { k: "gm", t: "Bruttomarge steigt", has: f => !!f.gm, ok: f => f.gm[0] > f.gm[1], txt: f => `${p1(f.gm[0])} nach ${p1(f.gm[1])}` },
    { k: "at", t: "Kapital effizienter genutzt", has: f => !!f.at, ok: f => f.at[0] > f.at[1], txt: f => `Umsatz je Euro Vermögen ${n2(f.at[0])} nach ${n2(f.at[1])}` },
  ];
  const FS_LABEL = { green: "stark", yellow: "mittel", red: "schwach" };
  function finStrength(sym) {
    const f = (S.fund(sym) || {}).fs;
    if (!f) return null;
    const tests = FS_TESTS.filter(t => t.has(f)).map(t => ({ k: t.k, t: t.t, txt: t.txt(f), pass: !!t.ok(f) }));
    if (tests.length < 5) return null;
    const p = tests.filter(t => t.pass).length, n = tests.length, r = p / n;
    const light = r >= 0.7 ? "green" : r >= 0.4 ? "yellow" : "red";
    // Warnung: knappe Liquidität und kein Geldzufluss oder Verlust
    const warn = !!(f.cr && f.cr[0] < 1 && ((f.roa && f.roa[0] < 0) || (f.fcfm && f.fcfm[0] < 0) || (fin(f.cfps) && f.cfps < 0)));
    return { p, n, light, label: FS_LABEL[light], tests, year: f.y || null, warn };
  }
  function finCard(sym) {
    const x = S.item(sym), fsd = finStrength(sym), fu = S.get("fund");
    if (!x || x.type !== "Aktie") return "";
    const T = (k, l) => (window.DTD.term ? window.DTD.term(k, l, sym) : l);
    if (!fsd) {
      const why = !fu ? "Die Kennzahlen laden noch." : !(S.fund(sym) || {}).fs ? (Object.values(fu.items || {}).some(v => v.fs) ? "Für diese Aktie liefert Finnhub keine Jahreswerte – meist bei Firmen außerhalb der USA." : "Die Jahreswerte dafür kommen mit dem nächsten nächtlichen Kennzahlen-Lauf.") : "Zu wenige prüfbare Punkte.";
      return `<p class="muted small">${T("finanzkraft", "Finanzkraft")}: ${why}</p>`;
    }
    return `<div class="fs-head"><span class="light ${fsd.light === "green" ? "green" : fsd.light === "yellow" ? "yellow" : "red"} big">Finanzkraft ${fsd.label}</span><b class="num">${fsd.p} von ${fsd.n}</b><span class="muted small">Punkten${fsd.year ? ` · Geschäftsjahr ${fsd.year}` : ""} · ${T("finanzkraft", "Wie wird gerechnet?")}</span></div>
      ${fsd.warn ? `<p class="small down"><b>Achtung:</b> knappe Liquidität (weniger kurzfristiges Vermögen als kurzfristige Schulden) und kein Geldzufluss oder Verlust.</p>` : ""}
      <ul class="fs-list">${fsd.tests.map(t => `<li class="${t.pass ? "ok" : "no"}"><span aria-hidden="true">${t.pass ? "✓" : "✗"}</span><b>${t.t}</b><span class="muted small">${esc(t.txt)}</span></li>`).join("")}</ul>`;
  }
  window.DTD.finStrength = finStrength;
  window.DTD.finCard = finCard;
  window.DTD.score = sym => { const t = ensure(); return t ? t.get(sym) || null : null; };
  window.DTD.scoreAll = () => ensure();
  window.DTD.scoreReady = () => Promise.all([S.load("stocks"), S.load("fund")]).then(ensure);
  window.DTD.scoreCard = card;
  window.DTD.scoreLabel = label;
  window.DTD.scoreTone = tone;
  window.DTD.scoreParts = PARTS;
})();

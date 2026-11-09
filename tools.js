// ---------- Werkzeuge: Screener, Quartalszahlen-Kalender, Insider-Käufe, Kursalarme, Steuer-Schätzer ----------
// Die Funktionen bekannter Börsen-Werkzeuge, gebaut aus den Daten dieser Seite: stocks.json (eToro-Kurse, Analysten und
// Quartalszahlen von Finnhub, 2× pro Börsentag), fund.json (Kennzahlen, Branche, Insider-Geschäfte – nachts von Finnhub),
// swing.json (Swing-Planer). Kursalarme, Portfolio und Journal bleiben nur in diesem Browser.
(() => {
  const RAW = "https://raw.githubusercontent.com/shg9d54y9j-langw/Anna-test/";
  const get = url => fetch(url, { cache: "no-store" }).then(r => (r.ok ? r.json() : null)).catch(() => null);
  const newest = list => list.filter(d => d && d.updated).sort((a, b) => new Date(b.updated) - new Date(a.updated))[0] || null;
  const A = (url, text) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`;
  const sign = (x, d = 1) => (Number.isFinite(x) ? (x > 0 ? "+" : "") + fmt(x, d) : "–");
  const pc = (x, d = 1) => (Number.isFinite(x) ? `<span class="${x < 0 ? "down" : "up"}">${sign(x, d)} %</span>` : "–");
  const price = x => (!Number.isFinite(x) ? "–" : x >= 1000 ? fmt(x, 0) : x >= 1 ? fmt(x, 2) : fmt(x, 4));
  const num = v => { const x = parseFloat(String(v ?? "").trim().replace(",", ".")); return Number.isFinite(x) ? x : null; };
  const dDate = iso => (iso ? new Date(`${String(iso).slice(0, 10)}T12:00:00Z`).toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" }) : "–");
  const big = v => (!Number.isFinite(v) ? "–" : v >= 1e9 ? `${fmt(v / 1e9, 1)} Mrd. $` : v >= 1e6 ? `${fmt(v / 1e6, 1)} Mio. $` : v >= 1e3 ? `${fmt(v / 1e3, 0)} Tsd. $` : `${fmt(v, 0)} $`);
  const SYM = /^[A-Z0-9][A-Z0-9.\-_]{0,19}$/;
  let stocks = null, fund = null, swing = null, firms = null, loading = false;
  const ui = Object.assign({ preset: "momentum", sort: "momRank", dir: -1, cal: "alle" }, store.get("dtd-tools", {}) || {});
  const saveUi = () => store.set("dtd-tools", { preset: ui.preset, sort: ui.sort, dir: ui.dir, cal: ui.cal });

  // ---------- Hilfen ----------
  const avgFrom = (last, d) => (Number.isFinite(last) && Number.isFinite(d) ? last / (1 + d / 100) : null);
  function trendOf(x) {
    const s50 = avgFrom(x.last, x.d50), s200 = avgFrom(x.last, x.d200);
    if (![x.last, s50, s200].every(Number.isFinite)) return "nodata";
    if (x.d200 > 0 && s50 > s200 && x.mom > 0) return "up";
    if (x.d200 < 0 && (s50 < s200 || x.mom < 0)) return "down";
    return "flat";
  }
  const TREND = { up: ["Auf", "green"], flat: ["Offen", "yellow"], down: ["Ab", "red"], nodata: ["–", ""] };
  const region = sym => { const m = /\.([A-Z]+)$/.exec(sym); if (!m) return "us"; return ["HK", "T", "KS", "KQ", "SS", "SZ", "TW", "SI", "AX"].includes(m[1]) ? "asia" : "eu"; };
  const total = r => (r ? r.sb + r.b + r.h + r.s + r.ss : 0);
  const buyPct = x => (x.rec && total(x.rec) >= 5 ? (x.rec.sb + x.rec.b) / total(x.rec) * 100 : null);
  const F = sym => (fund && fund.items && fund.items[sym]) || {};
  const planState = sym => { const s = swing && Array.isArray(swing.setups) ? swing.setups.find(y => y.sym === sym) : null; return s ? s.state : null; };
  const PLAN = { buy: ["Kaufzone", "green"], wait: ["Order", "yellow"], alert: ["Alarm", "yellow"], watch: ["Beobachten", ""], avoid: ["Finger weg", "red"] };
  const portfolio = () => { const l = store.get("dtd-portfolio", []); return Array.isArray(l) ? l.filter(h => h && typeof h.sym === "string") : []; };
  const themeSets = () => {
    const out = [];
    if (firms && firms.sectors) for (const [id, l] of Object.entries(firms.sectors)) out.push({ key: `sector:${id}`, syms: l });
    if (firms && firms.moon) for (const [id, m] of Object.entries(firms.moon)) out.push({ key: `moon:${id}`, syms: m.firms || [] });
    return out;
  };
  const themeName = key => { const info = window.DTD.themeInfo ? window.DTD.themeInfo() : {}; return info[key] ? info[key].title : key.replace(/^\w+:/, ""); };
  const open = sym => window.DTD.openStock && window.DTD.openStock(sym);

  // ---------- Screener ----------
  const PRESETS = {
    momentum: { label: "Momentum-Führer", note: "Momentum unter den besten 15 %, Aufwärtstrend, höchstens 7 % unter dem Jahreshoch – die Regel des Swing-Planers.", f: { trend: "up", minMom: 85, maxBelowHigh: 7 } },
    pullback: { label: "Rücksetzer im Aufwärtstrend", note: "Aufwärtstrend, aber zurück am 50-Tage-Schnitt (−3 % bis +2 %): klassische Kaufzone.", f: { trend: "up", d50min: -3, d50max: 2 } },
    highs: { label: "Neue Jahreshochs", note: "Höchstens 1 % unter dem 52-Wochen-Hoch.", f: { maxBelowHigh: 1 } },
    analysts: { label: "Analysten-Favoriten", note: "Mindestens 70 % der Analysten sagen Kauf (ab 5 Analysten), Aufwärtstrend.", f: { minBuy: 70, trend: "up" } },
    insider: { label: "Insider kaufen", note: "Mindestens zwei Insider haben in den letzten 90 Tagen am Markt gekauft (nur US-Aktien).", f: { minBuyers: 2 } },
    value: { label: "Wachstum zum fairen Preis", note: "KGV zwischen 0 und 25, Umsatz wächst um mehr als 10 %.", f: { maxPe: 25, minRevG: 10 } },
    dividend: { label: "Dividende", note: "Dividendenrendite ab 3 %, kein Abwärtstrend.", f: { minDiv: 3, trend: "notdown" } },
    theory: { label: "Theorie-Firmen", note: "Alle Firmen der Theorie-Seite.", f: { theory: "all" } },
    all: { label: "Alle", note: "Keine Vorauswahl – filtern Sie selbst.", f: {} },
  };
  const filter = () => Object.assign({ type: "Aktie", region: "all", theory: "", ind: "", trend: "", minMom: null, maxBelowHigh: null, d50min: null, d50max: null, minBuy: null, minBuyers: null, maxPe: null, minRevG: null, minDiv: null, q: "" }, (PRESETS[ui.preset] || PRESETS.all).f, ui.custom || {});
  function screen(f) {
    if (!stocks) return [];
    const theory = f.theory === "all" ? new Set(Object.keys((firms && firms.firms) || {})) : f.theory ? new Set((themeSets().find(t => t.key === f.theory) || { syms: [] }).syms) : null;
    const q = String(f.q || "").trim().toUpperCase();
    return stocks.items.filter(x => {
      const fx = F(x.sym), t = trendOf(x);
      if (f.type && f.type !== "all" && x.type !== f.type) return false;
      if (f.region !== "all" && region(x.sym) !== f.region) return false;
      if (theory && !theory.has(x.sym)) return false;
      if (f.ind && fx.ind !== f.ind) return false;
      if (f.trend === "up" && t !== "up") return false;
      if (f.trend === "notdown" && t === "down") return false;
      if (f.trend === "down" && t !== "down") return false;
      if (f.minMom !== null && !(x.momRank >= f.minMom)) return false;
      if (f.maxBelowHigh !== null && !(x.dHi52 >= -f.maxBelowHigh)) return false;
      if (f.d50min !== null && !(x.d50 >= f.d50min)) return false;
      if (f.d50max !== null && !(x.d50 <= f.d50max)) return false;
      if (f.minBuy !== null && !(buyPct(x) >= f.minBuy)) return false;
      if (f.minBuyers !== null && !((fx.ins && fx.ins.buyers) >= f.minBuyers)) return false;
      if (f.maxPe !== null && !(fx.pe > 0 && fx.pe <= f.maxPe)) return false;
      if (f.minRevG !== null && !(fx.revG >= f.minRevG)) return false;
      if (f.minDiv !== null && !(fx.div >= f.minDiv)) return false;
      if (q && !x.sym.includes(q) && !String(x.name || "").toUpperCase().includes(q)) return false;
      return true;
    });
  }
  const COLS = [
    { key: "sym", label: "Aktie", get: x => x.sym, cell: x => `<button type="button" class="chip-btn" data-open="${esc(x.sym)}">${esc(x.sym)}</button><div class="muted small scr-name">${esc(x.name || "")}</div>` },
    { key: "last", label: "Kurs", num: true, opt: true, get: x => x.last, cell: x => price(x.last) },
    { key: "ret12m", label: "12 Mon.", num: true, get: x => x.ret12m, cell: x => pc(x.ret12m, 0) },
    { key: "momRank", label: "Mom.", num: true, get: x => x.momRank, cell: x => (Number.isFinite(x.momRank) ? x.momRank : "–") },
    { key: "trend", label: "Trend", get: x => ({ up: 2, flat: 1, down: 0, nodata: -1 })[trendOf(x)], cell: x => { const [l, c] = TREND[trendOf(x)]; return `<span class="light ${c}">${l}</span>`; } },
    { key: "dHi52", label: "zum Hoch", num: true, opt: true, get: x => x.dHi52, cell: x => pc(x.dHi52, 0) },
    { key: "pe", label: "KGV", num: true, opt: true, get: x => F(x.sym).pe, cell: x => (Number.isFinite(F(x.sym).pe) ? fmt(F(x.sym).pe, 1) : "–") },
    { key: "revG", label: "Umsatz +", num: true, opt: true, get: x => F(x.sym).revG, cell: x => pc(F(x.sym).revG, 0) },
    { key: "buy", label: "Analysten", num: true, opt: true, get: x => buyPct(x), cell: x => (Number.isFinite(buyPct(x)) ? `${fmt(buyPct(x), 0)} %` : "–") },
    { key: "plan", label: "Planer", opt: true, get: x => planState(x.sym) || "", cell: x => { const p = PLAN[planState(x.sym)]; return p ? `<span class="light ${p[1]}">${p[0]}</span>` : `<span class="muted">–</span>`; } },
  ];
  function screenerCard() {
    const f = filter(), rows = screen(f);
    const col = COLS.find(c => c.key === ui.sort) || COLS[3];
    rows.sort((a, b) => { const va = col.get(a), vb = col.get(b); if (va === vb) return 0; if (va === null || va === undefined || va === "") return 1; if (vb === null || vb === undefined || vb === "") return -1; return (va < vb ? -1 : 1) * ui.dir; });
    const inds = fund ? [...new Set(Object.values(fund.items).map(x => x.ind).filter(Boolean))].sort() : [];
    const sel = (id, opts, val) => `<select id="${id}">${opts.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(val ?? "") ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
    const inp = (id, val, ph) => `<input id="${id}" inputmode="decimal" value="${val ?? ""}" placeholder="${ph}">`;
    const noFund = !fund ? "Kennzahlen und Insider-Daten kommen mit dem ersten nächtlichen Lauf." : !fund.available.insider ? "Insider-Daten liefert Finnhub im Gratis-Tarif nicht – dafür OpenInsider (unten)." : "";
    return `<article class="card" data-section="Screener">
      <div class="card-head"><h2 class="card-title">Screener: Aktien nach Regeln finden</h2><span class="muted small">${stocks ? `${rows.length} von ${stocks.items.length} Werten` : "lade …"}</span></div>
      <div class="seg wrap-seg" role="group" aria-label="Vorlagen">${Object.entries(PRESETS).map(([k, p]) => `<button type="button" data-preset="${k}" aria-pressed="${ui.preset === k}">${p.label}</button>`).join("")}</div>
      <p class="muted small" style="margin:8px 0 0">${(PRESETS[ui.preset] || PRESETS.all).note}${noFund ? ` ${noFund}` : ""}</p>
      <details class="scr-more"${ui.custom && Object.keys(ui.custom).length ? " open" : ""}><summary>Eigene Filter</summary>
        <div class="calc scr-grid">
          <label>Suche<input id="scQ" value="${esc(f.q || "")}" placeholder="Name oder Kürzel"></label>
          <label>Art${sel("scType", [["Aktie", "Aktien"], ["ETF", "ETFs"], ["all", "Alle"]], f.type)}</label>
          <label>Region${sel("scRegion", [["all", "Alle"], ["us", "USA"], ["eu", "Europa"], ["asia", "Asien"]], f.region)}</label>
          <label>Trend${sel("scTrend", [["", "egal"], ["up", "Aufwärts"], ["notdown", "kein Abwärtstrend"], ["down", "Abwärts"]], f.trend)}</label>
          <label>Theorie${sel("scTheory", [["", "egal"], ["all", "alle Theorie-Firmen"], ...themeSets().map(t => [t.key, themeName(t.key)])], f.theory)}</label>
          <label>Branche (USA)${sel("scInd", [["", "egal"], ...inds.map(i => [i, i])], f.ind)}</label>
          <label>Momentum-Rang ab${inp("scMom", f.minMom, "0–100")}</label>
          <label>Höchstens % unter dem Jahreshoch${inp("scHigh", f.maxBelowHigh, "z. B. 10")}</label>
          <label>Analysten Kauf ab %${inp("scBuy", f.minBuy, "z. B. 60")}</label>
          <label>KGV bis${inp("scPe", f.maxPe, "z. B. 25")}</label>
          <label>Umsatzwachstum ab %${inp("scRev", f.minRevG, "z. B. 10")}</label>
          <label>Dividende ab %${inp("scDiv", f.minDiv, "z. B. 3")}</label>
        </div>
        <div class="btn-row" style="margin-top:10px"><button type="button" class="btn ghost" data-act="scApply">Filtern</button><button type="button" class="btn ghost" data-act="scReset">Zurücksetzen</button></div>
      </details>
      <div class="table-wrap" style="margin-top:12px"><table class="scr"><thead><tr>${COLS.map(c => `<th class="${c.num ? "num " : ""}${c.opt ? "opt" : ""}"><button type="button" class="th-btn" data-sort="${c.key}">${c.label}${ui.sort === c.key ? (ui.dir < 0 ? " ↓" : " ↑") : ""}</button></th>`).join("")}</tr></thead>
        <tbody>${rows.slice(0, 120).map(x => `<tr>${COLS.map(c => `<td class="${c.num ? "num " : ""}${c.opt ? "opt" : ""}">${c.cell(x)}</td>`).join("")}</tr>`).join("") || `<tr><td colspan="${COLS.length}" class="muted">Kein Wert erfüllt alle Bedingungen.</td></tr>`}</tbody></table></div>
      ${rows.length > 120 ? `<p class="hint">Gezeigt werden die ersten 120 – enger filtern oder anders sortieren.</p>` : ""}
      <p class="hint">Ein Klick auf das Kürzel öffnet den Aktien-Check mit Diagramm, Kennzahlen und Kauf-Plan. Momentum-Rang: 100 = stärkste Rendite der letzten 12 Monate (ohne den letzten Monat) unter den rund 850 beliebtesten eToro-Werten.</p>
    </article>`;
  }

  // ---------- Quartalszahlen-Kalender ----------
  function calendarCard() {
    if (!stocks) return "";
    const today = new Date().toISOString().slice(0, 10), until = new Date(Date.now() + 28 * 864e5).toISOString().slice(0, 10);
    const mine = new Set(portfolio().map(h => h.sym)), ideas = new Set(swing && swing.setups ? swing.setups.filter(s => ["buy", "wait", "alert"].includes(s.state)).map(s => s.sym) : []);
    const theory = new Set(Object.keys((firms && firms.firms) || {}));
    const pick = { alle: () => true, meine: x => mine.has(x.sym), ideen: x => ideas.has(x.sym), theorie: x => theory.has(x.sym) }[ui.cal] || (() => true);
    const up = stocks.items.filter(x => x.earn && x.earn.date >= today && x.earn.date <= until && pick(x)).sort((a, b) => (a.earn.date < b.earn.date ? -1 : a.earn.date > b.earn.date ? 1 : (b.momRank || 0) - (a.momRank || 0)));
    const days = new Map();
    for (const x of up) { if (!days.has(x.earn.date)) days.set(x.earn.date, []); days.get(x.earn.date).push(x); }
    const HOUR = { bmo: "vor Börsenbeginn", amc: "nach Börsenschluss", dmh: "während des Handels" };
    const row = x => `<div class="cal-row"><button type="button" class="chip-btn" data-open="${esc(x.sym)}">${esc(x.sym)}</button>
        <span class="cal-name">${esc(x.name || "")}${mine.has(x.sym) ? ` <span class="light green">Ihre Aktie</span>` : ""}${ideas.has(x.sym) ? ` <span class="light yellow">Swing-Idee</span>` : ""}</span>
        <span class="muted small">${HOUR[x.earn.hour] || ""}${Number.isFinite(x.earn.eps) ? ` · Gewinn je Aktie erwartet ${fmt(x.earn.eps, 2)}` : ""}${x.lastEarn && Number.isFinite(x.lastEarn.surprisePct) ? ` · letztes Mal ${sign(x.lastEarn.surprisePct, 0)} %` : ""}${Number.isFinite(buyPct(x)) ? ` · ${fmt(buyPct(x), 0)} % Kauf` : ""}</span></div>`;
    const recent = stocks.items.filter(x => x.lastEarn && Number.isFinite(x.lastEarn.surprisePct) && x.lastEarn.date >= new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10) && pick(x))
      .sort((a, b) => Math.abs(b.lastEarn.surprisePct) - Math.abs(a.lastEarn.surprisePct)).slice(0, 12);
    return `<article class="card" data-section="Kalender">
      <div class="card-head"><h2 class="card-title">Quartalszahlen: die nächsten 4 Wochen</h2><span class="muted small">${up.length} Termine</span></div>
      <div class="seg" role="group" aria-label="Auswahl">${[["alle", "Alle"], ["meine", `Meine Aktien (${mine.size})`], ["ideen", "Swing-Ideen"], ["theorie", "Theorie-Firmen"]].map(([k, l]) => `<button type="button" data-cal="${k}" aria-pressed="${ui.cal === k}">${l}</button>`).join("")}</div>
      ${days.size ? `<div class="cal">${[...days.entries()].slice(0, 20).map(([d, xs]) => `<div class="cal-day"><p class="cal-date">${dDate(d)}</p>${xs.map(row).join("")}</div>`).join("")}</div>` : `<p class="muted" style="margin-top:12px">In den nächsten 4 Wochen keine Termine in dieser Auswahl.</p>`}
      ${recent.length ? `<h3 class="swing-h3">Zuletzt gemeldet (14 Tage): größte Überraschungen</h3><div class="chips">${recent.map(x => `<button type="button" class="chip-btn" data-open="${esc(x.sym)}">${esc(x.sym)} ${pc(x.lastEarn.surprisePct, 0)}</button>`).join(" ")}</div>` : ""}
      <p class="hint">Gewinn je Aktie über der Erwartung lässt den Kurs oft noch Wochen nachdriften – bei großen Aktien heute aber schwächer. An Zahlentagen springt der Kurs oft über den Stop hinweg; der Swing-Planer kauft deshalb 10 Tage vorher nicht neu. Die Telefonkonferenzen dazu gibt es live und zum Nachlesen in der Quartr-App.</p>
    </article>`;
  }

  // ---------- Insider-Käufe ----------
  function insiderCard() {
    const has = fund && fund.available && fund.available.insider;
    if (!has) {
      return `<article class="card" data-section="Insider">
        <h2 class="card-title">Insider-Käufe</h2>
        <p class="small">${!fund ? "Die Insider-Daten kommen mit dem ersten nächtlichen Kennzahlen-Lauf." : "Finnhub liefert im aktuellen Tarif keine Insider-Daten."} Bis dahin: ${A("http://openinsider.com/latest-cluster-buys", "OpenInsider – Käufe mehrerer Insider")} (kostenlos, US-Aktien).</p>
      </article>`;
    }
    const map = new Map(stocks ? stocks.items.map(x => [x.sym, x]) : []);
    const list = Object.entries(fund.items).filter(([, v]) => v.ins && v.ins.buys > 0).map(([sym, v]) => ({ sym, x: map.get(sym), ins: v.ins }))
      .sort((a, b) => b.ins.buyers - a.ins.buyers || b.ins.buyVal - a.ins.buyVal).slice(0, 25);
    const rows = list.map(r => `<tr><td><button type="button" class="chip-btn" data-open="${esc(r.sym)}">${esc(r.sym)}</button><div class="muted small scr-name">${esc(r.x ? r.x.name : "")}</div></td>
        <td class="num">${r.ins.buyers}</td><td class="num">${big(r.ins.buyVal)}</td><td class="num opt">${dDate(r.ins.lastBuy)}</td><td class="num opt">${r.ins.sellers}</td>
        <td>${r.x ? (() => { const [l, c] = TREND[trendOf(r.x)]; return `<span class="light ${c}">${l}</span>`; })() : "–"}</td>
        <td class="opt">${A(`http://openinsider.com/screener?s=${encodeURIComponent(r.sym)}`, "Details ↗")}</td></tr>`).join("");
    return `<article class="card" data-section="Insider">
      <div class="card-head"><h2 class="card-title">Insider-Käufe der letzten 90 Tage</h2><span class="muted small">US-Aktien · Stand ${new Date(fund.updated).toLocaleDateString("de-DE")}</span></div>
      <p class="muted small" style="margin:-6px 0 12px">Vorstände und Aufsichtsräte, die mit eigenem Geld am Markt kaufen (SEC-Formular 4, Code P). Laut Forschung haben vor allem gezielte Käufe Aussagekraft, Verkäufe kaum – sie haben oft private Gründe (${A("https://doi.org/10.1111/j.1540-6261.2012.01740.x", "Cohen, Malloy &amp; Pomorski 2012")}).</p>
      ${rows ? `<div class="table-wrap"><table class="scr"><thead><tr><th>Aktie</th><th class="num">Käufer</th><th class="num">gekauft für</th><th class="num opt">letzter Kauf</th><th class="num opt">Verkäufer</th><th>Trend</th><th class="opt">Quelle</th></tr></thead><tbody>${rows}</tbody></table></div>` : `<p class="muted">In den letzten 90 Tagen keine Insider-Käufe in den Aktien dieser Seite.</p>`}
      <p class="hint">Am stärksten gilt ein Kauf mehrerer Insider in einem Aufwärtstrend. Gegen den Trend lieber abwarten.</p>
    </article>`;
  }

  // ---------- Kursalarme ----------
  const alarms = () => { const l = store.get("dtd-alarms", []); return Array.isArray(l) ? l.filter(a => a && SYM.test(a.sym) && Number.isFinite(a.price) && (a.dir === "up" || a.dir === "down")) : []; };
  const saveAlarms = l => store.set("dtd-alarms", l);
  const lastOf = sym => { const x = stocks ? stocks.items.find(y => y.sym === sym) : null; return x ? x : null; };
  const hit = a => { const x = lastOf(a.sym); if (!x) return null; return a.dir === "up" ? (x.hi1d ?? x.last) >= a.price : (x.lo1d ?? x.last) <= a.price; };
  window.DTD.addAlarm = (sym, dir, priceV, note = "") => {
    if (!SYM.test(sym) || !Number.isFinite(priceV)) return false;
    const l = alarms().filter(a => !(a.sym === sym && a.dir === dir && Math.abs(a.price - priceV) < 1e-9));
    l.push({ id: `a${Date.now().toString(36)}`, sym, dir, price: priceV, note: String(note).slice(0, 120), created: new Date().toISOString().slice(0, 10) });
    saveAlarms(l);
    badge();
    return true;
  };
  function alarmCard() {
    const l = alarms();
    const rows = l.map(a => {
      const x = lastOf(a.sym), h = hit(a);
      const dist = x && Number.isFinite(x.last) ? (a.price / x.last - 1) * 100 : null;
      return `<div class="al-row" data-id="${esc(a.id)}"><button type="button" class="chip-btn" data-open="${esc(a.sym)}">${esc(a.sym)}</button>
        <div class="al-text"><b>${a.dir === "up" ? "über" : "unter"} <span class="num">${price(a.price)}</span></b>
          <div class="muted small">Kurs ${x ? price(x.last) : "–"}${Number.isFinite(dist) ? ` · noch ${pc(dist)}` : ""}${a.note ? ` · ${esc(a.note)}` : ""}</div></div>
        ${h === null ? `<span class="muted small">keine Daten</span>` : h ? `<span class="light green">erreicht</span>` : `<span class="light">wartet</span>`}
        <button type="button" class="icon-btn al-del" data-act="alDel" aria-label="Alarm für ${esc(a.sym)} entfernen">✕</button></div>`;
    }).join("");
    return `<article class="card" data-section="Kursalarme">
      <h2 class="card-title">Kursalarme</h2>
      <form id="alForm" class="calc" autocomplete="off">
        <label>Kürzel<input id="alSym" list="alSyms" required placeholder="z. B. PLTR" style="text-transform:uppercase"></label>
        <label>Wenn der Kurs<select id="alDir"><option value="up">über … steigt</option><option value="down">unter … fällt</option></select></label>
        <label>Preis<input id="alPrice" inputmode="decimal" required placeholder="in der Kurswährung"></label>
        <label>Notiz (freiwillig)<input id="alNote" maxlength="120" placeholder="z. B. Ausbruch über das Jahreshoch"></label>
        <div class="btn-row wide"><button type="submit">Alarm setzen</button></div>
      </form>
      <datalist id="alSyms">${stocks ? stocks.items.map(x => `<option value="${esc(x.sym)}">${esc(x.name)}</option>`).join("") : ""}</datalist>
      ${rows ? `<div class="al-list">${rows}</div>` : `<p class="muted" style="margin-top:12px">Noch keine Alarme. Tipp: Bei Ideen im Swing-Planer mit „Kursalarm“ setzt ein Knopf den Alarm gleich richtig.</p>`}
      <p class="hint">Geprüft wird mit den Kursen der Aktien-Daten (zweimal pro Börsentag, mit Tageshoch und -tief). Ist die Seite offen, meldet sie erreichte Alarme auch als Browser-Meldung; die Zahl steht am Reiter „Werkzeuge“. Für Alarme in Echtzeit: den Kurs bei TradingView öffnen und dort die Glocke wählen. Die Alarme bleiben nur in diesem Browser.</p>
    </article>`;
  }

  // ---------- Steuer-Schätzer (Österreich) ----------
  function taxCard() {
    const j = store.get("daytrade-journal-v1", []);
    const trades = (Array.isArray(j) ? j : []).filter(t => t && Number.isFinite(t.in) && Number.isFinite(t.out) && Number.isFinite(t.qty));
    const cur = ($("cCur") && $("cCur").value) || "$";
    const money = v => `${v < 0 ? "−" : ""}${fmt(Math.abs(v), 2)} ${cur}`;
    const years = new Map();
    for (const t of trades) {
      const y = String(t.ts || "").slice(0, 4) || "unbekannt", pl = (t.out - t.in) * t.qty * (t.dir === "Short" ? -1 : 1);
      if (!years.has(y)) years.set(y, { gain: 0, loss: 0, n: 0 });
      const Y = years.get(y); Y.n++; if (pl >= 0) Y.gain += pl; else Y.loss += pl;
    }
    const thisYear = String(new Date().getFullYear());
    const rows = [...years.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 4).map(([y, Y]) => {
      const net = Y.gain + Y.loss, tax = Math.max(0, net) * 0.275;
      return `<tr><td>${esc(y)}${y === thisYear ? " (laufend)" : ""}<div class="muted small">${Y.n} Trades<span class="mob"> · +${fmt(Y.gain, 0)} / −${fmt(-Y.loss, 0)}</span></div></td><td class="num up opt">${money(Y.gain)}</td><td class="num down opt">${money(Y.loss)}</td><td class="num"><b>${money(net)}</b></td><td class="num">${money(tax)}</td></tr>`;
    }).join("");
    const Y = years.get(thisYear), netNow = Y ? Y.gain + Y.loss : 0;
    const losers = stocks ? portfolio().map(h => ({ h, x: lastOf(h.sym) })).filter(r => r.x && r.h.qty && r.x.last < r.h.buy).map(r => ({ sym: r.h.sym, loss: (r.x.last - r.h.buy) * r.h.qty })) : [];
    return `<article class="card" data-section="Steuer">
      <h2 class="card-title">Steuer-Schätzer (Österreich, 27,5 % KESt)</h2>
      <p class="muted small" style="margin:-6px 0 12px">Aus den abgeschlossenen Trades in Ihrem Journal: Gewinne und Verluste je Kalenderjahr und die geschätzte Kapitalertragsteuer, die bei einem nicht steuereinfachen Broker wie eToro über die Beilage E1kv fällig wird.</p>
      ${rows ? `<div class="table-wrap"><table class="scr"><thead><tr><th>Jahr</th><th class="num opt">Gewinne</th><th class="num opt">Verluste</th><th class="num">Saldo</th><th class="num">KESt ca.</th></tr></thead><tbody>${rows}</tbody></table></div>` : `<p class="muted">Noch keine abgeschlossenen Trades im <a href="#journal">Journal</a>.</p>`}
      ${netNow > 0 && losers.length ? `<p class="small" style="margin-top:12px"><b>Vor dem 31.12. prüfen:</b> Ihr Portfolio hat Positionen im Minus (${losers.map(l => `${esc(l.sym)} ${fmt(l.loss, 0)}`).join(", ")} in Kurswährung). Ein Verkauf noch in diesem Jahr würde den Gewinn des Jahres mindern – Verluste lassen sich nur im selben Kalenderjahr verrechnen. Nur verkaufen, wenn die Aktie ohnehin nicht mehr überzeugt.</p>` : ""}
      <p class="hint">Grobe Schätzung: Dividenden, ausländische Quellensteuer, Währungsgewinne, Ausschüttungen von ETFs (auch ausschüttungsgleiche Erträge) und Nicht-Meldefonds sind nicht enthalten. Bankzinsen werden mit 25 % besteuert. eToro stellt einen Jahres-Steuerbericht mit Hinweisen für Österreich bereit (${A("https://etoro.com/about/tax-report-faq-for-austrian-residents", "eToro: Steuerbericht für Österreich")}). Keine Steuerberatung.</p>
    </article>`;
  }

  // ---------- Was sich nicht nachbauen lässt ----------
  function moreCard() {
    const item = (t, body) => `<li><b>${t}</b> ${body}</li>`;
    return `<article class="card" data-section="Mehr">
      <h2 class="card-title">Weitere Werkzeuge – direkt beim Anbieter</h2>
      <ul class="checklist">
        ${item("Telefonkonferenzen zu Quartalszahlen:", `live und als Mitschrift in der kostenlosen ${A("https://quartr.com/app", "Quartr-App")} – Ton und Mitschriften lassen sich nicht frei einbinden.`)}
        ${item("Was große Investoren halten:", `${A("https://dataroma.com/", "Dataroma")} zeigt die Depots bekannter Investoren aus den Pflichtmeldungen (bis zu 45 Tage verzögert). Im Aktien-Check führt ein Link direkt zur jeweiligen Aktie.`)}
        ${item("Kursalarme in Echtzeit:", `${A("https://www.tradingview.com/", "TradingView")} (kostenloses Konto) – hier auf der Seite prüft der Alarm zweimal pro Börsentag.`)}
        ${item("Depot über mehrere Broker:", `${A("https://www.portfolio-performance.info/", "Portfolio Performance")} (kostenlos, am Computer) – sobald echtes Geld bei mehreren Anbietern liegt.`)}
        ${item("ETF-Mischungen zurückrechnen:", `${A("https://curvo.eu/backtest/", "Curvo Backtest")} (kostenlos, europäische ETFs).`)}
      </ul>
    </article>`;
  }

  // ---------- Anzeige ----------
  function render() {
    const host = $("toolsBody");
    if (!host || $("tools").hidden) { badge(); return; }
    const kept = ["scQ", "alSym", "alPrice", "alNote"].reduce((o, id) => { const el = $(id); if (el && el.value) o[id] = el.value; return o; }, {});
    host.innerHTML = (stocks ? "" : `<article class="card"><p class="muted">${loading ? "Lade die Aktien-Daten …" : "Noch keine Aktien-Daten vorhanden."}</p></article>`)
      + screenerCard() + calendarCard() + insiderCard() + alarmCard() + taxCard() + moreCard();
    for (const [id, v] of Object.entries(kept)) if ($(id)) $(id).value = v;
    badge();
    window.dispatchEvent(new Event("dtd:sections"));
  }
  function readFilters() {
    const v = id => ($(id) ? $(id).value : "");
    return { q: v("scQ"), type: v("scType"), region: v("scRegion"), trend: v("scTrend"), theory: v("scTheory"), ind: v("scInd"),
      minMom: num(v("scMom")), maxBelowHigh: num(v("scHigh")), minBuy: num(v("scBuy")), maxPe: num(v("scPe")), minRevG: num(v("scRev")), minDiv: num(v("scDiv")) };
  }
  document.addEventListener("click", e => {
    const host = $("toolsBody");
    const b = e.target.closest("[data-preset],[data-sort],[data-cal],[data-act],[data-open]");
    if (!b || !host || !host.contains(b)) return;
    if (b.dataset.open) return open(b.dataset.open);
    if (b.dataset.preset) { ui.preset = b.dataset.preset; ui.custom = null; saveUi(); return render(); }
    if (b.dataset.sort) { ui.dir = ui.sort === b.dataset.sort ? -ui.dir : (b.dataset.sort === "sym" ? 1 : -1); ui.sort = b.dataset.sort; saveUi(); return render(); }
    if (b.dataset.cal) { ui.cal = b.dataset.cal; saveUi(); return render(); }
    if (b.dataset.act === "scApply") { ui.custom = readFilters(); ui.preset = "all"; return render(); }
    if (b.dataset.act === "scReset") { ui.custom = null; ui.preset = "momentum"; saveUi(); return render(); }
    if (b.dataset.act === "alDel") { const id = b.closest("[data-id]").dataset.id; saveAlarms(alarms().filter(a => a.id !== id)); return render(); }
  });
  document.addEventListener("submit", e => {
    if (e.target.id !== "alForm") return;
    e.preventDefault();
    const sym = $("alSym").value.trim().toUpperCase(), p = num($("alPrice").value);
    if (!SYM.test(sym) || !(p > 0)) return toast("Kursalarm", "Bitte Kürzel und Preis eintragen.", 5000);
    window.DTD.addAlarm(sym, $("alDir").value, p, $("alNote").value.trim());
    $("alSym").value = ""; $("alPrice").value = ""; $("alNote").value = "";
    toast("Kursalarm", `${sym}: Alarm gesetzt.`, 4000);
    render();
  });
  // erreichte Alarme: Zahl am Reiter und (wenn erlaubt) Browser-Meldung, je Alarm nur einmal
  function badge() {
    const n = stocks ? alarms().filter(a => hit(a)).length : 0, b = $("toolsBadge");
    if (b) { b.textContent = String(n); b.hidden = !n; }
    if (!stocks) return;
    const seen = new Set(store.get("dtd-alarms-seen", []));
    const fresh = alarms().filter(a => hit(a) && !seen.has(a.id));
    if (fresh.length && "Notification" in window && Notification.permission === "granted") {
      for (const a of fresh.slice(0, 5)) { try { new Notification(`RojkoMoney: ${a.sym}`, { body: `Kurs ${a.dir === "up" ? "über" : "unter"} ${price(a.price)} – Alarm erreicht.`, icon: "icons/icon-192.png", tag: a.id }); } catch { /* Handy-Browser ohne Meldungen */ } }
    }
    store.set("dtd-alarms-seen", alarms().filter(a => hit(a)).map(a => a.id));
  }

  async function load(force = false) {
    if (loading || (stocks && !force)) { if (stocks) render(); return; }
    loading = true;
    if (!stocks) render();
    const t = Date.now();
    const shared = !force && window.DTD.stockData ? window.DTD.stockData() : null;
    const [s1, s2, f1, w1, fi] = await Promise.all([
      shared ? Promise.resolve(shared) : get(`data/stocks.json?t=${t}`), shared ? Promise.resolve(null) : get(`${RAW}stock-data/stocks.json?t=${t}`),
      get(`${RAW}fund-data/fund.json?t=${t}`), get(`${RAW}stock-data/swing.json?t=${t}`), firms ? Promise.resolve(firms) : get(`data/firms.json?t=${t}`),
    ]);
    const s = newest([s1, s2]);
    if (s && Array.isArray(s.items)) stocks = s;
    if (f1 && f1.items) fund = f1;
    if (w1 && Array.isArray(w1.setups)) swing = w1;
    if (fi && fi.firms) firms = fi;
    loading = false;
    render();
  }
  window.DTD.startTools = () => load(false);
  window.DTD.reloadTools = () => load(true);
  window.DTD.alarmCount = () => alarms().length;
  // Kennzahlen für den Aktien-Check (wird nach dem Zeichnen der Aktie aufgerufen)
  window.DTD.fundData = async () => { if (!fund) { const f = await get(`${RAW}fund-data/fund.json?t=${Date.now()}`); if (f && f.items) fund = f; } return fund; };
  if (alarms().length) setTimeout(() => load(false), 2000);
})();

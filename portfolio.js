// ---------- Portfolio: eigene Aktien mit Kaufpreis – Gewinn/Verlust, Risiko, halten oder raus, Ausstiegs-Plan, Nachrichten ----------
// Unter den Aktien steht das Trade-Journal (app.js), darunter Steuer-Schätzer, Sichern und Regeln (#portfolioExtra).
// Der Bestand bleibt nur in diesem Browser (localStorage, Schlüssel dtd-portfolio) – er wird nirgends hochgeladen, auch nicht ins
// öffentliche Repository. Kennzahlen: stocks.json (eToro-Kurse, Trend, Schwankung, Analysten, Quartalszahlen; 2× pro Börsentag),
// swing.json (Zustand im Swing-Planer), data/firms.json (Theorie-Steckbriefe). Nachrichten: TradingView je Kürzel.
// Regeln wie im Swing-Planer: Aufwärtstrend = über dem 200-Tage-Schnitt, 50er darüber, Momentum positiv; Stop 3 Tagesspannen (ATR).
(() => {
  const KEY = "dtd-portfolio", SEEN = "dtd-portfolio-seen";
  const sign = (x, d = 1) => (Number.isFinite(x) ? (x > 0 ? "+" : "") + fmt(x, d) : "–");
  const pc = (x, d = 1) => (Number.isFinite(x) ? `<span class="${x < 0 ? "down" : "up"}">${sign(x, d)} %</span>` : "–");
  const price = x => (!Number.isFinite(x) ? "–" : x >= 1000 ? fmt(x, 0) : x >= 1 ? fmt(x, 2) : fmt(x, 4));
  const px = x => (!Number.isFinite(x) ? null : x >= 1 ? Math.round(x * 100) / 100 : Math.round(x * 10000) / 10000);
  const dDate = iso => (iso ? new Date(`${String(iso).slice(0, 10)}T12:00:00Z`).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }) : "–");
  const num = s => { const v = parseFloat(String(s ?? "").trim().replace(/\s/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".")); return Number.isFinite(v) ? v : null; };
  const SYM = /^[A-Z0-9][A-Z0-9.\-_]{0,19}$/;
  // Währung aus dem Börsenkürzel; Londoner Werte notieren teils in Pence, teils in Dollar – dort keine Angabe
  const CUR = { DE: "EUR", PA: "EUR", AS: "EUR", MI: "EUR", MC: "EUR", BR: "EUR", LS: "EUR", HE: "EUR", VI: "EUR", NV: "EUR", ZU: "CHF", SW: "CHF", CO: "DKK", ST: "SEK", OL: "NOK", HK: "HKD", T: "JPY", KS: "KRW", KQ: "KRW" };
  const currency = sym => { const m = /\.([A-Z]+)$/.exec(sym); return m ? CUR[m[1]] || "" : "USD"; };
  const money = (v, sym) => (Number.isFinite(v) ? `${v < 0 ? "−" : v > 0 ? "+" : ""}${fmt(Math.abs(v), 2)}${currency(sym) ? ` ${currency(sym)}` : ""}` : "–");

  // Nachkäufe und Teilverkäufe: lots = Käufe {q Stück, p Preis, d Datum}, sells = Verkäufe. Kaufpreis und Stück der Position
  // ergeben sich daraus nach dem gleitenden Durchschnittspreis (so rechnet die österreichische KESt je Depot): ein Kauf mischt den
  // Durchschnitt neu, ein Verkauf ändert ihn nicht.
  const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
  const okTrade = l => l && Number.isFinite(l.q) && l.q > 0 && Number.isFinite(l.p) && l.p > 0;
  // t = Zeitpunkt der Eingabe: ordnet Käufe und Verkäufe am selben Tag in der Reihenfolge, in der sie eingetragen wurden;
  // s = Depot, aus dem der Eintrag importiert wurde (tr Trade Republic, sc Scalable Capital, ot anderes) – fehlt bei Handeingaben
  const cleanTrades = a => (Array.isArray(a) ? a.filter(okTrade).map(l => ({ q: l.q, p: l.p, d: DAY_RE.test(l.d || "") ? l.d : null, t: Number.isFinite(l.t) ? l.t : 0,
    ...(/^[a-z]{2}$/.test(l.s || "") ? { s: l.s } : {}) })) : []);
  const DEPOT = { tr: "Trade Republic", sc: "Scalable Capital", ot: "anderes Depot" };
  function avgAt(h, until = null) {
    const ev = [...h.lots.map((l, i) => ({ ...l, k: "b", i })), ...(h.sells || []).map((s, i) => ({ ...s, k: "s", i: 1e4 + i }))]
      .filter(e => !until || !e.d || e.d <= until)
      .sort((a, b) => ((a.d || "") < (b.d || "") ? -1 : (a.d || "") > (b.d || "") ? 1 : (a.t || 0) - (b.t || 0) || a.i - b.i));
    let held = 0, avg = 0;
    for (const e of ev) { if (e.k === "b") { avg = (held * avg + e.q * e.p) / (held + e.q); held += e.q; } else held = Math.max(0, held - e.q); }
    return { held: Math.round(held * 1e6) / 1e6, avg };
  }
  function derive(h) {
    if (!h.lots || !h.lots.length) return h;
    const a = avgAt(h);
    return { ...h, buy: px(a.avg) || h.buy, qty: a.held > 0 ? a.held : null, date: h.lots.map(l => l.d).filter(Boolean).sort()[0] || h.date };
  }
  // ---------- Depot in Euro: EZB-Referenzkurse (fx-data/fx.json, Einheiten je 1 Euro) ----------
  // Kaufkosten zum Kurs am Kauftag (je Kauf, gleitender Durchschnitt wie bei der KESt), Wert zum letzten Kurs. Ohne Kaufdatum
  // gilt der letzte Kurs – dann bleibt der Währungseffekt unbekannt. London-Werte (Pence oder Dollar) bleiben außen vor.
  const fxData = () => (window.DTD.shared ? window.DTD.shared.get("fx") : null);
  function rateOn(cur, iso) {
    if (cur === "EUR") return 1;
    const fx = fxData(), r = fx && fx.rates && fx.rates[cur];
    if (!r || !fx.dates.length) return null;
    const day = iso && DAY_RE.test(iso) ? iso : fx.dates[fx.dates.length - 1];
    if (day < fx.dates[0]) return null;
    let lo = 0, hi = fx.dates.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (fx.dates[mid] <= day) lo = mid; else hi = mid - 1; }
    for (let i = lo; i >= 0; i--) if (r[i] > 0) return r[i];
    return null;
  }
  // Euro-Werte einer Position: Wert, Kosten, Ergebnis, Kurs- und Währungseffekt (null, wenn Stück, Kurs oder Wechselkurs fehlen)
  function euro(h, x) {
    const cur = currency(h.sym);
    if (!cur || !x || !Number.isFinite(x.last) || !(h.qty > 0)) return null;
    const now = rateOn(cur, null);
    if (!now) return null;
    let costEur = 0, held = 0, dated = true;
    const lots = h.lots && h.lots.length ? h.lots : [{ q: h.qty, p: h.buy, d: h.date }];
    const ev = [...lots.map((l, i) => ({ ...l, k: "b", i })), ...(h.sells || []).map((v, i) => ({ ...v, k: "s", i: 1e4 + i }))]
      .sort((a, b) => ((a.d || "") < (b.d || "") ? -1 : (a.d || "") > (b.d || "") ? 1 : (a.t || 0) - (b.t || 0) || a.i - b.i));
    for (const e of ev) {
      if (e.k === "b") { const r = rateOn(cur, e.d) || now; if (!e.d && cur !== "EUR") dated = false; costEur += e.q * e.p / r; held += e.q; }
      else if (held > 0) { const q = Math.min(e.q, held); costEur *= (held - q) / held; held -= q; }
    }
    if (!(held > 0) || !(costEur > 0)) return null;
    const value = h.qty * x.last / now, costLocal = h.qty * h.buy, buyRate = costLocal / costEur;
    const gain = value - costEur, fxEffect = cur === "EUR" || !dated ? 0 : h.qty * x.last * (1 / now - 1 / buyRate);
    return { cur, value, cost: costEur, gain, stock: gain - fxEffect, fx: fxEffect, dated, pct: (value / costEur - 1) * 100 };
  }
  const eur = (v, sign = false) => (Number.isFinite(v) ? `${sign ? (v < 0 ? "−" : v > 0 ? "+" : "±") : v < 0 ? "−" : ""}${fmt(Math.abs(v), Math.abs(v) >= 1000 ? 0 : 2)} €` : "–");
  let list = read(), stocks = null, swing = null, firms = null, loading = false, editId = null;
  const open = { exit: new Set(), news: new Set(), chart: new Set() };
  function read() {
    const raw = store.get(KEY, []);
    return (Array.isArray(raw) ? raw : []).filter(h => h && typeof h.sym === "string" && SYM.test(h.sym) && Number.isFinite(h.buy) && h.buy > 0)
      .map((h, i) => {
        const o = { id: String(h.id || `p${Date.now().toString(36)}${i}`), sym: h.sym, buy: h.buy, qty: Number.isFinite(h.qty) && h.qty > 0 ? h.qty : null,
          date: DAY_RE.test(h.date || "") ? h.date : null, stop: Number.isFinite(h.stop) && h.stop > 0 ? h.stop : null, note: String(h.note || "").slice(0, 200) };
        const lots = cleanTrades(h.lots), sells = cleanTrades(h.sells);
        if (lots.length) { o.lots = lots; if (sells.length) o.sells = sells; return derive(o); }
        return o;
      });
  }
  // erste Aktion an einer Position ohne Kaufliste: bisherigen Kauf als ersten Eintrag übernehmen
  const withLots = h => (h.lots && h.lots.length ? h : { ...h, lots: [{ q: h.qty, p: h.buy, d: h.date, t: 0 }], sells: [] });
  let trade = null;   // offenes Formular { id, kind: "buy" | "sell" }
  const save = () => store.set(KEY, list);
  const item = sym => (stocks ? stocks.items.find(x => x.sym === sym) : null);
  const profile = sym => (firms && firms.firms ? firms.firms[sym] : null);
  const plan = sym => (swing && Array.isArray(swing.setups) ? swing.setups.find(s => s.sym === sym) : null);

  // ---------- Regeln ----------
  const avgFrom = (last, d) => (Number.isFinite(last) && Number.isFinite(d) ? last / (1 + d / 100) : null);
  function trend(x) {
    const s50 = avgFrom(x.last, x.d50), s200 = avgFrom(x.last, x.d200);
    if (![x.last, x.atr, s50, s200].every(Number.isFinite) || !(x.atr > 0)) return { kind: "nodata", s50, s200 };
    if (x.d200 > 0 && s50 > s200 && x.mom > 0) return { kind: "up", s50, s200 };
    if (x.d200 < 0 && (s50 < s200 || x.mom < 0)) return { kind: "down", s50, s200 };
    return { kind: "flat", s50, s200 };
  }
  // Risiko: Schwankung, größter Rückgang im Jahr und Beta je 0–3 Punkte, spekulative Firmen +2
  function risk(x, f) {
    const pts = (v, cuts) => (Number.isFinite(v) ? cuts.filter(c => v > c).length : 1);
    const vol = Number.isFinite(x.vol60) ? x.vol60 : x.vol20, spec = Boolean(f && f.role === "spec");
    const p = pts(vol, [25, 40, 60]) + pts(x.mdd, [20, 35, 50]) + pts(x.beta, [0.8, 1.2, 1.6]) + (spec ? 2 : 0);
    const [label, cls, plain] = p <= 2 ? ["Solide", "green", "eher ein sicheres Ding"] : p <= 5 ? ["Mittel", "yellow", "normales Aktienrisiko"] : ["Riskant", "red", "kann schnell viel verlieren"];
    const why = [
      Number.isFinite(vol) ? `schwankt ${fmt(vol, 0)} % im Jahr` : null,
      Number.isFinite(x.mdd) ? `größter Rückgang in 12 Monaten −${fmt(x.mdd, 0)} %` : null,
      Number.isFinite(x.beta) ? `bewegt sich etwa ${fmt(x.beta, 1)}-mal so stark wie der S&P 500` : null,
      spec ? "auf der Theorie-Seite als spekulativ eingestuft" : null,
    ].filter(Boolean);
    return { label, cls, plain, why, p };
  }
  function verdict(h, x) {
    const t = trend(x);
    if (t.kind === "nodata") return null;
    // Stop: 3 Tagesspannen unter dem Kurs – liegt der 200-Tage-Schnitt näher (darunter wird ohnehin verkauft), knapp darunter
    const at200 = t.s200 - 0.5 * x.atr, base = x.last - 3 * x.atr;
    const pl = (x.last / h.buy - 1) * 100, ext = (x.last - t.s50) / x.atr, stop = px(at200 < x.last ? Math.max(base, at200) : base);
    if (t.kind === "down") return { key: "sell", label: "Verkauf prüfen", cls: "red", stop, s200: t.s200, text: `Der Kurs liegt unter dem 200-Tage-Schnitt (${price(t.s200)}) und der Trend fällt. Nach den Regeln der Seite ist das ein Ausstieg – auch der Swing-Planer verkauft hier.` };
    if (t.kind === "up" && ext > 3 && pl >= 20) return { key: "secure", label: "Halten, Gewinne sichern", cls: "green", stop, s200: t.s200, text: `Starker Aufwärtstrend, aber überhitzt (${fmt(ext, 1)} Tagesspannen über dem 50-Tage-Schnitt). Stop nachziehen; wer will, verkauft ein Drittel und lässt den Rest laufen.` };
    if (t.kind === "up") return { key: "hold", label: "Halten", cls: "green", stop, s200: t.s200, text: "Aufwärtstrend intakt: über dem 200-Tage-Schnitt, der 50er darüber, Momentum positiv. Halten und den Stop mitziehen." };
    return { key: "holdstop", label: "Halten mit Stop", cls: "yellow", stop, s200: t.s200, text: `Trend unklar. Halten, aber mit Stop – fällt der Kurs unter den 200-Tage-Schnitt (${price(t.s200)}) und dreht das Momentum, verkaufen.` };
  }
  // Hinweise: Ereignisse (mit Datum, einmal je Tag) und Zustände (melden sich einmal, bis sie vorbei sind)
  function alerts(h, x) {
    if (!x) return [];
    const out = [], add = (key, level, text) => out.push({ key: `${h.sym}:${key}`, level, text });
    const t = trend(x), pl = (x.last / h.buy - 1) * 100;
    if (x.chg1d <= -5) add(`drop:${x.asOf}`, "high", `Kurs ${sign(x.chg1d)} % am letzten Handelstag – Nachrichten prüfen.`);
    else if (x.chg1d >= 7) add(`jump:${x.asOf}`, "info", `Kurssprung ${sign(x.chg1d)} % am letzten Handelstag – Nachrichten prüfen.`);
    if (t.kind === "down") add("trend", "high", "Trend gebrochen: unter dem 200-Tage-Schnitt – Verkauf prüfen.");
    if (h.stop && x.last <= h.stop) add(`stop:${h.stop}`, "high", `Kurs ${price(x.last)} liegt unter Ihrem Stop ${price(h.stop)} – bei eToro wäre die Position damit geschlossen worden. Prüfen Sie, ob sie noch offen ist.`);
    else if (h.stop && x.last <= h.stop * 1.03) add(`nearstop:${h.stop}`, "warn", `Kurs nur ${fmt((x.last / h.stop - 1) * 100, 1)} % über Ihrem Stop ${price(h.stop)}.`);
    const earnIn = x.earn && x.earn.date ? Math.round((Date.parse(`${x.earn.date}T12:00:00Z`) - Date.now()) / 864e5) : null;
    if (earnIn !== null && earnIn >= 0 && earnIn <= 7) add(`earn:${x.earn.date}`, "info", `Quartalszahlen am ${dDate(x.earn.date)} – der Kurs kann stark springen.`);
    const total = r => (r ? r.sb + r.b + r.h + r.s + r.ss : 0), buy = r => (total(r) ? (r.sb + r.b) / total(r) : null);
    if (x.rec && x.recPrev && total(x.rec) >= 5 && total(x.recPrev) >= 5 && buy(x.rec) - buy(x.recPrev) <= -0.1) add(`down:${x.rec.period}`, "warn", `Analysten skeptischer: ${fmt((buy(x.rec) - buy(x.recPrev)) * 100, 0)} Punkte weniger Kaufempfehlungen als im Vormonat.`);
    if (pl <= -20) add("loss20", "warn", `Minus ${fmt(-pl, 0)} % seit dem Kauf – Plan prüfen: Gilt die Theorie noch?`);
    if (pl >= 50) add("gain50", "info", `Plus ${fmt(pl, 0)} % seit dem Kauf – Stop nachziehen, Gewinne sichern?`);
    if (x.dHi52 >= -0.5) add(`high:${x.asOf}`, "info", "Neues Jahreshoch – Stop nachziehen.");
    return out;
  }
  // Ausstiegs-Plan, wenn der Besitzer raus will
  function exitPlan(h, x, v) {
    const a = x.atr, pl = (x.last / h.buy - 1) * 100, amt = h.qty ? (x.last - h.buy) * h.qty : null;
    const dropped = x.chg1d <= -3 || x.ret1m <= -10;
    const best = v && v.key === "sell" ? (dropped ? "bounce" : "now") : "staged";
    const opt = (key, title, body) => `<div class="exit-opt${key === best ? " best" : ""}"><p class="exit-title"><b>${title}</b>${key === best ? ` <span class="light green">Empfehlung</span>` : ""}</p>${body}</div>`;
    const res = `${pc(pl)}${amt !== null ? ` (${money(amt, h.sym)})` : ""}`;
    return `<div class="exit-plan">
      <p class="small"><b>Ausstiegs-Plan</b> – ${v && v.key === "sell" ? "die Regeln sagen ohnehin: raus." : "die Regeln sagen eigentlich halten; wenn Sie trotzdem raus wollen, am besten gestaffelt."} Stand Kurs ${price(x.last)} vom ${dDate(x.asOf)}.</p>
      ${opt("now", "1 · Sofort ganz raus", `<ol class="steps"><li>eToro → Portfolio → Position → <b>„Schließen“</b> (ganze Position).</li><li>Ergebnis jetzt etwa ${res}.</li></ol>`)}
      ${opt("staged", "2 · Gestaffelt raus", `<ol class="steps"><li>Die Hälfte jetzt verkaufen: <b>„Schließen“ → „Teilweise schließen“</b>, 50 %.</li><li>Für den Rest: <b>Stop Loss ${price(px(x.last - 2 * a))}</b> (${pc(-2 * a / x.last * 100)}) mit Häkchen bei „Trailing Stop Loss“ und <b>Take Profit ${price(px(x.last + 2 * a))}</b> (${pc(2 * a / x.last * 100)}). Was zuerst kommt, beendet den Trade.</li></ol>`)}
      ${dropped ? opt("bounce", "3 · Nicht am Tief verkaufen: Erholung abwarten", `<ol class="steps"><li>Nach dem Rückgang (${pc(x.chg1d)} am letzten Tag, ${pc(x.ret1m)} im Monat) nicht in Panik verkaufen.</li><li><b>Take Profit ${price(px(x.last + a))}</b> (${pc(a / x.last * 100)}) und <b>Stop Loss ${price(px(x.last - 1.5 * a))}</b> (${pc(-1.5 * a / x.last * 100)}) setzen – so sind Sie in wenigen Tagen draußen, bei einer Erholung zu einem besseren Kurs.</li></ol>`) : ""}
      <p class="hint">Steuer (Österreich): Auf Gewinne fallen 27,5 % KESt an – bei eToro führen Sie sie selbst über die Beilage E1kv ab. Verluste lassen sich nur mit Gewinnen desselben Kalenderjahres verrechnen: Ein Verkauf mit Verlust vor dem 31.12. kann Steuern auf andere Gewinne senken. Keine Steuerberatung.</p>
    </div>`;
  }

  // Diagramm: Kurs-Leiter mit Kaufpreis, Stops und Durchschnitten, darunter die Tageskerzen der letzten 12 Monate
  function chartBlock(h, x, v, tv) {
    const t = x ? trend(x) : {};
    const ladder = x && window.DTD.levelLadder ? window.DTD.levelLadder([
      { label: "Kurs jetzt", v: x.last, kind: "now", from: h.buy },
      { label: "Ihr Kauf", v: h.buy, kind: "buy" },
      v ? { label: v.key === "sell" ? "Stop, wer hält" : "Stop-Vorschlag", v: v.stop, kind: "stop" } : null,
      h.stop ? { label: "Ihr Stop", v: h.stop, kind: "stop" } : null,
      { label: "50-Tage-Schnitt", v: t.s50, kind: "avg" },
      { label: "200-Tage-Schnitt", v: t.s200, kind: "avg" },
      { label: "52-Wochen-Hoch", v: x.hi52, kind: "range" },
      { label: "52-Wochen-Tief", v: x.lo52, kind: "range" },
    ], `Wo der Kurs steht · Schlusskurs vom ${dDate(x.asOf)}`) : "";
    return `<div class="pf-chart">${ladder}<div class="big-chart" id="pfChart-${esc(h.id)}" data-tv="${esc(tv)}"></div>
      <p class="small muted">Tageskerzen der letzten 12 Monate, live von TradingView. Die 50- und 200-Tage-Linie und Ihre Marken stehen in der Leiste darüber.</p></div>`;
  }

  // ---------- Anzeige ----------
  function card(h) {
    const x = item(h.sym), f = profile(h.sym), s = plan(h.sym);
    const v = x ? verdict(h, x) : null, r = x ? risk(x, f) : null, A = alerts(h, x);
    const pl = x ? (x.last / h.buy - 1) * 100 : null, amt = x && h.qty ? (x.last - h.buy) * h.qty : null;
    const name = (x && x.name) || (f && f.name) || "";
    const tv = (x && x.tv) || (f && f.tv) || h.sym;
    const total = q => (q ? q.sb + q.b + q.h + q.s + q.ss : 0);
    const view = x ? [
      x.rec && total(x.rec) >= 3 ? `Analysten: ${fmt((x.rec.sb + x.rec.b) / total(x.rec) * 100, 0)} % Kauf, ${fmt(x.rec.h / total(x.rec) * 100, 0)} % Halten, ${fmt((x.rec.s + x.rec.ss) / total(x.rec) * 100, 0)} % Verkauf (${total(x.rec)})` : null,
      Number.isFinite(x.momRank) ? `Momentum-Rang ${x.momRank} von 100 unter den beliebtesten eToro-Werten` : null,
      s ? `Swing-Planer: ${{ buy: "Kaufzone", wait: "Rücksetzer abwarten", alert: "Kursalarm", watch: "beobachten", avoid: "Finger weg" }[s.state] || s.state}` : null,
      f ? `Theorie-Seite: ${{ leader: "Marktführer", supplier: "Zulieferer", challenger: "Herausforderer", spec: "spekulativ" }[f.role] || ""}` : null,
    ].filter(Boolean) : [];
    return `<article class="pf-card" data-id="${esc(h.id)}">
      <div class="idea-head"><button type="button" class="idea-sym" data-open="${esc(h.sym)}">${esc(h.sym)}</button><button type="button" class="name-link muted small idea-name" data-open="${esc(h.sym)}">${esc(name || "Aktienübersicht")}</button>
        ${v ? `<span class="light ${v.cls}">${v.label}</span>` : `<span class="light">Keine Daten</span>`}</div>
      <div class="pf-nums">
        <span>${h.lots && h.lots.length > 1 ? "Ø Kauf" : "Kauf"} <b class="num">${price(h.buy)}</b>${h.qty ? ` · ${fmt(h.qty, h.qty % 1 ? 2 : 0)} Stück` : ""}${h.lots && h.lots.length > 1 ? ` <span class="muted">(${h.lots.length} Käufe)</span>` : ""}</span>
        <span>Jetzt <b class="num">${x ? price(x.last) : "–"}</b>${x ? ` <span class="muted">(${dDate(x.asOf)})</span>` : ""}</span>
        <span>Ergebnis <b class="num">${x ? pc(pl) : "–"}</b>${amt !== null ? ` <span class="num">${money(amt, h.sym)}</span>` : ""}</span>
        ${r ? `<span>Risiko <span class="light ${r.cls}">${r.label}</span></span>` : ""}
        ${(() => { const e = euro(h, x); return e ? `<span class="pf-eur">In Euro: Wert <b class="num">${eur(e.value)}</b> · Ergebnis <b class="num ${e.gain < 0 ? "down" : "up"}">${eur(e.gain, true)}</b>${e.cur !== "EUR" && e.dated ? ` <span class="muted">(Kurs ${eur(e.stock, true)}, Währung ${eur(e.fx, true)})</span>` : ""}</span>` : ""; })()}
      </div>
      ${A.length ? `<ul class="pf-alerts">${A.map(a => `<li class="${a.level}">${a.text}</li>`).join("")}</ul>` : ""}
      ${v ? `<p class="small"><b>Einschätzung:</b> ${v.text} ${v.key === "sell" ? "Wer trotzdem hält: Stop" : "Stop-Vorschlag:"} <b class="num">${price(v.stop)}</b> (${pc((v.stop / x.last - 1) * 100)})${v.stop > h.buy ? " – sichert schon Gewinn" : ""}, bei eToro mit „Trailing Stop Loss“.</p>` : `<p class="small muted">Für ${esc(h.sym)} gibt es keine Kennzahlen – der Wert ist nicht unter den rund 850 beliebtesten bei eToro. Nachrichten und Kurs gibt es trotzdem.</p>`}
      ${r ? `<p class="small"><b>Wie die Aktie gesehen wird:</b> ${r.label} – ${r.plain}: ${r.why.join(", ")}.${view.length ? ` ${view.join(" · ")}.` : ""}</p>` : ""}
      ${f ? `<p class="small muted"><b>Theorie:</b> ${esc(f.why)}</p>` : ""}
      ${h.note ? `<p class="small muted">Notiz: ${esc(h.note)}</p>` : ""}
      <div class="btn-row pf-actions">
        ${x ? `<button type="button" class="btn ghost" data-act="exit" aria-expanded="${open.exit.has(h.id)}">Ich will raus – Plan</button>` : ""}
        <button type="button" class="btn ghost" data-act="chart" aria-expanded="${open.chart.has(h.id)}">Diagramm</button>
        <button type="button" class="btn ghost" data-act="news" aria-expanded="${open.news.has(h.id)}">Nachrichten</button>
        <a class="btn ghost" href="https://www.tradingview.com/symbols/${encodeURIComponent(tv.replace(":", "-"))}/" target="_blank" rel="noopener noreferrer">Kurs live ↗</a>
        <button type="button" class="btn ghost" data-act="lotbuy" aria-expanded="${!!(trade && trade.id === h.id && trade.kind === "buy")}">Nachkauf</button>
        <button type="button" class="btn ghost" data-act="lotsell" aria-expanded="${!!(trade && trade.id === h.id && trade.kind === "sell")}">Teilverkauf</button>
        <button type="button" class="btn ghost" data-act="edit">Bearbeiten</button>
        <button type="button" class="btn ghost" data-act="del">Entfernen</button>
      </div>
      ${trade && trade.id === h.id ? tradeForm(h, x) : ""}
      ${h.lots && (h.lots.length > 1 || (h.sells && h.sells.length)) ? tradeLog(h) : ""}
      ${open.chart.has(h.id) ? chartBlock(h, x, v, tv) : ""}
      ${x && open.exit.has(h.id) ? exitPlan(h, x, v) : ""}
      ${open.news.has(h.id) ? `<div class="pf-news-list" data-news-fill="${esc(h.sym)}"></div><div class="pf-news" id="pfNews-${esc(h.id)}" data-tv="${esc(tv)}"></div>
        <p class="small muted">Mehr: <a href="https://www.tradingview.com/symbols/${encodeURIComponent(tv.replace(":", "-"))}/news/" target="_blank" rel="noopener noreferrer">alle Nachrichten bei TradingView ↗</a> · <a href="https://news.google.com/search?q=${encodeURIComponent(`${name || h.sym} Aktie`)}&hl=de&gl=AT&ceid=AT:de" target="_blank" rel="noopener noreferrer">deutsche Nachrichten bei Google News ↗</a></p>` : ""}
    </article>`;
  }
  function tradeForm(h, x) {
    const sell = trade.kind === "sell", today = new Date().toISOString().slice(0, 10);
    if (!(h.qty > 0)) return `<p class="small pf-trade-note">Für ${sell ? "einen Teilverkauf" : "einen Nachkauf"} braucht die Position eine Stückzahl – bitte zuerst über „Bearbeiten“ eintragen.</p>`;
    return `<form class="pf-trade calc" data-id="${esc(h.id)}" data-kind="${trade.kind}" autocomplete="off">
      <label>${sell ? "Verkaufte Stück" : "Gekaufte Stück"}<input name="q" inputmode="decimal" required placeholder="${sell ? `höchstens ${fmt(h.qty, h.qty % 1 ? 2 : 0)}` : "z. B. 5"}"></label>
      <label>${sell ? "Verkaufspreis" : "Kaufpreis"} je Stück<input name="p" inputmode="decimal" required value="${x && Number.isFinite(x.last) ? String(px(x.last)).replace(".", ",") : ""}"></label>
      <label>Datum<input name="d" type="date" value="${today}" max="${today}"></label>
      <div class="btn-row wide"><button type="submit">${sell ? "Verkauf speichern" : "Nachkauf speichern"}</button><button type="button" class="btn ghost" data-act="tradecancel">Abbrechen</button></div>
      <p class="hint">${sell ? "Der Gewinn oder Verlust zum Durchschnittspreis kommt ins Trade-Journal und damit in den Steuer-Schätzer. Verkaufen Sie alle Stück, verschwindet die Position aus der Liste." : "Der Kaufpreis der Position wird zum gleitenden Durchschnitt – so rechnet auch die österreichische Kapitalertragsteuer."}</p>
    </form>`;
  }
  function tradeLog(h) {
    const ev = [...h.lots.map(l => ({ ...l, k: "Kauf" })), ...(h.sells || []).map(s => ({ ...s, k: "Verkauf" }))].sort((a, b) => ((a.d || "") < (b.d || "") ? -1 : (a.d || "") > (b.d || "") ? 1 : (a.t || 0) - (b.t || 0)));
    return `<details class="more pf-log"><summary>Käufe und Verkäufe (${ev.length})</summary><ul class="checklist small">${ev.map(e => `<li>${e.d ? dDate(e.d) : "ohne Datum"}: <b>${e.k}</b> ${fmt(e.q, e.q % 1 ? 2 : 0)} Stück zu ${price(e.p)}${DEPOT[e.s] ? ` <span class="muted">· ${DEPOT[e.s]}</span>` : ""}</li>`).join("")}</ul></details>`;
  }
  function formCard() {
    const h = editId ? list.find(x => x.id === editId) : null;
    const v = (k, d = "") => (h && h[k] !== null && h[k] !== undefined ? esc(String(h[k]).replace(".", ",")) : d);
    return `<article class="card" data-section="Eintragen">
      <h2 class="card-title">${h ? `${esc(h.sym)} bearbeiten` : "Aktie eintragen"}</h2>
      <form id="pfForm" class="calc" autocomplete="off" data-key="${h ? esc(h.id) : "neu"}">
        <label>Kürzel wie bei eToro<input id="pfSym" required placeholder="Name oder Kürzel, z. B. Nvidia" value="${h ? esc(h.sym) : ""}" style="text-transform:uppercase"></label>
        <label>Kaufpreis je Stück<input id="pfBuy" inputmode="decimal" required placeholder="in der Währung bei eToro" value="${v("buy")}"${h && h.lots && h.lots.length > 1 ? " readonly" : ""}></label>
        <label>Stück (freiwillig)<input id="pfQty" inputmode="decimal" placeholder="für Gewinn in Geld" value="${v("qty")}"${h && h.lots && h.lots.length > 1 ? " readonly" : ""}></label>
        ${h && h.lots && h.lots.length > 1 ? `<p class="small muted wide">Kaufpreis und Stück ergeben sich aus ${h.lots.length} Käufen – ändern über „Nachkauf“ und „Teilverkauf“.</p>` : ""}
        <label>Kaufdatum (freiwillig)<input id="pfDate" type="date" value="${h && h.date ? h.date : ""}"></label>
        <label>Ihr Stop Loss bei eToro (freiwillig)<input id="pfStop" inputmode="decimal" placeholder="dann warnt die Seite" value="${v("stop")}"></label>
        <label>Notiz (freiwillig)<input id="pfNote" maxlength="200" placeholder="z. B. warum gekauft" value="${h ? esc(h.note) : ""}"></label>
        <div class="btn-row wide"><button type="submit">${h ? "Speichern" : "Hinzufügen"}</button>${h ? `<button type="button" class="btn ghost" data-act="cancel">Abbrechen</button>` : ""}</div>
      </form>
      <p class="hint">Ihre Liste bleibt nur in diesem Browser auf diesem Gerät – sie wird nirgends hochgeladen. Für ein zweites Gerät unten „Sichern und übertragen“ nutzen.</p>
    </article>`;
  }
  function summaryCard(rows) {
    const withData = rows.filter(r => r.x);
    const pls = withData.map(r => (r.x.last / r.h.buy - 1) * 100);
    const avg = pls.length ? pls.reduce((s, v) => s + v, 0) / pls.length : null;
    const count = cls => withData.filter(r => risk(r.x, profile(r.h.sym)).label === cls).length;
    const sells = withData.filter(r => (verdict(r.h, r.x) || {}).key === "sell").length;
    const high = rows.flatMap(r => alerts(r.h, r.x)).filter(a => a.level === "high").length;
    const kpi = (lbl, val) => `<div class="kpi"><div class="lbl">${lbl}</div><div class="val">${val}</div></div>`;
    const t = stocks ? new Date(stocks.updated).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }) : null;
    // in Euro: nur Positionen mit Stückzahl und bekannter Währung
    const E = withData.map(r => euro(r.h, r.x)).filter(Boolean);
    const needFx = withData.some(r => currency(r.h.sym) && currency(r.h.sym) !== "EUR");
    const sum = k => E.reduce((a, e) => a + e[k], 0);
    const eurKpis = E.length ? `${kpi("Depotwert in Euro", `<span class="num">${eur(sum("value"))}</span>`)}${kpi("Ergebnis in Euro", `<span class="${sum("gain") < 0 ? "down" : "up"}">${eur(sum("gain"), true)}</span>`)}` : "";
    const missing = withData.length - E.length;
    const fxLine = E.length ? `<p class="small" style="margin-top:10px">In Euro: Ergebnis ${eur(sum("gain"), true)} = Kurs ${eur(sum("stock"), true)} + Währung ${eur(sum("fx"), true)}${missing ? ` · ${missing} ${missing === 1 ? "Position" : "Positionen"} ohne Stückzahl oder Währung nicht enthalten` : ""}${E.some(e => !e.dated) ? " · ohne Kaufdatum kein Währungseffekt" : ""}. <span class="muted">EZB-Referenzkurse${fxData() ? ` vom ${dDate(fxData().last)}` : ""}.</span></p>` : needFx && !fxData() ? `<p class="muted small" style="margin-top:10px">Euro-Werte erscheinen, sobald die EZB-Kurse geladen sind.</p>` : "";
    return `<article class="card" data-section="Überblick">
      <div class="card-head"><h2 class="card-title">Ihr Portfolio</h2><span class="muted small">${t ? `Kurse vom ${t} Uhr` : "Kurse werden geladen …"}</span></div>
      <div class="stats">${eurKpis}${kpi("Aktien", rows.length)}${kpi("Ø Ergebnis je Aktie", pc(avg))}${kpi("Verkauf prüfen", sells)}${kpi("Wichtige Hinweise", high)}</div>
      ${fxLine}
      <p class="small" style="margin-top:12px">Risiko-Mischung: <b>${count("Solide")}</b> solide, <b>${count("Mittel")}</b> mittel, <b>${count("Riskant")}</b> riskant${withData.length < rows.length ? ` · ${rows.length - withData.length} ohne Kennzahlen` : ""}. ${count("Riskant") > withData.length / 2 && withData.length >= 2 ? "Mehr als die Hälfte ist riskant – ein Rückschlag trifft dann das ganze Depot." : ""}</p>
    </article>`;
  }
  // Depot-Analyse: Aufteilung nach Branche, Region, Währung und Risiko, Klumpenrisiko, Depot-Note und Beta
  const REGION = sym => { const m = /\.([A-Z]+)$/.exec(sym); if (!m) return "USA"; return ["HK", "T", "KS", "KQ", "SS", "SZ", "TW", "SI", "AX"].includes(m[1]) ? "Asien-Pazifik" : m[1] === "L" ? "Großbritannien" : "Europa"; };
  function mixCard(rows) {
    const withData = rows.filter(r => r.x);
    if (withData.length < 2) return "";
    const cur = new Set(withData.map(r => currency(r.h.sym) || "?"));
    const byValue = cur.size === 1 && withData.every(r => r.h.qty > 0);
    const w = r => (byValue ? r.h.qty * r.x.last : 1);
    const tot = withData.reduce((s, r) => s + w(r), 0);
    const share = r => w(r) / tot * 100;
    const F = sym => (window.DTD.shared && window.DTD.shared.fund(sym)) || {};
    const groupBy = key => { const m = new Map(); for (const r of withData) { const k = key(r); m.set(k, (m.get(k) || 0) + share(r)); } return [...m.entries()].sort((a, b) => b[1] - a[1]); };
    const dims = [
      ["Branche", groupBy(r => F(r.h.sym).ind || (r.h.sym.includes(".") ? "außerhalb USA (keine Branchendaten)" : "unbekannt"))],
      ["Region", groupBy(r => REGION(r.h.sym))],
      ["Währung", groupBy(r => currency(r.h.sym) || "Pence/Dollar (London)")],
      ["Risiko", groupBy(r => risk(r.x, profile(r.h.sym)).label)],
    ];
    const big = [...withData].sort((a, b) => share(b) - share(a))[0];
    const warn = [];
    if (share(big) > 25) warn.push(`Größte Position: <b>${esc(big.h.sym)}</b> mit ${fmt(share(big), 0)} % – über 25 % in einer Aktie ist ein Klumpenrisiko.`);
    if (dims[0][1][0] && dims[0][1][0][1] > 40 && withData.length >= 3) warn.push(`${fmt(dims[0][1][0][1], 0)} % in einer Branche (${esc(dims[0][1][0][0])}) – ein Rückschlag dort trifft das ganze Depot.`);
    const risky = (dims[3][1].find(([k]) => k === "Riskant") || [0, 0])[1];
    if (risky > 50) warn.push(`${fmt(risky, 0)} % riskante Aktien – mehr als die Hälfte schwankt stark.`);
    const weak = withData.filter(r => { const fsd = window.DTD.finStrength && window.DTD.finStrength(r.h.sym); return fsd && fsd.light === "red"; }).map(r => r.h.sym);
    if (weak.length) warn.push(`Schwache Finanzkraft (rote Ampel): <b>${weak.map(esc).join(", ")}</b> – Bilanz im Aktien-Check prüfen.`);
    if ((dims[1][1][0] || [])[1] === 100 && dims[1][1][0][0] === "USA") warn.push("Alles in US-Aktien: Fällt der Dollar gegen den Euro, sinkt der Wert in Euro – auch wenn die Kurse gleich bleiben.");
    const avgW = get => { let s = 0, n = 0; for (const r of withData) { const v = get(r); if (Number.isFinite(v)) { s += v * share(r); n += share(r); } } return n ? s / n : null; };
    const note = avgW(r => { const sc = window.DTD.score && window.DTD.score(r.h.sym); return sc ? sc.note : null; }), beta = avgW(r => r.x.beta);
    const row = ([k, v]) => `<div class="mix-row"><span class="mix-k">${esc(k)}</span><span class="mix-bar"><i style="width:${Math.max(2, v).toFixed(1)}%"></i></span><b class="num">${fmt(v, 0)} %</b></div>`;
    // Stresstest: Wie viel verliert das Depot ungefähr, wenn der Markt (S&P 500) fällt? Je Aktie Beta × Marktbewegung;
    // ohne Beta zählt 1, Beta auf 0 bis 3 begrenzt. Dazu der größte Rückgang jeder Aktie im letzten Jahr als zweiter Anhalt.
    const betaOf = r => (Number.isFinite(r.x.beta) ? Math.max(0, Math.min(3, r.x.beta)) : 1);
    const depBeta = withData.reduce((s, r) => s + share(r) / 100 * betaOf(r), 0);
    const curName = byValue ? currency(withData[0].h.sym) : "";
    const stressRow = m => { const d = depBeta * m; return `<tr><td>Markt ${m} %</td><td class="num"><b class="down">${fmt(d, 1)} %</b></td>${byValue ? `<td class="num">≈ −${fmt(Math.abs(tot * d / 100), 0)}${curName ? ` ${curName}` : ""}</td>` : ""}</tr>`; };
    const hit = [...withData].map(r => ({ r, c: share(r) / 100 * betaOf(r) * 20 })).filter(o => o.c >= 0.05).sort((a, b) => b.c - a.c).slice(0, 3);
    const mddW = avgW(r => r.x.mdd);
    const stress = `<h3 class="swing-h3" style="margin-top:18px">Stresstest: Wenn der Markt fällt</h3>
      <div class="table-wrap"><table class="scr stress"><thead><tr><th>S&amp;P 500</th><th class="num">Ihr Depot etwa</th>${byValue ? `<th class="num">in ${curName || "Währung"}</th>` : ""}</tr></thead><tbody>${[-10, -20, -30].map(stressRow).join("")}</tbody></table></div>
      <p class="small" style="margin-top:8px">${hit.length ? `Am stärksten trifft es bei −20 %: ${hit.map(o => `${esc(o.r.h.sym)} <span class="down">−${fmt(o.c, 1)} Punkte</span> <span class="muted">(Beta ${Number.isFinite(o.r.x.beta) ? fmt(o.r.x.beta, 2) : "unbekannt, 1 angenommen"}, ${fmt(share(o.r), 0)} % Anteil)</span>`).join(" · ")}.` : ""}${Number.isFinite(mddW) ? ` Im letzten Jahr fielen Ihre Aktien zeitweise um durchschnittlich ${fmt(mddW, 0)} % (gewichtet).` : ""}</p>
      <p class="hint">Grobe Schätzung aus dem Beta der letzten 12 Monate. In echten Krisen laufen Aktien stärker im Gleichschritt – rechnen Sie mit mehr. Währungen bleiben außen vor.</p>`;
    return `<article class="card" id="pfMix" data-section="Aufteilung">
      <div class="card-head"><h2 class="card-title">Depot-Analyse</h2><span class="muted small">${byValue ? "nach aktuellem Wert" : cur.size > 1 ? "nach Anzahl – Währungen gemischt" : "nach Anzahl – Stückzahlen fehlen"}</span></div>
      <div class="stats">${kpi("Depot-Note", Number.isFinite(note) ? `<span class="${window.DTD.scoreTone(note)}">${fmt(note, 0)}</span>` : "–")}${kpi("Ø Beta", Number.isFinite(beta) ? fmt(beta, 2) : "–")}${kpi("Branchen", dims[0][1].length)}${kpi("Größte Position", `${fmt(share(big), 0)} %`)}</div>
      ${warn.length ? `<ul class="checklist mix-warn">${warn.map(t => `<li>${t}</li>`).join("")}</ul>` : `<p class="small up" style="margin-top:10px">Gut gestreut: keine Aktie über 25 %, keine Branche über 40 %.</p>`}
      <div class="mix-grid">${dims.map(([t, l]) => `<div><h3 class="swing-h3">${t}</h3>${l.slice(0, 6).map(row).join("")}${l.length > 6 ? `<p class="muted small">+ ${l.length - 6} weitere</p>` : ""}</div>`).join("")}</div>
      ${stress}
      <p class="hint">Depot-Note = Gesamtnote der Aktien, gewichtet. Ø Beta: 1 = schwankt wie der S&P 500, 1,5 = anderthalbmal so stark. Faustregeln für Privatanleger: keine Einzelaktie über 20–25 %, mindestens 5 Branchen.</p>
    </article>`;
  }
  // ---------- Meldungen aufs Handy über ntfy ----------
  // Kanalname (wirkt wie ein Passwort) und Push-Liste entstehen hier im Browser; der Besitzer trägt beides als GitHub-Secret ein
  // (NTFY_TOPIC, PUSH_WATCH). Die Seite schickt selbst nichts – die Meldungen kommen aus den GitHub-Abläufen (scripts/notify.mjs).
  const PUSH_SYM = /^[A-Z0-9][A-Z0-9.\-_]{0,19}$/, NTFY_KEY = "dtd-ntfy-topic", PUSH_COPIED = "dtd-push-copied";
  const REPO_URL = "https://github.com/shg9d54y9j-langw/Anna-test";
  function pushList() {
    const uniq = l => [...new Set((Array.isArray(l) ? l : []).filter(v => typeof v === "string" && PUSH_SYM.test(v)))];
    const d = uniq(list.map(h => h.sym)), w = uniq(store.get("dtd-watch", [])).filter(v => !d.includes(v));
    const al = store.get("dtd-alarms", []);
    const a = (Array.isArray(al) ? al : []).filter(x => x && PUSH_SYM.test(x.sym) && Number.isFinite(x.price) && x.price > 0 && (x.dir === "up" || x.dir === "down")).map(x => [x.sym, x.dir === "up" ? ">" : "<", x.price]);
    const st = {};
    for (const h of list) if (PUSH_SYM.test(h.sym) && Number.isFinite(h.stop) && h.stop > 0) st[h.sym] = h.stop;
    return JSON.stringify({ v: 1, d, w, a, s: st, ...(store.get("dtd-push-brief", false) === true ? { b: 1 } : {}) });
  }
  // 22 Zeichen aus 64 möglichen (gleich verteilt) – rund 132 Bit Zufall, nicht zu erraten
  const newTopic = () => { const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"; return `rojko-${[...crypto.getRandomValues(new Uint8Array(22))].map(b => abc[b % 64]).join("")}`; };
  let pushOpen = false;
  document.addEventListener("toggle", e => { if (e.target && e.target.id === "pfPushSetup") pushOpen = e.target.open; }, true);
  // ---------- Risiko-Check: was passiert, wenn alle Stops greifen? ----------
  // Verlust je Position bis zum Stop (Stück × Abstand, in Euro zum aktuellen EZB-Kurs), Summe in % des Depotwerts, Positionen
  // ohne Stop, und je Aktie ein Vorschlag nach dem Risikobudget: höchstens so viele Stück, dass ein Stop-Treffer nicht mehr
  // als das Budget kostet – oder wo der Stop dafür liegen müsste.
  const BUDGETS = [0.5, 1, 2, 3];
  const budget = () => { const b = store.get("dtd-risk-budget", 1); return BUDGETS.includes(b) ? b : 1; };
  function riskCard(rows) {
    const R = rows.filter(r => r.x && Number.isFinite(r.x.last)).map(r => {
      const e = euro(r.h, r.x), cur = currency(r.h.sym), now = cur ? rateOn(cur, null) : null;
      const stop = r.h.stop, v = verdict(r.h, r.x);
      const dist = stop ? (stop / r.x.last - 1) * 100 : null;
      const loss = e && stop && now && stop < r.x.last ? r.h.qty * (stop - r.x.last) / now : null;   // negativ = Verlust in Euro
      return { ...r, e, now, stop, dist, loss, suggest: v ? v.stop : null };
    });
    if (!R.length) return "";
    const total = R.reduce((a, r) => a + (r.e ? r.e.value : 0), 0);
    const b = budget(), limit = total * b / 100;
    const withStop = R.filter(r => r.stop), without = R.filter(r => !r.stop);
    const lossSum = withStop.reduce((a, r) => a + (Number.isFinite(r.loss) ? Math.min(0, r.loss) : 0), 0);
    const share = v => (total > 0 && Number.isFinite(v) ? -v / total * 100 : null);
    const worst = withStop.filter(r => Number.isFinite(r.loss)).sort((a, c) => a.loss - c.loss)[0];
    const advice = r => {
      if (!r.stop) return `<span class="warn-t">Kein Stop</span>${r.suggest ? ` – Vorschlag nach den Regeln: <b class="num">${price(r.suggest)}</b> (${pc((r.suggest / r.x.last - 1) * 100)})` : ""}`;
      if (r.stop >= r.x.last) return `<span class="warn-t">Stop über dem Kurs</span> – in eToro prüfen, ob die Position noch offen ist`;
      if (!Number.isFinite(r.loss) || !(total > 0)) return `<span class="muted">Stück und Euro-Kurs nötig</span>`;
      if (-r.loss <= limit * 1.0001) return `<span class="up">passt</span> zum Budget`;
      const perShare = (r.x.last - r.stop) / r.now, maxQty = Math.floor(limit / perShare * 100) / 100;
      const fitStop = r.x.last - limit * r.now / r.h.qty;
      return `<span class="warn-t">zu groß</span> – höchstens <b class="num">${fmt(maxQty, maxQty % 1 ? 2 : 0)}</b> Stück${fitStop > 0 ? ` oder Stop bei <b class="num">${price(fitStop)}</b>` : ""}`;
    };
    const rowsHtml = R.map(r => `<tr><td><button type="button" class="chip-btn" data-open="${esc(r.h.sym)}">${esc(r.h.sym)}</button></td>
      <td class="num">${r.stop ? `${price(r.stop)} <span class="muted">(${pc(r.dist)})</span>` : "–"}</td>
      <td class="num">${Number.isFinite(r.loss) ? `<span class="down">${eur(r.loss, true)}</span>` : "–"}</td>
      <td class="num opt">${Number.isFinite(r.loss) && share(r.loss) !== null ? `${fmt(share(r.loss), 1)} %` : "–"}</td>
      <td class="wrap">${advice(r)}</td></tr>`).join("");
    return `<article class="card" id="pfRisk" data-section="Risiko">
      <div class="card-head"><h2 class="card-title">Risiko-Check: wenn alle Stops greifen</h2>
        <div class="seg" role="group" aria-label="Risikobudget je Aktie">${BUDGETS.map(x => `<button type="button" data-risk-budget="${x}" aria-pressed="${x === b}">${fmt(x, x % 1 ? 1 : 0)} %</button>`).join("")}</div></div>
      <div class="stats">
        ${kpi("Verlust, wenn alle Stops greifen", total > 0 && withStop.length ? `<span class="down">${eur(lossSum, true)}</span>` : "–")}
        ${kpi("Anteil am Depot", total > 0 && withStop.length ? `${fmt(share(lossSum) || 0, 1)} %` : "–")}
        ${kpi("Ohne Stop", `<span class="${without.length ? "warn-t" : "up"}">${without.length}</span>`)}
        ${kpi("Größtes Einzelrisiko", worst ? `${esc(worst.h.sym)} ${fmt(share(worst.loss) || 0, 1)} %` : "–")}
      </div>
      <div class="table-wrap" style="margin-top:14px"><table class="scr risk-t"><thead><tr><th>Aktie</th><th class="num">Stop</th><th class="num">Verlust bis Stop</th><th class="num opt">vom Depot</th><th>Vorschlag (Budget ${fmt(b, b % 1 ? 1 : 0)} % = ${total > 0 ? eur(limit) : "–"})</th></tr></thead><tbody>${rowsHtml}</tbody></table></div>
      <p class="hint">Risikobudget = höchstens so viel verlieren, wenn der Stop einer Aktie greift (Profis: 0,5–2 % des Depots je Position). Gerechnet in Euro zum aktuellen EZB-Kurs; Kurslücken (z. B. nach Quartalszahlen) können den Verlust über den Stop hinaus vergrößern. ${without.length ? "Positionen ohne Stop haben kein begrenztes Risiko – den Stop tragen Sie beim Bearbeiten der Aktie ein." : ""}</p>
    </article>`;
  }
  document.addEventListener("click", e => {
    const t = e.target.closest("[data-risk-budget]");
    if (!t) return;
    store.set("dtd-risk-budget", Number(t.dataset.riskBudget));
    const el = $("pfRisk"); if (el) el.outerHTML = riskCard(list.map(h => ({ h, x: item(h.sym) })));
  });
  function notifyCard() {
    const can = "Notification" in window, perm = can ? Notification.permission : "unsupported";
    const topic = String(store.get(NTFY_KEY, "") || ""), cur = pushList(), copied = String(store.get(PUSH_COPIED, "") || "");
    const changed = Boolean(copied) && copied !== cur, c = JSON.parse(cur);
    const counts = `${c.d.length} im Depot, ${c.w.length} auf der Merkliste, ${c.a.length} ${c.a.length === 1 ? "Kursalarm" : "Kursalarme"}, ${Object.keys(c.s).length} ${Object.keys(c.s).length === 1 ? "Stop" : "Stops"}`;
    const ext = (url, text) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    return `<article class="card" id="pfPush" data-section="Benachrichtigungen">
      <h2 class="card-title">Benachrichtigungen</h2>
      <ul class="checklist">
        <li><b>Hier auf der Seite:</b> Jede Aktie zeigt Hinweise – Kurssturz, Trendbruch, Ihr Stop, Quartalszahlen, Abstufungen. Die Zahl der wichtigen Hinweise steht am Reiter „Portfolio“ (am Handy an „Depot“ in der Leiste unten).</li>
        <li><b>Im Browser:</b> ${perm === "granted" ? "eingeschaltet – neue Hinweise kommen als Meldung, solange die Seite offen ist." : perm === "denied" ? "im Browser blockiert – in den Website-Einstellungen erlauben." : can ? `<button type="button" class="btn ghost" data-act="notify">Hinweise als Meldung erlauben</button> – kommt, solange die Seite offen ist.` : "von diesem Browser nicht unterstützt (auf dem iPhone nur, wenn die Seite zum Home-Bildschirm hinzugefügt ist)."}</li>
        <li><b>Aufs Handy mit der App ntfy – auch wenn die Seite zu ist:</b> Stop oder Kursalarm erreicht (an Börsentagen etwa alle 15 Minuten geprüft, auch ein kurzes Unterschreiten zählt), Trendbruch am 200-Tage-Schnitt, Kurssprung ab 5 %, Analysten-Umschwung, Zahlen am nächsten Börsentag, Gesamtnote unter 40 oder über 80, wichtige Nachrichten zu Ihren US-Aktien – und freitags ein Wochenbericht.${changed ? ` <span class="pill-due">Liste geändert – neu kopieren und PUSH_WATCH ersetzen</span>` : ""}</li>
      </ul>
      <details class="more push-setup" id="pfPushSetup"${pushOpen || changed ? " open" : ""}>
        <summary>${copied ? "Einrichtung und Push-Liste" : "So richten Sie es ein – einmalig, etwa 5 Minuten"}</summary>
        <ol class="steps">
          <li>App <b>ntfy</b> installieren – kostenlos für ${ext("https://apps.apple.com/app/ntfy/id1625396347", "iPhone")} und ${ext("https://play.google.com/store/apps/details?id=io.heckel.ntfy", "Android")}.</li>
          <li><button type="button" class="btn ghost" data-act="ntfy-topic">${topic ? "Neuen Kanalnamen erzeugen" : "Kanalnamen erzeugen"}</button>
            ${topic ? `<span class="push-row"><input id="pfTopic" class="push-val" readonly value="${esc(topic)}" aria-label="Ihr Kanalname"><button type="button" class="btn ghost" data-act="ntfy-copy">Kopieren</button></span>` : ""}
            In der App auf „+“ tippen, den Namen eintragen (Server ntfy.sh) und abonnieren. Der Name wirkt wie ein Passwort – nicht weitergeben.</li>
          <li><label class="push-brief"><input type="checkbox" data-push-brief${store.get("dtd-push-brief", false) === true ? " checked" : ""}> Morgens das Tagesbriefing schicken (Mo–Fr gegen 7:40 Uhr)</label>
            <button type="button" class="btn ghost" data-act="ntfy-list">Push-Liste kopieren</button> <span class="muted small">${counts}</span>
            <textarea id="pfPushText" class="push-val" rows="3" readonly hidden aria-label="Ihre Push-Liste"></textarea></li>
          <li>Auf GitHub zwei Secrets anlegen (im Browser, angemeldet): ${ext(`${REPO_URL}/settings/secrets/actions/new`, "Neues Secret")} → Name <code>NTFY_TOPIC</code>, Wert: der Kanalname. Noch einmal → Name <code>PUSH_WATCH</code>, Wert: die Push-Liste.</li>
          <li>Probe: ${ext(`${REPO_URL}/actions/workflows/weekly-push.yml`, "Ablauf „Wochenbericht aufs Handy“")} → „Run workflow“ (Probe-Meldung). Nach etwa einer Minute meldet sich das Handy.</li>
        </ol>
        <p class="hint">Wann: an Börsentagen nach den Aktien-Daten (gegen 10 und 15 Uhr), nach den Nachrichten (viermal am Tag) und freitags gegen 18 Uhr – nur wenn es etwas zu melden gibt. Ändern Sie Depot, Merkliste, Stops oder Kursalarme, kopieren Sie die Push-Liste neu und ersetzen Sie das Secret <code>PUSH_WATCH</code> („Update secret“). Die Meldungen nennen Kürzel und Kurse, nie Beträge oder Stückzahlen; die Liste liegt nur als geheimes Secret auf GitHub, nicht im öffentlichen Repository. Der kostenlose Dienst ntfy.sh leitet die Meldungen weiter.</p>
      </details>
      <p class="small" style="margin-top:10px">Lieber mit Einschätzung durch Claude? <button type="button" class="btn ghost" data-act="claude">Liste für Claude kopieren</button> und im Claude-Chat senden.</p>
    </article>`;
  }
  document.addEventListener("change", e => {
    const cb = e.target.closest && e.target.closest("[data-push-brief]");
    if (!cb) return;
    store.set("dtd-push-brief", cb.checked);
    const el = $("pfPush"); if (el) el.outerHTML = notifyCard();   // Hinweis „Liste geändert“ sofort zeigen
  });
  // in die Zwischenablage; ohne Zugriff das Feld zum Markieren zeigen
  function copyOut(text, done, field) {
    const manual = () => { if (field) { field.hidden = false; field.value = text; field.focus(); field.select(); } note("Bitte den markierten Text kopieren."); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, manual);
    else manual();
  }
  // ---------- Komplette Sicherung als Datei ----------
  // Alles, was die Seite in diesem Browser speichert (Schlüssel dtd-… und daytrade-…): Depot, Merkliste, Journal, Kursalarme,
  // smarte Alarme, Vergleich, Trader, Einstellungen. Die Datei bleibt beim Nutzer – nichts wird hochgeladen. Beim Laden wird der
  // bisherige Stand 7 Tage aufgehoben und lässt sich zurückholen.
  const BK = /^(dtd|daytrade)-[a-z0-9-]{1,40}$/, BK_AT = "dtd-backup-at", BK_UNDO = "dtd-restore-undo", BK_SKIP = new Set([BK_AT, BK_UNDO, "dtd-auth", "dtd-auth-pending", "dtd-auth-req", "dtd-sync", "dtd-login"]);   // Anmeldung nie in die Datei
  const BK_APP = "RojkoMoney", WEEK = 7 * 864e5;
  let persisted = null;
  if (navigator.storage && navigator.storage.persisted) navigator.storage.persisted().then(v => { persisted = v; }).catch(() => {});
  function localKeys() {
    const out = [];
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && BK.test(k) && !BK_SKIP.has(k)) out.push(k); } } catch { /* Speicher gesperrt */ }
    return out.sort();
  }
  function snapshot() {
    const data = {};
    for (const k of localKeys()) { try { data[k] = JSON.parse(localStorage.getItem(k)); } catch { /* kein JSON: auslassen */ } }
    return data;
  }
  // „3 Aktien im Depot, 12 auf der Merkliste …“ – was in einer Sicherung (oder im Browser) steckt
  function contents(data) {
    const n = k => (Array.isArray(data[k]) ? data[k].length : 0);   // die Beispiel-Trader des Copy-Vergleichs zählen nicht mit
    return [
      [n("dtd-portfolio"), "Aktie im Depot", "Aktien im Depot"],
      [n("dtd-watch"), "Aktie auf der Merkliste", "Aktien auf der Merkliste"],
      [n("daytrade-journal-v1"), "Trade im Journal", "Trades im Journal"],
      [n("dtd-alarms"), "Kursalarm", "Kursalarme"],
      [n("dtd-cmp"), "Aktie im Vergleich", "Aktien im Vergleich"],
    ].filter(([c]) => c > 0).map(([c, one, many]) => `${fmt(c, 0)} ${c === 1 ? one : many}`);
  }
  const backupAge = () => { const at = store.get(BK_AT, null), t = at ? new Date(at).getTime() : NaN; return Number.isFinite(t) ? Math.max(0, Math.floor((Date.now() - t) / 864e5)) : null; };
  // Sicherung empfohlen: Depot oder Journal vorhanden und noch nie bzw. vor über 30 Tagen gesichert
  function backupDue() {
    const j = store.get("daytrade-journal-v1", []), age = backupAge();
    return (list.length > 0 || (Array.isArray(j) && j.length > 0)) && (age === null || age > 30);
  }
  function undoInfo() {
    const u = store.get(BK_UNDO, null), t = u && u.at ? new Date(u.at).getTime() : NaN;
    if (!u || !u.data || !Number.isFinite(t)) return null;
    if (Date.now() - t > WEEK) { try { localStorage.removeItem(BK_UNDO); } catch { /* egal */ } return null; }
    return { ...u, t };
  }
  function downloadBackup() {
    const data = snapshot(), now = new Date(), what = contents(data);
    const file = { app: BK_APP, kind: "Sicherung", version: 1, created: now.toISOString(), contents: what, data };
    const name = `rojkomoney-sicherung-${now.toISOString().slice(0, 10)}.json`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(file, null, 1)], { type: "application/json" }));
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    store.set(BK_AT, now.toISOString());
    // Browser bitten, die Daten nicht von selbst zu löschen (Chrome entscheidet still, Safari bei Home-Bildschirm-Apps)
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().then(v => { persisted = v; render(); }).catch(() => {});
    note(`Sicherung „${name}“ gespeichert${what.length ? ` – ${what.join(", ")}` : ""}. Am Handy liegt sie unter Dateien → Downloads.`);
    render();
    window.dispatchEvent(new Event("dtd:backup"));
  }
  let picker = null;
  function pickBackup() {
    // eigenes Feld außerhalb des Bereichs, der neu gezeichnet wird – sonst ginge die Auswahl beim Neuzeichnen verloren
    if (!picker) {
      picker = document.createElement("input");
      picker.type = "file";
      picker.id = "pfRestoreFile";
      picker.accept = "application/json,.json,text/plain";
      picker.hidden = true;
      picker.addEventListener("change", () => { const f = picker.files && picker.files[0]; if (f) restoreBackup(f).finally(() => { picker.value = ""; }); });
      document.body.append(picker);
    }
    picker.click();
  }
  async function restoreBackup(f) {
    if (f.size > 5e6) return note("Die Datei ist zu groß für eine Sicherung dieser Seite.");
    let file = null;
    try { file = JSON.parse(await f.text()); } catch { /* unten gemeldet */ }
    const data = file && file.app === BK_APP && file.data && typeof file.data === "object" && !Array.isArray(file.data) ? file.data : null;
    if (!data) return note("Das ist keine Sicherung dieser Seite – bitte die Datei „rojkomoney-sicherung-….json“ wählen.");
    const keys = Object.keys(data).filter(k => BK.test(k) && !BK_SKIP.has(k) && data[k] !== undefined);
    if (!keys.length) return note("In dieser Sicherung stehen keine Daten.");
    const t = new Date(file.created), when = Number.isFinite(t.getTime()) ? t.toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "unbekanntem Datum";
    const what = contents(data), now = contents(snapshot());
    const msg = `Sicherung vom ${when} laden?\n\nIn der Datei: ${what.length ? what.join(", ") : "nur Einstellungen"}.\nJetzt in diesem Browser: ${now.length ? now.join(", ") : "nichts Gespeichertes"}.\n\nDie Daten aus der Datei ersetzen die gleichen Daten in diesem Browser. Der jetzige Stand wird 7 Tage aufgehoben und lässt sich unter „Sichern und übertragen“ zurückholen.`;
    if (!confirm(msg)) return;
    const before = {};
    for (const k of keys) { try { before[k] = localStorage.getItem(k); } catch { before[k] = null; } }
    try { localStorage.setItem(BK_UNDO, JSON.stringify({ at: new Date().toISOString(), from: when, data: before })); } catch { /* zu wenig Platz: ohne Rückweg */ }
    let ok = 0;
    for (const k of keys) { try { localStorage.setItem(k, JSON.stringify(data[k])); ok++; } catch { /* Speicher voll */ } }
    try { sessionStorage.setItem("dtd-restored", JSON.stringify({ ok, of: keys.length, what })); } catch { /* ohne Meldung nach dem Neuladen */ }
    location.reload();
  }
  function undoRestore() {
    const u = undoInfo();
    if (!u || !confirm(`Den Stand von vor dem Laden der Sicherung (geladen am ${new Date(u.t).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}) zurückholen?`)) return;
    for (const [k, v] of Object.entries(u.data)) {
      if (!BK.test(k) || BK_SKIP.has(k)) continue;
      try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, String(v)); } catch { /* Speicher voll */ }
    }
    try { localStorage.removeItem(BK_UNDO); sessionStorage.setItem("dtd-restored", JSON.stringify({ undo: true })); } catch { /* egal */ }
    location.reload();
  }
  // nach dem Neuladen melden, was geladen wurde
  try {
    const r = JSON.parse(sessionStorage.getItem("dtd-restored") || "null");
    if (r) {
      sessionStorage.removeItem("dtd-restored");
      setTimeout(() => toast("Sicherung", r.undo ? "Der Stand von vor dem Laden ist zurück." : `Sicherung geladen${r.what && r.what.length ? `: ${r.what.join(", ")}` : ""}.${r.ok < r.of ? ` ${r.of - r.ok} Teil(e) passten nicht in den Speicher.` : ""}`, 7000), 300);
    }
  } catch { /* egal */ }

  function backupCard() {
    const age = backupAge(), due = backupDue(), u = undoInfo(), mine = contents(snapshot());
    const last = age === null ? "Noch keine Sicherung gemacht." : `Letzte Sicherung: ${age === 0 ? "heute" : age === 1 ? "gestern" : `vor ${fmt(age, 0)} Tagen`}.`;
    const keep = persisted === true ? "Dieser Browser hält die Daten dauerhaft." : persisted === false ? "Der Browser darf die Daten von selbst löschen – Safari z. B. nach 7 Tagen ohne Besuch der Seite, außer sie ist zum Home-Bildschirm hinzugefügt. Eine Sicherung schützt davor." : "";
    return `<details class="info card" id="pfBackup" data-section="Sichern">
      <summary>Sichern und übertragen${due ? ` <span class="pill-due">Sicherung empfohlen</span>` : ""}</summary>
      <h3 class="swing-h3">Alles als Datei</h3>
      <p class="small">Depot, Merkliste, Journal, Kursalarme, smarte Alarme, Vergleich und Einstellungen in einer Datei – für ein neues Handy, einen anderen Browser oder falls der Browser-Speicher gelöscht wird. Die Datei bleibt bei Ihnen; nichts wird hochgeladen.</p>
      <p class="small"><b>${last}</b> ${mine.length ? `Gespeichert sind ${mine.join(", ")}.` : "In diesem Browser ist noch nichts gespeichert."} ${keep}</p>
      <div class="btn-row"><button type="button" class="btn" data-act="backup">Sicherung herunterladen</button><button type="button" class="btn ghost" data-act="restore">Sicherung laden</button>${u ? `<button type="button" class="btn ghost" data-act="undo-restore">Stand vor dem Laden zurückholen</button>` : ""}</div>
      <h3 class="swing-h3" style="margin-top:18px">Nur die Aktien als Text</h3>
      <p class="small">Eine Zeile je Aktie: <code>Kürzel; Kaufpreis; Stück; Kaufdatum; Stop; Notiz</code>. „Kopieren“ legt Ihre Liste in die Zwischenablage, „Hinzufügen“ übernimmt Zeilen aus dem Feld (gleiche Aktie mit gleichem Kaufpreis wird nicht doppelt angelegt).</p>
      <textarea id="pfText" rows="5" placeholder="NVDA; 120,50; 10; 2026-03-02; 105; KI-Chips"></textarea>
      <div class="btn-row" style="margin-top:8px"><button type="button" class="btn ghost" data-act="export">Liste kopieren</button><button type="button" class="btn ghost" data-act="import">Zeilen hinzufügen</button></div>
      <h3 class="swing-h3" style="margin-top:18px">Aus Trade Republic oder Scalable übernehmen</h3>
      <p class="small"><b>Trade Republic:</b> in der App unter Profil → Kontoauszüge → Transaktionsexport die CSV-Datei sichern. <b>Scalable Capital:</b> im Web-Broker am Computer unter Transaktionen als CSV exportieren (laut Scalable für PRIME und PRIME+). Dann hier wählen – je Depot eine Datei; Werte in beiden Depots werden zusammengeführt.</p>
      <p class="small muted">Die Seite liest die Datei nur in diesem Browser, zeigt Stück und Ø Kaufkurs je Wert und übernimmt erst nach Ihrer Bestätigung.</p>
      <input type="file" id="trFile" accept=".csv,text/csv,text/plain" hidden>
      <div class="btn-row"><button type="button" class="btn ghost" data-act="tr-import">Umsatzliste (CSV) wählen</button></div>
    </details>`;
  }
  window.DTD.backupDue = backupDue;
  window.DTD.backupAge = backupAge;
  // Steuer-Schätzer (Österreich): abgeschlossene Trades aus dem Journal je Kalenderjahr, Verluste im Depot vor dem 31.12.
  function taxCard() {
    const j = store.get("daytrade-journal-v1", []);
    const trades = (Array.isArray(j) ? j : []).filter(t => t && Number.isFinite(t.in) && Number.isFinite(t.out) && Number.isFinite(t.qty));
    // in Euro zum EZB-Kurs am Verkaufstag, wenn für alle Trades Währung und Kurs bekannt sind – sonst wie bisher in Kontowährung
    const inEur = trades.length > 0 && trades.every(t => currency(t.sym) && rateOn(currency(t.sym), String(t.ts || "").slice(0, 10)));
    const cur = inEur ? "€" : ($("cCur") && $("cCur").value) || "$";
    const amount = v => `${v < 0 ? "−" : ""}${fmt(Math.abs(v), 2)} ${cur}`;
    const years = new Map();
    for (const t of trades) {
      const raw = (t.out - t.in) * t.qty * (t.dir === "Short" ? -1 : 1);
      const y = String(t.ts || "").slice(0, 4) || "unbekannt", pl = inEur ? raw / rateOn(currency(t.sym), String(t.ts || "").slice(0, 10)) : raw;
      if (!years.has(y)) years.set(y, { gain: 0, loss: 0, n: 0 });
      const Y = years.get(y); Y.n++; if (pl >= 0) Y.gain += pl; else Y.loss += pl;
    }
    const thisYear = String(new Date().getFullYear());
    const rows = [...years.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 4).map(([y, Y]) => {
      const net = Y.gain + Y.loss, tax = Math.max(0, net) * 0.275;
      return `<tr><td>${esc(y)}${y === thisYear ? " (laufend)" : ""}<div class="muted small">${Y.n} Trades<span class="mob"> · +${fmt(Y.gain, 0)} / −${fmt(-Y.loss, 0)}</span></div></td><td class="num up opt">${amount(Y.gain)}</td><td class="num down opt">${amount(Y.loss)}</td><td class="num"><b>${amount(net)}</b></td><td class="num">${amount(tax)}</td></tr>`;
    }).join("");
    const Y = years.get(thisYear), netNow = Y ? Y.gain + Y.loss : 0;
    const losers = stocks ? list.map(h => ({ h, x: item(h.sym) })).filter(r => r.x && r.h.qty && r.x.last < r.h.buy).map(r => ({ sym: r.h.sym, loss: (r.x.last - r.h.buy) * r.h.qty })) : [];
    return `<article class="card" id="pfTax" data-section="Steuer">
      <h2 class="card-title">Steuer-Schätzer (Österreich, 27,5 % KESt)</h2>
      ${inEur ? `<p class="small" style="margin:-6px 0 10px"><span class="light green">in Euro</span> umgerechnet zum EZB-Referenzkurs am Verkaufstag.</p>` : ""}
      <p class="muted small" style="margin:-6px 0 12px">Aus den abgeschlossenen Trades im Journal oben: Gewinne und Verluste je Kalenderjahr und die geschätzte Kapitalertragsteuer, die bei einem nicht steuereinfachen Broker wie eToro über die Beilage E1kv fällig wird.</p>
      ${rows ? `<div class="table-wrap"><table class="scr"><thead><tr><th>Jahr</th><th class="num opt">Gewinne</th><th class="num opt">Verluste</th><th class="num">Saldo</th><th class="num">KESt ca.</th></tr></thead><tbody>${rows}</tbody></table></div>` : `<p class="muted">Noch keine abgeschlossenen Trades im <a href="#journal">Journal</a>.</p>`}
      ${netNow > 0 && losers.length ? `<p class="small" style="margin-top:12px"><b>Vor dem 31.12. prüfen:</b> Ihr Portfolio hat Positionen im Minus (${losers.map(l => `${esc(l.sym)} ${fmt(l.loss, 0)}`).join(", ")} in Kurswährung). Ein Verkauf noch in diesem Jahr würde den Gewinn des Jahres mindern – Verluste lassen sich nur im selben Kalenderjahr verrechnen. Nur verkaufen, wenn die Aktie ohnehin nicht mehr überzeugt.</p>` : ""}
      <p class="hint">Grobe Schätzung: Dividenden, ausländische Quellensteuer, Währungsgewinne zwischen Kauf und Verkauf, Ausschüttungen von ETFs (auch ausschüttungsgleiche Erträge) und Nicht-Meldefonds sind nicht enthalten. Bankzinsen werden mit 25 % besteuert. eToro stellt einen Jahres-Steuerbericht mit Hinweisen für Österreich bereit (<a href="https://etoro.com/about/tax-report-faq-for-austrian-residents" target="_blank" rel="noopener noreferrer">eToro: Steuerbericht für Österreich</a>). Keine Steuerberatung.</p>
    </article>`;
  }
  function methodCard() {
    return `<article class="card" data-section="Regeln">
      <h2 class="card-title">Wie die Einschätzung entsteht</h2>
      <ul class="checklist">
        <li><b>Halten oder raus</b> nach denselben Regeln wie der Swing-Planer: Aufwärtstrend heißt Kurs über dem 200-Tage-Schnitt, 50er darüber, Momentum (12 bis 1 Monat) positiv – dann halten. Unter dem 200-Tage-Schnitt mit fallendem Trend: Verkauf prüfen. Der Stop-Vorschlag liegt 3 Tagesspannen (ATR) unter dem Kurs – oder knapp unter dem 200-Tage-Schnitt, wenn der näher liegt – und wandert bei eToro mit dem „Trailing Stop Loss“ nach oben.</li>
        <li><b>Riskant oder solide</b> aus drei Messungen: wie stark die Aktie im Jahr schwankt, wie tief sie in 12 Monaten gefallen ist und wie stark sie mit dem Gesamtmarkt mitgeht (Beta); spekulative Firmen der Theorie-Seite zählen riskanter.</li>
        <li><b>Hinweise</b> entstehen zweimal pro Börsentag mit den Aktien-Daten (eToro, Finnhub für Analysten und Quartalszahlen). Die Nachrichten je Aktie kommen live von TradingView – dafür lädt die Seite TradingView mit dem jeweiligen Kürzel.</li>
      </ul>
      <p class="hint">Keine Anlageberatung – mechanische Regeln, die auch danebenliegen. Die Entscheidung bleibt bei Ihnen.</p>
    </article>`;
  }

  // Eingaben überstehen ein Neuzeichnen (neue Kurse im Hintergrund), außer nach dem Speichern oder beim Wechsel zum Bearbeiten
  const FIELDS = ["pfSym", "pfBuy", "pfQty", "pfDate", "pfStop", "pfNote", "pfText"];
  let clearForm = false;
  const keepForm = () => ($("pfForm") ? { key: $("pfForm").dataset.key, vals: Object.fromEntries(FIELDS.map(i => [i, $(i) ? $(i).value : ""])), focus: document.activeElement && document.activeElement.id } : null);
  function restoreForm(st) {
    if (!st) { clearForm = false; return; }
    const same = !clearForm && st.key === (editId || "neu");
    clearForm = false;
    for (const [i, v] of Object.entries(st.vals)) if ($(i) && (i === "pfText" || same)) $(i).value = v;
    if (st.focus && FIELDS.includes(st.focus) && $(st.focus)) $(st.focus).focus();
  }
  function render() {
    const host = $("portfolioBody");
    if (!host || $("portfolio").hidden) { badge(); return; }
    const kept = keepForm();
    const tf = document.querySelector("form.pf-trade");
    const tKeep = tf ? { id: tf.dataset.id, kind: tf.dataset.kind, v: ["q", "p", "d"].map(n => tf.elements[n].value), focus: tf.contains(document.activeElement) ? document.activeElement.name : null } : null;
    const rows = list.map(h => ({ h, x: item(h.sym) }));
    const order = r => (!r.x ? 3 : { sell: 0, holdstop: 1, secure: 2, hold: 2 }[(verdict(r.h, r.x) || {}).key] ?? 3);
    rows.sort((a, b) => order(a) - order(b) || alerts(b.h, b.x).length - alerts(a.h, a.x).length || a.h.sym.localeCompare(b.h.sym));
    host.innerHTML = (list.length ? summaryCard(rows) + mixCard(rows) + riskCard(rows) + (window.DTD.depotHistoryCard ? window.DTD.depotHistoryCard() : "") : `<article class="card"><h2 class="card-title">Noch keine Aktien eingetragen</h2><p class="small">Tragen Sie unten Ihre erste Aktie mit Kaufpreis ein – die Seite zeigt dann Ergebnis, Risiko, ob Halten oder Raus und Nachrichten.</p></article>`)
      + (list.length ? `<article class="card" data-section="Aktien"><div class="card-head"><h2 class="card-title">Ihre Aktien</h2><span class="muted small">${loading && !stocks ? "Lade Kennzahlen …" : "„Verkauf prüfen“ zuerst"}</span></div><div class="pf-list">${rows.map(r => card(r.h)).join("")}</div></article>` : "")
      + formCard() + notifyCard();
    const extra = $("portfolioExtra");
    if (extra) {
      // aufgeklappte Abschnitte bleiben beim Neuzeichnen offen
      const opened = new Set([...extra.querySelectorAll("details[open][data-section]")].map(d => d.dataset.section));
      extra.innerHTML = taxCard() + backupCard() + methodCard();
      extra.querySelectorAll("details[data-section]").forEach(d => { if (opened.has(d.dataset.section)) d.open = true; });
    }
    if (window.DTD.drawDepotHistory) window.DTD.drawDepotHistory();
    for (const id of open.chart) {
      const el = document.getElementById(`pfChart-${id}`);
      if (el && window.DTD.bigChart) window.DTD.bigChart(el.id, el.dataset.tv);
    }
    for (const id of open.news) {
      const el = document.getElementById(`pfNews-${id}`);
      if (el && typeof tvWidget === "function") tvWidget(el.id, "timeline", { ...COMMON, feedMode: "symbol", symbol: el.dataset.tv, displayMode: "regular", width: "100%", height: 420 });
    }
    document.querySelectorAll("#portfolioBody [data-news-fill]").forEach(el => { if (window.DTD.fillNews) window.DTD.fillNews(el, el.dataset.newsFill); });
    restoreForm(kept);
    if (tKeep) {
      const nf = [...document.querySelectorAll("form.pf-trade")].find(f => f.dataset.id === tKeep.id && f.dataset.kind === tKeep.kind);
      if (nf) { ["q", "p", "d"].forEach((n, i) => { nf.elements[n].value = tKeep.v[i]; }); if (tKeep.focus && nf.elements[tKeep.focus]) nf.elements[tKeep.focus].focus(); }
    }
    // Vorschläge beim Tippen: Name oder Kürzel → Kürzel eintragen, weiter zum Kaufpreis
    if ($("pfSym") && window.DTD.attachSuggest) window.DTD.attachSuggest($("pfSym"), { source: text => (stocks && text ? window.DTD.matchStocks(stocks.items, text, 8) : []), onPick: () => { if ($("pfBuy")) $("pfBuy").focus(); } });
    badge();
    window.dispatchEvent(new Event("dtd:sections"));
  }
  // Zahl der wichtigen Hinweise am Reiter; neue Hinweise als Browser-Meldung (wenn erlaubt)
  function badge() {
    const b = $("pfBadge");
    const A = stocks ? list.flatMap(h => alerts(h, item(h.sym))) : [];
    const n = A.filter(a => a.level !== "info").length;
    if (b) { b.textContent = String(n); b.hidden = !n; }
    const nb = document.querySelector('.bottomnav [data-go="portfolio"]');   // Handy: Zahl auch an „Depot“ in der Leiste unten
    if (nb) {
      let dot = nb.querySelector(".nav-badge");
      if (!dot) { dot = document.createElement("b"); dot.className = "nav-badge"; nb.append(dot); }
      dot.textContent = String(n); dot.hidden = !n;
    }
    if (!stocks) return;
    const seen = new Set(store.get(SEEN, []));
    const fresh = A.filter(a => a.level !== "info" && !seen.has(a.key));
    if (fresh.length && "Notification" in window && Notification.permission === "granted") {
      for (const a of fresh.slice(0, 5)) { try { new Notification(`RojkoMoney: ${a.key.split(":")[0]}`, { body: a.text.replace(/<[^>]+>/g, ""), icon: "icons/icon-192.png", tag: a.key }); } catch { /* Handy-Browser ohne Meldungen */ } }
    }
    store.set(SEEN, A.map(a => a.key));
  }

  document.addEventListener("submit", e => {
    if (e.target.id !== "pfForm") return;
    e.preventDefault();
    const sym = $("pfSym").value.trim().toUpperCase(), buy = num($("pfBuy").value);
    if (!SYM.test(sym)) { $("pfSym").focus(); return note("Bitte ein gültiges Kürzel eintragen, z. B. NVDA oder SIE.DE."); }
    if (!(buy > 0)) { $("pfBuy").focus(); return note("Bitte den Kaufpreis je Stück eintragen."); }
    const rec = { sym, buy, qty: num($("pfQty").value), date: $("pfDate").value || null, stop: num($("pfStop").value), note: $("pfNote").value.trim().slice(0, 200) };
    if (!(rec.qty > 0)) rec.qty = null;
    if (!(rec.stop > 0)) rec.stop = null;
    const same = !editId ? list.find(h => h.sym === sym) : null;
    if (editId) {
      list = list.map(h => {
        if (h.id !== editId) return h;
        if (h.lots && h.lots.length > 1) return derive({ ...h, sym, stop: rec.stop, note: rec.note });   // Kaufpreis und Stück aus den Käufen
        if (h.lots && h.lots.length === 1) return rec.qty ? derive({ ...h, ...rec, lots: [{ q: rec.qty, p: rec.buy, d: rec.date, t: h.lots[0].t || 0 }] }) : (({ lots, sells, ...rest }) => ({ ...rest, ...rec }))(h);
        return { ...h, ...rec };
      });
    } else if (same && rec.qty > 0 && same.qty > 0 && confirm(`${sym} ist schon im Depot. Als Nachkauf zur bestehenden Position zählen (Durchschnittspreis)?\n\nAbbrechen = als eigene Zeile anlegen.`)) {
      const m = withLots(same);
      const merged = derive({ ...m, lots: [...m.lots, { q: rec.qty, p: rec.buy, d: rec.date, t: Date.now() }] });
      list = list.map(h => (h.id === same.id ? merged : h));
    } else list.push({ id: `p${Date.now().toString(36)}`, ...rec });
    editId = null;
    clearForm = true;
    save();
    render();
    note(`${sym} gespeichert.`);
  });
  document.addEventListener("submit", e => {
    const f = e.target.closest && e.target.closest("form.pf-trade");
    if (!f) return;
    e.preventDefault();
    const h0 = list.find(x => x.id === f.dataset.id);
    if (!h0) return;
    const q = num(f.elements.q.value), p = num(f.elements.p.value), today = new Date().toISOString().slice(0, 10);
    const d = DAY_RE.test(f.elements.d.value) && f.elements.d.value <= today ? f.elements.d.value : today;
    if (!(q > 0) || !(p > 0)) return note("Bitte Stück und Preis eintragen.");
    let h = withLots(h0);
    if (f.dataset.kind === "buy") {
      h = derive({ ...h, lots: [...h.lots, { q, p, d, t: Date.now() }] });
      list = list.map(x => (x.id === h.id ? h : x));
      trade = null; save(); render();
      return note(`${h.sym}: Nachkauf von ${fmt(q, q % 1 ? 2 : 0)} Stück gespeichert – Durchschnittspreis jetzt ${price(h.buy)}.`);
    }
    const at = avgAt(h, d);
    if (q > at.held + 1e-9) return note(`Am ${dDate(d)} hatten Sie nur ${fmt(at.held, at.held % 1 ? 2 : 0)} Stück ${h.sym}.`);
    const avg = px(at.avg), gain = (p - at.avg) * q;
    h = derive({ ...h, sells: [...(h.sells || []), { q, p, d, t: Date.now() }] });
    if (window.DTD.addJournal) window.DTD.addJournal({ ts: `${d}T12:00:00.000Z`, date: new Date(`${d}T12:00:00Z`).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }), sym: h.sym, dir: "Long", in: avg, out: p, qty: q, note: `Teilverkauf aus dem Portfolio (Durchschnittspreis ${price(avg)})` });
    if (!(h.qty > 0)) { list = list.filter(x => x.id !== h.id); open.exit.delete(h.id); open.news.delete(h.id); open.chart.delete(h.id); }
    else list = list.map(x => (x.id === h.id ? h : x));
    trade = null; save(); render();
    note(`${h.sym}: ${fmt(q, q % 1 ? 2 : 0)} Stück verkauft – ${gain >= 0 ? "Gewinn" : "Verlust"} ${money(gain, h.sym)} zum Durchschnittspreis, im Trade-Journal eingetragen${h.qty > 0 ? "" : "; die Position ist damit geschlossen"}.`);
  });
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-act]");
    if (!b || !$("portfolio") || !$("portfolio").contains(b)) return;
    const id = (b.closest("[data-id]") || {}).dataset?.id, h = list.find(x => x.id === id);
    const act = b.dataset.act;
    if (act === "open" && h) return window.DTD.openStock && window.DTD.openStock(h.sym);
    if (act === "exit" && h) { open.exit.has(id) ? open.exit.delete(id) : open.exit.add(id); return render(); }
    if (act === "news" && h) { open.news.has(id) ? open.news.delete(id) : open.news.add(id); return render(); }
    if (act === "chart" && h) { open.chart.has(id) ? open.chart.delete(id) : open.chart.add(id); return render(); }
    if (act === "edit" && h) { editId = id; render(); const f = $("pfForm"); if (f) f.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
    if (act === "cancel") { editId = null; return render(); }
    if ((act === "lotbuy" || act === "lotsell") && h) { const kind = act === "lotbuy" ? "buy" : "sell"; trade = trade && trade.id === id && trade.kind === kind ? null : { id, kind }; render(); const f = document.querySelector("form.pf-trade input[name=q]"); if (f) f.focus(); return; }
    if (act === "tradecancel") { trade = null; return render(); }
    if (act === "del" && h) { if (confirm(`${h.sym} aus dem Portfolio entfernen?`)) { list = list.filter(x => x.id !== id); open.exit.delete(id); open.news.delete(id); open.chart.delete(id); save(); render(); } return; }
    if (act === "notify") { Notification.requestPermission().then(() => render()); return; }
    if (act === "ntfy-topic") {
      if (store.get(NTFY_KEY, "") && !confirm("Neuen Kanalnamen erzeugen? Dann müssen Sie ihn in der App neu abonnieren und das Secret NTFY_TOPIC ersetzen.")) return;
      store.set(NTFY_KEY, newTopic()); pushOpen = true; render();
      const f = $("pfTopic"); if (f) { f.focus(); f.select(); }
      return;
    }
    if (act === "ntfy-copy") { const t = String(store.get(NTFY_KEY, "") || ""); if (t) copyOut(t, () => note("Kanalname kopiert – in der App ntfy abonnieren und auf GitHub als Secret NTFY_TOPIC eintragen."), $("pfTopic")); return; }
    if (act === "ntfy-list") {
      const text = pushList();
      store.set(PUSH_COPIED, text);   // ohne Zwischenablage nicht neu zeichnen – sonst verschwände das Feld zum Markieren
      copyOut(text, () => { pushOpen = true; render(); note("Push-Liste kopiert – auf GitHub als Secret PUSH_WATCH eintragen (oder ersetzen)."); }, $("pfPushText"));
      return;
    }
    if (act === "tr-import") { const f = $("trFile"); if (f) f.click(); return; }
    if (act === "backup") return downloadBackup();
    if (act === "restore") return pickBackup();
    if (act === "undo-restore") return undoRestore();
    if (act === "export" || act === "claude") {
      const lines = list.map(x => [x.sym, String(x.buy).replace(".", ","), x.qty ? String(x.qty).replace(".", ",") : "", x.date || "", x.stop ? String(x.stop).replace(".", ",") : "", x.note.replace(/;/g, ",")].join("; ").replace(/(; )+$/, ""));
      const text = act === "claude"
        ? `Portfolio für die Benachrichtigungen:\n${list.map(x => `- ${x.sym}: Kauf ${price(x.buy)}${currency(x.sym) ? ` ${currency(x.sym)}` : ""}${x.qty ? `, ${fmt(x.qty, x.qty % 1 ? 2 : 0)} Stück` : ""}${x.date ? `, gekauft am ${dDate(x.date)}` : ""}${x.stop ? `, Stop ${price(x.stop)}` : ""}`).join("\n")}`
        : lines.join("\n");
      const ta = $("pfText");
      if (ta) ta.value = text;
      const done = () => note(act === "claude" ? "Kopiert – jetzt im Claude-Chat einfügen und senden." : "Liste kopiert.");
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => { if (ta) { ta.select(); note("Bitte den Text im Feld markieren und kopieren."); } });
      else if (ta) { ta.select(); note("Bitte den Text im Feld markieren und kopieren."); }
      if (act === "claude" && ta) ta.closest("details").open = true;
      return;
    }
    if (act === "import") {
      const ta = $("pfText"), added = [];
      for (const line of String(ta ? ta.value : "").split(/\r?\n/)) {
        const [s, b2, q, d, st, ...note] = line.replace(/^[-•]\s*/, "").split(";").map(v => v.trim());
        const sym = (s || "").toUpperCase(), buy = num(b2);
        if (!SYM.test(sym) || !(buy > 0) || list.some(x => x.sym === sym && x.buy === buy)) continue;
        const rec = { id: `p${Date.now().toString(36)}${added.length}`, sym, buy, qty: num(q) > 0 ? num(q) : null, date: /^\d{4}-\d{2}-\d{2}$/.test(d || "") ? d : null, stop: num(st) > 0 ? num(st) : null, note: note.join(", ").slice(0, 200) };
        list.push(rec); added.push(sym);
      }
      if (added.length && ta) ta.value = "";
      save(); render();
      note(added.length ? `${added.length} Aktie(n) hinzugefügt: ${added.join(", ")}` : "Keine neuen gültigen Zeilen gefunden.");
    }
  });
  const note = msg => toast("Portfolio", msg, 5000);

  async function load(force = false) {
    if (loading || (stocks && !force)) { if (stocks) render(); return; }
    loading = true;
    if (!stocks) render();
    // gemeinsamer Lader (data.js): Aktien-, Swing- und Firmen-Daten nur einmal übers Netz für alle Bereiche
    const S = window.DTD.shared;
    const [next, w, f] = await Promise.all([S.load("stocks", force), S.load("swing", force), firms ? Promise.resolve(firms) : S.load("firms")]);
    if (next && Array.isArray(next.items)) stocks = next;
    if (list.some(h => currency(h.sym) && currency(h.sym) !== "EUR") && !S.get("fx")) S.load("fx").then(d => { if (d) render(); });
    swing = w || swing;
    if (f && f.firms) firms = f;
    loading = false;
    render();
    // Branchen und Gesamtnote für die Depot-Analyse
    if (window.DTD.scoreReady && !(window.DTD.scoreAll && window.DTD.scoreAll() && window.DTD.shared.get("fund"))) window.DTD.scoreReady().then(() => render());
  }
  // Für den Trade-Republic-Import (trimport.js): Währung der Kursdaten, EZB-Kurs am Tag und das Übernehmen fertiger Positionen.
  // Gleiche Kürzel werden ersetzt; der bisherige Stand bleibt 7 Tage über „Stand vor dem Laden zurückholen“ erhalten.
  window.DTD.pfCurrency = currency;
  window.DTD.pfRateOn = rateOn;
  // Mehrere Depots: Käufe und Verkäufe tragen ihr Depot (s). Ein Import aus Depot X ersetzt nur die X-Einträge der Werte in der
  // Datei – Einträge aus anderen Depots bleiben, so ergibt sich je Wert eine gemeinsame Position. Von Hand eingetragene Käufe
  // desselben Werts werden ersetzt (trimport.js fragt vorher). drop: in der Datei ganz verkaufte Werte – ihre X-Einträge fallen weg.
  window.DTD.pfImport = (recs, from, src = "", drop = []) => {
    let before = null;
    try { before = localStorage.getItem(KEY); } catch { /* egal */ }
    try { localStorage.setItem(BK_UNDO, JSON.stringify({ at: new Date().toISOString(), from, data: { [KEY]: before } })); } catch { /* ohne Rückweg */ }
    const tag = /^[a-z]{2}$/.test(src) ? src : "", stamp = Date.now().toString(36);
    const otherDepot = l => !!l.s && l.s !== tag, fromHere = l => !!tag && l.s === tag;
    const AUTO = /^(Trade Republic|Scalable Capital|anderes Depot)( \+ (Trade Republic|Scalable Capital|anderes Depot))* · [A-Z]{2}[A-Z0-9]{10}$/;
    const out = list.slice();
    let added = 0, merged = 0, replaced = 0;
    const place = (k, pos) => { if (pos.qty > 0) { if (k >= 0) out[k] = pos; else out.push(pos); } else if (k >= 0) out.splice(k, 1); };
    (Array.isArray(recs) ? recs : []).forEach((r, i) => {
      const sym = String(r && r.sym || "").toUpperCase();
      const mark = l => (tag ? { ...l, s: tag } : l), lots = cleanTrades(r && r.lots).map(mark), sells = cleanTrades(r && r.sells).map(mark);
      if (!SYM.test(sym) || !lots.length) return;
      const k = out.findIndex(h => h.sym === sym), h = k >= 0 ? out[k] : null;
      const keepL = h && h.lots ? h.lots.filter(otherDepot) : [], keepS = h && h.sells ? h.sells.filter(otherDepot) : [];
      if (h) { if (keepL.length) merged++; else replaced++; }
      const all = [...keepL, ...lots], depots = [...new Set(all.map(l => DEPOT[l.s]).filter(Boolean))];
      const isin = /[A-Z]{2}[A-Z0-9]{10}$/.exec(String(r.note || "")), auto = depots.length && isin ? `${depots.join(" + ")} · ${isin[0]}` : String(r.note || "");
      const note = h && h.note && !AUTO.test(h.note) ? h.note : auto.slice(0, 200);
      const sl = [...keepS, ...sells];
      place(k, derive({ id: h ? h.id : `p${stamp}t${i}`, sym, buy: all[0].p, qty: null, date: null, stop: h ? h.stop : null, note, lots: all, ...(sl.length ? { sells: sl } : {}) }));
      added++;
    });
    for (const sym of Array.isArray(drop) ? drop : []) {
      const k = out.findIndex(h => h.sym === sym && h.lots && h.lots.some(fromHere));
      if (k < 0) continue;
      const h = out[k], lots = h.lots.filter(l => !fromHere(l)), sells = (h.sells || []).filter(l => !fromHere(l));
      if (!lots.length) { out.splice(k, 1); continue; }
      const { sells: _old, ...rest } = h, isin = /[A-Z]{2}[A-Z0-9]{10}$/.exec(h.note || ""), depots = [...new Set(lots.map(l => DEPOT[l.s]).filter(Boolean))];
      const note = AUTO.test(h.note || "") && isin && depots.length ? `${depots.join(" + ")} · ${isin[0]}` : h.note;
      place(k, derive({ ...rest, note, lots, ...(sells.length ? { sells } : {}) }));
    }
    list = out;
    save(); render();
    return { added, merged, replaced };
  };
  window.DTD.startPortfolio = () => load(false);
  window.DTD.reloadPortfolio = () => load(true);
  window.DTD.portfolioCount = () => list.length;
  // neuer oder gelöschter Trade im Journal: nur den Steuer-Schätzer neu rechnen
  window.addEventListener("dtd:journal", () => { const el = $("pfTax"); if (el && !$("portfolio").hidden) el.outerHTML = taxCard(); });
  // Karte „Benachrichtigungen“ aktuell halten (Hinweis „Liste geändert“), wenn Merkliste oder Kursalarme sich ändern oder der Bereich öffnet
  const refreshPush = () => { const el = $("pfPush"); if (el && !$("portfolio").hidden) el.outerHTML = notifyCard(); };
  window.addEventListener("dtd:watch", refreshPush);
  window.addEventListener("dtd:alarms", refreshPush);
  window.addEventListener("dtd:view", e => { if (e.detail === "portfolio") refreshPush(); });
  // Mit Bestand gleich beim Öffnen der Seite die Hinweise rechnen (Zahl am Reiter, Browser-Meldungen)
  if (list.length) setTimeout(() => load(false), 1500);
})();

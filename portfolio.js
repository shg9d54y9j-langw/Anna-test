// ---------- Portfolio: eigene Aktien mit Kaufpreis – Gewinn/Verlust, Risiko, halten oder raus, Ausstiegs-Plan, Nachrichten ----------
// Unter den Aktien steht das Trade-Journal (app.js), darunter Steuer-Schätzer, Sichern und Regeln (#portfolioExtra).
// Der Bestand bleibt nur in diesem Browser (localStorage, Schlüssel dtd-portfolio) – er wird nirgends hochgeladen, auch nicht ins
// öffentliche Repository. Kennzahlen: stocks.json (eToro-Kurse, Trend, Schwankung, Analysten, Quartalszahlen; 2× pro Börsentag),
// swing.json (Zustand im Swing-Planer), data/firms.json (Theorie-Steckbriefe). Nachrichten: TradingView je Kürzel.
// Regeln wie im Swing-Planer: Aufwärtstrend = über dem 200-Tage-Schnitt, 50er darüber, Momentum positiv; Stop 3 Tagesspannen (ATR).
(() => {
  const KEY = "dtd-portfolio", SEEN = "dtd-portfolio-seen";
  const BASE = "https://raw.githubusercontent.com/shg9d54y9j-langw/Anna-test/stock-data/";
  const get = url => fetch(url, { cache: "no-store" }).then(r => (r.ok ? r.json() : null)).catch(() => null);
  const newest = list => list.filter(d => d && d.updated).sort((a, b) => new Date(b.updated) - new Date(a.updated))[0] || null;
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

  let list = read(), stocks = null, swing = null, firms = null, loading = false, editId = null;
  const open = { exit: new Set(), news: new Set(), chart: new Set() };
  function read() {
    const raw = store.get(KEY, []);
    return (Array.isArray(raw) ? raw : []).filter(h => h && typeof h.sym === "string" && SYM.test(h.sym) && Number.isFinite(h.buy) && h.buy > 0)
      .map((h, i) => ({ id: String(h.id || `p${Date.now().toString(36)}${i}`), sym: h.sym, buy: h.buy, qty: Number.isFinite(h.qty) && h.qty > 0 ? h.qty : null,
        date: /^\d{4}-\d{2}-\d{2}$/.test(h.date || "") ? h.date : null, stop: Number.isFinite(h.stop) && h.stop > 0 ? h.stop : null, note: String(h.note || "").slice(0, 200) }));
  }
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
        <span>Kauf <b class="num">${price(h.buy)}</b>${h.qty ? ` · ${fmt(h.qty, h.qty % 1 ? 2 : 0)} Stück` : ""}</span>
        <span>Jetzt <b class="num">${x ? price(x.last) : "–"}</b>${x ? ` <span class="muted">(${dDate(x.asOf)})</span>` : ""}</span>
        <span>Ergebnis <b class="num">${x ? pc(pl) : "–"}</b>${amt !== null ? ` <span class="num">${money(amt, h.sym)}</span>` : ""}</span>
        ${r ? `<span>Risiko <span class="light ${r.cls}">${r.label}</span></span>` : ""}
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
        <button type="button" class="btn ghost" data-act="edit">Bearbeiten</button>
        <button type="button" class="btn ghost" data-act="del">Entfernen</button>
      </div>
      ${open.chart.has(h.id) ? chartBlock(h, x, v, tv) : ""}
      ${x && open.exit.has(h.id) ? exitPlan(h, x, v) : ""}
      ${open.news.has(h.id) ? `<div class="pf-news" id="pfNews-${esc(h.id)}" data-tv="${esc(tv)}"></div>
        <p class="small muted">Mehr: <a href="https://www.tradingview.com/symbols/${encodeURIComponent(tv.replace(":", "-"))}/news/" target="_blank" rel="noopener noreferrer">alle Nachrichten bei TradingView ↗</a> · <a href="https://news.google.com/search?q=${encodeURIComponent(`${name || h.sym} Aktie`)}&hl=de&gl=AT&ceid=AT:de" target="_blank" rel="noopener noreferrer">deutsche Nachrichten bei Google News ↗</a></p>` : ""}
    </article>`;
  }
  function formCard() {
    const h = editId ? list.find(x => x.id === editId) : null;
    const v = (k, d = "") => (h && h[k] !== null && h[k] !== undefined ? esc(String(h[k]).replace(".", ",")) : d);
    return `<article class="card" data-section="Eintragen">
      <h2 class="card-title">${h ? `${esc(h.sym)} bearbeiten` : "Aktie eintragen"}</h2>
      <form id="pfForm" class="calc" autocomplete="off" data-key="${h ? esc(h.id) : "neu"}">
        <label>Kürzel wie bei eToro<input id="pfSym" required placeholder="Name oder Kürzel, z. B. Nvidia" value="${h ? esc(h.sym) : ""}" style="text-transform:uppercase"></label>
        <label>Kaufpreis je Stück<input id="pfBuy" inputmode="decimal" required placeholder="in der Währung bei eToro" value="${v("buy")}"></label>
        <label>Stück (freiwillig)<input id="pfQty" inputmode="decimal" placeholder="für Gewinn in Geld" value="${v("qty")}"></label>
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
    return `<article class="card" data-section="Überblick">
      <div class="card-head"><h2 class="card-title">Ihr Portfolio</h2><span class="muted small">${t ? `Kurse vom ${t} Uhr` : "Kurse werden geladen …"}</span></div>
      <div class="stats">${kpi("Aktien", rows.length)}${kpi("Ø Ergebnis je Aktie", pc(avg))}${kpi("Verkauf prüfen", sells)}${kpi("Wichtige Hinweise", high)}</div>
      <p class="small" style="margin-top:12px">Risiko-Mischung: <b>${count("Solide")}</b> solide, <b>${count("Mittel")}</b> mittel, <b>${count("Riskant")}</b> riskant${withData.length < rows.length ? ` · ${rows.length - withData.length} ohne Kennzahlen` : ""}. ${count("Riskant") > withData.length / 2 && withData.length >= 2 ? "Mehr als die Hälfte ist riskant – ein Rückschlag trifft dann das ganze Depot." : ""}</p>
    </article>`;
  }
  function notifyCard() {
    const can = "Notification" in window, perm = can ? Notification.permission : "unsupported";
    return `<article class="card" data-section="Benachrichtigungen">
      <h2 class="card-title">Benachrichtigungen bei wichtigen Nachrichten</h2>
      <ul class="checklist">
        <li><b>Hier auf der Seite:</b> Jede Aktie zeigt Hinweise – Kurssturz, Trendbruch, Ihr Stop, Quartalszahlen, Abstufungen. Die Zahl der wichtigen Hinweise steht am Reiter „Portfolio“ (am Handy an „Depot“ in der Leiste unten).</li>
        <li><b>Im Browser:</b> ${perm === "granted" ? "eingeschaltet – neue Hinweise kommen als Meldung, solange die Seite offen ist." : perm === "denied" ? "im Browser blockiert – in den Website-Einstellungen erlauben." : can ? `<button type="button" class="btn ghost" data-act="notify">Hinweise als Meldung erlauben</button> – kommt, solange die Seite offen ist.` : "von diesem Browser nicht unterstützt (auf dem iPhone nur, wenn die Seite zum Home-Bildschirm hinzugefügt ist)."}</li>
        <li><b>Aufs Handy über die Claude-App – auch wenn die Seite zu ist:</b> Tippen Sie auf <button type="button" class="btn ghost" data-act="claude">Liste für Claude kopieren</button> und schicken Sie mir den Text im Chat. Dann prüft Claude an jedem Börsentag die Nachrichten zu Ihren Aktien und meldet sich in der Claude-App, wenn etwas Wichtiges passiert – mit Einschätzung und, wenn nötig, Ausstiegs-Plan. Die Liste liegt dann nur in Ihrem Claude-Konto, nicht im öffentlichen Repository.</li>
      </ul>
    </article>`;
  }
  function backupCard() {
    return `<details class="info card" data-section="Sichern">
      <summary>Sichern und übertragen</summary>
      <p class="small">Eine Zeile je Aktie: <code>Kürzel; Kaufpreis; Stück; Kaufdatum; Stop; Notiz</code>. „Kopieren“ legt Ihre Liste in die Zwischenablage, „Hinzufügen“ übernimmt Zeilen aus dem Feld (gleiche Aktie mit gleichem Kaufpreis wird nicht doppelt angelegt).</p>
      <textarea id="pfText" rows="5" placeholder="NVDA; 120,50; 10; 2026-03-02; 105; KI-Chips"></textarea>
      <div class="btn-row" style="margin-top:8px"><button type="button" class="btn ghost" data-act="export">Liste kopieren</button><button type="button" class="btn ghost" data-act="import">Zeilen hinzufügen</button></div>
    </details>`;
  }
  // Steuer-Schätzer (Österreich): abgeschlossene Trades aus dem Journal je Kalenderjahr, Verluste im Depot vor dem 31.12.
  function taxCard() {
    const j = store.get("daytrade-journal-v1", []);
    const trades = (Array.isArray(j) ? j : []).filter(t => t && Number.isFinite(t.in) && Number.isFinite(t.out) && Number.isFinite(t.qty));
    const cur = ($("cCur") && $("cCur").value) || "$";
    const amount = v => `${v < 0 ? "−" : ""}${fmt(Math.abs(v), 2)} ${cur}`;
    const years = new Map();
    for (const t of trades) {
      const y = String(t.ts || "").slice(0, 4) || "unbekannt", pl = (t.out - t.in) * t.qty * (t.dir === "Short" ? -1 : 1);
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
      <p class="muted small" style="margin:-6px 0 12px">Aus den abgeschlossenen Trades im Journal oben: Gewinne und Verluste je Kalenderjahr und die geschätzte Kapitalertragsteuer, die bei einem nicht steuereinfachen Broker wie eToro über die Beilage E1kv fällig wird.</p>
      ${rows ? `<div class="table-wrap"><table class="scr"><thead><tr><th>Jahr</th><th class="num opt">Gewinne</th><th class="num opt">Verluste</th><th class="num">Saldo</th><th class="num">KESt ca.</th></tr></thead><tbody>${rows}</tbody></table></div>` : `<p class="muted">Noch keine abgeschlossenen Trades im <a href="#journal">Journal</a>.</p>`}
      ${netNow > 0 && losers.length ? `<p class="small" style="margin-top:12px"><b>Vor dem 31.12. prüfen:</b> Ihr Portfolio hat Positionen im Minus (${losers.map(l => `${esc(l.sym)} ${fmt(l.loss, 0)}`).join(", ")} in Kurswährung). Ein Verkauf noch in diesem Jahr würde den Gewinn des Jahres mindern – Verluste lassen sich nur im selben Kalenderjahr verrechnen. Nur verkaufen, wenn die Aktie ohnehin nicht mehr überzeugt.</p>` : ""}
      <p class="hint">Grobe Schätzung: Dividenden, ausländische Quellensteuer, Währungsgewinne, Ausschüttungen von ETFs (auch ausschüttungsgleiche Erträge) und Nicht-Meldefonds sind nicht enthalten. Bankzinsen werden mit 25 % besteuert. eToro stellt einen Jahres-Steuerbericht mit Hinweisen für Österreich bereit (<a href="https://etoro.com/about/tax-report-faq-for-austrian-residents" target="_blank" rel="noopener noreferrer">eToro: Steuerbericht für Österreich</a>). Keine Steuerberatung.</p>
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
    const rows = list.map(h => ({ h, x: item(h.sym) }));
    const order = r => (!r.x ? 3 : { sell: 0, holdstop: 1, secure: 2, hold: 2 }[(verdict(r.h, r.x) || {}).key] ?? 3);
    rows.sort((a, b) => order(a) - order(b) || alerts(b.h, b.x).length - alerts(a.h, a.x).length || a.h.sym.localeCompare(b.h.sym));
    host.innerHTML = (list.length ? summaryCard(rows) : `<article class="card"><h2 class="card-title">Noch keine Aktien eingetragen</h2><p class="small">Tragen Sie unten Ihre erste Aktie mit Kaufpreis ein – die Seite zeigt dann Ergebnis, Risiko, ob Halten oder Raus und Nachrichten.</p></article>`)
      + (list.length ? `<article class="card" data-section="Aktien"><div class="card-head"><h2 class="card-title">Ihre Aktien</h2><span class="muted small">${loading && !stocks ? "Lade Kennzahlen …" : "„Verkauf prüfen“ zuerst"}</span></div><div class="pf-list">${rows.map(r => card(r.h)).join("")}</div></article>` : "")
      + formCard() + notifyCard();
    const extra = $("portfolioExtra");
    if (extra) extra.innerHTML = taxCard() + backupCard() + methodCard();
    for (const id of open.chart) {
      const el = document.getElementById(`pfChart-${id}`);
      if (el && window.DTD.bigChart) window.DTD.bigChart(el.id, el.dataset.tv);
    }
    for (const id of open.news) {
      const el = document.getElementById(`pfNews-${id}`);
      if (el && typeof tvWidget === "function") tvWidget(el.id, "timeline", { ...COMMON, feedMode: "symbol", symbol: el.dataset.tv, displayMode: "regular", width: "100%", height: 420 });
    }
    restoreForm(kept);
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
    if (editId) list = list.map(h => (h.id === editId ? { ...h, ...rec } : h));
    else list.push({ id: `p${Date.now().toString(36)}`, ...rec });
    editId = null;
    clearForm = true;
    save();
    render();
    note(`${sym} gespeichert.`);
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
    if (act === "del" && h) { if (confirm(`${h.sym} aus dem Portfolio entfernen?`)) { list = list.filter(x => x.id !== id); open.exit.delete(id); open.news.delete(id); open.chart.delete(id); save(); render(); } return; }
    if (act === "notify") { Notification.requestPermission().then(() => render()); return; }
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
    const t = Date.now();
    const shared = !force && window.DTD.stockData ? window.DTD.stockData() : null;
    const [s1, s2, w1, w2, f] = await Promise.all([
      shared ? Promise.resolve(shared) : get(`data/stocks.json?t=${t}`), shared ? Promise.resolve(null) : get(`${BASE}stocks.json?t=${t}`),
      get(`data/swing.json?t=${t}`), get(`${BASE}swing.json?t=${t}`), firms ? Promise.resolve(firms) : get(`data/firms.json?t=${t}`),
    ]);
    const next = newest([s1, s2]);
    if (next && Array.isArray(next.items)) stocks = next;
    swing = newest([w1, w2]) || swing;
    if (f && f.firms) firms = f;
    loading = false;
    render();
  }
  window.DTD.startPortfolio = () => load(false);
  window.DTD.reloadPortfolio = () => load(true);
  window.DTD.portfolioCount = () => list.length;
  // neuer oder gelöschter Trade im Journal: nur den Steuer-Schätzer neu rechnen
  window.addEventListener("dtd:journal", () => { const el = $("pfTax"); if (el && !$("portfolio").hidden) el.outerHTML = taxCard(); });
  // Mit Bestand gleich beim Öffnen der Seite die Hinweise rechnen (Zahl am Reiter, Browser-Meldungen)
  if (list.length) setTimeout(() => load(false), 1500);
})();

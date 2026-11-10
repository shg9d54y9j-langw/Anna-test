// ---------- Merkliste: Stern bei jeder Aktie, Liste im Portfolio und auf der Startseite ----------
// Bleibt nur in diesem Browser (localStorage, Schlüssel dtd-watch) – wie das Portfolio nirgends hochgeladen.
(() => {
  const KEY = "dtd-watch";
  const SYM = /^[A-Z0-9][A-Z0-9.\-_:]{0,24}$/;
  const S = window.DTD.shared;
  const list = () => { const l = store.get(KEY, []); return Array.isArray(l) ? l.filter(s => typeof s === "string" && SYM.test(s)).slice(0, 80) : []; };
  const has = sym => list().includes(sym);
  const sign = (x, d = 1) => (Number.isFinite(x) ? (x > 0 ? "+" : "") + fmt(x, d) : "–");
  const pc = (x, d = 1) => (Number.isFinite(x) ? `<span class="${x < 0 ? "down" : "up"}">${sign(x, d)} %</span>` : "–");
  const price = x => (!Number.isFinite(x) ? "–" : x >= 1000 ? fmt(x, 0) : x >= 1 ? fmt(x, 2) : fmt(x, 4));
  const dDate = iso => new Date(`${String(iso).slice(0, 10)}T12:00:00Z`).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
  const PLAN = { buy: ["Kaufzone", "green"], wait: ["Order", "yellow"], alert: ["Alarm", "yellow"], watch: ["Beobachten", ""], avoid: ["Finger weg", "red"] };
  const starTitle = on => (on ? "Von der Merkliste nehmen" : "Auf die Merkliste setzen");
  const star = (sym, cls = "") => { const on = has(sym); return `<button type="button" class="star ${cls}" data-watch="${esc(sym)}" aria-pressed="${on}" title="${starTitle(on)}" aria-label="${esc(sym)}: ${starTitle(on)}">${on ? "★" : "☆"}</button>`; };
  function toggle(sym) {
    const l = list(), on = !l.includes(sym);
    store.set(KEY, on ? [sym, ...l] : l.filter(s => s !== sym));
    document.querySelectorAll("[data-watch]").forEach(b => { if (b.dataset.watch !== sym) return; b.setAttribute("aria-pressed", String(on)); b.textContent = on ? "★" : "☆"; b.title = starTitle(on); b.setAttribute("aria-label", `${sym}: ${starTitle(on)}`); });
    toast("Merkliste", on ? `${sym} gemerkt – zu finden im Portfolio und auf der Startseite.` : `${sym} von der Merkliste genommen.`, 3500);
    render();
    window.dispatchEvent(new CustomEvent("dtd:watch", { detail: { sym, on } }));
  }
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-watch]");
    if (!b || !b.dataset.watch) return;
    e.preventDefault();
    e.stopPropagation();
    toggle(b.dataset.watch);
  });

  // Eine Zeile je gemerkter Aktie: Kurs, Tag, Note, Trend, Swing-Planer, nächste Zahlen
  function row(sym, compact = false) {
    const x = S.item(sym), s = window.DTD.score ? window.DTD.score(sym) : null, plan = S.setup(sym);
    const p = plan && PLAN[plan.state];
    // Trend wie im Screener: aufwärts = über dem 200er, 50er über dem 200er, Momentum positiv
    const s50 = x && Number.isFinite(x.d50) ? x.last / (1 + x.d50 / 100) : null, s200 = x && Number.isFinite(x.d200) ? x.last / (1 + x.d200 / 100) : null;
    const trend = s50 === null || s200 === null ? null : x.d200 > 0 && s50 > s200 && x.mom > 0 ? ["Aufwärts", "green"] : x.d200 < 0 && (s50 < s200 || x.mom < 0) ? ["Abwärts", "red"] : ["Offen", "yellow"];
    const days = x && x.earn && x.earn.date ? Math.round((Date.parse(`${x.earn.date}T12:00:00Z`) - Date.now()) / 864e5) : null;
    return `<div class="w-row">
      <button type="button" class="chip-btn" data-open="${esc(sym)}">${esc(sym)}</button>
      <div class="w-main"><button type="button" class="name-link w-name" data-open="${esc(sym)}">${esc(x ? x.name : "noch ohne Kennzahlen")}</button>
        <div class="muted small">${x ? `${price(x.last)} · heute ${pc(x.chg1d)}${compact ? "" : ` · 12 Mon. ${pc(x.ret12m, 0)}`}` : "erscheint nach dem nächsten Datenlauf, sofern bei eToro"}${days !== null && days >= 0 && days <= 14 ? ` · <b>Zahlen ${days === 0 ? "heute" : `am ${dDate(x.earn.date)}`}</b>` : ""}</div></div>
      <div class="w-tags">${s && Number.isFinite(s.note) ? `<span class="w-note ${window.DTD.scoreTone(s.note)}" title="Gesamtnote">${s.note}</span>` : ""}${!compact && trend ? `<span class="light ${trend[1]}">${trend[0]}</span>` : ""}${p ? `<span class="light ${p[1]}" title="Swing-Planer">${p[0]}</span>` : ""}</div>
      ${star(sym)}
    </div>`;
  }
  function render() {
    const host = $("watchBody");
    if (!host || $("portfolio").hidden) return;
    const l = list();
    host.innerHTML = l.length
      ? `<div class="w-list">${l.map(s => row(s)).join("")}</div><p class="hint">Note = Gesamtnote 0–100 (im Aktien-Check erklärt). Tippen Sie auf den Stern, um eine Aktie zu entfernen.</p>`
      : `<article class="card"><p class="small">Noch nichts gemerkt. Tippen Sie bei einer Aktie auf den Stern ☆ – im Aktien-Check, im Screener, bei HotStuff oder im Swing-Planer. Die Merkliste bleibt nur in diesem Browser.</p></article>`;
  }
  window.DTD.watch = { list, has, toggle, star, row };
  window.DTD.renderWatch = () => S.all().then(() => (window.DTD.scoreReady ? window.DTD.scoreReady() : null)).then(render);
  window.addEventListener("dtd:shared", () => render());
  window.addEventListener("dtd:view", e => { if (e.detail === "portfolio") window.DTD.renderWatch(); });
})();

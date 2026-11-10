// ---------- Klickbare Nachrichten: antippen → was die Meldung bedeutet, wie Kurse meist reagieren, betroffene Aktien ----------
// Daten: Zweig news-data (scripts/news-data.mjs, an Börsentagen 4×): news.json (Markt, bewegte Aktien) und co/KÜRZEL.json
// (Firmennachrichten der letzten 7 Tage, nur US-Aktien). Die Einordnung nach Nachrichtentyp kommt aus dem Datenlauf,
// die Erklärungen und die Forschung dazu stehen hier. Depot und Merkliste bleiben im Browser – geladen werden nur Dateien.
(() => {
  const RAW = "https://raw.githubusercontent.com/shg9d54y9j-langw/Anna-test/news-data/";
  const get = url => fetch(url, { cache: "no-store" }).then(r => (r.ok ? r.json() : null)).catch(() => null);
  const S = window.DTD.shared;
  const fin = v => Number.isFinite(v);
  const SYM = /^[A-Z0-9][A-Z0-9.\-_]{0,24}$/;
  // Nachrichtentypen: Titel, was es bedeutet, wie Kurse meist reagieren (mit Belegen), was Sie tun können
  const T = {
    earnings_beat: ["Zahlen über den Erwartungen", "Die Firma hat im Quartal mehr verdient oder umgesetzt, als Analysten im Schnitt erwartet hatten.", "Oft steigt der Kurs am Zahlentag – bei großen Überraschungen driftet er noch Wochen nach (Bernard & Thomas 1989), bei großen, viel beachteten Aktien heute schwächer (Martineau 2022). Entscheidend ist oft der Ausblick: Schwacher Ausblick trotz guter Zahlen lässt den Kurs trotzdem fallen.", "Nicht dem ersten Kurssprung hinterherlaufen. Im Swing-Planer prüfen, ob die Aktie in der Kaufzone liegt, und auf den Ausblick achten."],
    earnings_miss: ["Zahlen unter den Erwartungen", "Die Firma hat weniger verdient oder umgesetzt als erwartet.", "Der Kurs fällt meist sofort; negative Überraschungen wirken ebenfalls nach. Mehrere Enttäuschungen hintereinander sind ein Warnsignal.", "Wer die Aktie hält: Stop prüfen. Fällt sie unter den 200-Tage-Schnitt, ist der Trend gebrochen – Verkauf prüfen."],
    earnings: ["Quartalszahlen", "Die Firma legt ihre Zahlen für das Quartal vor oder kündigt sie an.", "Am Zahlentag springt der Kurs oft um ein Vielfaches der normalen Tagesspanne – in beide Richtungen.", "Vor den Zahlen keine neuen Positionen; der Swing-Planer pausiert 10 Tage vorher."],
    guidance_up: ["Prognose angehoben", "Das Management erwartet für das Jahr mehr Umsatz oder Gewinn als bisher angekündigt.", "Eines der stärksten positiven Signale: Analysten heben danach meist ihre Schätzungen an, und solche Schätzungs-Änderungen ziehen Kurse nach (Chan, Jegadeesh & Lakonishok 1996).", "Gute Kandidaten für die Merkliste – kaufen, wenn der Trend passt und die Aktie nicht überhitzt ist."],
    guidance_down: ["Prognose gesenkt", "Das Management erwartet weniger Umsatz oder Gewinn als bisher angekündigt.", "Löst oft heftige Verluste aus; Analysten senken danach ihre Schätzungen, was weiter belasten kann.", "Wer hält: Plan prüfen – gilt der Grund für den Kauf noch? Stop eng nachziehen."],
    upgrade: ["Hochstufung durch Analysten", "Ein Analyst rät jetzt eher zum Kauf als vorher.", "Am Tag der Hochstufung steigen Kurse im Schnitt um 1–3 % und driften leicht nach (Womack 1996); Hochstufungen großer Banken wirken stärker, gegen den Trend hält der Effekt selten.", "Nur zusammen mit dem Trend ernst nehmen – im Aktien-Check Gesamtnote und Trend ansehen."],
    downgrade: ["Herabstufung durch Analysten", "Ein Analyst ist skeptischer geworden und rät eher zum Halten oder Verkaufen.", "Herabstufungen wirken stärker und länger als Hochstufungen (Womack 1996) – Banken stufen ungern ab.", "Wer hält: genau hinsehen, besonders wenn der Kurs auch unter den 50-Tage-Schnitt fällt."],
    price_target: ["Neues Kursziel", "Ein Analyst ändert seine Schätzung, wo der Kurs in 12 Monaten stehen könnte.", "Kursziele sind im Schnitt zu optimistisch; die Richtung (angehoben oder gesenkt) sagt mehr als die Höhe.", "Als Stimmungsbild nehmen, nicht als Ziel für eigene Orders."],
    merger: ["Übernahme oder Fusion", "Eine Firma will eine andere kaufen oder mit ihr zusammengehen.", "Die übernommene Firma springt meist bis knapp unter den Angebotspreis; der Käufer fällt im Schnitt leicht, weil er oft zu viel bezahlt (Andrade, Mitchell & Stafford 2001).", "Beim Übernahmeziel ist danach wenig Luft nach oben, aber das Risiko, dass der Deal platzt. Beim Käufer: Preis und Finanzierung prüfen."],
    buyback: ["Aktienrückkauf", "Die Firma kauft eigene Aktien zurück – der Gewinn verteilt sich auf weniger Aktien.", "Firmen, die Rückkäufe ankündigen, schnitten in den Jahren danach im Schnitt besser ab (Ikenberry, Lakonishok & Vermaelen 1995) – das Management hält die Aktie offenbar für günstig.", "Positives Zeichen, aber kein Kaufgrund allein – Trend und Bewertung zählen weiter."],
    dividend: ["Dividende", "Die Firma ändert ihre Gewinnausschüttung an die Aktionäre.", "Erhöhungen werden positiv aufgenommen, Kürzungen oder Streichungen lösen oft deutliche Verluste aus (Michaely, Thaler & Womack 1995).", "Bei Kürzungen fragen, warum: Geldsorgen oder Umbau? In Österreich fallen 27,5 % KESt auf Dividenden an."],
    offering: ["Kapitalerhöhung oder Aktienverkauf", "Die Firma gibt neue Aktien oder Wandelanleihen aus, um Geld einzusammeln.", "Neue Aktien verwässern die Anteile; Kurse fallen meist bei der Ankündigung, und Firmen nach Kapitalerhöhungen hinkten jahrelang hinterher (Loughran & Ritter 1995).", "Bei kleinen, verlustreichen Firmen häufig – ein Hinweis, dass das Geld knapp ist."],
    legal: ["Klage, Ermittlung oder Strafe", "Behörden ermitteln, es gibt eine Klage, Strafe oder einen Vergleich.", "Unsicherheit belastet den Kurs; wie stark, hängt von der möglichen Strafe im Verhältnis zur Firmengröße ab. Steht die Summe fest, ist es oft eingepreist.", "Größe des Risikos einschätzen: Kleine Strafe für einen Konzern ist meist ein Kaufgrund-Rauschen, eine existenzielle Klage nicht."],
    approval: ["Zulassung (z. B. FDA)", "Eine Behörde hat ein Medikament oder Produkt zugelassen.", "Bei kleinen Biotech-Firmen sind Sprünge von 20–100 % möglich, bei Konzernen wenig – oft war die Zulassung schon teilweise erwartet („sell the news“).", "Nach großen Sprüngen nicht hinterherkaufen – ein Rücksetzer ist häufig."],
    rejection: ["Ablehnung oder gescheiterte Studie", "Eine Behörde lehnt ab oder eine wichtige Studie ist gescheitert.", "Bei kleinen Firmen oft ein Absturz um 50 % und mehr, weil der Wert an diesem einen Produkt hängt.", "Darum Biotech-Einzelwerte nur klein gewichten."],
    layoffs: ["Stellenabbau oder Umbau", "Die Firma streicht Stellen oder baut das Geschäft um.", "Märkte reagieren oft positiv, wenn es nach Effizienz aussieht (Kosten sinken) – negativ, wenn es auf schwache Nachfrage hindeutet.", "Lesen, warum: Sparprogramm aus Stärke oder Notbremse?"],
    management: ["Wechsel an der Spitze", "Ein Chef oder Finanzchef geht oder kommt.", "Plötzliche Rücktritte verunsichern; geplante Nachfolgen bewegen kaum.", "Bei überraschenden Abgängen des Finanzchefs besonders aufmerksam sein."],
    contract: ["Auftrag oder Partnerschaft", "Die Firma meldet einen Auftrag, eine Partnerschaft oder einen Vertrag.", "Bei kleinen Firmen kann ein großer Auftrag den Kurs deutlich bewegen, bei Konzernen selten.", "Größe des Auftrags mit dem Jahresumsatz vergleichen."],
    product: ["Neues Produkt", "Die Firma stellt ein neues Produkt oder einen Dienst vor.", "Meist geringe Kurswirkung, außer bei Schlüsselprodukten.", "Wirkung zeigt sich erst in den nächsten Quartalszahlen."],
    macro_rates: ["Zinsen und Notenbank", "Es geht um die Leitzinsen der US-Notenbank (Fed) oder der EZB.", "Sinkende Zinsen stützen Aktien, besonders Wachstumswerte und Immobilienfirmen; steigende Zinsen belasten sie. Banken verdienen eher an höheren Zinsen.", "An Tagen von Zinsentscheiden keine neuen Positionen kurz vor der Veröffentlichung."],
    macro_inflation: ["Inflation", "Neue Zahlen zur Teuerung (Verbraucherpreise CPI, PCE, Erzeugerpreise).", "Höher als erwartet → Sorge vor höheren Zinsen → Aktien, vor allem Technologie, fallen; niedriger → Erleichterung.", "Inflationsdaten kommen um 14:30 Uhr unserer Zeit – davor und kurz danach nicht handeln."],
    macro_jobs: ["Arbeitsmarkt", "Neue Zahlen zu Jobs, Arbeitslosigkeit oder Anträgen auf Arbeitslosenhilfe.", "Ein starker Arbeitsmarkt stützt Konsum und Gewinne, kann aber Zinssenkungen hinauszögern – deshalb reagiert die Börse manchmal scheinbar paradox.", "Der Arbeitsmarktbericht kommt meist am ersten Freitag im Monat um 14:30 Uhr."],
    tariffs: ["Zölle und Handelsstreit", "Neue Zölle, Exportverbote oder Sanktionen.", "Belastet Firmen mit Lieferketten oder Umsatz im betroffenen Land (Halbleiter, Autos, Industrie); kann heimische Hersteller stützen.", "Prüfen, wie viel Umsatz Ihre Firmen im betroffenen Land machen."],
    oil: ["Ölpreis", "Der Ölpreis bewegt sich, oft wegen OPEC-Entscheidungen oder Konflikten.", "Steigender Ölpreis hilft Energiefirmen und belastet Fluglinien, Chemie und Konsum; er schürt Inflationssorgen.", "Energie-Aktien schwanken mit dem Ölpreis – Positionsgröße anpassen."],
    crypto: ["Krypto", "Bitcoin und andere Kryptowerte bewegen sich.", "Krypto-nahe Aktien (Börsen, Miner, Firmen mit Bitcoin in der Bilanz) schwanken oft doppelt so stark wie Bitcoin selbst.", "Nur mit Geld, dessen Verlust Sie verkraften."],
    bankruptcy: ["Insolvenz", "Die Firma hat Insolvenz oder Gläubigerschutz (in den USA „Chapter 11“) beantragt.", "Für Aktionäre oft ein Totalverlust oder fast: Bei einer Sanierung werden meist zuerst Gläubiger bedient, die alten Aktien verlieren den größten Teil ihres Werts.", "Nicht auf eine Wende spekulieren – Insolvenz-Aktien sind reine Lotterie."],
    general: ["Meldung", "Eine allgemeine Meldung ohne klar erkannten Typ.", "Ohne Einordnung lässt sich wenig zur typischen Kursreaktion sagen.", "Im Artikel nachlesen, worum es geht."],
  };
  const TONE = { pos: ["positiv", "green"], neg: ["negativ", "red"], neu: ["neutral", ""] };
  // passende Wirtschaftstermine (econ.js) zu Zins-, Inflations- und Arbeitsmarktnachrichten
  const ECON = { macro_rates: [["fomc", "Fed-Zinsentscheid"], ["ecb", "EZB-Zinsentscheid"]], macro_inflation: [["cpi", "Verbraucherpreise"], ["pce", "Kern-PCE"]], macro_jobs: [["nfp", "Arbeitsmarktbericht"], ["claims", "Erstanträge"]], oil: [["oilinv", "US-Ölbestände"]] };
  let main = null, mainAt = 0;
  const co = new Map();   // Kürzel → Promise der Firmennachrichten
  const byId = new Map();
  // ein Abruf für alle, die gleichzeitig fragen; neu nach 10 Minuten – fehlt die Datei, höchstens alle 2 Minuten ein neuer Versuch
  let mainP = null, mainTried = 0;
  const loadMain = (force = false) => {
    if (mainP) return mainP;
    const fresh = main ? Date.now() - mainAt < 10 * 60 * 1000 : mainTried && Date.now() - mainTried < 2 * 60 * 1000;
    if (!force && fresh) return Promise.resolve(main);
    mainTried = Date.now();
    mainP = get(`${RAW}news.json?t=${Date.now()}`).then(d => { if (d && Array.isArray(d.market)) { main = d; mainAt = Date.now(); } return main; }).finally(() => { mainP = null; });
    return mainP;
  };
  const loadCo = sym => {
    if (!SYM.test(sym) || sym.includes(".")) return Promise.resolve([]);
    if (!co.has(sym)) co.set(sym, loadMain().then(m => (m && Array.isArray(m.syms) && !m.syms.includes(sym) ? null : get(`${RAW}co/${encodeURIComponent(sym)}.json?t=${Date.now()}`))).then(d => (d && Array.isArray(d.items) ? d.items : [])));
    return co.get(sym);
  };
  const ago = d => { const m = Math.round((Date.now() / 1000 - d) / 60); return m < 60 ? `vor ${Math.max(1, m)} Min.` : m < 1440 ? `vor ${Math.round(m / 60)} Std.` : `vor ${Math.round(m / 1440)} T.`; };
  const tag = n => { const t = T[n.type] || T.general, [tl, c] = TONE[n.tone] || TONE.neu; return `<span class="light ${c}" title="${tl}">${t[0]}</span>`; };
  function item(n, sym = "") {
    const id = `${sym || "m"}:${n.id}`;
    byId.set(id, { n, sym });
    return `<button type="button" class="nw-item${n.m === 0 ? " nw-mention" : ""}" data-news="${esc(id)}"><span class="nw-meta">${tag(n)}${n.m === 0 ? ` <span class="muted small" title="Die Schlagzeile nennt die Firma nicht – Sammel- oder Marktartikel">Erwähnung</span>` : ""} <span class="muted small">${esc(n.s || "")} · ${ago(n.d)}${n.rel && n.rel.length ? ` · ${n.rel.slice(0, 3).map(esc).join(", ")}` : ""}</span></span><span class="nw-t">${esc(n.t)}</span></button>`;
  }
  const list = (items, sym = "", empty = "Keine Meldungen.") => (items.length ? `<div class="nw-list">${items.map(n => item(n, sym || (n.rel && n.rel[0]) || "")).join("")}</div>` : `<p class="muted small">${empty}</p>`);
  const total = r => (r ? r.sb + r.b + r.h + r.s + r.ss : 0);
  const buy = r => (total(r) >= 5 ? (r.sb + r.b) / total(r) : null);
  const PLAN = { buy: "Kaufzone", wait: "Order", alert: "Kursalarm", watch: "Beobachten", avoid: "Finger weg" };
  // Betroffene Aktie: Kurs, Tag, Trend, Gesamtnote, Analysten, nächste Zahlen, Swing-Planer
  function stockBox(sym) {
    const x = S.item(sym);
    if (!x) return `<div class="nw-stock"><button type="button" class="chip-btn" data-open="${esc(sym)}">${esc(sym)}</button> <span class="muted small">nicht in den Aktien-Daten dieser Seite</span></div>`;
    const s = window.DTD.score ? window.DTD.score(sym) : null, b = buy(x.rec), bp = buy(x.recPrev), p = S.setup(sym);
    const trend = x.d200 > 0 && x.mom > 0 ? ["Aufwärtstrend", "green"] : x.d200 < 0 ? ["unter dem 200-Tage-Schnitt", "red"] : ["Trend offen", "yellow"];
    const pc = v => (fin(v) ? `<span class="${v < 0 ? "down" : "up"}">${v > 0 ? "+" : ""}${fmt(v, 1)} %</span>` : "–");
    return `<div class="nw-stock">
      <div class="nw-stock-head"><button type="button" class="chip-btn" data-open="${esc(sym)}">${esc(sym)}</button><b>${esc(x.name)}</b>${window.DTD.watch ? window.DTD.watch.star(sym, "sm") : ""}</div>
      <p class="small">Kurs ${fmt(x.last, x.last >= 1000 ? 0 : 2)} · heute ${pc(x.chg1d)} · 3 Monate ${pc(x.ret3m)} · <span class="light ${trend[1]}">${trend[0]}</span>${s && fin(s.note) ? ` · Gesamtnote <b class="${window.DTD.scoreTone(s.note)}">${s.note}</b>` : ""}</p>
      ${b !== null ? `<p class="small"><b>Analysten:</b> ${fmt(b * 100, 0)} % von ${total(x.rec)} raten zum Kauf${bp !== null ? ` (Vormonat ${fmt(bp * 100, 0)} %${b - bp >= 0.05 ? " – optimistischer geworden" : b - bp <= -0.05 ? " – skeptischer geworden" : ""})` : ""}.</p>` : ""}
      <p class="small muted">${x.earn && x.earn.date ? `Nächste Zahlen ${new Date(`${x.earn.date}T12:00:00Z`).toLocaleDateString("de-DE")} · ` : ""}${p && PLAN[p.state] ? `Swing-Planer: ${PLAN[p.state]}` : "nicht im Swing-Planer"}</p>
    </div>`;
  }
  async function openNews(id) {
    const e = byId.get(id);
    if (!e) return;
    const { n } = e, t = T[n.type] || T.general;
    const syms = [...new Set([e.sym, ...(n.rel || [])].filter(s => s && SYM.test(s)))].slice(0, 3);
    await S.load("stocks");
    if (window.DTD.scoreReady) await window.DTD.scoreReady();
    const more = e.sym ? (await loadCo(e.sym)).filter(m => m.id !== n.id).slice(0, 5) : [];
    openDrawer(t[0], `<p class="nw-d-meta">${tag(n)} <span class="muted small">${esc(n.s || "")} · ${new Date(n.d * 1000).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })} Uhr</span></p>
      <h3 class="nw-d-t">${esc(n.t)}</h3>
      ${n.sum ? `<p class="small muted">Kurzfassung der Quelle (Englisch): ${esc(n.sum)}</p>` : ""}
      <p><a class="btn ghost" href="${esc(n.u)}" target="_blank" rel="noopener noreferrer">Artikel lesen ↗</a></p>
      <h3 class="swing-h3">Was bedeutet das?</h3><p>${t[1]}</p>
      <h3 class="swing-h3">Wie reagiert der Kurs meist?</h3><p>${t[2]}</p>
      <h3 class="swing-h3">Was Sie tun können</h3><p>${t[3]}</p>
      ${ECON[n.type] ? `<p>${ECON[n.type].map(([k, l]) => `<button type="button" class="btn ghost small-btn" data-econ="${k}">Termin erklärt: ${l}</button>`).join(" ")}</p>` : ""}
      ${syms.length ? `<h3 class="swing-h3">Betroffene Aktie${syms.length > 1 ? "n" : ""} – Daten und Expertenmeinung</h3>${syms.map(stockBox).join("")}` : ""}
      ${more.length ? `<h3 class="swing-h3">Weitere Meldungen zu ${esc(e.sym)}</h3>${list(more, e.sym)}` : ""}
      <p class="muted small" style="margin-top:14px">Einordnung automatisch nach Schlagwörtern der Schlagzeile – sie kann danebenliegen. Keine Anlageberatung.</p>`);
  }
  document.addEventListener("click", ev => {
    const b = ev.target.closest("[data-news]");
    if (!b) return;
    ev.preventDefault();
    openNews(b.dataset.news);
  });

  // ---------- Bereich Markt: Meine Aktien · Markt · Bewegte Aktien ----------
  const SY = /^[A-Z0-9][A-Z0-9.\-_:]{0,24}$/;
  const mine = () => { const d = store.get("dtd-portfolio", []), w = window.DTD.watch ? window.DTD.watch.list() : []; return [...new Set([...(Array.isArray(d) ? d.map(h => h && h.sym) : []), ...w])].filter(s => typeof s === "string" && SY.test(s) && !s.includes(".")).slice(0, 25); };
  let tab = store.get("dtd-news-tab", "") || "";
  async function renderMarket() {
    const host = $("newsBody");
    if (!host) return;
    const m = await loadMain();
    if (!m) { host.innerHTML = `<p class="muted small">Die eingeordneten Nachrichten kommen mit dem ersten Nachrichten-Lauf (an Börsentagen 4×). Darunter die Live-Nachrichten von TradingView.</p>`; return; }
    const my = mine();
    if (!tab) tab = my.length ? "mine" : "market";
    let body = "";
    if (tab === "mine") {
      const all = (await Promise.all(my.map(s => loadCo(s).then(l => l.map(n => ({ ...n, rel: [s, ...(n.rel || []).filter(r => r !== s)] })))))).flat().sort((a, b) => b.d - a.d).slice(0, 25);
      body = my.length ? list(all, "", "Zu Ihren Aktien gibt es in den letzten 7 Tagen keine eingeordneten Meldungen (nur US-Aktien).") : `<p class="small">Tragen Sie Aktien im Portfolio ein oder merken Sie sie mit ☆ – dann stehen hier ihre Nachrichten.</p>`;
    } else if (tab === "market") body = list(m.market.slice(0, 30), "", "Gerade keine Marktnachrichten.");
    else body = list(m.hot.slice(0, 25), "", "Keine Meldungen.");
    host.innerHTML = `<div class="seg wrap-seg" role="group" aria-label="Auswahl">${[["mine", `Meine Aktien${my.length ? ` (${my.length})` : ""}`], ["market", "Markt"], ["hot", "Bewegte Aktien"]].map(([k, l]) => `<button type="button" data-news-tab="${k}" aria-pressed="${tab === k}">${l}</button>`).join("")}</div>
      <p class="muted small" style="margin:8px 0">Stand ${new Date(m.updated).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })} Uhr · Meldung antippen: was sie bedeutet, wie Kurse meist reagieren, betroffene Aktien mit Analystenmeinung.</p>${body}`;
  }
  document.addEventListener("click", ev => {
    const b = ev.target.closest("[data-news-tab]");
    if (!b) return;
    tab = b.dataset.newsTab;
    store.set("dtd-news-tab", tab);
    renderMarket();
  });
  // ---------- Liste für eine Aktie (Aktien-Check, Portfolio) ----------
  async function fillNews(el, sym) {
    if (!el) return;
    if (sym.includes(".") || !SYM.test(sym)) { el.innerHTML = `<p class="muted small">Eingeordnete Nachrichten gibt es nur für US-Aktien – unten die Live-Nachrichten von TradingView.</p>`; return; }
    const l = await loadCo(sym);
    if (!el.isConnected) return;
    el.innerHTML = l.length ? `<p class="muted small" style="margin:0 0 8px">Antippen für die Erklärung – was die Meldung bedeutet und wie Kurse meist reagieren.</p>${list(l, sym)}` : `<p class="muted small">Keine eingeordneten Meldungen der letzten 7 Tage – unten die Live-Nachrichten von TradingView.</p>`;
  }
  // ---------- „Warum bewegt sie sich?“: neueste eingeordnete Meldung der letzten 3 Tage neben großen Bewegungen ----------
  // Platzhalter <span data-why="KÜRZEL"></span> füllen (Aktien-Check, Merkliste, Startseite, Hinweise, HotStuff)
  async function fillWhy(root = document) {
    const els = [...root.querySelectorAll("[data-why]:not([data-why-done])")];
    for (const el of els) {
      el.dataset.whyDone = "1";
      const sym = el.dataset.why;
      const l = (await loadCo(sym)).filter(n => Date.now() / 1000 - n.d <= 3 * 86400 && n.m !== 0);
      const n = l.find(m => m.type !== "general") || l[0];
      if (!n || !el.isConnected) continue;
      const id = `${sym}:${n.id}`;
      byId.set(id, { n, sym });
      el.innerHTML = `<button type="button" class="why-btn" data-news="${esc(id)}"><b>Warum?</b> ${tag(n)} <span class="why-t">${esc(n.t)}</span></button>`;
    }
  }
  window.DTD.fillWhy = fillWhy;
  window.DTD.startNews = renderMarket;
  window.DTD.fillNews = fillNews;
  window.DTD.newsFor = loadCo;
  window.DTD.newsMain = loadMain;
  window.DTD.newsTypes = T;
  window.DTD.openNews = openNews;
  window.DTD.newsItem = item;
  window.addEventListener("dtd:watch", () => { if ($("newsBody") && !$("markt").hidden && tab === "mine") renderMarket(); });
})();

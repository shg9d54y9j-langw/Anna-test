// ---------- Tagesbriefing: die wichtigsten Punkte des Tages, nach Dringlichkeit ----------
// Ganz oben auf der Startseite: Stops und Kursalarme zuerst, dann Warnungen zu Depot-Aktien, Quartalszahlen heute und morgen,
// Zinsentscheid, Marktlage, Chancen auf der Merkliste und die fällige Sicherung. Höchstens fünf Punkte – der Rest steht in den
// Karten darunter. Alles wird im Browser aus den vorhandenen Daten berechnet; nichts wird hochgeladen.
(() => {
  const S = window.DTD.shared;
  const fin = Number.isFinite;
  const SYM = /^[A-Z0-9][A-Z0-9.\-_:]{0,24}$/;
  const price = v => (!fin(v) ? "–" : v >= 1000 ? fmt(v, 0) : v >= 1 ? fmt(v, 2) : fmt(v, 4));
  const viennaDay = (t = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Vienna", year: "numeric", month: "2-digit", day: "2-digit" }).format(t);
  const addDays = (iso, n) => { const t = new Date(`${iso}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
  const holdings = () => { const l = store.get("dtd-portfolio", []); return Array.isArray(l) ? l.filter(h => h && typeof h.sym === "string" && SYM.test(h.sym)) : []; };
  const alarms = () => { const l = store.get("dtd-alarms", []); return Array.isArray(l) ? l.filter(a => a && SYM.test(a.sym) && fin(a.price) && (a.dir === "up" || a.dir === "down")) : []; };
  const watched = () => (window.DTD.watch ? window.DTD.watch.list() : []);
  const LIGHT_TXT = { green: "Rückenwind", yellow: "gemischte Lage", red: "Gegenwind" };

  // Punkte mit Rang: 0 = sofort handeln, 1 = heute prüfen, 2 = gut zu wissen, 3 = Erinnerung
  function items() {
    const out = [], seen = new Set();
    const add = (rank, tone, text, extra = {}) => { const k = `${extra.sym || ""}|${text}`; if (!seen.has(k)) { seen.add(k); out.push({ rank, tone, text, ...extra }); } };
    const today = viennaDay(), tomorrow = addDays(today, 1);
    const hs = holdings(), mine = new Set(hs.map(h => h.sym)), watch = new Set(watched().filter(s => !mine.has(s)));
    // Stops
    for (const h of hs) {
      const x = S.item(h.sym);
      if (!x || !fin(x.last) || !fin(h.stop) || !(h.stop > 0)) continue;
      const dist = (x.last / h.stop - 1) * 100;
      if (x.last <= h.stop || (fin(x.lo1d) && x.lo1d <= h.stop)) add(0, "down", `${h.sym} hat Ihren Stop ${price(h.stop)} erreicht (zuletzt ${price(x.last)}) – in eToro prüfen, ob verkauft wurde.`, { sym: h.sym });
      else if (dist <= 3) add(1, "warn", `${h.sym} liegt nur ${fmt(dist, 1)} % über Ihrem Stop ${price(h.stop)}.`, { sym: h.sym });
    }
    // Kursalarme
    for (const a of alarms()) {
      const x = S.item(a.sym);
      if (!x || !fin(x.last)) continue;
      const hit = a.dir === "up" ? x.last >= a.price || (fin(x.hi1d) && x.hi1d >= a.price) : x.last <= a.price || (fin(x.lo1d) && x.lo1d <= a.price);
      if (hit) add(0, a.dir === "up" ? "up" : "down", `Kursalarm ${a.sym} ${a.dir === "up" ? "über" : "unter"} ${price(a.price)} erreicht (zuletzt ${price(x.last)}).`, { sym: a.sym });
    }
    // Quartalszahlen heute und morgen
    for (const sym of [...mine, ...watch]) {
      const x = S.item(sym);
      if (!x || !x.earn || (x.earn.date !== today && x.earn.date !== tomorrow)) continue;
      const when = `${x.earn.date === today ? "heute" : "morgen"}${x.earn.hour === "bmo" ? " vor Börsenbeginn" : x.earn.hour === "amc" ? " nach Börsenschluss" : ""}`;
      add(mine.has(sym) ? 1 : 2, "info", `${sym} meldet ${when} Quartalszahlen${mine.has(sym) ? " – der Kurs kann stark springen, Stop prüfen" : ""}.`, { sym });
    }
    // Hinweise zu den Aktien: Warnungen im Depot, Chancen auf der Merkliste
    const smart = window.DTD.smartAlerts ? window.DTD.smartAlerts() : [];
    for (const a of smart) {
      if (a.type === "earn") continue;   // steht schon oben
      if (a.where === "Depot" && (a.level === "high" || a.level === "warn")) add(a.level === "high" ? 1 : 2, a.level === "high" ? "down" : "warn", `${a.sym} ${a.text}`, { sym: a.sym });
      if (a.where === "Merkliste" && a.level === "good" && (a.type === "swing" || a.type === "note")) add(2, "up", `${a.sym} ${a.text}`, { sym: a.sym });
    }
    // Zinsentscheid heute oder morgen
    for (const d of window.DTD.nextMarketDates ? window.DTD.nextMarketDates() : []) {
      const day = viennaDay(d.date);
      if (/Zinsentscheid/.test(d.title) && (day === today || day === tomorrow)) add(1, "info", `${day === today ? "Heute" : "Morgen"} ${d.date.toLocaleTimeString("de-DE", { timeZone: "Europe/Vienna", hour: "2-digit", minute: "2-digit" })} Uhr: ${d.title} – rund um die Bekanntgabe keine neuen Trades.`, { href: "#econ" });
    }
    // Marktlage
    const m = window.DTD.market, o = m && m.overall;
    if (o && LIGHT_TXT[o.light]) {
      const size = fin(o.sizeFactor) ? Math.round(o.sizeFactor * 100) : null;
      add(o.light === "red" ? 1 : 3, o.light === "red" ? "down" : o.light === "green" ? "up" : "warn",
        `Marktlage: ${LIGHT_TXT[o.light]}${size !== null && size < 100 ? ` – neue Positionen mit ${size} % der üblichen Größe` : o.light === "green" ? " – Trendfolge-Regeln erlauben volle Positionen" : ""}.`, { href: "#markt" });
    }
    // Sicherung
    if (window.DTD.backupDue && window.DTD.backupDue()) add(3, "info", "Sicherung fällig – Depot, Merkliste und Einstellungen als Datei sichern.", { href: "#pfBackup" });
    return out.sort((a, b) => a.rank - b.rank);
  }
  const ICON = { down: ["▼", "down"], warn: ["!", "warn-t"], up: ["▲", "up"], info: ["i", "muted"] };
  function card() {
    if (!S.get("stocks")) return "";
    const all = items(), top = all.slice(0, 5);
    const urgent = all.filter(i => i.rank <= 1).length;
    const date = new Date().toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Vienna" });
    const row = i => `<li class="brief-row${i.rank === 0 ? ` now ${i.tone}` : ""}"><span class="sa-icon ${ICON[i.tone][1]}" aria-hidden="true">${ICON[i.tone][0]}</span><span class="brief-t">${i.sym ? `<button type="button" class="name-link" data-open="${esc(i.sym)}">${esc(i.text)}</button>` : i.href ? `<a href="${i.href}">${esc(i.text)}</a>` : esc(i.text)}</span></li>`;
    const hs = holdings().length + watched().length;
    return `<article class="card brief" id="briefing" data-section="Heute">
      <div class="card-head"><h2 class="card-title">Heute wichtig</h2><span class="muted small">${date}</span></div>
      ${top.length ? `<ol class="brief-list">${top.map(row).join("")}</ol>` : `<p class="small">Heute nichts Dringendes${hs ? " – Ihre Aktien sind ruhig" : ""}.</p>`}
      <p class="muted small brief-foot">${urgent ? `${urgent} ${urgent === 1 ? "Punkt" : "Punkte"} heute prüfen` : "Kein dringender Punkt"}${all.length > top.length ? ` · ${all.length - top.length} weitere in den Karten darunter` : ""}${!hs ? ' · <a href="#portfolio">Depot eintragen</a>, damit das Briefing Ihre Aktien kennt' : ""}</p>
    </article>`;
  }
  window.DTD.briefingItems = items;
  window.DTD.briefingCard = card;
})();

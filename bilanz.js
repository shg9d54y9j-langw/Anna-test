// ---------- Note-Bilanz: Hat die Gesamtnote die besseren Aktien gefunden? ----------
// Daten: note-track.json auf dem Zweig stock-data (scripts/note-track.mjs, mit jedem Lauf der Aktien-Daten). An jedem Börsentag
// wird die Note aller Aktien gespeichert; gemessen wird ab dem Schlusskurs dieses Tages – nur mit Kursen, die danach kamen.
// Karte im Bereich Werkzeuge (#notebilanz), Verweis aus der Gesamtnote im Aktien-Check.
(() => {
  const SRC = "https://raw.githubusercontent.com/shg9d54y9j-langw/Anna-test/stock-data/note-track.json";
  const fin = v => Number.isFinite(v);
  // Vorzeichen nach dem gerundeten Wert: +0,04 wird „±0,0“, nicht „+0,0“
  const pp = (v, d = 1) => { if (!fin(v)) return "–"; const r = Math.round(v * 10 ** d) / 10 ** d; return `${r > 0 ? "+" : r < 0 ? "−" : "±"}${fmt(Math.abs(r), d)}`; };
  const pct = (v, d = 1) => (fin(v) ? `${pp(v, d)} %` : "–");
  const dDate = iso => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }) : "–");
  const dShort = iso => new Date(`${iso}T12:00:00Z`).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
  let data = null, loading = null, failed = false, at = 0;

  function load(force = false) {
    if (loading) return loading;
    if (data && !force && Date.now() - at < 10 * 60e3) return Promise.resolve(data);
    loading = fetch(`${SRC}?t=${Date.now()}`, { cache: "no-store" }).then(r => (r.ok ? r.json() : r.status === 404 ? { days: 0 } : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(d => { data = d && typeof d === "object" ? d : { days: 0 }; failed = false; at = Date.now(); return data; })
      .catch(() => { failed = !data; return data; })
      .finally(() => { loading = null; fill(); });
    return loading;
  }

  // Aussagekraft nach Zahl der Messtage (überlappende Zeiträume sind nicht unabhängig – daher vorsichtig)
  const strength = days => (days >= 60 ? "gut" : days >= 20 ? "mittel" : "gering");
  function verdict(d) {
    const hz = d.horizons.filter(h => h.days > 0 && h.g && h.g["80"] && h.g["0"]);
    if (!hz.length) return "";
    const h = hz.find(x => x.h === 21 && x.days >= 5) || hz.find(x => x.h === 63 && x.days >= 5) || hz[0];
    const top = h.g["80"], low = h.g["0"];
    const how = top.rel > 0 && low.rel < 0 ? "Bisher trennt die Note: " : top.rel <= 0 && low.rel >= 0 ? "Bisher hat die Note die besseren Aktien <b>nicht</b> gefunden: " : "Bisher kein klares Bild: ";
    return `<p class="nt-verdict">${how}Aktien mit Note 80–100 lagen nach ${{ 5: "einer Woche", 21: "einem Monat", 63: "drei Monaten" }[h.h] || h.label} im Schnitt <b class="${top.rel < 0 ? "down" : "up"}">${pp(top.rel)} Prozentpunkte</b> ${top.rel < 0 ? "hinter" : "vor"} dem Durchschnitt aller Aktien, Aktien mit 0–19 <b class="${low.rel < 0 ? "down" : "up"}">${pp(low.rel)} Punkte</b>. Die beste Stufe lag an ${top.win} von ${top.days} Messtagen vorne.</p>
      <p class="small muted">Aussagekraft: <b>${strength(h.days)}</b> – ${h.days} Messtag${h.days === 1 ? "" : "e"} für „${h.label}“${h.days < 20 ? ". Bei so wenigen Tagen spielt der Zufall noch eine große Rolle – eine einzige Marktbewegung kann das Bild drehen." : h.days < 60 ? ". Ein erstes Bild, aber noch keine Gewissheit." : "."}</p>`;
  }
  function table(d) {
    const H = d.horizons;
    const cell = (h, k) => {
      if (!h.days) return `<td class="num muted small">ab ${dShort(h.firstAt)}</td>`;
      const g = k === "all" ? h.all : h.g[k];
      if (!g) return `<td class="num muted">–</td>`;
      if (k === "all") return `<td class="num"><b>${pct(g.avg)}</b><span class="nt-sub">Ø aller</span><span class="nt-sub">Aktien</span></td>`;
      return `<td class="num"><b class="${g.rel < 0 ? "down" : g.rel > 0 ? "up" : ""}">${pp(g.rel)}</b><span class="nt-sub">Ø ${pct(g.avg)}</span><span class="nt-sub nt-hit">${g.hit} % Treffer</span></td>`;
    };
    return `<div class="table-wrap"><table class="scr nt-table"><thead><tr><th>Note</th>${H.map(h => `<th class="num">${h.label}</th>`).join("")}</tr></thead>
      <tbody>${d.groups.map(g => `<tr><td><b>${g.label}</b><span class="nt-sub">${g.name}</span></td>${H.map(h => cell(h, g.k)).join("")}</tr>`).join("")}
        <tr class="nt-all"><td><b>Alle</b><span class="nt-sub">${fmt(d.stocks, 0)} Aktien</span></td>${H.map(h => cell(h, "all")).join("")}</tr></tbody></table></div>
      <p class="small muted">Große Zahl: Vorsprung in Prozentpunkten gegenüber dem Durchschnitt aller Aktien am selben Tag (so fällt die allgemeine Marktbewegung heraus). Darunter die durchschnittliche Rendite und (auf größeren Bildschirmen) wie viele Aktien besser liefen als die mittlere Aktie – 50 % wäre Zufall.</p>`;
  }
  function body() {
    if (!data) return failed ? `<p class="muted small">Die Note-Bilanz ist gerade nicht erreichbar – bitte später noch einmal öffnen.</p>` : `<p class="muted small">Lade die Note-Bilanz …</p>`;
    const d = data;
    if (!d.days || !Array.isArray(d.horizons)) return `<p class="small">Ab dem nächsten Lauf der Aktien-Daten (an Börsentagen um 9:20 und 14:35 Uhr) merkt sich die Seite jeden Tag die Note aller Aktien. Danach steht hier, wie die Aktien je Notenstufe gelaufen sind – die erste Wochen-Bilanz gibt es eine gute Woche später.</p>`;
    const any = d.horizons.some(h => h.days > 0);
    const w = d.horizons.find(h => h.h === 5), m = d.horizons.find(h => h.h === 21);
    const curve = d.curve && Array.isArray(d.curve.dates) && d.curve.dates.length >= 3;
    return `<p class="small">Seit dem ${dDate(d.since)} merkt sich die Seite an jedem Börsentag die Gesamtnote aller ${fmt(d.stocks, 0)} Aktien – bisher ${d.days} Messtag${d.days === 1 ? "" : "e"}. Gemessen wird ab dem Schlusskurs dieses Tages, also nur mit Kursen, die erst danach kamen.</p>
      ${any ? verdict(d) : `<p class="nt-verdict">Noch zu früh für eine Bilanz: Die erste Wochen-Bilanz kommt voraussichtlich am <b>${dDate(w && w.firstAt)}</b>, die erste Monats-Bilanz am <b>${dDate(m && m.firstAt)}</b>.</p>`}
      ${table(d)}
      ${curve ? `<h3 class="swing-h3" style="margin-top:18px">Körbe je Notenstufe seit dem ${dDate(d.since)}</h3>
        <div class="legend-row"><span class="legend-item"><span class="lkey" style="background:${PAL.series1}"></span>Note 80–100</span><span class="legend-item"><span class="lkey dash" style="color:${PAL.gray}"></span>Alle Aktien</span><span class="legend-item"><span class="lkey dot" style="color:${PAL.series2}"></span>Note 0–19</span></div>
        <div class="chart-host" id="ntChart"></div>
        <p class="small muted">An jedem Messtag neu zusammengestellt, alle Aktien gleich gewichtet; ohne Gebühren, Spreads und Steuern.</p>` : ""}
      <details class="more"><summary>So wird gemessen</summary><ul class="checklist small">
        <li>Gespeichert wird nur die Note, die am Messtag galt – spätere Änderungen der Note oder der Formel ändern die Vergangenheit nicht.</li>
        <li>Rendite vom Schlusskurs des Messtags bis 5, 21 oder 63 Börsentage später (eine Woche, ein Monat, drei Monate), je Aktie an ihrer eigenen Börse.</li>
        <li>Vorsprung: Durchschnitt der Notenstufe minus Durchschnitt aller Aktien desselben Tages. Treffer: Anteil der Aktien der Stufe, die besser liefen als die mittlere Aktie (Median).</li>
        <li>Zeiträume aufeinanderfolgender Messtage überlappen sich – 20 Messtage sind daher weniger wert als 20 unabhängige Versuche.</li>
        <li>Die Kurse dafür kommen von eToro (Tageskerzen) und bleiben im Lauf auf GitHub; veröffentlicht werden nur Noten und Durchschnitte.</li>
        <li>Keine Anlageberatung: Was bisher funktioniert hat, muss nicht weiter funktionieren.</li>
      </ul></details>`;
  }
  function card() {
    if (!data && !loading && !failed) load();
    return `<article class="card" id="notebilanz" data-section="Note-Bilanz"><div class="card-head"><h2 class="card-title">Note-Bilanz</h2><span class="muted small">Trifft die Gesamtnote die besseren Aktien?</span></div><div id="ntBody">${body()}</div></article>`;
  }
  function fill() {
    const el = document.getElementById("ntBody");
    if (!el) return;
    el.innerHTML = body();
    draw();
  }

  // ---------- Diagramm: Körbe je Notenstufe (drei Linien, Fadenkreuz mit Werten) ----------
  function niceTicks(min, max, count) {
    const span = max - min || 1, step0 = span / count, mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const step = [1, 2, 2.5, 5, 10].map(s => s * mag).find(s => span / s <= count) || 10 * mag;
    const out = [];
    for (let v = Math.floor(min / step) * step; v <= max + step * 0.001; v += step) out.push(+v.toFixed(6));
    if (out[out.length - 1] < max) out.push(out[out.length - 1] + step);
    return out;
  }
  function draw() {
    const host = document.getElementById("ntChart"), c = data && data.curve;
    if (!host || !c || !Array.isArray(c.dates) || c.dates.length < 3 || !host.clientWidth) return;
    const W = Math.max(240, host.clientWidth), H = W < 520 ? 220 : 260, m = { l: 52, r: W < 520 ? 12 : 136, t: 12, b: 26 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b, N = c.dates.length - 1;
    const S = [
      { key: "top", name: "Note 80–100", short: "80–100", color: PAL.series1, width: 2.5, dash: "" },
      { key: "all", name: "Alle Aktien", short: "Alle", color: PAL.gray, width: 2, dash: "5 4" },
      { key: "low", name: "Note 0–19", short: "0–19", color: PAL.series2, width: 2, dash: "1.5 3.5" },
    ];
    const all = S.flatMap(s => c[s.key]).filter(fin);
    const ticks = niceTicks(Math.min(0, ...all), Math.max(0, ...all), 4);
    const y0 = ticks[0], y1 = ticks[ticks.length - 1];
    const X = i => m.l + (N ? i / N : 0) * pw, Y = v => m.t + (y1 - v) / (y1 - y0 || 1) * ph;
    const path = g => g.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join("");
    const end = s => c[s.key][N];
    const labels = W < 520 ? "" : S.map(s => ({ s, y: Y(end(s)), v: end(s) })).sort((a, b) => a.y - b.y)
      .map((o, k, arr) => { if (k && o.y - arr[k - 1].y < 15) o.y = arr[k - 1].y + 15; return o; })
      .map(o => `<text class="dlabel" x="${m.l + pw + 8}" y="${o.y + 4}">${pct(o.v)} · ${o.s.short}</text>`).join("");
    host.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="group" aria-label="Körbe je Notenstufe seit ${dDate(c.dates[0])}: Note 80–100 ${pct(end(S[0]))}, alle Aktien ${pct(end(S[1]))}, Note 0–19 ${pct(end(S[2]))}">
      ${ticks.map(t => `<line class="${t === 0 ? "base" : "grid"}" x1="${m.l}" x2="${m.l + pw}" y1="${Y(t)}" y2="${Y(t)}"/><text class="tick" x="${m.l - 6}" y="${Y(t) + 4}" text-anchor="end">${t > 0 ? "+" : ""}${fmt(t, Math.abs(y1 - y0) < 4 ? 1 : 0)} %</text>`).join("")}
      ${S.slice().reverse().map(s => `<path d="${path(c[s.key])}" fill="none" stroke="${s.color}" stroke-width="${s.width}" stroke-dasharray="${s.dash}" stroke-linejoin="round" stroke-linecap="round"/>`).join("")}
      ${S.map(s => `<circle cx="${X(N)}" cy="${Y(end(s))}" r="4" fill="${s.color}" stroke="${PAL.surface}" stroke-width="2"/>`).join("")}
      ${labels}
      <text class="tick" x="${m.l}" y="${H - 6}">${dShort(c.dates[0])}</text>
      <text class="tick" x="${m.l + pw}" y="${H - 6}" text-anchor="end">${dShort(c.dates[N])}</text>
      <line class="cross" x1="0" x2="0" y1="${m.t}" y2="${m.t + ph}" visibility="hidden"/>
      <rect class="hit" x="${m.l}" y="${m.t}" width="${pw}" height="${ph}" fill="transparent" tabindex="0" role="slider" aria-valuemin="0" aria-valuemax="${N}" aria-valuenow="${N}" aria-label="Werte je Messtag anzeigen (Pfeiltasten)"/>
    </svg>`;
    const svg = host.querySelector("svg"), cross = svg.querySelector(".cross"), hit = svg.querySelector(".hit");
    let tip = host.querySelector(".viz-tip");
    if (!tip) { tip = document.createElement("div"); tip.className = "viz-tip"; tip.hidden = true; host.append(tip); }
    let idx = N;
    const show = i => {
      idx = Math.max(0, Math.min(N, i));
      const x = X(idx);
      cross.setAttribute("x1", x); cross.setAttribute("x2", x); cross.setAttribute("visibility", "visible");
      tip.innerHTML = `<div class="tip-head">${dDate(c.dates[idx])}</div>` + S.map(s => `<div class="tip-row"><span class="lkey${s.key === "all" ? " dash" : s.key === "low" ? " dot" : ""}" style="${s.key === "top" ? `background:${s.color}` : `color:${s.color}`}"></span>${s.name}: <strong>${pct(c[s.key][idx])}</strong></div>`).join("");
      tip.hidden = false;
      hit.setAttribute("aria-valuenow", String(idx)); hit.setAttribute("aria-valuetext", tip.textContent.replace(/\s+/g, " ").trim());
      const wTip = tip.offsetWidth;
      tip.style.left = `${x + 12 + wTip > host.clientWidth ? Math.max(8, x - wTip - 12) : x + 12}px`;
      tip.style.top = "8px";
    };
    const hide = () => { cross.setAttribute("visibility", "hidden"); tip.hidden = true; };
    const fromEvent = e => { const b = svg.getBoundingClientRect(); return Math.round(((e.clientX - b.left) * (W / b.width) - m.l) / pw * N); };
    hit.addEventListener("pointermove", e => show(fromEvent(e)));
    hit.addEventListener("pointerleave", hide);
    hit.addEventListener("focus", () => show(idx));
    hit.addEventListener("blur", hide);
    hit.addEventListener("keydown", e => { if (e.key === "ArrowLeft") { show(idx - 1); e.preventDefault(); } if (e.key === "ArrowRight") { show(idx + 1); e.preventDefault(); } });
  }
  let lastW = 0;
  window.addEventListener("resize", () => { const el = document.getElementById("ntChart"); if (el && Math.abs(el.clientWidth - lastW) > 30) { lastW = el.clientWidth; draw(); } });

  window.DTD.noteTrackCard = card;
  window.DTD.noteTrackDraw = draw;
  window.DTD.noteTrack = () => data;
  window.DTD.noteTrackLoad = load;
})();

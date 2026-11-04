// ---------- Tagesempfehlung & Top 25 ----------
// Liest data/ranking.json (wird jeden Börsentag vom GitHub-Job aktualisiert).
// Nutzt fmt, esc, kpi, v, warnBox und $ aus app.js.
(() => {
  const RAW = "https://raw.githubusercontent.com/shg9d54y9j-langw/Anna-test/claude/daytrade-website/data/ranking.json";
  const body = $("dailyBody");
  let data = null;

  const pct = p => (p > 0.995 ? "über 99 %" : p < 0.005 ? "unter 1 %" : `${fmt(p * 100, 0)} %`);
  const n1 = x => (Number.isFinite(x) ? fmt(x, 1) : "–");
  const profile = u => `https://www.etoro.com/people/${encodeURIComponent(u)}`;
  const link = u => `<a href="${profile(u)}" target="_blank" rel="noopener noreferrer">${esc(u)}</a>`;
  const okName = u => typeof u === "string" && /^[A-Za-z0-9_.-]{1,40}$/.test(u);   // nur gültige eToro-Namen anzeigen
  const dateDe = iso => new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
  const hold = h => (!Number.isFinite(h) ? "–" : h < 48 ? `${fmt(h, h < 10 ? 1 : 0)} Std.` : `${fmt(h / 24, 0)} Tage`);
  const account = () => { const x = parseFloat(($("sAccount") || {}).value); return Number.isFinite(x) && x > 0 ? x : null; };

  async function load() {
    const get = url => fetch(url, { cache: "no-store" }).then(r => (r.ok ? r.json() : null)).catch(() => null);
    const [local, raw] = await Promise.all([get("data/ranking.json"), get(RAW)]);
    const list = [local, raw].filter(d => d && d.updated);
    data = list.sort((a, b) => new Date(b.updated) - new Date(a.updated))[0] || null;
    render();
  }

  function setup() {
    $("dailyUpdated").textContent = "";
    body.innerHTML = `
      <div class="reco no">
        <div class="reco-head"><span class="icon-no">●</span> Noch keine Live-Daten</div>
        <p>Die Top 25 und die Tagesempfehlung werden jeden Börsentag um ca. 7 Uhr automatisch aus eToro-Daten berechnet. Dafür einmalig:</p>
        <ol class="steps">
          <li>In eToro: <b>Einstellungen</b> → <b>Trading</b> → <b>API-Key-Verwaltung</b> → <b>„Neuen Schlüssel erstellen“</b>. Name: ${v("DayTrade Desk")}, Berechtigung: ${v("nur Lesen")}. Mit dem SMS-Code bestätigen und <b>beide</b> Schlüssel kopieren – der User Key wird nur einmal angezeigt.</li>
          <li>In GitHub: Repository → <b>Settings</b> → <b>Secrets and variables</b> → <b>Actions</b> → <b>„New repository secret“</b>. Zweimal anlegen: Name ${v("ETORO_API_KEY")} mit dem öffentlichen API-Schlüssel und Name ${v("ETORO_USER_KEY")} mit dem User Key.</li>
          <li>Unter <b>Actions</b> → <b>„Tagesempfehlung“</b> → <b>„Run workflow“</b> einmal von Hand starten. Nach ca. 5 Minuten erscheinen hier die Daten.</li>
        </ol>
        <p class="muted small">Die Schlüssel niemals in einen Chat oder in Dateien kopieren – nur in die GitHub-Secrets.</p>
      </div>`;
  }

  function render() {
    if (!data) return setup();
    const d = data, cfg = d.config || {};
    const rec = d.recommendation && okName(d.recommendation.userName) ? d.recommendation : null;
    if (rec && rec.previous && !okName(rec.previous)) rec.previous = null;
    const top = Array.isArray(d.top) ? d.top.filter(r => r && okName(r.userName)) : [];
    const ageDays = (Date.now() - new Date(d.updated)) / 864e5;
    $("dailyUpdated").textContent = `Stand: ${new Date(d.updated).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })} Uhr`;
    const acc = account();
    const notes = [];
    if (ageDays > 4) notes.push(`Die Daten sind ${fmt(ageDays, 0)} Tage alt – läuft die GitHub-Aktion „Tagesempfehlung“ noch?`);

    let head;
    if (rec) {
      const amount = acc ? Math.floor(rec.amountPct * acc + 1e-9) : null;
      const bindTxt = { share: `Ihren Max. Anteil von ${fmt((cfg.share || 0) * 100, 0)} % des Kontos`, loss: `das Verlustbudget von ${fmt((cfg.lossPct || 0) * 100, 0)} % des Kontos`, kelly: "das halbe Kelly-Kriterium" }[rec.bind] || "";
      const status = rec.changed
        ? `<p class="reco-sub"><b>Neu seit heute.</b> ${esc(rec.note || "")}</p>`
        : `<p class="reco-sub">Unverändert seit ${dateDe(rec.since)} · ${esc(rec.note || "")}</p>`;
      const steps = [];
      if (rec.changed && rec.previous) steps.push(`Bisherige Kopie beenden: <b>„Portfolio“</b> → ${v(esc(rec.previous))} antippen → Zahnrad → <b>„Kopieren beenden“</b>.`);
      steps.push(
        `Profil von ${link(rec.userName)} öffnen und auf <b>„Kopieren“</b> tippen.`,
        `<b>„Betrag“</b>: ${v(amount !== null ? `${fmt(amount, 0)} $` : `${fmt(rec.amountPct * 100, 0)} % Ihres Kontos`)} – begrenzt durch ${bindTxt}.`,
        `<b>„Copy Stop Loss“</b>: ${v(rec.csl + " %")} (1,25 × bisher größter Rückgang von ${n1(rec.mdd)} %).`,
        `Häkchen <b>„Offene Trades kopieren“</b>: ${v("nicht setzen")}, dann mit <b>„Kopieren“</b> bestätigen.`,
      );
      head = `
        <div class="reco ok">
          <div class="reco-head"><span class="icon-ok">✓</span> Heute kopieren: ${link(rec.userName)}</div>
          ${status}
          <div class="result">
            ${kpi("Betrag", amount !== null ? `${fmt(amount, 0)} $` : `${fmt(rec.amountPct * 100, 0)} % vom Konto`)}
            ${kpi("Copy Stop Loss", `${rec.csl} %`, "down")}
            ${kpi("Können-Sicherheit", pct(rec.dsr), "up")}
            ${kpi("Rendite p.a.", `${n1(rec.cagr)} %`, "up")}
            ${kpi("Max. Drawdown", `${n1(rec.mdd)} %`, "down")}
          </div>
          <ol class="steps">${steps.map(s => `<li>${s}</li>`).join("")}</ol>
          ${acc ? "" : `<p class="muted small">Tragen Sie unten im Trader-Vergleich unter „Ihre Grenzen“ Ihren Kontostand ein, dann steht hier der Betrag in Dollar.</p>`}
        </div>`;
    } else {
      head = `
        <div class="reco no">
          <div class="reco-head"><span class="icon-no">✗</span> Heute keine Empfehlung</div>
          <p>${esc(d.notice || "Heute erfüllt kein Trader alle Bedingungen.")}</p>
          <p class="muted small">Das ist kein Fehler: Kein geprüfter Trader erreicht nach der Glücks-Korrektur eine Können-Sicherheit von ${pct(cfg.threshold || 0.9)}. Lieber keine Empfehlung als eine geratene.</p>
        </div>`;
    }

    const basis = `Geprüft: ${d.evaluated} der ${d.screened} meistkopierten Popular Investors mit Risiko-Score bis ${cfg.maxRisk} und mindestens ${cfg.minMonths} Monaten Historie.
      Glücks-Korrektur für effektiv ${fmt(d.nEff, 0)} unabhängige Trader (mittlere Korrelation ${fmt(d.avgCorrelation, 2)}).
      ${d.qualifiedCount} ${d.qualifiedCount === 1 ? "erfüllt" : "erfüllen"} alle Bedingungen (Können-Sicherheit ab ${pct(cfg.threshold || 0.9)}, Drawdown bis ${cfg.maxDd} %).`;

    const rows = top.map(r => `<tr>
        <td>${r.rank}</td>
        <td>${link(r.userName)}</td>
        <td>${r.qualified ? `<span class="tag good">✓ sicher</span>` : `<span class="tag bad"><span class="x">✗</span> ${esc(r.reason || "")}</span>`}</td>
        <td>${pct(r.dsr)}</td>
        <td>${n1(r.cagr)} %</td>
        <td>${n1(r.mdd)} %</td>
        <td>${Number.isFinite(r.sharpe) ? fmt(r.sharpe, 2) : "–"}</td>
        <td>${r.risk ?? "–"}</td>
        <td>${Number.isFinite(r.copiers) ? r.copiers.toLocaleString("de-DE") : "–"}</td>
        <td>${hold(r.avgHoldHours)}</td>
        <td>${r.months}</td>
      </tr>`).join("");

    body.innerHTML = `
      ${head}
      ${warnBox(notes)}
      <p class="hint">${basis}</p>
      <h3>Top 25</h3>
      <p class="muted small">Sortierung: zuerst alle sicheren Trader nach Rendite, danach die übrigen nach Können-Sicherheit. Rendite und Drawdown aus den Monatsrenditen der letzten bis zu ${cfg.maxMonths} Monate.</p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Platz</th><th>Trader</th><th>Ergebnis</th><th>Können-Sicherheit</th><th>Rendite p.a.</th><th>Max. Drawdown</th><th>Sharpe</th><th>Risiko</th><th>Kopierer</th><th>Ø Haltedauer</th><th>Monate</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="11" class="muted">Keine Trader innerhalb der Grenzen.</td></tr>`}</tbody>
        </table>
      </div>
      <p class="muted small">Vergangene Renditen garantieren nichts. Die Sicherheit gibt an, wie wahrscheinlich die bisherige Leistung Können statt Glück war – nicht, dass sie weitergeht.</p>`;
  }

  const settings = $("cmpSettings");
  if (settings) settings.addEventListener("input", () => data && render());
  load();
})();

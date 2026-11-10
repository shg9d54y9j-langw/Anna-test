// ---------- „Neu in RojkoMoney“: neue Funktionen auf der Startseite, jede mit einem Tipp erreichbar ----------
// Erscheint, solange es Einträge gibt, die noch nicht als gelesen markiert sind (localStorage dtd-wn-seen = neuester Eintrag).
(() => {
  const SEEN = "dtd-wn-seen";
  // neueste zuerst; href = Sprungziel (Bereich oder Abschnitt), act = besondere Aktion
  const NEW = [
    { id: "2026-11-10-lots", t: "Nachkäufe und Teilverkäufe", d: "Bei jeder Aktie im Portfolio: Nachkauf zum Durchschnittspreis (wie die österreichische KESt rechnet) und Teilverkauf – der Gewinn landet automatisch im Journal und im Steuer-Schätzer.", href: "#portfolio" },
    { id: "2026-11-10-risers", t: "Notenverlauf, Aufsteiger und Notenalarm", d: "Im Aktien-Check steht, wie sich die Gesamtnote entwickelt hat; im Screener gibt es die Vorlage „Aufsteiger“, und ein smarter Alarm meldet, wenn eine Ihrer Aktien unter Note 40 fällt oder über 80 steigt. Erste Vergleiche nach einer Woche.", href: "#screener" },
    { id: "2026-11-10-finance", t: "Finanzkraft-Ampel", d: "Im Aktien-Check: bis zu acht Bilanz-Prüfungen nach dem Piotroski-Prinzip (Gewinn, Geldzufluss, Schulden, Liquidität, Marge, Effizienz) mit Ampel; dazu die Screener-Vorlage „Finanzstark im Aufwärtstrend“. Die Jahreswerte kommen mit dem Kennzahlen-Lauf heute Nacht.", href: "#aktie" },
    { id: "2026-11-10-stress", t: "Stresstest fürs Depot", d: "In der Depot-Analyse: wie viel Ihr Depot ungefähr verliert, wenn der Markt um 10, 20 oder 30 % fällt – und welche Aktien es am stärksten trifft.", href: "#pfMix" },
    { id: "2026-11-10-similar", t: "Ähnliche Aktien", d: "Im Aktien-Check: die fünf Aktien mit dem ähnlichsten Profil aus Trend, Qualität, Bewertung, Wachstum, Experten und Sicherheit – auch aus anderen Branchen.", href: "#aktie" },
    { id: "2026-11-10-since", t: "Seit Ihrem letzten Besuch", d: "Beim Öffnen: wie sich Ihre Depot- und Merklisten-Aktien seitdem bewegt haben und wo sich die Gesamtnote deutlich geändert hat.", href: "#home" },
    { id: "2026-11-10-notebilanz", t: "Note-Bilanz", d: "Prüft ab heute jeden Börsentag, ob Aktien mit hoher Gesamtnote danach wirklich besser laufen – mit Urteil, Tabelle und Verlauf.", href: "#notebilanz" },
    { id: "2026-11-10-backup", t: "Sicherung als Datei", d: "Depot, Merkliste, Journal, Alarme und Einstellungen als Datei sichern und auf einem neuen Handy laden – mit Rückgängig.", href: "#pfBackup" },
    { id: "2026-11-10-speed", t: "Schneller am Handy", d: "Jede Datei kommt nur noch einmal übers Netz (rund 40 % weniger Daten pro Start), Tabellen zeichnen schneller." },
    { id: "2026-11-10-offline", t: "Als App und ohne Netz", d: "Im Browser „Zum Home-Bildschirm“ wählen: startet wie eine App und zeigt ohne Netz den letzten Stand." },
    { id: "2026-11-10-theory", t: "Theorie aufgeräumt", d: "Firmenlisten, Risiken und Quellen klappen auf – die Seite ist am Handy nur noch halb so lang.", href: "#theorie" },
    { id: "2026-11-10-mix", t: "Depot-Analyse", d: "Aufteilung nach Branche, Region, Währung und Risiko, Warnungen bei Klumpenrisiken und eine Depot-Note.", href: "#pfMix" },
    { id: "2026-11-10-econ", t: "Wirtschaftstermine erklärt", d: "Inflation, Arbeitsmarkt, Fed, EZB und mehr: was gemessen wird, wann, und welche Branchen es trifft.", href: "#econ" },
    { id: "2026-11-10-presets", t: "Neue Screener-Vorlagen", d: "Beste Gesamtnote, Qualität, Wachstum, ruhige Aktien und Experten-Lieblinge mit einem Tipp.", href: "#screener" },
    { id: "2026-11-10-earn", t: "Quartalszahlen und echte Konkurrenten", d: "Im Aktien-Check: die letzten vier Quartale gegen die Schätzung und die direkten Konkurrenten.", href: "#aktie" },
    { id: "2026-11-10-why", t: "„Warum?“ bei großen Bewegungen", d: "Bewegt sich eine Aktie stark, steht daneben die passende Schlagzeile – antippen erklärt sie." },
    { id: "2026-11-10-search", t: "Schnellsuche", d: "Oben die Lupe (am Computer Strg+K): auf jeder Seite eine Aktie suchen.", act: "search" },
  ];
  const BEFORE = [
    { t: "Klickbare Nachrichten", d: "Was eine Meldung bedeutet, wie Kurse meist reagieren, was zu tun ist.", href: "#newsExplained" },
    { t: "Smarte Alarme", d: "Trendbruch, Zahlen, Analysten und Insider für Depot und Merkliste.", href: "#hinweise" },
    { t: "Gesamtnote und Erklärung per Antippen", d: "Note 0–100 aus sechs Teilnoten; jede Kennzahl erklärt sich beim Antippen.", href: "#aktie" },
    { t: "Merkliste", d: "Stern bei jeder Aktie – Liste im Portfolio und hier auf der Startseite.", href: "#merkliste" },
    { t: "Vergleich und Konkurrenz", d: "2–4 Aktien nebeneinander, dazu jede Aktie gegen ihre Branche.", href: "#vergleich" },
    { t: "Branchen-Rotation", d: "Welche Branchen gerade kommen und welche gehen.", href: "#branchen" },
  ];
  const unseen = () => { const s = store.get(SEEN, ""); const i = NEW.findIndex(n => n.id === s); return i < 0 ? NEW : NEW.slice(0, i); };
  const item = n => `<li>${n.href ? `<a href="${n.href}">` : n.act ? `<button type="button" class="link-btn" data-wn-act="${n.act}">` : "<span>"}<b>${esc(n.t)}</b>${n.href ? " →" : ""}${n.href ? "</a>" : n.act ? "</button>" : "</span>"}<span class="wn-d">${esc(n.d)}</span></li>`;
  function card() {
    const fresh = unseen();
    if (!fresh.length) return "";
    // die vier neuesten offen, der Rest aufklappbar – sonst schiebt die Karte das Depot weit nach unten
    const top = fresh.slice(0, 4), more = fresh.slice(4), older = NEW.slice(fresh.length).concat(BEFORE);
    return `<article class="card whatsnew" data-section="Neu"><div class="card-head"><h2 class="card-title">Neu in RojkoMoney</h2><button type="button" class="btn ghost small-btn" data-wn-done>Gelesen</button></div>
      <ul class="wn-list">${top.map(item).join("")}</ul>
      ${more.length ? `<details class="more"><summary>${more.length} weitere neue Funktionen</summary><ul class="wn-list">${more.map(item).join("")}</ul></details>` : ""}
      <details class="more"><summary>Früher neu</summary><ul class="wn-list">${older.map(item).join("")}</ul></details>
    </article>`;
  }
  document.addEventListener("click", e => {
    if (e.target.closest("[data-wn-done]")) {
      store.set(SEEN, NEW[0].id);
      const c = e.target.closest(".whatsnew");
      if (c) c.remove();
      toast("Neu in RojkoMoney", "Als gelesen markiert – neue Funktionen erscheinen hier wieder.", 3500);
      return;
    }
    const a = e.target.closest("[data-wn-act]");
    if (a && a.dataset.wnAct === "search") {
      const box = document.querySelector(".qs"), input = document.getElementById("qsInput");
      if (box) box.classList.add("open");
      if (input) setTimeout(() => input.focus(), 30);
    }
  });
  window.DTD.whatsNewCard = card;
})();

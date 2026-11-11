// ---------- „Neu in RojkoMoney“: neue Funktionen auf der Startseite, jede mit einem Tipp erreichbar ----------
// Erscheint, solange es Einträge gibt, die noch nicht als gelesen markiert sind (localStorage dtd-wn-seen = neuester Eintrag).
(() => {
  const SEEN = "dtd-wn-seen";
  // neueste zuerst; href = Sprungziel (Bereich oder Abschnitt), act = besondere Aktion
  const NEW = [
    { id: "2026-11-11-europa", t: "Europäische und österreichische Aktien", d: "Die Aktien-Daten führen jetzt auch Werte, die bei eToro selten gehandelt werden: österreichische wie Porr, Erste Group, Verbund oder voestalpine, dazu DAX und MDAX, die Schweiz und Europas Große. Die Suche versteht deutsche Namen in jeder Schreibweise („Münchener Rück“, „Muenchener“) und Wiener Kürzel wie „POS“; im Screener gibt es Deutschland, Österreich und die Schweiz als Region.", href: "#aktie" },
    { id: "2026-11-11-lernt", t: "Note lernt dazu", d: "Die Note-Bilanz misst jetzt auch, wie treffsicher jede der sechs Teilnoten ist. Ab etwa sechs Monaten Messung passt die Seite die Gewichte der Gesamtnote vorsichtig daran an – begrenzt und offen zu sehen in der Note-Bilanz.", href: "#notebilanz" },
    { id: "2026-11-11-wischen", t: "Wischen am Handy", d: "Nach links oder rechts wischen wechselt zum nächsten oder vorherigen Bereich – in Tabellen, Diagrammen und Leisten bleibt Wischen deren Sache. Abschaltbar unter „Seite anpassen“.", act: "layout" },
    { id: "2026-11-11-datenstand", t: "Datenstand an der Live-Uhr", d: "Ein Tipp auf die Live-Uhr oben zeigt, wann jede Auswertung zuletzt kam – ein gelber oder roter Punkt warnt bei Verspätung oder Ausfall. Ausfälle und ihre Behebung kommen auch aufs Handy (ntfy).", act: "status" },
    { id: "2026-11-11-alarme15", t: "Kursalarme und Stops alle 15 Minuten", d: "Mit Handy-Meldungen (ntfy) prüft der Live-Wächter Ihre Kursalarme und Stops an Börsentagen etwa alle 15 Minuten – auch ein kurzes Unterschreiten des Stops zählt, jede Berührung kommt genau einmal. Ihre Kürzel bleiben dabei verschlüsselt.", href: "#pfPush" },
    { id: "2026-11-11-vermoegen", t: "Vermögen: langfristig anlegen", d: "Neuer Bereich: Ihr Anlegerprofil, ein Musterportfolio aus breit gestreuten ETFs mit erwarteter Rendite und Bandbreite, Rebalancing-Helfer, Steuern in Österreich – und was die Forschung dazu sagt, mit Quellen. Der Forschungsstand wird jeden Monat geprüft, Zinsen und Inflation kommen täglich von der EZB.", href: "#wProfil" },
    { id: "2026-11-11-bots", t: "Bots & Copy-Trading: eigener Knopf", d: "Trend-Bot, Copy-Trading und Tagesempfehlung stehen jetzt gemeinsam hinter dem Knopf „Bots & Copy-Trading“ oben in der Kopfzeile – getrennt von den übrigen Bereichen. Alte Links funktionieren weiter.", href: "#bot" },
    { id: "2026-11-11-sparplan", t: "Sparplan-Rechner", d: "Im Bereich Vermögen: was aus einer monatlichen ETF-Rate wird – mit Zinseszins, Kosten, 27,5 % KESt nach österreichischem Recht und Inflation. Mit Ziel: wann Sie es erreichen und welche Rate dafür nötig ist.", href: "#sparplan" },
    { id: "2026-11-10-journal", t: "Journal-Auswertung", d: "Unter dem Journal: was ein Trade im Schnitt bringt, Ø Gewinn gegen Ø Verlust, Serien und welche Wochentage, Tageszeiten, Richtungen und Aktien bei Ihnen funktionieren – mit Einsichten in Worten. Schlagwörter in der Notiz (#breakout, #fomo) werden mit ausgewertet.", href: "#jInsights" },
    { id: "2026-11-10-risk", t: "Risiko-Check", d: "Im Portfolio: wie viel Sie verlieren, wenn alle Stops greifen – in Euro und in % des Depots, Positionen ohne Stop und je Aktie ein Vorschlag zur Größe nach Ihrem Risikobudget.", href: "#pfRisk" },
    { id: "2026-11-10-euro", t: "Depot in Euro", d: "Im Portfolio: Depotwert und Ergebnis in Euro mit EZB-Kursen – aufgeteilt in Kursgewinn und Währungseffekt, je Aktie und im Steuer-Schätzer (Kurs am Verkaufstag).", href: "#portfolio" },
    { id: "2026-11-10-briefing", t: "Heute wichtig", d: "Ganz oben auf der Startseite die fünf wichtigsten Punkte des Tages: Stops, Kursalarme, Zahlen, Zinsentscheid, Marktlage, Chancen auf der Merkliste. Auf Wunsch morgens als Handy-Meldung (Portfolio → Benachrichtigungen).", href: "#briefing" },
    { id: "2026-11-10-theme", t: "Hell oder dunkel", d: "Oben neben der Uhr: das Farbschema wie das Gerät, hell für Tageslicht oder dunkel – auch unter „Seite anpassen“." },
    { id: "2026-11-10-groups", t: "Sieben statt zwölf Bereiche", d: "Ähnliches ist zusammengelegt: „Ideen“ (HotStuff, Swing-Planer, Trade-Ideen, Theorie), „Bots“ (Trend-Bot, Copy-Trading) und „Trade planen“ im Aktien-Check – oben im Bereich umschalten. Am Handy stehen jetzt alle Bereiche direkt in der Leiste unten.", href: "#hot" },
    { id: "2026-11-10-design", t: "Neues Design", d: "Ruhiger und übersichtlicher: am Computer links alle Bereiche in Gruppen, klare Zahlen, farbige Ampeln, aufgeräumte Karten – am Handy die Leiste unten mit hervorgehobenem Bereich." },
    { id: "2026-11-10-push", t: "Meldungen aufs Handy", d: "Mit der kostenlosen App ntfy: Stop oder Kursalarm erreicht, Trendbruch, Kurssprung, Zahlen, Notenwechsel und wichtige Nachrichten – auch wenn die Seite zu ist, dazu freitags ein Wochenbericht. Einrichtung im Portfolio.", href: "#pfPush" },
    { id: "2026-11-10-layout", t: "Seite anpassen", d: "Bereiche und Karten der Startseite ausblenden oder umsortieren – unten auf der Startseite oder unter „Alle Themen“.", act: "layout" },
    { id: "2026-11-10-history", t: "Depot-Verlauf", d: "Im Portfolio: Ihr Depot Tag für Tag im Vergleich mit S&P 500 und MSCI World – zeitgewichtet, nur in Ihrem Browser gespeichert. Der Verlauf baut sich ab heute auf.", href: "#pfHist" },
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
    if (a && a.dataset.wnAct === "layout" && window.DTD.layout) return window.DTD.layout.open();
    if (a && a.dataset.wnAct === "status" && window.DTD.openDataStatus) return window.DTD.openDataStatus();
    if (a && a.dataset.wnAct === "search") {
      const box = document.querySelector(".qs"), input = document.getElementById("qsInput");
      if (box) box.classList.add("open");
      if (input) setTimeout(() => input.focus(), 30);
    }
  });
  window.DTD.whatsNewCard = card;
})();

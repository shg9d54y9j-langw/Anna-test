// ---------- Wirtschaftstermine erklärt: die wichtigsten Termine des Kalenders zum Antippen ----------
// Was gemessen wird, wann (Wiener Zeit), warum es die Kurse bewegt, welche Branchen profitieren oder leiden. Ergänzt den
// Wirtschaftskalender von TradingView im Bereich Markt (dort lässt sich nicht hineinklicken).
(() => {
  const E = [
    { k: "cpi", g: "USA", t: "Verbraucherpreise (CPI)", when: "monatlich um den 10.–15., 14:30 Uhr", what: "Wie stark die Preise für Verbraucher in den USA gestiegen sind – gesamt und ohne Energie und Lebensmittel („Kernrate“).", why: "Inflation entscheidet über die Zinsen der Fed. Höher als erwartet: Sorge vor höheren Zinsen, Aktien fallen – besonders Technologie und Wachstumswerte. Niedriger: Erleichterung.", sectors: "Leiden bei hoher Inflation: Technologie, Immobilien, Versorger. Profitieren eher: Energie, Rohstoffe, Banken." },
    { k: "pce", g: "USA", t: "Kern-PCE-Preisindex", when: "monatlich gegen Monatsende, 14:30 Uhr", what: "Das Inflationsmaß, auf das die Fed selbst am meisten schaut (Konsumausgaben ohne Energie und Lebensmittel).", why: "Wichtig für die nächsten Zinsentscheide; überrascht seltener als der CPI, weil vieles daraus schon bekannt ist.", sectors: "Wie beim CPI." },
    { k: "ppi", g: "USA", t: "Erzeugerpreise (PPI)", when: "monatlich, meist einen Tag nach dem CPI, 14:30 Uhr", what: "Preise, die Hersteller für ihre Waren bekommen – ein Frühindikator für die Verbraucherpreise.", why: "Steigende Erzeugerpreise drücken Margen oder werden an Kunden weitergegeben.", sectors: "Betrifft vor allem Industrie und Konsumgüter." },
    { k: "nfp", g: "USA", t: "Arbeitsmarktbericht (Nonfarm Payrolls)", when: "meist am ersten Freitag im Monat, 14:30 Uhr", what: "Neu geschaffene Stellen außerhalb der Landwirtschaft, Arbeitslosenquote und Stundenlöhne.", why: "Starker Arbeitsmarkt stützt Konsum und Gewinne, kann aber Zinssenkungen hinauszögern – deshalb reagiert die Börse oft scheinbar paradox. Einer der Termine mit den größten Kursausschlägen.", sectors: "Zyklische Branchen (Konsum, Industrie) reagieren am stärksten." },
    { k: "claims", g: "USA", t: "Erstanträge auf Arbeitslosenhilfe", when: "jeden Donnerstag, 14:30 Uhr", what: "Wie viele Menschen sich in der Woche neu arbeitslos gemeldet haben.", why: "Der schnellste Blick auf den Arbeitsmarkt; nur bei deutlichen Ausreißern kursbewegend.", sectors: "Breit über den Markt." },
    { k: "fomc", g: "USA", t: "Zinsentscheid der Fed (FOMC)", when: "8× im Jahr, 20:00 Uhr, Pressekonferenz 20:30 Uhr", what: "Die US-Notenbank legt den Leitzins fest und erklärt ihren Kurs; viermal im Jahr mit Zinsprognosen („Dot Plot“).", why: "Der wichtigste Termin für alle Märkte: Zinsen bestimmen, wie viel künftige Gewinne heute wert sind. Oft schwankt der Markt während der Pressekonferenz stark in beide Richtungen.", sectors: "Sinkende Zinsen helfen Wachstumswerten, Immobilien und kleinen Firmen; steigende Zinsen helfen eher Banken." },
    { k: "minutes", g: "USA", t: "Fed-Protokoll (Minutes)", when: "3 Wochen nach jedem Zinsentscheid, 20:00 Uhr", what: "Die ausführliche Mitschrift der letzten Fed-Sitzung.", why: "Zeigt, wie einig sich die Mitglieder waren – wichtig für die Erwartung des nächsten Schritts.", sectors: "Wie beim Zinsentscheid, meist schwächer." },
    { k: "gdp", g: "USA", t: "Wirtschaftswachstum (BIP)", when: "vierteljährlich, Ende des Folgemonats, 14:30 Uhr", what: "Wie stark die US-Wirtschaft im Quartal gewachsen ist (auf das Jahr hochgerechnet).", why: "Bestätigt oder widerlegt Rezessionssorgen; die erste Schätzung bewegt die Kurse am meisten.", sectors: "Zyklische Branchen profitieren von starkem Wachstum." },
    { k: "retail", g: "USA", t: "Einzelhandelsumsätze", when: "monatlich Mitte des Monats, 14:30 Uhr", what: "Wie viel die Amerikaner im Handel ausgegeben haben – Konsum ist rund zwei Drittel der US-Wirtschaft.", why: "Schwache Umsätze deuten auf eine Abkühlung hin, starke stützen Konsumwerte.", sectors: "Handel, Konsumgüter, Online-Händler." },
    { k: "ism", g: "USA", t: "ISM-Einkaufsmanagerindex", when: "erster Werktag im Monat (Industrie), dritter (Dienstleistung), 16:00 Uhr", what: "Umfrage unter Einkaufsleitern: über 50 = Wachstum, unter 50 = Schrumpfung.", why: "Ein Frühindikator für Konjunktur und Gewinne der Industrie.", sectors: "Industrie, Rohstoffe, Chemie, Transport." },
    { k: "sentiment", g: "USA", t: "Verbrauchervertrauen", when: "Uni Michigan: Mitte und Ende des Monats, 16:00 Uhr; Conference Board: letzter Dienstag, 16:00 Uhr", what: "Wie zuversichtlich die Verbraucher sind, dazu ihre Inflationserwartungen.", why: "Bewegt die Kurse meist wenig – außer bei großen Überraschungen bei den Inflationserwartungen.", sectors: "Konsumwerte." },
    { k: "ecb", g: "Europa", t: "Zinsentscheid der EZB", when: "8× im Jahr, Donnerstag 14:15 Uhr, Pressekonferenz 14:45 Uhr", what: "Die Europäische Zentralbank legt die Leitzinsen für den Euroraum fest.", why: "Wichtig für europäische Aktien und den Euro: Sinkende Zinsen stützen Aktien, schwächen meist den Euro.", sectors: "Banken (profitieren von höheren Zinsen), Immobilien und Versorger (von niedrigeren)." },
    { k: "hicp", g: "Europa", t: "Inflation im Euroraum (HVPI)", when: "Schnellschätzung am Monatsende oder -anfang, 11:00 Uhr", what: "Die Teuerung im Euroraum – Grundlage für die EZB.", why: "Höher als erwartet: Die EZB senkt die Zinsen später, europäische Aktien geraten unter Druck.", sectors: "Wie bei der US-Inflation." },
    { k: "ifo", g: "Europa", t: "ifo-Geschäftsklima", when: "monatlich um den 25., 10:00 Uhr", what: "Umfrage unter rund 9.000 deutschen Unternehmen zur Lage und zu den Erwartungen.", why: "Wichtigster Frühindikator für Deutschland – bewegt vor allem den DAX.", sectors: "Deutsche Industrie, Autos, Chemie." },
    { k: "zew", g: "Europa", t: "ZEW-Konjunkturerwartungen", when: "monatlich Mitte des Monats (Dienstag), 11:00 Uhr", what: "Umfrage unter Finanzexperten zur erwarteten Konjunktur in Deutschland.", why: "Reagiert schnell auf Stimmung an den Märkten; kann den DAX kurz bewegen.", sectors: "Breit über deutsche Aktien." },
    { k: "season", g: "Börse", t: "Quartalszahlen-Saison", when: "rund 2–6 Wochen nach Quartalsende (Mitte Jan., Apr., Jul., Okt.)", what: "Die Wochen, in denen die meisten Firmen ihre Zahlen melden – zuerst die großen US-Banken.", why: "Einzelwerte springen an ihren Zahlentagen oft um ein Vielfaches der normalen Tagesspanne. Der Swing-Planer kauft deshalb 10 Tage vor Zahlen nicht neu.", sectors: "Alle – Termine im Werkzeuge-Kalender." },
    { k: "witching", g: "Börse", t: "Großer Verfallstag („Hexensabbat“)", when: "3. Freitag im März, Juni, September und Dezember", what: "An diesem Tag laufen viele Optionen und Terminkontrakte gleichzeitig aus.", why: "Ungewöhnlich hohes Handelsvolumen und teils sprunghafte Kurse, vor allem zur Schlussauktion – Orders an diesem Tag mit Vorsicht.", sectors: "Breit über den Markt, besonders große Indexwerte." },
    { k: "oilinv", g: "Börse", t: "US-Ölbestände (EIA)", when: "jeden Mittwoch, 16:30 Uhr", what: "Wie viel Rohöl und Benzin in den USA lagert.", why: "Bewegt den Ölpreis und damit Energieaktien.", sectors: "Öl- und Gasfirmen, Fluglinien, Chemie." },
  ];
  function card() {
    const groups = [...new Set(E.map(e => e.g))];
    return `<div class="lex-list">${groups.map(g => `<div class="lex-group"><span class="tchips-lbl">${g}</span><div class="chips">${E.filter(e => e.g === g).map(e => `<button type="button" class="chip-btn" data-econ="${e.k}">${e.t}</button>`).join("")}</div></div>`).join("")}</div>
      <p class="hint">Uhrzeiten in Wiener Zeit; wenn nur die USA auf Sommerzeit umgestellt haben (März und Oktober/November), eine Stunde früher. Kurz vor und nach diesen Terminen besser nicht neu kaufen oder verkaufen – die Spreads sind dann weit und die Kurse springen.</p>`;
  }
  function open(k) {
    const e = E.find(x => x.k === k);
    if (!e) return;
    openDrawer(e.t, `<p class="term-ctx"><b>Wann:</b> ${e.when}</p><h3 class="swing-h3">Was gemessen wird</h3><p>${e.what}</p>
      <h3 class="swing-h3">Warum es die Kurse bewegt</h3><p>${e.why}</p><h3 class="swing-h3">Betroffene Branchen</h3><p>${e.sectors}</p>
      <p class="muted small" style="margin-top:14px">Die genauen Termine und Erwartungen stehen im Wirtschaftskalender im Bereich Markt.</p>`);
  }
  document.addEventListener("click", ev => {
    const b = ev.target.closest("[data-econ]");
    if (!b) return;
    ev.preventDefault();
    open(b.dataset.econ);
  });
  window.DTD.econCard = card;
  window.DTD.openEcon = open;
  const host = document.getElementById("econBody");
  if (host) host.innerHTML = card();
})();

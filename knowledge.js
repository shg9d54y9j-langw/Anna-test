// ---------- Wissen: Finanztheorie und Trade-Ideen ----------
// Alle Aussagen mit Quelle aus Fachzeitschriften, Arbeitspapieren anerkannter Institute (NBER, SSRN, arXiv)
// oder offiziellen Stellen (Fed, IEA, IWF, UN, SIPRI). Beweisstärke: 3 = stark belegt, 2 = gemischt, 1 = umstritten.
(() => {
  const A = (url, text) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`;
  const DOI = (doi, text) => A(`https://doi.org/${doi}`, text);
  const EV = { 3: "stark belegt", 2: "gemischt belegt", 1: "umstritten" };
  const evidence = e => `<span class="evidence e${e}" title="Beweisstärke"><i></i><i></i><i></i> ${EV[e]}</span>`;

  // ================= Finanztheorie =================
  const THEORY = [
    {
      cat: "Grundlagen", e: 3, title: "Effiziente und adaptive Märkte",
      core: "Preise verarbeiten öffentlich bekannte Informationen sehr schnell. Lo ergänzt: Wie effizient ein Markt ist, schwankt – mit Wettbewerb, Marktphase und den Teilnehmern.",
      means: "Ohne echten Informations- oder Kostenvorteil ist ein dauerhafter Vorsprung schwer. Öffentlich bekannte Muster sind meist schon im Preis – manche kommen und gehen.",
      now: "Gilt als Ausgangspunkt jeder Strategie: Erst fragen, warum ein Muster nicht schon wegarbitriert ist.",
      src: [DOI("10.2307/2325486", "Fama, Journal of Finance 1970"), DOI("10.3905/jpm.2004.442611", "Lo, Journal of Portfolio Management 2004")],
    },
    {
      cat: "Grundlagen", e: 3, title: "Rendite gibt es für Risiko: CAPM und Faktormodelle",
      core: "Das CAPM erklärt erwartete Renditen über das Marktrisiko (Beta). Faktormodelle ergänzen Größe, Bewertung (Value), Profitabilität und Investitionsverhalten.",
      means: "Mehr Rendite ohne mehr Risiko ist die Ausnahme. Wer einen Trader oder Fonds beurteilt, sollte fragen: Wie viel davon ist nur Markt- oder Faktorrisiko?",
      now: "Fünf-Faktoren-Modell von Fama und French ist Standard in Forschung und Fondsanalyse.",
      src: [DOI("10.1111/j.1540-6261.1964.tb02865.x", "Sharpe, Journal of Finance 1964"), DOI("10.1016/0304-405X(93)90023-5", "Fama &amp; French, JFE 1993"), DOI("10.1016/j.jfineco.2014.10.010", "Fama &amp; French, JFE 2015")],
    },
    {
      cat: "Grundlagen", e: 3, title: "Grenzen der Arbitrage",
      core: "Fehlbewertungen können lange bestehen, weil Wetten dagegen Kapital, Geduld und Nerven kosten – und Profis Geld abgezogen wird, wenn es zwischendurch schlechter läuft.",
      means: "„Der Kurs ist doch zu hoch“ ist kein Short-Signal. Eine Übertreibung kann sich lange vor dem Umschwung noch verstärken.",
      now: "Erklärt Blasen und Meme-Rallys, die rational kaum zu begründen sind.",
      src: [DOI("10.1111/j.1540-6261.1997.tb03807.x", "Shleifer &amp; Vishny, Journal of Finance 1997")],
    },
    {
      cat: "Grundlagen", e: 3, title: "Momentum und Trendfolge",
      core: "Was in den letzten 3–12 Monaten gestiegen ist, steigt im Schnitt noch etwas weiter – quer über Aktien (Momentum) und für ganze Märkte (Trendfolge, über 100 Jahre belegt).",
      means: "Gegen einen klaren Trend zu handeln ist statistisch die schwierigere Seite. Aber: Momentum erleidet seltene, heftige Einbrüche, meist nach Panikphasen, wenn der Markt dreht.",
      now: "Eine der robustesten Anomalien; das Cockpit zeigt den aktuellen Trend der wichtigsten Märkte.",
      src: [DOI("10.1111/j.1540-6261.1993.tb04702.x", "Jegadeesh &amp; Titman, JF 1993"), DOI("10.1016/j.jfineco.2011.11.003", "Moskowitz, Ooi &amp; Pedersen, JFE 2012"), DOI("10.1016/j.jfineco.2015.12.002", "Daniel &amp; Moskowitz, JFE 2016 (Crashs)")],
    },
    {
      cat: "Grundlagen", e: 3, title: "Hochfrequenzhandel und Marktmikrostruktur",
      core: "Bei sehr kurzen Haltedauern konkurrieren Menschen mit Maschinen, die Preise in Mikrosekunden vergleichen und Wettrennen um jede Kursänderung führen.",
      means: "Ihr Vorteil als Privatanleger liegt nicht in Geschwindigkeit. Je kürzer der Trade, desto größer der Anteil von Spread und Kosten am Ergebnis.",
      now: "Begründet, warum Scalping für Privatleute fast nie aufgeht.",
      src: [DOI("10.1093/qje/qjv027", "Budish, Cramton &amp; Shim, Quarterly Journal of Economics 2015")],
    },
    {
      cat: "Verhalten", e: 3, title: "Verlustaversion (Prospect Theory)",
      core: "Verluste wiegen etwa doppelt so schwer wie gleich große Gewinne (geschätzt rund 2,25-fach). Menschen bewerten Ergebnisse relativ zu einem Bezugspunkt, etwa dem Einstiegskurs.",
      means: "Man hält Verlierer zu lange („kommt schon zurück“) und schaut zu oft aufs Depot. Ein vorher gesetzter Stop-Loss nimmt diese Entscheidung ab.",
      now: "Nobelpreis 2002 (Kahneman); Grundlage der Verhaltensökonomie.",
      src: [DOI("10.2307/1914185", "Kahneman &amp; Tversky, Econometrica 1979"), DOI("10.1007/BF00122574", "Tversky &amp; Kahneman, J. Risk and Uncertainty 1992"), DOI("10.2307/2118511", "Benartzi &amp; Thaler, QJE 1995")],
    },
    {
      cat: "Verhalten", e: 3, title: "Dispositionseffekt und zu viel Handeln",
      core: "Privatanleger verkaufen Gewinner zu früh und halten Verlierer zu lange. Und: Die Haushalte, die am meisten handelten, erzielten 11,4 % pro Jahr – der Markt 17,9 %.",
      means: "Jeder zusätzliche Trade kostet Spread und Nerven. Weniger, aber geplante Trades schlagen viele spontane.",
      now: "Im Journal prüft die Seite, ob diese Muster bei Ihnen auftreten.",
      src: [DOI("10.1111/j.1540-6261.1985.tb05002.x", "Shefrin &amp; Statman, JF 1985"), DOI("10.1111/0022-1082.00072", "Odean, JF 1998"), DOI("10.1111/0022-1082.00226", "Barber &amp; Odean, JF 2000")],
    },
    {
      cat: "Verhalten", e: 3, title: "Daytrading in Zahlen",
      core: "Taiwan 1992–2006: Weniger als 1 % der Daytrader erzielten verlässlich Gewinne nach Kosten. Brasilien: Von allen, die mindestens 300 Tage Daytrading betrieben, verloren 97 % Geld.",
      means: "Daytrading als Einkommensquelle ist für fast alle unrealistisch. Wenn überhaupt: kleines Budget, strenge Regeln, ehrliche Buchführung.",
      now: "Deshalb setzt diese Seite auf Tageslimits, Journal und geprüftes Copy-Trading statt auf schnelle Trades.",
      src: [DOI("10.1016/j.finmar.2013.05.006", "Barber, Lee, Liu &amp; Odean, J. Financial Markets 2014"), A("https://papers.ssrn.com/sol3/papers.cfm?abstract_id=3423101", "Chague, De-Losso &amp; Giovannetti, SSRN 2019")],
    },
    {
      cat: "Verhalten", e: 3, title: "Aufmerksamkeit, Apps und Gamification",
      core: "Privatanleger kaufen, was gerade auffällt: Aktien in den News, mit hohem Volumen oder extremen Tagesbewegungen. Bei Robinhood sagten starke Käufe im Schnitt −4,7 % in den folgenden 20 Tagen voraus.",
      means: "Die Top-Gewinner-Liste und Schlagzeilen sind Einladung zum Fehlkauf. Erst Plan, dann Kurs – nicht umgekehrt.",
      now: "Hoch aktuell durch Handels-Apps, Social Media und Meme-Aktien.",
      src: [DOI("10.1093/rfs/hhm079", "Barber &amp; Odean, Review of Financial Studies 2008"), DOI("10.1111/jofi.13183", "Barber, Huang, Odean &amp; Schwarz, JF 2022")],
    },
    {
      cat: "Verhalten", e: 2, title: "Optionen mit Verfall am selben Tag (0DTE)",
      core: "Tagesoptionen auf den S&P 500 sind bei Kleinanlegern sehr beliebt. Eine Studie findet, dass sie damit im Schnitt verlieren – vor allem beim Kaufen, ein großer Teil durch Handelskosten.",
      means: "Der schnellste Weg zu großen Gewinnen ist auch der schnellste zu Verlusten. Für Einsteiger ungeeignet.",
      now: "Arbeitspapier (2023); das Thema wird in Forschung und Aufsicht intensiv diskutiert.",
      src: [A("https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4404704", "Beckmeyer, Branger &amp; Gayda, SSRN 2023")],
    },
    {
      cat: "Neue Forschung", e: 2, title: "Der „Faktor-Zoo“ und die Replikationsdebatte",
      core: "Hunderte „Renditemuster“ wurden veröffentlicht – viele davon Zufallstreffer. Strengere Hürden fordern einen t-Wert über 3. Nach der Veröffentlichung fallen die Überrenditen deutlich geringer aus.",
      means: "Ein Backtest mit schöner Kurve beweist wenig. Seriös ist nur, was außerhalb der Stichprobe und in vielen Ländern hält. Die Gegenposition: Richtig gemessen lassen sich die meisten Faktoren doch replizieren.",
      now: "Aktuell zentrale Debatte; diese Seite rechnet deshalb die Glücks-Korrektur (Deflated Sharpe Ratio) und einen ehrlichen Rückblick-Test.",
      src: [DOI("10.1093/rfs/hhv059", "Harvey, Liu &amp; Zhu, RFS 2016"), DOI("10.1111/jofi.12365", "McLean &amp; Pontiff, JF 2016"), DOI("10.1093/rfs/hhy131", "Hou, Xue &amp; Zhang, RFS 2020"), DOI("10.1111/jofi.13249", "Jensen, Kelly &amp; Pedersen, JF 2023")],
    },
    {
      cat: "Neue Forschung", e: 2, title: "Maschinelles Lernen und KI in der Kursprognose",
      core: "Neuronale Netze und große Modelle verbessern Renditeprognosen messbar gegenüber klassischen Verfahren – überraschend oft gerade dann, wenn sie sehr viele Parameter haben. Sprachmodelle können aus Nachrichten die Reaktion am Folgetag teilweise vorhersagen.",
      means: "Die vorhersagbare Rendite bleibt klein und verschwindet, je mehr Marktteilnehmer dieselben Werkzeuge nutzen. Kein Modell macht aus Rauschen Gewissheit.",
      now: "Eines der aktivsten Forschungsfelder 2024–2026.",
      src: [DOI("10.1093/rfs/hhaa009", "Gu, Kelly &amp; Xiu, RFS 2020"), DOI("10.1111/jofi.13298", "Kelly, Malamud &amp; Zhou, JF 2024"), A("https://arxiv.org/abs/2304.07619", "Lopez-Lira &amp; Tang, arXiv 2023/2025")],
    },
    {
      cat: "Neue Forschung", e: 2, title: "Unelastische Märkte und passives Investieren",
      core: "Viele Großanleger halten feste Aktienquoten und reagieren kaum auf Preise. Folge: Ein zusätzlich in Aktien fließender Dollar hebt den Marktwert laut Schätzung um etwa 5 Dollar.",
      means: "Geldflüsse (z. B. in ETFs) bewegen Kurse stärker als gedacht – Kurssprünge sind nicht immer „neue Information“.",
      now: "Viel beachtetes Arbeitspapier; Folgen für passives Investieren werden breit diskutiert.",
      src: [A("https://www.nber.org/papers/w28967", "Gabaix &amp; Koijen, NBER Working Paper 2021")],
    },
    {
      cat: "Neue Forschung", e: 2, title: "Klima und „grüne“ Renditen",
      core: "Grüne Aktien liefen in den letzten Jahren besser – vor allem, weil die Sorge ums Klima unerwartet stieg, nicht weil sie höhere erwartete Renditen haben. Erwartet wird für sie eher etwas weniger Rendite.",
      means: "Vergangene Themen-Gewinne nicht in die Zukunft verlängern: Sie kamen oft aus einmaligen Stimmungsschüben.",
      now: "Wichtig für die Bewertung von Zukunftsthemen (siehe Trade-Ideen).",
      src: [DOI("10.1016/j.jfineco.2022.07.007", "Pástor, Stambaugh &amp; Taylor, JFE 2022")],
    },
    {
      cat: "Risiko & Einsatz", e: 3, title: "Einsatzhöhe: Kelly-Kriterium und Volatilitätssteuerung",
      core: "Die richtige Einsatzhöhe hängt von Vorteil und Schwankung ab (Kelly). Wer bei hoher Schwankung kleiner und bei niedriger größer investiert, verbessert das Verhältnis von Rendite zu Risiko.",
      means: "Halbes Kelly statt vollem ist robuster gegen Schätzfehler. Bei unruhigen Märkten Positionen verkleinern – das Cockpit rechnet die passende Größe aus.",
      now: "Die Tageswahl nutzt halbes Kelly, das Cockpit die Volatilitätssteuerung.",
      src: [DOI("10.1002/j.1538-7305.1956.tb03809.x", "Kelly, Bell System Technical Journal 1956"), DOI("10.1111/jofi.12513", "Moreira &amp; Muir, JF 2017")],
    },
  ];

  // ================= Trade-Ideen: Strategien mit Studienlage =================
  // signal(m): aktueller Bezug zum Cockpit (market.json), falls vorhanden
  const trendOf = (m, key) => (m && m.assets || []).find(a => a.key === key);
  const trendWord = a => (!a || !Number.isFinite(a.distSma200) ? "–" : a.light === "green" ? `<b class="up">Aufwärtstrend</b>` : a.light === "red" ? `<b class="down">Abwärtstrend</b>` : `<b class="warn-text">uneinheitlich</b>`);
  const STRATS = [
    {
      e: 3, title: "Trendfolge auf ganze Märkte", horizon: "Wochen bis Monate",
      core: "Einen Index nur halten, solange er über seinem 200-Tage-Durchschnitt liegt und die 12-Monats-Rendite positiv ist – sonst Kasse. Belegt über mehr als 100 Jahre und Dutzende Märkte.",
      how: "In eToro: Index-ETF oder Index kaufen, wenn das Cockpit „Aufwärtstrend“ zeigt; bei „Abwärtstrend“ verkaufen. Höchstens einmal pro Woche prüfen.",
      risk: "Fehlsignale in Seitwärtsphasen kosten jedes Mal Spread; hinkt bei schnellen Erholungen hinterher.",
      signal: m => `S&amp;P 500: ${trendWord(trendOf(m, "spx"))} · Nasdaq 100: ${trendWord(trendOf(m, "ndx"))} · DAX: ${trendWord(trendOf(m, "dax"))} · Gold: ${trendWord(trendOf(m, "gold"))}`,
      src: [DOI("10.1016/j.jfineco.2011.11.003", "Moskowitz, Ooi &amp; Pedersen, JFE 2012"), A("https://www.aqr.com/Insights/Research/Journal-Article/A-Century-of-Evidence-on-Trend-Following-Investing", "Hurst, Ooi &amp; Pedersen, JPM 2017")],
    },
    {
      e: 3, title: "Einsatz nach Schwankung steuern", horizon: "jeder Trade",
      core: "Positionsgröße = normale Größe × (15 % ÷ aktuelle Jahresschwankung). Bei doppelter Schwankung nur halber Einsatz. Verbessert in Studien das Rendite-Risiko-Verhältnis vieler Strategien.",
      how: "Vor jedem Trade die empfohlene Positionsgröße aus dem Cockpit auf den Betrag im Trade-Setup anwenden.",
      risk: "Nach plötzlichen Crashs reagiert die Regel mit Verzögerung; bei manchen Strategien ist der Vorteil kleiner.",
      signal: m => (m && m.overall && Number.isFinite(m.overall.sizeFactor) ? `Heute empfohlen: <b>${Math.round(m.overall.sizeFactor * 100)} %</b> der normalen Positionsgröße` : ""),
      src: [DOI("10.1111/jofi.12513", "Moreira &amp; Muir, JF 2017")],
    },
    {
      e: 2, title: "Monatswechsel-Effekt", horizon: "4 Handelstage",
      core: "In den USA lag die durchschnittliche Indexrendite 1926–2005 am letzten und an den ersten drei Handelstagen des Monats bei 0,15 % pro Tag, an den übrigen Tagen nahe null – in 31 von 35 Ländern ähnlich.",
      how: "Wenn überhaupt: Index nur in diesem Fenster halten (Termine unten). Wegen der Kosten nur ohne Hebel und mit kleinen Spreads sinnvoll.",
      risk: "Kleiner Effekt; jahrweise oft negativ. Kein Grund, das Fenster mit Hebel zu spielen.",
      signal: () => "",
      src: [DOI("10.2469/faj.v64.n2.11", "McConnell &amp; Xu, Financial Analysts Journal 2008"), DOI("10.1093/rfs/1.4.403", "Lakonishok &amp; Smidt, RFS 1988")],
    },
    {
      e: 1, title: "Vor Zinsentscheiden der US-Notenbank", horizon: "24 Stunden",
      core: "Bis 2011 stiegen US-Aktien in den 24 Stunden vor angekündigten Zinsentscheiden auffällig stark. Nach 2015 ist dieser Effekt laut einer Folgestudie weitgehend verschwunden; andere Autoren widersprechen.",
      how: "Nicht darauf setzen. Praktischer Nutzen: Am Entscheidungstag um 20 Uhr (deutscher Zeit) schwanken die Kurse stark – Stops weiter oder Positionen vorher schließen.",
      risk: "Bekanntes Muster, inzwischen unsicher; große Bewegungen in beide Richtungen nach der Entscheidung.",
      signal: () => "",
      src: [DOI("10.1111/jofi.12196", "Lucca &amp; Moench, JF 2015"), A("https://ideas.repec.org/a/eee/finlet/v40y2021ics1544612320315956.html", "Kurov, Wolfe &amp; Gilbert, Finance Research Letters 2021")],
    },
    {
      e: 2, title: "Intraday-Momentum: erste und letzte halbe Stunde", horizon: "innerhalb eines Tages",
      core: "Beim S&P-500-ETF sagte die Rendite der ersten halben Stunde die der letzten halben Stunde des Tages voraus – vor allem an unruhigen Tagen und Tagen mit Wirtschaftsdaten. Die Vorhersagekraft ist klein.",
      how: "Für Daytrader: Ist der US-Markt bis 16 Uhr deutscher Zeit klar gestiegen, eher nicht kurz vor Schluss gegen den Trend handeln.",
      risk: "Erklärt nur einen kleinen Teil der Bewegung; nach Kosten schwer auszunutzen.",
      signal: () => "",
      src: [A("https://econpapers.repec.org/RePEc:eee:jfinec:v:129:y:2018:i:2:p:394-414", "Gao, Han, Li &amp; Zhou, JFE 2018")],
    },
    {
      e: 2, title: "Über Nacht oder tagsüber?", horizon: "Haltedauer-Frage",
      core: "Bei bekannten Strategien entsteht der Gewinn je nach Strategie fast nur über Nacht (z. B. Momentum) oder nur im Tagesverlauf – die beiden Teile ziehen gegeneinander.",
      how: "Wer abends alles schließt, handelt nur die Tageshälfte. Für Momentum-Ideen ist Daytrading deshalb die falsche Haltedauer.",
      risk: "Übernacht-Positionen tragen Lückenrisiko und bei CFDs Übernachtgebühren.",
      signal: () => "",
      src: [A("https://econpapers.repec.org/RePEc:eee:jfinec:v:134:y:2019:i:1:p:192-213", "Lou, Polk &amp; Skouras, JFE 2019")],
    },
    {
      e: 3, title: "Qualität und niedrige Schwankung", horizon: "Jahre",
      core: "Profitable, stabile, wenig verschuldete Firmen („Qualität“) und wenig schwankende Aktien lieferten pro Risiko mehr Rendite als ihr Gegenteil.",
      how: "In eToro: breit gestreute Qualitäts- oder Minimum-Volatility-ETFs als ruhiger Kern neben dem Trading-Konto.",
      risk: "Bleibt in wilden Rallys von „Schrott-Aktien“ deutlich zurück; Faktoren haben lange Durststrecken.",
      signal: () => "",
      src: [DOI("10.1007/s11142-018-9470-2", "Asness, Frazzini &amp; Pedersen, Review of Accounting Studies 2019"), DOI("10.1016/j.jfineco.2013.10.005", "Frazzini &amp; Pedersen, JFE 2014")],
    },
    {
      e: 1, title: "Nach Quartalszahlen weiterlaufen lassen (PEAD)", horizon: "Tage bis Wochen",
      core: "Früher liefen Kurse nach positiven oder negativen Gewinnüberraschungen wochenlang in dieselbe Richtung weiter. Neuere Studien finden das bei großen Aktien nicht mehr – andere halten den Effekt für lebendig.",
      how: "Nicht als Strategie nutzen. Lehre: Am Tag der Zahlen ist die Überraschung meist schon im Kurs.",
      risk: "Umstritten; Kurslücken am Berichtstag können jeden Stop überspringen.",
      signal: () => "",
      src: [DOI("10.2307/2491062", "Bernard &amp; Thomas, Journal of Accounting Research 1989"), DOI("10.1561/104.00000122", "Martineau, Critical Finance Review 2022")],
    },
  ];

  // ================= Zukunftsthemen =================
  const THEMES = [
    {
      title: "KI, Rechenzentren und Strom",
      core: "Die Internationale Energieagentur erwartet, dass sich der Strombedarf von Rechenzentren bis 2030 auf rund 945 TWh mehr als verdoppelt – getrieben von KI. Der IWF schätzt, dass etwa 40 % der Arbeitsplätze weltweit von KI betroffen sind, in Industrieländern rund 60 %.",
      who: "Chips und Rechenzentren, aber auch Stromnetze, Kraftwerke, Kühlung und Rohstoffe.",
      risk: "Hohe Bewertungen und Investitionszyklen: Wenn die Ausgaben langsamer wachsen, fallen solche Aktien stark.",
      src: [A("https://www.iea.org/reports/energy-and-ai", "IEA: Energy and AI (2025)"), A("https://www.imf.org/en/Publications/Staff-Discussion-Notes/Issues/2024/01/14/Gen-AI-Artificial-Intelligence-and-the-Future-of-Work-542379", "IWF: Gen-AI and the Future of Work (2024)")],
    },
    {
      title: "Elektrifizierung und Energiewende",
      core: "Laut World Energy Outlook 2025 wächst der Strombedarf in allen Szenarien schneller als der Energiebedarf insgesamt; Solarstrom wächst bis 2035 am schnellsten. Netze und Speicher werden zum Engpass. Die Weiterverarbeitung wichtiger Energie-Rohstoffe ist stark auf einzelne Länder konzentriert.",
      who: "Netzbetreiber und -ausrüster, Speicher, Solar und Wind, Rohstoffe.",
      risk: "Politik, Zinsen und Preiskampf; viele Firmen der Branche verdienen trotz Wachstum wenig.",
      src: [A("https://www.iea.org/reports/world-energy-outlook-2025", "IEA: World Energy Outlook 2025")],
    },
    {
      title: "Verteidigung und Sicherheit",
      core: "Die weltweiten Militärausgaben stiegen 2025 real um 2,9 % auf 2.887 Mrd. $ – das elfte Jahr in Folge. In Europa legten sie um 14 % auf 864 Mrd. $ zu.",
      who: "Rüstung, Luft- und Raumfahrt, Cybersicherheit.",
      risk: "Stark von Politik abhängig; nach den Kurssprüngen seit 2022 ist viel bereits im Preis.",
      src: [A("https://www.sipri.org/publications/2026/sipri-fact-sheets/trends-world-military-expenditure-2025", "SIPRI: Trends in World Military Expenditure 2025 (April 2026)")],
    },
    {
      title: "Demografie und Gesundheit",
      core: "Laut UN gibt es bis Mitte der 2030er Jahre weltweit mehr Menschen über 80 als Säuglinge; bis Ende der 2070er mehr über 65-Jährige als unter 18-Jährige. Die Weltbevölkerung erreicht ihren Höchststand voraussichtlich Mitte der 2080er bei rund 10,3 Mrd.",
      who: "Gesundheit, Pflege, Medizintechnik, Pharma.",
      risk: "Langsamer Trend, Preisdruck durch Gesundheitspolitik; einzelne Studien- oder Zulassungsergebnisse bewegen Aktien heftig.",
      src: [A("https://population.un.org/WPP/Publications/Files/WPP2024_Key-Messages.pdf", "UN DESA: World Population Prospects 2024")],
    },
  ];

  // ================= Zukunft: Trend-Empfehlung und Ideen mit sehr großem Potenzial =================
  // Einstufung dieser Seite nach Beleglage der Nachfrage (offizielle Prognosen) und Reife der Technik – keine Kaufempfehlung.
  const FUTURE = [
    { id: "chips", title: "KI-Rechenleistung und Halbleiter", level: "stark", why: "Der Strombedarf von Rechenzentren steigt laut IEA von rund 415 TWh (2024) auf etwa 945 TWh bis 2030 – vor allem wegen KI-Servern. Chips, Speicher und Fertigungsanlagen sind der Engpass.", sparten: "Chips, Speicherchips, Chipfertigung und -maschinen, Netzwerktechnik", ex: ["NVDA", "TSM", "ASML", "AMD", "MU", "AVGO"], risk: "Stark zyklisch: Wenn die Investitionen der großen Tech-Firmen langsamer wachsen, fallen diese Aktien schnell um 30–50 %.", src: [A("https://www.iea.org/reports/energy-and-ai", "IEA: Energy and AI (2025)")] },
    { id: "grid", title: "Stromnetze und Elektrifizierung", level: "stark", why: "Strom wächst in allen Szenarien des World Energy Outlook 2025 schneller als der übrige Energiebedarf. Netze, Transformatoren, Kabel und Speicher werden zum Nadelöhr – unabhängig davon, welche Kraftwerke gebaut werden.", sparten: "Netzausrüster, Kabel, Schaltanlagen, Kühlung für Rechenzentren, Gasturbinen", ex: ["SIE.DE", "ENR.DE", "ABBN.ZU", "SU.PA", "PRY.MI", "GEV", "ETN", "VRT"], risk: "Viele dieser Aktien sind seit 2023 stark gestiegen; Lieferengpässe und Zinsen bestimmen die Gewinne.", src: [A("https://www.iea.org/reports/world-energy-outlook-2025", "IEA: World Energy Outlook 2025")] },
    { id: "defense", title: "Verteidigung und Cybersicherheit", level: "stark", why: "Die NATO-Staaten haben im Juni 2025 beschlossen, bis 2035 jährlich 5 % der Wirtschaftsleistung für Verteidigung und Sicherheit auszugeben (3,5 % Kernverteidigung, 1,5 % Infrastruktur, Cyber, Resilienz; Überprüfung 2029). Die weltweiten Militärausgaben steigen seit elf Jahren.", sparten: "Rüstung und Munition, Sensorik, Luftfahrt, Cybersicherheit, Datenanalyse", ex: ["RHM.DE", "HAG.DE", "BA.L", "LMT", "AIR.PA", "CRWD", "PANW", "PLTR"], risk: "Politisch getrieben und viel ist schon im Preis: Rheinmetall hat sich nach dem Höhenflug zeitweise halbiert.", src: [A("https://www.ncia.nato.int/newsroom/news/the-hague-summit-declaration", "NATO: The Hague Summit Declaration (25.6.2025)"), A("https://www.sipri.org/publications/2026/sipri-fact-sheets/trends-world-military-expenditure-2025", "SIPRI 2026")] },
    { id: "health", title: "Gesundheit: Abnehmmittel und alternde Gesellschaft", level: "stark", why: "Weltweit leben mehr als eine Milliarde Menschen mit Adipositas (Lancet 2024). Bis Mitte der 2030er gibt es mehr Über-80-Jährige als Säuglinge (UN). Neue Abnehmmittel (GLP-1) gehören zu den umsatzstärksten Medikamenten.", sparten: "Pharma, Medizintechnik, Roboter-Chirurgie, Telemedizin, Pflege", ex: ["LLY", "NOVO-B.CO", "ISRG", "HIMS"], risk: "Preisdruck durch Politik und Konkurrenz: Novo Nordisk fiel trotz Wachstum deutlich, weil Konkurrenten aufholten.", src: [A("https://doi.org/10.1016/S0140-6736(23)02750-2", "NCD-RisC, The Lancet 2024"), A("https://population.un.org/WPP/Publications/Files/WPP2024_Key-Messages.pdf", "UN: World Population Prospects 2024")] },
    { id: "robots", title: "Robotik und Automatisierung", level: "mittel", why: "2024 wurden weltweit rund 542.000 Industrieroboter installiert – doppelt so viele wie vor zehn Jahren; der Verband IFR erwartet über 700.000 pro Jahr bis 2028. Fachkräftemangel und KI treiben die Nachfrage; humanoide Roboter stehen noch am Anfang.", sparten: "Industrieroboter, Antriebe und Sensoren, Lager-Automatisierung, humanoide Roboter", ex: ["ABBN.ZU", "SIE.DE", "ISRG", "TSLA"], risk: "Abhängig von Industriekonjunktur und China; ob humanoide Roboter bald Geld verdienen, ist offen.", src: [A("https://ifr.org/ifr-press-releases/news/global-robot-demand-in-factories-doubles-over-10-years", "IFR: World Robotics 2025")] },
    { id: "nuclear", title: "Kernenergie und kleine Reaktoren", level: "mittel", why: "Die IEA sieht eine „neue Ära“ der Kernkraft: Viele Staaten und Tech-Konzerne setzen auf rund um die Uhr verfügbaren, CO₂-armen Strom; kleine modulare Reaktoren (SMR) sollen ab etwa 2030 ans Netz gehen.", sparten: "Kraftwerksbetreiber, Uran, Reaktorbauer, SMR-Entwickler", ex: ["RR.L", "VST", "OKLO"], risk: "SMR-Firmen haben oft noch keinen Umsatz; Zulassung, Kosten und Bauzeiten sind die großen Unbekannten (Oklo: −80 % in 12 Monaten).", src: [A("https://www.iea.org/reports/the-path-to-a-new-era-for-nuclear-energy", "IEA: The Path to a New Era for Nuclear Energy (2025)")] },
    { id: "space", title: "Raumfahrt und Satelliten", level: "mittel", why: "Laut Weltwirtschaftsforum und McKinsey wächst die Weltraumwirtschaft von 630 Mrd. $ (2023) auf rund 1,8 Billionen $ bis 2035 – etwa doppelt so schnell wie die Weltwirtschaft. Treiber sind billigere Starts und Satelliten-Internet.", sparten: "Raketenstarts, Satelliten-Internet (auch direkt aufs Handy), Erdbeobachtung, Luft- und Raumfahrt", ex: ["RKLB", "ASTS", "AIR.PA"], risk: "Kapitalintensiv, viele Firmen verbrennen Geld und geben laufend neue Aktien aus (Verwässerung).", src: [A("https://www.weforum.org/publications/space-the-1-8-trillion-opportunity-for-global-economic-growth/", "WEF & McKinsey: Space – The $1.8 Trillion Opportunity (2024)")] },
    { id: "quantum", title: "Quantencomputer", level: "spekulativ", why: "McKinsey schätzt im Quantum Technology Monitor 2026 den Umsatz mit Quantencomputern bis 2035 auf 43–71 Mrd. $. Heute ist der Umsatz noch klein – je nach Abgrenzung 1 bis 4 Mrd. $; nützliche, fehlerkorrigierte Rechner gibt es noch nicht.", sparten: "Quantenhardware, Software, Verschlüsselung; große Tech-Konzerne forschen mit", ex: ["IONQ", "RGTI", "QBTS", "IBM", "GOOG"], risk: "Technik unreif, Umsätze winzig im Verhältnis zur Bewertung – die reinen Quanten-Aktien haben sich nach dem Hype 2025 mehr als halbiert.", src: [A("https://www.mckinsey.com/no/our-insights/mckinsey-quantum-technology-monitor-2026-a-commercial-tipping-point", "McKinsey: Quantum Technology Monitor 2026")] },
  ];
  const LEVEL = { stark: ["Stark belegt", "green", "Nachfrage durch offizielle Prognosen gut abgesichert"], mittel: ["Belegt, unsicherer", "yellow", "Wachstum wahrscheinlich, Gewinner noch offen"], spekulativ: ["Spekulativ", "red", "Technik oder Geschäftsmodell noch unreif"] };
  // Ideen mit 1000 %-Potenzial; die Firmen dazu kommen aus data/firms.json (ex: Rückfall, falls die Datei fehlt)
  const MOON = [
    { id: "quantum", title: "Quantencomputer", why: "Erste nützliche Anwendungen in Chemie, Logistik und Verschlüsselung.", ex: ["IONQ", "RGTI", "QBTS"] },
    { id: "smr", title: "Kleine Reaktoren und Kernfusion", why: "Rund um die Uhr Strom für Rechenzentren ohne CO₂.", ex: ["OKLO", "RR.L"] },
    { id: "d2d", title: "Satelliten-Internet direkt aufs Handy", why: "Netz überall, ohne Funkmasten.", ex: ["ASTS", "RKLB"] },
    { id: "humanoid", title: "Humanoide Roboter", why: "Maschinen, die Arbeiten in Fabrik, Lager und Haushalt übernehmen.", ex: ["TSLA"] },
    { id: "aisoft", title: "KI-Software für Firmen", why: "Programme, die ganze Arbeitsabläufe selbst erledigen.", ex: ["PLTR"] },
    { id: "telehealth", title: "Telemedizin und Abnehmmittel", why: "Behandlung per App, neue Medikamente für Volkskrankheiten.", ex: ["HIMS"] },
  ];
  let stockMap = null, stockLoading = false;
  async function loadStocks() {
    if (stockMap || stockLoading) return;
    stockLoading = true;
    const shared = window.DTD.stockData && window.DTD.stockData();
    let d = shared;
    if (!d) {
      const t = Date.now(), get = u => fetch(u, { cache: "no-store" }).then(r => (r.ok ? r.json() : null)).catch(() => null);
      const list = (await Promise.all([get(`data/stocks.json?t=${t}`), get(`https://raw.githubusercontent.com/shg9d54y9j-langw/Anna-test/stock-data/stocks.json?t=${t}`)])).filter(x => x && Array.isArray(x.items));
      d = list.sort((a, b) => new Date(b.updated) - new Date(a.updated))[0] || null;
    }
    stockMap = d ? new Map(d.items.map(x => [x.sym, x])) : new Map();
    stockLoading = false;
    if (!$("theorie").hidden) renderTheory();
  }
  const tvUrl = tv => `https://www.tradingview.com/symbols/${encodeURIComponent(tv.replace(":", "-"))}/`;
  const chipFor = sym => {
    const x = stockMap && stockMap.get(sym), f = firms && firms.firms[sym];
    // nicht in den eToro-Daten: Firmen anderer Börsen verlinken den Kurs bei TradingView, sonst nur anzeigen
    if (stockMap && stockMap.size && !x) {
      if (f && f.tv) return `<button type="button" class="chip-btn ext" data-open="${esc(f.tv)}" title="${esc(f.listing || "")} – nicht in den eToro-Daten; Aktienübersicht mit Kurs und Diagramm von TradingView">${esc(sym)}</button>`;
      return `<button type="button" class="chip-btn off" data-open="${esc(sym)}" title="Noch nicht in den Aktien-Daten – Aktienübersicht mit dem Diagramm von TradingView">${esc(sym)}</button>`;
    }
    const r = x && Number.isFinite(x.ret12m) ? ` <span class="${x.ret12m < 0 ? "down" : "up"}">${x.ret12m > 0 ? "+" : ""}${fmt(x.ret12m, 0)} %</span>` : "";
    return `<button type="button" class="chip-btn" data-open="${esc(sym)}" title="${x ? `${esc(x.name)} – 12-Monats-Rendite, im Aktien-Check öffnen` : "im Aktien-Check öffnen"}">${esc(sym)}${r}</button>`;
  };

  // Firmen-Steckbriefe (data/firms.json): je Sparte und je 1000-%-Idee – was die Firma macht, warum gerade sie, worauf achten, mit Quelle
  let firms = null, firmsLoading = false;
  async function loadFirms() {
    if (firms || firmsLoading) return;
    firmsLoading = true;
    try { const r = await fetch(`data/firms.json?t=${Date.now()}`, { cache: "no-store" }); const d = r.ok ? await r.json() : null; firms = d && d.firms ? d : null; } catch { firms = null; }
    firmsLoading = false;
    if (firms && $("theorie") && !$("theorie").hidden) renderTheory();
  }
  const ROLE = { leader: ["Marktführer", "green"], supplier: ["Zulieferer", ""], challenger: ["Herausforderer", "yellow"], spec: ["Spekulativ", "red"] };
  const link = (u, t) => (/^https:\/\//.test(u) ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(t)}</a>` : esc(t));
  const firstSentence = s => { const m = /^(.+?[.!?])(?:\s|$)/.exec(s || ""); return m ? m[1] : s || ""; };
  const firmRow = sym => {
    const f = firms && firms.firms[sym];
    if (!f) return "";
    const R = ROLE[f.role] || ROLE.challenger;
    return `<div class="firm">${chipFor(sym)}<details>
        <summary><span class="firm-name">${esc(f.name)}</span> <span class="light ${R[1]}">${R[0]}</span><span class="firm-teaser">${esc(firstSentence(f.why))}</span></summary>
        <div class="firm-body">
          <p><b>Was sie macht:</b> ${esc(f.what)}</p>
          <p><b>Warum diese Firma:</b> ${esc(f.why)}</p>
          <p class="firm-risk"><b>Worauf achten:</b> ${esc(f.watch)}</p>
          ${where(sym, f)}
          <p class="small"><button type="button" class="name-link" data-open="${esc(stockMap && stockMap.size && !stockMap.has(sym) && f.tv ? f.tv : sym)}">Aktienübersicht mit Diagramm öffnen →</button></p>
          <p class="muted small">Quelle: ${(f.src || []).map(([u, t]) => link(u, t)).join(" · ")}</p>
        </div></details></div>`;
  };
  const firmList = syms => `<div class="firm-list">${syms.map(firmRow).join("")}</div>`;
  // Wo es die Aktie gibt: Börse, und ob sie in den eToro-Daten ist (sonst z. B. über Interactive Brokers oder eine Bank mit Auslandsbörsen)
  function where(sym, f) {
    const onEtoro = stockMap && stockMap.has(sym);
    if (!f.listing) return "";   // US-Werte: bei eToro handelbar (fehlende kommen mit dem nächsten Datenlauf)
    const etoro = !stockMap || !stockMap.size ? "" : onEtoro ? " · bei eToro handelbar" : " · nicht in den eToro-Daten – nur über einen Broker mit Zugang zu dieser Börse (vorher beim Broker suchen; manche Auslandsaktien gibt es auch an deutschen Börsen)";
    return `<p class="small"><b>Börse:</b> ${esc(f.listing || "USA")}${etoro}${f.tv ? ` · ${link(tvUrl(f.tv), "Kurs bei TradingView")}` : ""}</p>`;
  }
  function futureHtml() {
    loadFirms();
    const moonSyms = m => (firms && firms.moon && firms.moon[m.id] ? firms.moon[m.id].firms : m.ex);
    const moonRet = [...new Set(MOON.flatMap(moonSyms))].map(sym => stockMap && stockMap.get(sym)).filter(x => x && Number.isFinite(x.ret12m));
    const worst = moonRet.filter(x => x.ret12m < -20).sort((a, b) => a.ret12m - b.ret12m).slice(0, 4);
    return `<article class="card" data-section="Trend-Empfehlung">
        <div class="card-head"><h2 class="card-title">Trend-Empfehlung: Welche Sparten in den nächsten Jahren wachsen</h2><span class="muted small">12-Monats-Renditen live aus den Tagesdaten</span></div>
        <p class="small">Eingestuft nach zwei Fragen: Ist die Nachfrage durch offizielle Prognosen abgesichert? Und verdienen die Firmen schon Geld damit? Je Sparte stehen interessante Firmen – vom Marktführer bis zum spekulativen Wert, auch von Börsen außerhalb von eToro (Seoul, Tokio, Stockholm, Oslo …) – <b>keine Kaufempfehlung</b>. Ein Klick auf den Namen zeigt, was die Firma macht, warum gerade sie und worauf man achten muss; ein Klick auf das Kürzel öffnet sie im Aktien-Check, Kürzel mit ↗ zeigen den Kurs bei TradingView. <b>Wann sich ein Kauf lohnt</b> – mit Kauf, Stop und Ziel für eToro – zeigt der <a href="#swing">Swing-Planer</a>.${firms ? ` <span class="muted">Steckbriefe: Stand ${esc(new Date(`${firms.asOf}T12:00:00Z`).toLocaleDateString("de-DE", { day: "numeric", month: "long", year: "numeric" }))}, aus Firmenangaben und Presse; die 12-Monats-Rendite am Kürzel ist live.</span>` : ""}</p>
        <div class="future-grid">${FUTURE.map(f => { const L = LEVEL[f.level], syms = firms && firms.sectors && firms.sectors[f.id]; return `
          <article class="future">
            <div class="topic-kicker"><span class="light ${L[1]}">${L[0]}</span><span class="muted small">${L[2]}</span></div>
            <h3>${f.title}</h3>
            <p class="core">${f.why}</p>
            <p class="small"><b>Welche Sparten profitieren:</b> ${f.sparten}</p>
            ${syms ? `<p class="small firm-intro"><b>Interessante Firmen</b> <span class="muted">– Name antippen für die Begründung</span></p>${firmList(syms)}` : `<div class="chips">${f.ex.map(chipFor).join("")}</div>`}
            <p class="small risk"><b>Risiko:</b> ${f.risk}</p>
            <ul class="srcs">${f.src.map(x => `<li>${x}</li>`).join("")}</ul>
          </article>`; }).join("")}</div>
        <p class="hint"><b>Unsere Einschätzung:</b> Am sichersten wachsen die „Schaufel-Verkäufer“ – Netze, Chips, Strom – und Bereiche mit fest beschlossenem Geld wie Verteidigung. Am meisten Fantasie, aber auch am meisten Totalverlust-Risiko steckt in Quanten, kleinen Reaktoren und Raumfahrt. Wichtig: Ein wachsender Markt heißt nicht, dass die Aktie steigt – bekannte Themen sind oft schon im Preis; Themen-ETFs verloren nach Auflage im Schnitt rund 30 % gegenüber dem Markt in fünf Jahren (${A("https://doi.org/10.1093/rfs/hhac048", "Ben-David u. a., RFS 2023")}).</p>
      </article>
      <article class="card" data-section="1000-%-Ideen">
        <h2 class="card-title">Ideen mit 1000 %-Potenzial – und was die Forschung dazu sagt</h2>
        <p><b>Kann eine Aktie 1000 % steigen? Ja – aber es ist selten, und vorher weiß es niemand.</b> Von 64.000 Aktien weltweit (1990–2020) haben nur 2,4 % den gesamten Netto-Vermögenszuwachs geschaffen; mehr als die Hälfte brachte über ihre Laufzeit weniger als US-Geldmarktzinsen (${A("https://rpc.cfainstitute.org/research/financial-analysts-journal/2023/long-term-shareholder-returns-evidence-from-64000-global-stocks", "Bessembinder u. a., Financial Analysts Journal 2023")}; für die USA 1926–2016: 4 %, ${A("https://doi.org/10.1016/j.jfineco.2018.06.004", "Bessembinder, JFE 2018")}). Aktien, die wie Lotterielose wirken, bringen im Schnitt sogar weniger (${A("https://doi.org/10.1016/j.jfineco.2010.08.014", "Bali, Cakici &amp; Whitelaw 2011")}).</p>
        <p class="small" style="margin-top:10px">Je Idee die Firmen, die heute an der Börse am direktesten darauf setzen – fast alle klein, mit wenig oder keinem Umsatz und mit Kursschwankungen von 60–80 % im Jahr. Darunter jeweils der <b>sicherere Weg</b> über große Firmen, die am selben Trend verdienen.</p>
        <div class="moon-grid">${MOON.map(m => { const M = firms && firms.moon && firms.moon[m.id]; return `
          <article class="moon-card">
            <h3>${m.title}</h3>
            <p class="core">${m.why}</p>
            ${M ? `${firmList(M.firms)}
            ${M.note ? `<p class="small moon-note">${esc(M.note[0])} <span class="muted">(${link(M.note[1], M.note[2])})</span></p>` : ""}
            <p class="small moon-safer">${esc(M.safer)}</p><div class="chips">${(M.saferSyms || []).map(chipFor).join("")}</div>` : `<div class="chips">${m.ex.map(chipFor).join("")}</div>`}
          </article>`; }).join("")}</div>
        ${worst.length ? `<p class="small" style="margin-top:12px"><b>Die Lehre aus 2025/26:</b> Genau solche Werte waren 2025 die großen Stars – in den letzten 12 Monaten: ${worst.map(x => `${esc(x.sym)} <span class="down">${fmt(x.ret12m, 0)} %</span>`).join(", ")}. Wer 1000 % will, muss −80 % aushalten können.</p>` : ""}
        <ul class="checklist">
          <li><b>Nur ein kleiner „Moonshot-Korb“:</b> höchstens 5–10 % Ihres Geldes, verteilt auf 10–20 Werte mit je höchstens 1 %. Ein einziger Treffer mit +1000 % gleicht viele Totalverluste aus – ein Einzelwert nicht.</li>
          <li><b>Langsam kaufen, lange halten:</b> in mehreren Schritten über Monate; solche Werte brauchen Jahre, nicht Wochen.</li>
          <li><b>Nie mit Hebel und nie mit geliehenem Geld.</b> Schwankungen von 60–70 % pro Jahr sind hier normal.</li>
          <li><b>Verkaufen, wenn die Geschichte nicht mehr stimmt</b> – etwa wenn das Geld knapp wird und laufend neue Aktien ausgegeben werden –, nicht wegen eines schlechten Tages.</li>
        </ul>
      </article>`;
  }

  // ================= Termine mit belegtem Muster =================
  // Zinsentscheide der US-Notenbank (2. Sitzungstag, Bekanntgabe 14:00 Uhr New York). 2027: vorläufiger Kalender der Fed.
  const FOMC = [["2026-12-09", false], ["2027-01-27", true], ["2027-03-17", true], ["2027-04-28", true], ["2027-06-09", true], ["2027-07-28", true]];
  function nyTime(dateIso, h) {
    // Uhrzeit in New York → Date (Sommer-/Winterzeit automatisch)
    for (const off of [4, 5]) {
      const d = new Date(`${dateIso}T${String(h + off).padStart(2, "0")}:00:00Z`);
      const ny = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" }).format(d));
      if (ny === h) return d;
    }
    return new Date(`${dateIso}T${h + 5}:00:00Z`);
  }
  const isWeekday = d => d.getDay() > 0 && d.getDay() < 6;
  function turnOfMonth(now = new Date()) {
    // letzter Handelstag des Monats bis 3. Handelstag des Folgemonats (Mo–Fr, ohne Feiertage)
    const res = [];
    for (let k = 0; k < 3; k++) {
      const y = now.getFullYear(), mo = now.getMonth() + k;
      const last = new Date(y, mo + 1, 0);
      while (!isWeekday(last)) last.setDate(last.getDate() - 1);
      const end = new Date(y, mo + 1, 1);
      let c = isWeekday(end) ? 1 : 0;
      while (c < 3) { end.setDate(end.getDate() + 1); if (isWeekday(end)) c++; }
      if (end >= new Date(now.getFullYear(), now.getMonth(), now.getDate())) res.push({ start: last, end });
    }
    return res[0];
  }
  const dLabel = d => ({ day: d.toLocaleDateString("de-DE", { day: "2-digit" }), mon: d.toLocaleDateString("de-DE", { month: "short" }).replace(".", "") });
  const longDate = d => d.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  function datesHtml() {
    const now = new Date();
    const items = [];
    const tom = turnOfMonth(now);
    if (tom) {
      const running = now >= tom.start;
      items.push({ date: tom.start, soon: (tom.start - now) / 864e5 < 7, html: `<b>Monatswechsel-Fenster ${running ? "läuft gerade" : ""}</b><p>${longDate(tom.start)} bis ${longDate(tom.end)} · letzter und erste drei Handelstage (Feiertage nicht berücksichtigt) · ${evidence(2)}</p>` });
    }
    const next = FOMC.map(([d, tentative]) => ({ at: nyTime(d, 14), tentative })).filter(f => f.at > now).slice(0, 3);
    for (const f of next) {
      const berlin = f.at.toLocaleTimeString("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" });
      items.push({ date: f.at, soon: (f.at - now) / 864e5 < 7, html: `<b>Zinsentscheid der US-Notenbank${f.tentative ? " (vorläufiger Termin)" : ""}</b><p>${longDate(f.at)}, ${berlin} Uhr deutscher Zeit · starke Schwankungen rund um die Bekanntgabe; Effekt davor ${evidence(1)}</p>` });
    }
    items.sort((a, b) => a.date - b.date);
    return `<div class="timeline">${items.map(it => { const l = dLabel(it.date); return `<div class="when-card ${it.soon ? "soon" : ""}"><div class="when-date"><b>${l.day}</b><span>${l.mon}</span></div><div class="when-text">${it.html}</div></div>`; }).join("")}</div>
      <p class="muted small" style="margin-top:10px">Termine der US-Notenbank: ${A("https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm", "Federal Reserve – Meeting calendars")}. Wichtige Wirtschaftsdaten stehen im Bereich Markt unter <a href="#news">Wirtschaftskalender</a>.</p>`;
  }

  // ================= Darstellung =================
  let theoryFilter = "Alle";
  function renderTheory() {
    const host = $("theoryBody");
    if (!host) return;
    const cats = ["Alle", ...new Set(THEORY.map(t => t.cat))];
    const list = THEORY.filter(t => theoryFilter === "Alle" || t.cat === theoryFilter);
    loadStocks();
    host.innerHTML = futureHtml() + `
      <article class="card" data-section="Theorien"><h2 class="card-title">Die wichtigsten Theorien</h2>
      <div class="filter-row">
        <div class="seg" role="group" aria-label="Themen filtern">${cats.map(c => `<button type="button" data-cat="${c}" aria-pressed="${c === theoryFilter}">${c}</button>`).join("")}</div>
        <span class="muted small">${list.length} Theorien · Beweisstärke: ${evidence(3)} ${evidence(2)} ${evidence(1)}</span>
      </div>
      <div class="topic-grid">${list.map(t => `
        <article class="topic">
          <div class="topic-kicker"><span>${t.cat}</span>${evidence(t.e)}</div>
          <h3>${t.title}</h3>
          <p class="core">${t.core}</p>
          <p class="means"><b>Was es für Sie heißt:</b> ${t.means}</p>
          <p class="now"><b>Aktuell:</b> ${t.now}</p>
          <ul class="srcs">${t.src.map(s => `<li>${s}</li>`).join("")}</ul>
        </article>`).join("")}
      </div>
      <p class="muted small">Auswahl nach Bedeutung in Fachzeitschriften und aktueller Forschung (Stand November 2026). Beweisstärke ist eine Einschätzung dieser Seite anhand der Studienlage, keine amtliche Bewertung.</p></article>`;
    host.querySelectorAll("[data-cat]").forEach(b => b.addEventListener("click", () => { theoryFilter = b.dataset.cat; renderTheory(); }));
    window.dispatchEvent(new Event("dtd:sections"));
  }

  function renderIdeas() {
    const host = $("ideasBody");
    if (!host) return;
    const m = window.DTD.market;
    host.innerHTML = `
      <article class="card">
        <div class="card-head"><h2 class="card-title">Nächste Termine mit belegtem Muster</h2><span class="badge">automatisch berechnet</span></div>
        ${datesHtml()}
      </article>
      <div class="card-head" style="margin:6px 0 -4px"><h2 class="card-title" style="font-size:20px">Strategien mit Studienlage</h2><span class="muted small">sortiert nach Beweisstärke</span></div>
      <div class="topic-grid">${STRATS.slice().sort((a, b) => b.e - a.e).map(s => {
        const sig = s.signal(m);
        return `<article class="topic">
          <div class="topic-kicker"><span>${s.horizon}</span>${evidence(s.e)}</div>
          <h3>${s.title}</h3>
          <p class="core">${s.core}</p>
          ${sig ? `<p class="means"><b>Jetzt:</b> ${sig}</p>` : ""}
          <p class="now"><b>Umsetzung:</b> ${s.how}</p>
          <p class="risk"><b>Risiko:</b> ${s.risk}</p>
          <ul class="srcs">${s.src.map(x => `<li>${x}</li>`).join("")}</ul>
        </article>`; }).join("")}
      </div>
      <div class="card-head" style="margin:6px 0 -4px"><h2 class="card-title" style="font-size:20px">Zukunftsthemen</h2><span class="muted small">belegt sind die Trends – nicht, dass ihre Aktien steigen</span></div>
      <div class="topic-grid">${THEMES.map(t => `
        <article class="topic">
          <div class="topic-kicker"><span>Megatrend</span></div>
          <h3>${t.title}</h3>
          <p class="core">${t.core}</p>
          <p class="means"><b>Wer profitieren könnte:</b> ${t.who}</p>
          <p class="risk"><b>Risiko:</b> ${t.risk}</p>
          <ul class="srcs">${t.src.map(x => `<li>${x}</li>`).join("")}</ul>
        </article>`).join("")}
        <article class="topic" style="box-shadow:inset 0 3px 0 var(--text)">
          <div class="topic-kicker"><span>Wichtig</span>${evidence(3)}</div>
          <h3>Bekannte Trends sind oft schon im Preis</h3>
          <p class="core">Spezial- und Themen-ETFs verloren in ihren ersten fünf Jahren risikobereinigt rund 30 %. Grund ist nicht die Gebühr, sondern der Zeitpunkt: Sie werden aufgelegt, wenn die Themen-Aktien schon überbewertet sind. Grüne Aktien liefen zuletzt vor allem wegen überraschend gestiegener Klimasorge gut.</p>
          <p class="means"><b>Was es für Sie heißt:</b> Ein richtiger Megatrend ist noch keine gute Anlage. Klein einsteigen, breit streuen, nicht nachkaufen, nur weil ein Thema in den Nachrichten ist.</p>
          <ul class="srcs"><li>${DOI("10.1093/rfs/hhac048", "Ben-David, Franzoni, Kim &amp; Moussawi, RFS 2023")}</li><li>${DOI("10.1016/j.jfineco.2022.07.007", "Pástor, Stambaugh &amp; Taylor, JFE 2022")}</li></ul>
        </article>
      </div>
      <p class="muted small">Keine Anlageberatung: Die Ideen beschreiben, was Studien gefunden haben, und wie es sich grundsätzlich umsetzen ließe. Einzelne Wertpapiere werden bewusst nicht empfohlen.</p>`;
  }

  // Für den Aktien-Check: die nächsten marktweiten Termine
  window.DTD.nextMarketDates = () => {
    const now = new Date(), items = [];
    const tom = turnOfMonth(now);
    if (tom) { const l = dLabel(tom.start); items.push({ date: tom.start, ...l, title: "Monatswechsel-Fenster", text: `${longDate(tom.start)} bis ${longDate(tom.end)} · im Schnitt stärkere Indexrenditen (gemischt belegt)` }); }
    for (const f of FOMC.map(([d, tentative]) => ({ at: nyTime(d, 14), tentative })).filter(f => f.at > now).slice(0, 2)) {
      const l = dLabel(f.at), berlin = f.at.toLocaleTimeString("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" });
      items.push({ date: f.at, ...l, title: `Zinsentscheid der US-Notenbank${f.tentative ? " (vorläufig)" : ""}`, text: `${longDate(f.at)}, ${berlin} Uhr · starke Schwankungen rund um die Bekanntgabe` });
    }
    return items.sort((a, b) => a.date - b.date);
  };
  // Namen der Sparten und 1000-%-Ideen für den Swing-Planer
  window.DTD.themeInfo = () => Object.fromEntries([...FUTURE.map(f => [`sector:${f.id}`, { title: f.title, level: f.level }]), ...MOON.map(m => [`moon:${m.id}`, { title: m.title }])]);
  window.DTD.renderTheory = renderTheory;
  window.DTD.renderIdeas = renderIdeas;
  window.addEventListener("dtd:market", () => { if ($("ideen") && !$("ideen").hidden) renderIdeas(); });
})();

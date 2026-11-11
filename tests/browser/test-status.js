// Browser-Test (Playwright) – läuft in der Rechenkontrolle über tests/browser/run.sh
// Datenstand an der Live-Uhr: Punkt und Beschriftung je nach Lage (alles aktuell, verspätet, Ausfall), Knopf öffnet die
// Übersicht mit Zustand je Quelle und fehlgeschlagenen Läufen (Link zum Protokoll), Adresse #datenstand öffnet sie direkt,
// ohne status.json ein klarer Hinweis; Alter wird beim Anzeigen neu gerechnet (gleiche Regeln wie scripts/data-status.mjs).
// node test-status.js <port> <ausgabe>
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const stocks = fs.readFileSync(path.join(__dirname, 'fixtures', 'stocks.json'), 'utf8');
const NOW = '2026-11-11T12:00:00Z';   // Mittwoch
const S = (id, label, updated, o = {}) => ({ id, label, updated, mode: 'work', warn: 20, stale: 30, cadence: 'Mo–Fr zweimal täglich', ...o });
const STATUS = {
  updated: '2026-11-11T11:53:00Z',
  sources: [
    S('stocks', 'Aktien-Daten und Swing-Planer', '2026-11-11T09:35:00Z'),
    S('news', 'Nachrichten', '2026-11-10T20:54:00Z', { warn: 12, stale: 26, cadence: 'Mo–Fr viermal täglich' }),
    S('fx', 'Wechselkurse (EZB)', '2026-11-06T15:30:00Z', { warn: 30, stale: 54, cadence: 'Mo–Fr einmal täglich' }),
    S('alarms', 'Kursalarme und Stops aufs Handy', null, { mode: 'live', warn: 1.5, stale: 4, optional: true, cadence: 'mit dem Live-Wächter' }),
    S('research', 'Forschungsstand im Bereich Vermögen', '2026-11-11', { mode: 'due', due: '2026-12-11', cadence: 'monatlich geprüft' }),
  ],
  workflows: [{ file: 'trend-bot.yml', name: 'Trend-Bot', conclusion: 'failure', at: '2026-11-11T10:30:00Z', url: 'https://github.com/x/y/actions/runs/1' }, { file: 'tests.yml', name: 'Rechenkontrolle', conclusion: 'success', at: '2026-11-11T08:00:00Z' }],
  problems: [], alerts: { new: [], resolved: [] },
};
const ALLOK = { ...STATUS, sources: STATUS.sources.slice(0, 1).concat(STATUS.sources.slice(3)), workflows: [STATUS.workflows[1]] };

(async () => {
  const [port, out] = process.argv.slice(2);
  const b = await chromium.launch(), errs = [], fails = [];
  const check = (ok, msg) => { console.log(`${ok ? '✓' : '✗'} ${msg}`); if (!ok) fails.push(msg); };
  async function open(status, { width = 1280, hash = 'home' } = {}) {
    const p = await (await b.newContext({ viewport: { width, height: 900 }, timezoneId: 'Europe/Vienna', locale: 'de-AT' })).newPage();
    await p.clock.setFixedTime(new Date(NOW));
    p.on('pageerror', e => errs.push(e.message));
    await p.route('**/status/status.json*', r => (status ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(status) }) : r.fulfill({ status: 404, body: '' })));
    await p.route('**/stock-data/stocks.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: stocks }));
    await p.route(/tradingview|finnhub\.io|news-data|fund-data|note-|swing\.json|live-data|fx-data|wealth-data/, r => r.abort());
    await p.goto(`http://localhost:${port}/#${hash}`, { waitUntil: 'load' });
    await p.waitForTimeout(3600);   // Datenstand lädt 3 s nach dem Start
    return p;
  }
  const chip = p => p.$eval('.livechip', e => ({ tag: e.tagName, health: e.dataset.health, label: e.getAttribute('aria-label') }));

  const p = await open(STATUS);
  let c = await chip(p);
  check(c.tag === 'BUTTON' && c.health === 'bad' && c.label === 'Datenstand anzeigen – 2 Probleme', `Live-Uhr als Knopf mit rotem Punkt (${JSON.stringify(c)})`);
  await p.click('.livechip'); await p.waitForTimeout(300);
  check(await p.$eval('#drawerTitle', e => e.textContent) === 'Datenstand' && await p.$eval('#drawer', e => !e.hidden), 'Knopf öffnet die Übersicht');
  const rows = await p.$$eval('#drawerBody .ds-list:first-of-type .ds-row', l => l.map(r => r.innerText.replace(/\s+/g, ' ')));
  console.log('  ', rows.join(' | '));
  check(rows.length === 5 && /Aktien-Daten.*zuletzt vor 2 Std\..*aktuell$/.test(rows[0]), 'Aktien-Daten vom Morgen: aktuell, „vor 2 Std.“');
  check(/Nachrichten.*verspätet$/.test(rows[1]) && /Wechselkurse.*ausgefallen$/.test(rows[2]) && /Kursalarme.*noch keine Daten.*nicht eingerichtet$/.test(rows[3]), 'verspätet, ausgefallen, nicht eingerichtet');
  check(/Forschungsstand.*geprüft am 11\.11\.2026, nächste Prüfung 11\.12\.2026.*aktuell$/.test(rows[4]), 'Forschungsstand mit Prüftermin');
  const wf = await p.$$eval('#drawerBody .ds-list:nth-of-type(2) .ds-row', l => l.map(r => ({ t: r.innerText.replace(/\s+/g, ' '), href: (r.querySelector('a') || {}).href, rel: (r.querySelector('a') || {}).rel })));
  check(wf.length === 1 && /Trend-Bot/.test(wf[0].t) && wf[0].href === 'https://github.com/x/y/actions/runs/1' && /noopener/.test(wf[0].rel), 'fehlgeschlagener Lauf mit Link zum Protokoll');
  check(/Mindestens eine Auswertung ist ausgefallen/.test(await p.$eval('#drawerBody', e => e.innerText)), 'Zusammenfassung oben');
  try { await (await p.$('#drawer')).screenshot({ path: `${out}/status-drawer.png` }); } catch { /* Bildschirmfoto nur zur Ansicht */ }
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  check(await p.$eval('#drawer', e => e.hidden), 'Escape schließt die Übersicht');

  // alles aktuell
  const a = await open(ALLOK);
  c = await chip(a);
  check(c.health === 'ok' && /alles aktuell/.test(c.label), `alles aktuell: grüner Punkt (${c.label})`);
  // Adresse #datenstand öffnet direkt (z. B. aus der Handy-Meldung)
  const h = await open(ALLOK, { hash: 'datenstand', width: 360 });
  check(await h.$eval('#drawer', e => !e.hidden) && /Alle Auswertungen sind aktuell/.test(await h.$eval('#drawerBody', e => e.innerText)), '#datenstand öffnet die Übersicht');
  check(await h.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.getElementById('drawer').scrollWidth <= innerWidth), 'Handy 360 px: Übersicht passt');
  // ohne status.json
  const n = await open(null);
  await n.click('.livechip'); await n.waitForTimeout(400);
  check(/noch nicht verfügbar/.test(await n.$eval('#drawerBody', e => e.innerText)) && (await chip(n)).health === 'unknown', 'ohne Datenstand: klarer Hinweis');

  check(!errs.length, `Keine Skriptfehler${errs.length ? ': ' + errs.join(' | ') : ''}`);
  await b.close();
  console.log(fails.length ? `\n${fails.length} FEHLER` : '\nALLES OK');
  process.exit(fails.length ? 1 : 0);
})();

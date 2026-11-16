// Browser-Test (Playwright) – läuft in der Rechenkontrolle über tests/browser/run.sh
// Einfacher Einstieg: Erster Besuch am Handy zeigt die Willkommenskarte mit vier Schritten statt Änderungsliste und leerer
// Karten; „Eine Aktie prüfen“ öffnet den Aktien-Check mit dem Cursor im Suchfeld; „Ausblenden“ bleibt gemerkt. Schnellstart-
// Kacheln (am Computer in einer Reihe), Begrüßung nach Uhrzeit (nachts „Guten Abend“). Leiste unten: vier Bereiche und „Mehr“;
// das Fenster „Mehr“ führt zu Vermögen, Werkzeugen, Ideen und Bots und hebt „Mehr“ hervor; ein ausgeblendeter Hauptbereich
// macht seinen Platz frei. Hinweise lassen sich antippen und schließen. node test-start.js <port> <ausgabe>
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const stocks = fs.readFileSync(path.join(__dirname, 'fixtures', 'stocks.json'), 'utf8');

(async () => {
  const [port, out] = process.argv.slice(2);
  const b = await chromium.launch(), errs = [], fails = [];
  const check = (ok, msg) => { console.log(`${ok ? '✓' : '✗'} ${msg}`); if (!ok) fails.push(msg); };
  async function page(viewport, seed = null, at = null) {
    const ctx = await b.newContext({ viewport, locale: 'de-AT', timezoneId: 'Europe/Vienna' });
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(e.message));
    if (at) await p.clock.setFixedTime(new Date(at));
    await p.route(/raw\.githubusercontent\.com/, r => r.fulfill({ status: 404, body: '' }));
    await p.route('**/stock-data/stocks.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: stocks }));
    await p.route(/tradingview|finnhub\.io|supabase\.co/, r => r.abort());
    await p.addInitScript(s => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('dtd-swipe-hint', 'true'); for (const [k, v] of Object.entries(s || {})) localStorage.setItem(k, JSON.stringify(v)); } }, seed);
    await p.goto(`http://localhost:${port}/#home`, { waitUntil: 'load' });
    await p.waitForTimeout(1200);
    return p;
  }
  const text = (p, sel) => p.$eval(sel, e => e.innerText.replace(/\s+/g, ' ')).catch(() => '');

  // 1) Erster Besuch am Handy (nachts): Willkommen statt Änderungsliste und leerer Karten
  const m = await page({ width: 390, height: 844 }, null, '2026-11-16T00:30:00Z');
  check(await text(m, '#ovGreeting') === 'Guten Abend', `nachts „Guten Abend“ statt „Guten Morgen“ (${await text(m, '#ovGreeting')})`);
  const steps = await m.$$eval('.welcome .welcome-steps li', l => l.map(e => e.querySelector('b').textContent));
  check(steps.join('|') === 'Eine Aktie prüfen|Depot eintragen|Marktlage ansehen|Als App aufs Handy', `Willkommen mit vier Schritten (${steps.join(', ')})`);
  check(!(await m.$('#ovSmart .whatsnew')) && !(await m.$('[data-home="depot"]')) && !(await m.$('[data-home="alerts"]')), 'erster Besuch: keine Änderungsliste, keine leeren Karten zu Depot und Hinweisen');
  check(await m.evaluate(() => localStorage.getItem('dtd-wn-seen') !== null), 'Änderungsliste gilt beim ersten Besuch als gelesen');
  const tiles = await m.$$eval('.start-tile b', l => l.map(e => e.textContent));
  check(tiles.join('|') === 'Aktie prüfen|Mein Depot|Marktlage|Ideen', `Schnellstart-Kacheln (${tiles.join(', ')})`);
  try { await m.screenshot({ path: `${out}/start-willkommen.png` }); } catch { /* Bildschirmfoto nur zur Ansicht */ }
  await m.click('.welcome-steps [data-start-search]'); await m.waitForTimeout(700);
  check(await m.evaluate(() => location.hash === '#aktie' && document.activeElement && document.activeElement.id === 'stockInput'), '„Eine Aktie prüfen“: Aktien-Check mit Cursor im Suchfeld');
  await m.click('.bottomnav [data-go="home"]'); await m.waitForTimeout(500);
  await m.click('[data-welcome-done]'); await m.waitForTimeout(300);
  check(!(await m.$('.welcome')), '„Alles klar, ausblenden“ blendet die Willkommenskarte aus');
  await m.reload({ waitUntil: 'load' }); await m.waitForTimeout(1000);
  check(!(await m.$('.welcome')) && !!(await m.$('.start-tiles')), 'bleibt nach dem Neuladen ausgeblendet, Kacheln bleiben');

  // 2) Leiste unten und „Mehr“
  const bar = await m.$$eval('.bottomnav button', l => l.map(e => e.dataset.go || (e.dataset.more !== undefined ? 'mehr' : '?')).join());
  check(bar === 'home,portfolio,aktie,markt,mehr', `Leiste unten: vier Bereiche und „Mehr“ (${bar})`);
  await m.click('.bottomnav [data-more]'); await m.waitForTimeout(300);
  const sheet = await m.$$eval('.navsheet [data-go]', l => l.map(e => e.dataset.go).join());
  const utils = await m.$$eval('[data-more-act]', l => l.map(e => e.dataset.moreAct).join());
  check(sheet === 'vermoegen,tools,ideas,bots' && utils === 'layout,account,theme,help', `„Mehr“: weitere Bereiche mit Erklärung und Einstellungen (${sheet} · ${utils})`);
  try { await m.screenshot({ path: `${out}/start-mehr.png` }); } catch { /* Bildschirmfoto nur zur Ansicht */ }
  await m.click('.navsheet [data-go="tools"]'); await m.waitForTimeout(500);
  const inTools = await m.evaluate(() => ({ hash: location.hash, drawer: document.getElementById('drawer').hidden, more: document.querySelector('.bottomnav [data-more]').classList.contains('on'), anyGo: !!document.querySelector('.bottomnav [data-go].on') }));
  check(inTools.hash === '#tools' && inTools.drawer && inTools.more && !inTools.anyGo, `Werkzeuge über „Mehr“ geöffnet, „Mehr“ hervorgehoben (${JSON.stringify(inTools)})`);
  await m.click('.bottomnav [data-more]'); await m.waitForTimeout(250);
  await m.click('[data-more-act="help"]'); await m.waitForTimeout(250);
  check(/Kurze Anleitung/.test(await text(m, '#drawerTitle')) && /Depot/.test(await text(m, '#drawerBody')), '„Kurze Anleitung“ erklärt den Aufbau');
  await m.keyboard.press('Escape');
  // Hinweis antippen schließt ihn
  await m.evaluate(() => toast('Test', 'Antippen schließt mich', 9000)); await m.waitForTimeout(100);
  await m.click('#toasts .toast'); await m.waitForTimeout(100);
  check(!(await m.$('#toasts .toast')), 'Hinweis antippen: sofort geschlossen');

  // 3) Ausgeblendeter Hauptbereich (Markt) macht Platz; bestehender Nutzer ohne Willkommen, Depot-Kachel zählt
  const u = await page({ width: 390, height: 844 }, { 'dtd-portfolio': [{ id: 'a', sym: 'NVDA', buy: 150, qty: 10 }, { id: 'b', sym: 'KO', buy: 60, qty: 2 }], 'dtd-layout': { hide: ['markt'] } }, '2026-11-16T09:00:00Z');
  const bar2 = await u.$$eval('.bottomnav button', l => l.map(e => e.dataset.go || 'mehr').join());
  check(bar2 === 'home,portfolio,aktie,vermoegen,mehr', `Markt ausgeblendet: Vermögen rückt in die Leiste (${bar2})`);
  check(!(await u.$('.welcome')) && /2 Aktien im Blick/.test(await text(u, '.start-tiles')) && !/Marktlage/.test(await text(u, '.start-tiles')), 'bestehender Nutzer: keine Willkommenskarte, Depot-Kachel zählt, ausgeblendete Marktlage fehlt');
  check(await text(u, '#ovGreeting') === 'Guten Morgen', 'vormittags „Guten Morgen“');

  // 4) Computer: Kacheln in einer Reihe, Leiste unten unsichtbar
  const d = await page({ width: 1280, height: 900 }, { 'dtd-portfolio': [{ id: 'a', sym: 'NVDA', buy: 150, qty: 10 }] });
  const row = await d.$$eval('.start-tile', l => l.map(e => Math.round(e.getBoundingClientRect().top)));
  check(row.length === 4 && new Set(row).size === 1 && await d.$eval('.bottomnav', e => getComputedStyle(e).display === 'none'), `Computer: vier Kacheln in einer Reihe (${row.join(', ')})`);

  check(!errs.length, `Keine Skriptfehler${errs.length ? ': ' + [...new Set(errs)].join(' | ') : ''}`);
  await b.close();
  console.log(fails.length ? `\n${fails.length} FEHLER` : '\nALLES OK');
  process.exit(fails.length ? 1 : 0);
})();

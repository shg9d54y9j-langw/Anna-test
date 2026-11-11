// Browser-Test (Playwright) – läuft in der Rechenkontrolle über tests/browser/run.sh
// Seite anpassen: Bereiche und Startseiten-Karten ausblenden, umsortieren, zurücksetzen. node test-layout.js <port> <ausgabe>
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
// Testdaten: feste Dateien in tests/browser/fixtures, abgeleitete aus make-fixtures.mjs (FIXTURES_TMP)
const FX = { 'stocks-2053.json': 'stocks.json', 'fund-cty.json': 'fund.json', 'swing-2053.json': 'swing.json', 'fund-earn.json': 'fund-earn.json' };
const fx = n => (FX[n] ? path.join(__dirname, 'fixtures', FX[n]) : path.join(process.env.FIXTURES_TMP || '/tmp/rojko-fixtures', n));

(async () => {
  const [port, out] = process.argv.slice(2);
  const stocks = fs.readFileSync(fx('stocks-2053.json'), 'utf8'), fund = fs.readFileSync(fx('fund-cty.json'), 'utf8');
  const b = await chromium.launch(), errs = [], fails = [];
  const check = (ok, msg) => { console.log(`${ok ? '✓' : '✗'} ${msg}`); if (!ok) fails.push(msg); };
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  p.on('pageerror', e => errs.push(e.message));
  await p.addInitScript(() => { if (!localStorage.getItem('seeded')) { localStorage.setItem('seeded', '1'); localStorage.setItem('dtd-portfolio', JSON.stringify([{ id: 'a', sym: 'NVDA', buy: 150, qty: 10 }])); localStorage.setItem('dtd-watch', JSON.stringify(['AAPL'])); } });
  await p.route('**/stock-data/stocks.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: stocks }));
  await p.route('**/fund-data/fund.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: fund }));
  await p.route(/tradingview|finnhub\.io|news-data|note-track|swing\.json|note-recent/, r => r.abort());
  await p.goto(`http://localhost:${port}/#home`, { waitUntil: 'load' });
  await p.waitForSelector('#ovSmart [data-home="depot"]', { timeout: 15000 });
  const topOrder = () => p.$$eval('#ovSmart > [data-home]', l => l.map(x => x.dataset.home));
  console.log('  Start:', JSON.stringify(await topOrder()));
  await p.click('[data-layout-open]');
  await p.waitForSelector('#layBody');
  check(await p.$$eval('#layBody input[data-lay="view"]', l => l.length) === 6, 'alle 5 Bereiche außer der Übersicht und der Knopf „Bots & Copy-Trading“ wählbar');
  try { await (await p.$('.drawer, #layBody')).screenshot({ path: `${out}/layout-drawer.png` }).catch(() => null); } catch { /* Bildschirmfoto nur zur Ansicht */ }
  // Knopf „Bots & Copy-Trading“ ausblenden
  await p.click('#layBody input[data-lay="view"][data-id="bots"]');
  const vis = await p.evaluate(() => ({ btn: document.getElementById('botsBtn').hidden, shown: getComputedStyle(document.getElementById('botsBtn')).display }));
  check(vis.btn && vis.shown === 'none', `Knopf „Bots & Copy-Trading“ ausgeblendet (${JSON.stringify(vis)})`);
  // Karten: Börsen und „Neu heute“ aus, „Seit Ihrem letzten Besuch“ nach oben, Tagesregeln nach oben
  await p.click('#layBody input[data-lay="dash"][data-id="sessions"]');
  await p.click('#layBody input[data-lay="top"][data-id="today"]');
  await p.click('#layBody [data-lay-move="top"][data-id="depot"][data-dir="-1"]');
  await p.click('#layBody [data-lay-move="dash"][data-id="rules"][data-dir="-1"]');
  await p.waitForTimeout(300);
  const st = await p.evaluate(() => ({ live: getComputedStyle(document.querySelector('#home [data-home="sessions"]')).display, rulesOrder: getComputedStyle(document.querySelector('#ovDash > [data-home="rules"]')).order, journalOrder: getComputedStyle(document.querySelector('#ovDash > [data-home="journal"]')).order }));
  const t1 = await topOrder();
  console.log('  Danach:', JSON.stringify(t1), JSON.stringify(st));
  check(st.live === 'none', 'Karte „Börsen“ ausgeblendet');
  check(!t1.includes('today') && t1.indexOf('depot') < t1.indexOf('alerts'), 'Neu heute ausgeblendet, Depot vor den Hinweisen');
  check(Number(st.rulesOrder) < Number(st.journalOrder), 'Tagesregeln vor „Mein Handelstag“');
  // bleibt nach dem Neuladen
  await p.reload(); await p.waitForSelector('#ovSmart [data-home="depot"]', { timeout: 15000 });
  const after = await p.evaluate(() => ({ btn: document.getElementById('botsBtn').hidden, live: getComputedStyle(document.querySelector('#home [data-home="sessions"]')).display }));
  check(after.btn && after.live === 'none' && JSON.stringify(await topOrder()) === JSON.stringify(t1), 'Einstellungen bleiben nach dem Neuladen');
  // ausgeblendeter Bereich über Link erreichbar
  await p.evaluate(() => { location.hash = 'bot'; }); await p.waitForTimeout(500);
  check(await p.evaluate(() => !document.getElementById('bot').hidden), 'Trend-Bot über Link trotzdem erreichbar');
  check(await p.evaluate(() => !document.querySelector('#home [data-home="reco"], #home [data-home="live"]')), 'Startseite ohne Copy-Trading-Karten (Tagesempfehlung, Live-Wächter)');
  // zurücksetzen
  await p.evaluate(() => { location.hash = 'home'; }); await p.waitForTimeout(300);
  await p.click('[data-layout-open]'); await p.waitForSelector('#layBody');
  await p.click('#layBody [data-lay-reset]'); await p.waitForTimeout(300);
  const reset = await p.evaluate(() => ({ btn: document.getElementById('botsBtn').hidden, live: getComputedStyle(document.querySelector('#home [data-home="sessions"]')).display }));
  check(!reset.btn && reset.live !== 'none' && (await topOrder()).includes('today'), 'Zurücksetzen zeigt alles wieder');
  // Knopf unten auf der Startseite öffnet das Fenster wieder
  await p.click('#drawerClose'); await p.waitForTimeout(300);
  await p.click('#home .home-custom [data-layout-open]'); await p.waitForTimeout(300);
  check(await p.evaluate(() => !!document.getElementById('layBody')), 'Knopf „Seite anpassen“ auf der Startseite öffnet das Fenster');
  const ov = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
  check(ov[0] <= ov[1], 'kein seitliches Scrollen');
  check(!errs.length, `Keine Skriptfehler${errs.length ? ': ' + errs.join(' | ') : ''}`);
  await b.close();
  console.log(fails.length ? `\n${fails.length} FEHLER` : '\nALLES OK');
  process.exit(fails.length ? 1 : 0);
})();

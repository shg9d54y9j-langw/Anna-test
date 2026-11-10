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
  check(await p.$$eval('#layBody input[data-lay="view"]', l => l.length) === 11, 'alle 11 Bereiche außer der Übersicht wählbar');
  try { await (await p.$('.drawer, #layBody')).screenshot({ path: `${out}/layout-drawer.png` }).catch(() => null); } catch { /* Bildschirmfoto nur zur Ansicht */ }
  // Bereich „Trend-Bot“ ausblenden
  await p.click('#layBody input[data-lay="view"][data-id="bot"]');
  const vis = await p.evaluate(() => ({ tab: document.getElementById('tab-bot').hidden, bar: document.querySelector('.bottomnav [data-go="bot"]').hidden, sheet: document.querySelector('.navsheet [data-go="bot"]').hidden }));
  check(vis.tab && vis.bar && vis.sheet, `Trend-Bot aus Reitern, Leiste und „Alle Themen“ (${JSON.stringify(vis)})`);
  // Karten: Live-Wächter und „Neu heute“ aus, „Seit Ihrem letzten Besuch“ nach oben, Tagesregeln nach oben
  await p.click('#layBody input[data-lay="dash"][data-id="live"]');
  await p.click('#layBody input[data-lay="top"][data-id="today"]');
  await p.click('#layBody [data-lay-move="top"][data-id="depot"][data-dir="-1"]');
  await p.click('#layBody [data-lay-move="dash"][data-id="rules"][data-dir="-1"]');
  await p.waitForTimeout(300);
  const st = await p.evaluate(() => ({ live: getComputedStyle(document.querySelector('#home [data-home="live"]')).display, rulesOrder: getComputedStyle(document.querySelector('#ovDash > [data-home="rules"]')).order, journalOrder: getComputedStyle(document.querySelector('#ovDash > [data-home="journal"]')).order }));
  const t1 = await topOrder();
  console.log('  Danach:', JSON.stringify(t1), JSON.stringify(st));
  check(st.live === 'none', 'Live-Wächter ausgeblendet');
  check(!t1.includes('today') && t1.indexOf('depot') < t1.indexOf('alerts'), 'Neu heute ausgeblendet, Depot vor den Hinweisen');
  check(Number(st.rulesOrder) < Number(st.journalOrder), 'Tagesregeln vor „Mein Handelstag“');
  // bleibt nach dem Neuladen
  await p.reload(); await p.waitForSelector('#ovSmart [data-home="depot"]', { timeout: 15000 });
  const after = await p.evaluate(() => ({ tab: document.getElementById('tab-bot').hidden, bar: document.querySelector('.bottomnav [data-go="bot"]').hidden, live: getComputedStyle(document.querySelector('#home [data-home="live"]')).display }));
  check(after.tab && after.bar && after.live === 'none' && JSON.stringify(await topOrder()) === JSON.stringify(t1), 'Einstellungen bleiben nach dem Neuladen');
  // ausgeblendeter Bereich über Link erreichbar
  await p.evaluate(() => { location.hash = 'bot'; }); await p.waitForTimeout(500);
  check(await p.evaluate(() => !document.getElementById('bot').hidden), 'Trend-Bot über Link trotzdem erreichbar');
  // zurücksetzen
  await p.evaluate(() => { location.hash = 'home'; }); await p.waitForTimeout(300);
  await p.click('[data-layout-open]'); await p.waitForSelector('#layBody');
  await p.click('#layBody [data-lay-reset]'); await p.waitForTimeout(300);
  const reset = await p.evaluate(() => ({ tab: document.getElementById('tab-bot').hidden, live: getComputedStyle(document.querySelector('#home [data-home="live"]')).display }));
  check(!reset.tab && reset.live !== 'none' && (await topOrder()).includes('today'), 'Zurücksetzen zeigt alles wieder');
  // Eintrag in „Alle Themen“ öffnet das Fenster
  await p.click('#drawerClose'); await p.waitForTimeout(300);
  await p.click('.bottomnav [data-more]'); await p.click('.navsheet [data-layout-open]'); await p.waitForTimeout(300);
  check(await p.evaluate(() => !!document.getElementById('layBody') && document.querySelector('.navsheet').hidden), '„Alle Themen“ → Seite anpassen öffnet das Fenster');
  const ov = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
  check(ov[0] <= ov[1], 'kein seitliches Scrollen');
  check(!errs.length, `Keine Skriptfehler${errs.length ? ': ' + errs.join(' | ') : ''}`);
  await b.close();
  console.log(fails.length ? `\n${fails.length} FEHLER` : '\nALLES OK');
  process.exit(fails.length ? 1 : 0);
})();

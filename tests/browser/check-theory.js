// Browser-Test (Playwright) – läuft in der Rechenkontrolle über tests/browser/run.sh
const { chromium } = require('playwright'); const fs = require('fs');
const path = require('path');
// Testdaten: feste Dateien in tests/browser/fixtures, abgeleitete aus make-fixtures.mjs (FIXTURES_TMP)
const FX = { 'stocks-2053.json': 'stocks.json', 'fund-cty.json': 'fund.json', 'swing-2053.json': 'swing.json', 'fund-earn.json': 'fund-earn.json' };
const fx = n => (FX[n] ? path.join(__dirname, 'fixtures', FX[n]) : path.join(process.env.FIXTURES_TMP || '/tmp/rojko-fixtures', n));

(async () => {
  const stocks = fs.readFileSync(fx('stocks-2053.json'), 'utf8');
  const b = await chromium.launch(), errs = [];
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  p.on('pageerror', e => errs.push(e.message));
  await p.route('**/stocks.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: stocks }));
  await p.route(/tradingview|finnhub\.io|news-data|fund-data|swing\.json/, r => r.abort());
  await p.goto('http://localhost:8811/#theorie', { waitUntil: 'load' }); await p.waitForTimeout(1500);
  const h = await p.evaluate(() => document.getElementById('theorie').scrollHeight);
  const n = await p.$$eval('#theoryBody details.more', d => d.length);
  await p.click('#theoryBody details.more summary'); await p.waitForTimeout(200);
  const chips = await p.$$eval('#theoryBody details.more[open] .firm > .chip-btn', c => c.length);
  console.log(`Theorie am Handy: ${h}px (${Math.round(h / 844)} Bildschirme), ${n} aufklappbare Bereiche, nach Aufklappen ${chips} Firmen-Kürzel, JS-Fehler ${JSON.stringify(errs)}`);
  await b.close();
})();

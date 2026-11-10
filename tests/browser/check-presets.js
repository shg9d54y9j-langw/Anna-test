// Browser-Test (Playwright) – läuft in der Rechenkontrolle über tests/browser/run.sh
const { chromium } = require('playwright'); const fs = require('fs');
const path = require('path');
// Testdaten: feste Dateien in tests/browser/fixtures, abgeleitete aus make-fixtures.mjs (FIXTURES_TMP)
const FX = { 'stocks-2053.json': 'stocks.json', 'fund-cty.json': 'fund.json', 'swing-2053.json': 'swing.json', 'fund-earn.json': 'fund-earn.json' };
const fx = n => (FX[n] ? path.join(__dirname, 'fixtures', FX[n]) : path.join(process.env.FIXTURES_TMP || '/tmp/rojko-fixtures', n));

(async () => {
  const stocks = fs.readFileSync(fx('stocks-2053.json'), 'utf8'), fund = fs.readFileSync(fx('fund-cty.json'), 'utf8'), swing = fs.readFileSync(fx('swing-2053.json'), 'utf8');
  const b = await chromium.launch(), errs = [];
  const p = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  p.on('pageerror', e => errs.push(e.message));
  await p.route('**/stocks.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: stocks }));
  await p.route('**/fund-data/fund.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: fund }));
  await p.route('**/swing.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: swing }));
  await p.route(/tradingview|finnhub\.io|news-data/, r => r.abort());
  await p.goto('http://localhost:8811/#tools', { waitUntil: 'load' });
  await p.waitForSelector('#screener tbody tr', { timeout: 15000 });
  const out = {};
  for (const k of ['quality', 'growthTrend', 'calm', 'experts', 'best']) { await p.click(`#screener [data-preset="${k}"]`); await p.waitForTimeout(150); out[k] = await p.$eval('#screener .card-head .muted', e => e.textContent) + ' · ' + (await p.$$eval('#screener tbody tr .chip-btn', x => x.slice(0, 5).map(y => y.textContent).join(','))); }
  console.log(JSON.stringify(out, null, 1));
  await p.goto('http://localhost:8811/#hot', { waitUntil: 'load' }); await p.waitForSelector('#hotBody .idea .w-note', { timeout: 15000 }).catch(() => null);
  const hot = await p.$$eval('#hotBody .idea .w-note', x => x.length);
  await p.goto('http://localhost:8811/#swing', { waitUntil: 'load' }); await p.waitForSelector('#swingBody .idea .w-note', { timeout: 15000 }).catch(() => null);
  const sw = await p.$$eval('#swingBody .idea .w-note', x => x.length);
  console.log('Noten in Karten: HotStuff', hot, 'Swing', sw, 'JS-Fehler', JSON.stringify(errs));
  await b.close();
})();

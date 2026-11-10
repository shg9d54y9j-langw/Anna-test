// Browser-Test (Playwright) – läuft in der Rechenkontrolle über tests/browser/run.sh
const { chromium } = require('playwright'); const fs = require('fs');
const path = require('path');
// Testdaten: feste Dateien in tests/browser/fixtures, abgeleitete aus make-fixtures.mjs (FIXTURES_TMP)
const FX = { 'stocks-2053.json': 'stocks.json', 'fund-cty.json': 'fund.json', 'swing-2053.json': 'swing.json', 'fund-earn.json': 'fund-earn.json' };
const fx = n => (FX[n] ? path.join(__dirname, 'fixtures', FX[n]) : path.join(process.env.FIXTURES_TMP || '/tmp/rojko-fixtures', n));

(async () => {
  const stocks = fs.readFileSync(fx('stocks-2053.json'), 'utf8'), fund = fs.readFileSync(fx('fund-earn.json'), 'utf8');
  const b = await chromium.launch(), errs = [], fails = [];
  for (const [name, vp] of [['desk', { width: 1280, height: 900 }], ['small', { width: 360, height: 740 }]]) {
    const p = await (await b.newContext({ viewport: vp })).newPage();
    p.on('pageerror', e => errs.push(e.message));
    await p.route('**/stocks.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: stocks }));
    await p.route('**/fund-data/fund.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: fund }));
    await p.route(/tradingview|finnhub\.io|swing\.json|news-data/, r => r.abort());
    await p.goto('http://localhost:8811/#aktie', { waitUntil: 'load' });
    await p.waitForFunction(() => window.DTD.stockData && window.DTD.stockData());
    await p.waitForFunction(() => window.DTD.market !== undefined, null, { timeout: 6000 }).catch(() => {});
    await p.evaluate(() => window.DTD.openStock('NVDA'));
    await p.waitForSelector('#skEarn table tbody tr', { timeout: 15000 }); await p.waitForSelector('#skPeers tbody tr', { timeout: 15000 });
    const r = await p.evaluate(() => ({ earn: document.querySelector('#skEarn > p.small:not(.hint)') && [...document.querySelectorAll('#skEarn > p')].map(x => x.innerText).join(' | '), rows: document.querySelectorAll('#skEarn tbody tr').length, peersIntro: document.querySelector('#skPeers > p').innerText, peers: [...document.querySelectorAll('#skPeers tbody tr .chip-btn')].map(x => x.textContent), w: [document.documentElement.scrollWidth, innerWidth] }));
    console.log(name, JSON.stringify(r));
    if (r.rows !== 4 || !/3 von 4/.test(r.earn) || !/direkte Konkurrenten laut Finnhub/.test(r.peersIntro) || r.peers.slice(1, 7).join() !== 'AMD,AVGO,INTC,QCOM,TSM,MRVL' || r.w[0] > r.w[1]) fails.push(name);
    try { if (name === 'small') { await p.evaluate(() => document.querySelector('#stockBody [data-section="Quartalszahlen"]').scrollIntoView()); await (await p.$('#stockBody [data-section="Quartalszahlen"]')).screenshot({ path: 'step2/small-earn.png' }); } } catch { /* Bildschirmfoto nur zur Ansicht */ }
  }
  console.log('JS-Fehler:', JSON.stringify(errs), fails.length ? 'FEHLER ' + fails : 'Alle Prüfungen bestanden.');
  await b.close();
})();

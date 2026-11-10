// Browser-Test (Playwright) – läuft in der Rechenkontrolle über tests/browser/run.sh
const { chromium } = require('playwright'); const fs = require('fs');
const path = require('path');
// Testdaten: feste Dateien in tests/browser/fixtures, abgeleitete aus make-fixtures.mjs (FIXTURES_TMP)
const FX = { 'stocks-2053.json': 'stocks.json', 'fund-cty.json': 'fund.json', 'swing-2053.json': 'swing.json', 'fund-earn.json': 'fund-earn.json' };
const fx = n => (FX[n] ? path.join(__dirname, 'fixtures', FX[n]) : path.join(process.env.FIXTURES_TMP || '/tmp/rojko-fixtures', n));

(async () => {
  const stocks = fs.readFileSync(fx('stocks-2053.json'), 'utf8'), fund = fs.readFileSync(fx('fund-cty.json'), 'utf8'), swing = fs.readFileSync(fx('swing-2053.json'), 'utf8');
  const b = await chromium.launch(), errs = [], fails = [];
  for (const [name, vp] of [['desk', { width: 1280, height: 900 }], ['small', { width: 360, height: 740 }]]) {
    const p = await (await b.newContext({ viewport: vp })).newPage();
    p.on('pageerror', e => errs.push(e.message));
    await p.addInitScript(() => { if (localStorage.getItem('seeded')) return; localStorage.setItem('seeded', '1'); localStorage.setItem('dtd-portfolio', JSON.stringify([{ id: 'a', sym: 'NVDA', buy: 150, qty: 30 }, { id: 'b', sym: 'AMD', buy: 120, qty: 5 }, { id: 'c', sym: 'MU', buy: 300, qty: 2 }, { id: 'd', sym: 'KO', buy: 60, qty: 10 }])); });
    await p.route('**/stocks.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: stocks }));
    await p.route('**/fund-data/fund.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: fund }));
    await p.route('**/swing.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: swing }));
    await p.route(/tradingview|finnhub\.io|news-data/, r => r.abort());
    await p.goto('http://localhost:8811/#portfolio', { waitUntil: 'load' });
    await p.waitForSelector('#portfolioBody [data-section="Aufteilung"] .mix-row', { timeout: 15000 }); await p.waitForTimeout(800);
    const r = await p.evaluate(() => { const c = document.querySelector('#portfolioBody [data-section="Aufteilung"]'); return { kpis: c.querySelector('.stats').innerText.replace(/\s+/g, ' '), warn: [...c.querySelectorAll('.mix-warn li')].map(l => l.textContent), dims: [...c.querySelectorAll('.mix-grid > div')].map(d => d.innerText.replace(/\s+/g, ' ').slice(0, 120)), w: [document.documentElement.scrollWidth, innerWidth] }; });
    console.log(name, JSON.stringify(r, null, 1));
    if (!/Depot-Note/i.test(r.kpis) || !r.warn.length || r.dims.length !== 4 || r.w[0] > r.w[1]) fails.push(name);
    try { if (name === 'small') await (await p.$('#portfolioBody [data-section="Aufteilung"]')).screenshot({ path: 'step3/small-mix.png' }); } catch { /* Bildschirmfoto nur zur Ansicht */ }
  }
  console.log('JS-Fehler:', JSON.stringify(errs), fails.length ? 'FEHLER ' + fails : 'Alle Prüfungen bestanden.');
  await b.close();
})();

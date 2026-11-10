// Browser-Test (Playwright) – läuft in der Rechenkontrolle über tests/browser/run.sh
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
// Testdaten: feste Dateien in tests/browser/fixtures, abgeleitete aus make-fixtures.mjs (FIXTURES_TMP)
const FX = { 'stocks-2053.json': 'stocks.json', 'fund-cty.json': 'fund.json', 'swing-2053.json': 'swing.json', 'fund-earn.json': 'fund-earn.json' };
const fx = n => (FX[n] ? path.join(__dirname, 'fixtures', FX[n]) : path.join(process.env.FIXTURES_TMP || '/tmp/rojko-fixtures', n));

(async () => {
  const [port] = process.argv.slice(2);
  const stocks = fs.readFileSync(fx('stocks-2053.json'), 'utf8'), swing = fs.readFileSync(fx('swing-2053.json'), 'utf8'), fund = fs.readFileSync(fx('fund-cty.json'), 'utf8');
  const b = await chromium.launch(), errs = [];
  const p = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  p.on('pageerror', e => errs.push(e.message));
  await p.route('**/stocks.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: stocks }));
  await p.route('**/swing.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: swing }));
  await p.route('**/fund-data/fund.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: fund }));
  await p.route(/tradingview|finnhub\.io/, r => r.abort());
  await p.goto(`http://localhost:${port}/#tools`, { waitUntil: 'load' });
  await p.waitForSelector('#toolsBody [data-section="Insider"] tbody tr', { timeout: 15000 });
  const rows = await p.$$eval('#toolsBody [data-section="Insider"] tbody tr', r => r.map(x => x.innerText.replace(/\s+/g, ' ').slice(0, 75)));
  console.log('Insider-Liste (erste 4):', JSON.stringify(rows.slice(0, 4)));
  console.log('Insider-Liste (letzte 4):', JSON.stringify(rows.slice(-4)));
  await p.click('#toolsBody [data-preset="insider"]'); await p.waitForTimeout(300);
  const pre = await p.$$eval('#toolsBody [data-section="Screener"] tbody tr td:first-child button', r => r.map(x => x.textContent));
  console.log('Vorlage „Insider kaufen“:', pre.length, 'Werte; TSM/BABA/GRAB enthalten?', ['TSM', 'BABA', 'GRAB'].filter(s => pre.includes(s)).join(',') || 'nein');
  for (const s of ['TSM', 'NVDA', 'SONY']) {
    await p.evaluate(s => window.DTD.openStock(s), s); await p.waitForTimeout(1200);
    const t = await p.$eval('#skFund', e => e.innerText.replace(/\s+/g, ' ')).catch(() => 'fehlt');
    const m = /([0-9.,]+ (Bio|Mrd|Mio)\. \$|siehe eToro)/.exec(t);
    console.log(`${s}: Börsenwert ${m ? m[1].trim() : '?'} · Hinweis Sitz: ${/Sitz außerhalb der USA/.test(t) ? 'ja' : 'nein'}`);
  }
  console.log('JS-Fehler:', JSON.stringify(errs));
  await b.close();
})();

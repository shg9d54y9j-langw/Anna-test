// Browser-Test (Playwright) – läuft in der Rechenkontrolle über tests/browser/run.sh
// Ähnliche Aktien im Aktien-Check: node test-similar.js <port> <ausgabe>
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
// Testdaten: feste Dateien in tests/browser/fixtures, abgeleitete aus make-fixtures.mjs (FIXTURES_TMP)
const FX = { 'stocks-2053.json': 'stocks.json', 'fund-cty.json': 'fund.json', 'swing-2053.json': 'swing.json', 'fund-earn.json': 'fund-earn.json' };
const fx = n => (FX[n] ? path.join(__dirname, 'fixtures', FX[n]) : path.join(process.env.FIXTURES_TMP || '/tmp/rojko-fixtures', n));

(async () => {
  const [port, out] = process.argv.slice(2);
  const stocks = fs.readFileSync(fx('stocks-2053.json'), 'utf8'), swing = fs.readFileSync(fx('swing-2053.json'), 'utf8'), fund = fs.readFileSync(fx('fund-cty.json'), 'utf8');
  const b = await chromium.launch(), errs = [], fails = [];
  const check = (ok, msg) => { console.log(`${ok ? '✓' : '✗'} ${msg}`); if (!ok) fails.push(msg); };
  for (const [name, vp] of [['desk', { width: 1280, height: 900 }], ['phone', { width: 360, height: 740 }]]) {
    const p = await (await b.newContext({ viewport: vp })).newPage();
    p.on('pageerror', e => errs.push(e.message));
    await p.route('**/stock-data/stocks.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: stocks }));
    await p.route('**/stock-data/swing.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: swing }));
    await p.route('**/fund-data/fund.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: fund }));
    await p.route(/tradingview|finnhub\.io|news-data|note-track/, r => r.abort());
    await p.goto(`http://localhost:${port}/#aktie`, { waitUntil: 'load' });
    await p.waitForFunction(() => window.DTD.stockData && window.DTD.stockData());
    for (const sym of ['NVDA', 'KO', 'GOOG']) {
      await p.evaluate(s => window.DTD.openStock(s), sym);
      await p.waitForFunction(() => document.querySelector('#skSimilar .sim-row') || /zu wenige/.test((document.getElementById('skSimilar') || {}).textContent || ''), null, { timeout: 15000 }).catch(() => null);
      const rows = await p.$$eval('#skSimilar .sim-row', r => r.map(x => x.innerText.replace(/\s+/g, ' ').trim()));
      console.log(`  ${name} ${sym}: ${JSON.stringify(rows.slice(0, 5))}`);
      check(rows.length === 5 && !rows.some(r => r.startsWith(sym + ' ')) && rows.every(r => /\d+ % ähnlich/.test(r)), `${name} ${sym}: 5 ähnliche Aktien, nicht sich selbst`);
      if (sym === 'GOOG') check(!rows.some(r => /^GOOGL /.test(r)), `${name}: GOOGL (gleiche Firma) nicht als „ähnlich“`);
      if (sym === 'NVDA') check(rows.filter(r => /^GOOGL? /.test(r)).length <= 1, `${name}: Alphabet nur einmal in den Treffern`);
    }
    // Antippen öffnet die ähnliche Aktie
    await p.waitForTimeout(800);   // sanftes Scrollen nach dem Öffnen abwarten
    const first = await p.$('#skSimilar .sim-row .chip-btn');
    const target = first ? await first.textContent() : '';
    if (first) { await first.evaluate(e => e.scrollIntoView({ block: 'center' })); await first.click(); await p.waitForTimeout(800); }
    check(target && (await p.inputValue('#stockInput')) === target, `${name}: Antippen öffnet ${target}`);
    const ov = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    check(ov[0] <= ov[1], `${name}: kein seitliches Scrollen (${ov[0]} ≤ ${ov[1]})`);
    try { if (name === 'phone') await (await p.$('#skSimilar')).screenshot({ path: `${out}/similar-phone.png` }); } catch { /* Bildschirmfoto nur zur Ansicht */ }
  }
  check(!errs.length, `Keine Skriptfehler${errs.length ? ': ' + errs.join(' | ') : ''}`);
  await b.close();
  console.log(fails.length ? `\n${fails.length} FEHLER` : '\nALLES OK');
  process.exit(fails.length ? 1 : 0);
})();

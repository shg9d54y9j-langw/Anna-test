// Browser-Test (Playwright) – läuft in der Rechenkontrolle über tests/browser/run.sh
// Stresstest in der Depot-Analyse: node test-stress.js <port> <ausgabe>
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
// Testdaten: feste Dateien in tests/browser/fixtures, abgeleitete aus make-fixtures.mjs (FIXTURES_TMP)
const FX = { 'stocks-2053.json': 'stocks.json', 'fund-cty.json': 'fund.json', 'swing-2053.json': 'swing.json', 'fund-earn.json': 'fund-earn.json' };
const fx = n => (FX[n] ? path.join(__dirname, 'fixtures', FX[n]) : path.join(process.env.FIXTURES_TMP || '/tmp/rojko-fixtures', n));

(async () => {
  const [port, out] = process.argv.slice(2);
  const stocksTxt = fs.readFileSync(fx('stocks-2053.json'), 'utf8'), fund = fs.readFileSync(fx('fund-cty.json'), 'utf8');
  const st = JSON.parse(stocksTxt), item = s => st.items.find(x => x.sym === s);
  const b = await chromium.launch(), errs = [], fails = [];
  const check = (ok, msg) => { console.log(`${ok ? '✓' : '✗'} ${msg}`); if (!ok) fails.push(msg); };
  const hold = [{ id: 'a', sym: 'NVDA', buy: 150, qty: 30 }, { id: 'b', sym: 'AMD', buy: 120, qty: 5 }, { id: 'c', sym: 'KO', buy: 60, qty: 10 }];
  // Gegenrechnung: Anteile nach Wert, Beta begrenzt auf 0–3
  const val = hold.map(h => h.qty * item(h.sym).last), tot = val.reduce((a, b) => a + b, 0);
  const depBeta = hold.reduce((s, h, i) => s + val[i] / tot * Math.max(0, Math.min(3, item(h.sym).beta)), 0);
  const want20 = (depBeta * -20).toFixed(1).replace('.', ',');
  for (const [name, vp] of [['desk', { width: 1280, height: 900 }], ['phone', { width: 360, height: 740 }]]) {
    const p = await (await b.newContext({ viewport: vp })).newPage();
    p.on('pageerror', e => errs.push(e.message));
    await p.addInitScript(h => { if (!localStorage.getItem('seeded')) { localStorage.setItem('seeded', '1'); localStorage.setItem('dtd-portfolio', JSON.stringify(h)); } }, hold);
    await p.route('**/stock-data/stocks.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: stocksTxt }));
    await p.route('**/fund-data/fund.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: fund }));
    await p.route(/tradingview|finnhub\.io|news-data|note-track|swing\.json/, r => r.abort());
    await p.goto(`http://localhost:${port}/#pfMix`, { waitUntil: 'load' });
    await p.waitForSelector('#pfMix table.stress tbody tr', { timeout: 15000 }).catch(() => null);
    const rows = await p.$$eval('#pfMix table.stress tbody tr', r => r.map(x => x.innerText.replace(/\s+/g, ' ').trim()));
    const txt = await p.$eval('#pfMix', e => e.innerText.replace(/\s+/g, ' ')).catch(() => '');
    console.log(`  ${name}: ${JSON.stringify(rows)}`);
    check(rows.length === 3 && rows[1].includes(`-${want20.replace('-', '')} %`) || rows[1] && rows[1].includes(`${want20} %`), `${name}: Depot bei −20 % ≈ ${want20} % (Beta ${depBeta.toFixed(2)})`);
    check(rows.every(r => /USD/.test(r)), `${name}: Betrag in USD (eine Währung, Stückzahlen vorhanden)`);
    check(/Am stärksten trifft es bei −20 %: NVDA/.test(txt), `${name}: NVDA als stärkster Treffer`);
    const ov = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    check(ov[0] <= ov[1], `${name}: kein seitliches Scrollen`);
    try { if (name === 'phone') { const el = await p.$('#pfMix table.stress'); if (el) await (await el.evaluateHandle(e => e.closest('.table-wrap').parentElement)).asElement().screenshot({ path: `${out}/stress-phone.png` }); } } catch { /* Bildschirmfoto nur zur Ansicht */ }
  }
  check(!errs.length, `Keine Skriptfehler${errs.length ? ': ' + errs.join(' | ') : ''}`);
  await b.close();
  console.log(fails.length ? `\n${fails.length} FEHLER` : '\nALLES OK');
  process.exit(fails.length ? 1 : 0);
})();

// Browser-Test (Playwright) – läuft in der Rechenkontrolle über tests/browser/run.sh
// Notenverlauf, Vorlage „Aufsteiger“, Alarm bei Notenwechsel. node test-notehist.js <port> <ausgabe>
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
// Testdaten: feste Dateien in tests/browser/fixtures, abgeleitete aus make-fixtures.mjs (FIXTURES_TMP)
const FX = { 'stocks-2053.json': 'stocks.json', 'fund-cty.json': 'fund.json', 'swing-2053.json': 'swing.json', 'fund-earn.json': 'fund-earn.json' };
const fx = n => (FX[n] ? path.join(__dirname, 'fixtures', FX[n]) : path.join(process.env.FIXTURES_TMP || '/tmp/rojko-fixtures', n));

(async () => {
  const [port, out] = process.argv.slice(2);
  const stocks = fs.readFileSync(fx('stocks-2053.json'), 'utf8'), fund = fs.readFileSync(fx('fund-cty.json'), 'utf8'), notes = JSON.parse(fs.readFileSync(fx('nt-notes.json'), 'utf8'));
  const n = {};
  for (const [s, v] of Object.entries(notes)) n[s] = [v, v, v, v, null];
  n.NVDA = [notes.NVDA, notes.NVDA - 2, notes.NVDA - 7, notes.NVDA - 27, null];
  n.KO = [notes.KO, 78, 80, notes.KO - 4, null];
  n.AMD = [38, 45, 50, 55, null];
  const recentBody = JSON.stringify({ updated: '2026-12-15T13:40:00Z', keys: ['now', 'd1', 'w1', 'm1', 'm3'], dates: { now: '2026-12-15', d1: '2026-12-14', w1: '2026-12-08', m1: '2026-11-14', m3: null }, n });
  const b = await chromium.launch(), errs = [], fails = [];
  const check = (ok, msg) => { console.log(`${ok ? '✓' : '✗'} ${msg}`); if (!ok) fails.push(msg); };
  async function page(recent, vp = { width: 1280, height: 900 }) {
    const p = await (await b.newContext({ viewport: vp })).newPage();
    p.on('pageerror', e => errs.push(e.message));
    await p.addInitScript(() => { if (!localStorage.getItem('seeded')) { localStorage.setItem('seeded', '1'); localStorage.setItem('dtd-portfolio', JSON.stringify([{ id: 'a', sym: 'AMD', buy: 120, qty: 5 }])); localStorage.setItem('dtd-watch', JSON.stringify(['KO'])); localStorage.setItem('dtd-wn-seen', JSON.stringify('x')); } });
    await p.route('**/stock-data/stocks.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: stocks }));
    await p.route('**/fund-data/fund.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: fund }));
    await p.route('**/stock-data/note-recent.json*', r => (recent ? r.fulfill({ status: 200, contentType: 'application/json', body: recent }) : r.fulfill({ status: 404, body: '' })));
    await p.route(/tradingview|finnhub\.io|news-data|note-track|swing\.json/, r => r.abort());
    return p;
  }
  const p = await page(recentBody);
  await p.goto(`http://localhost:${port}/#aktie`, { waitUntil: 'load' });
  await p.waitForFunction(() => window.DTD.stockData && window.DTD.stockData());
  await p.evaluate(() => window.DTD.openStock('NVDA'));
  await p.waitForSelector('#skNote .nt-hist', { timeout: 15000 }).catch(() => null);
  const hist = await p.$eval('#skNote .nt-hist', e => e.innerText.replace(/\s+/g, ' ')).catch(() => '');
  console.log('  ', hist);
  check(new RegExp(`vor 1 Monat ${notes.NVDA - 27} · vor 1 Woche ${notes.NVDA - 7} · heute ${notes.NVDA} ▲ \\+27`).test(hist), 'NVDA: Verlauf mit +27 zum Vormonat');
  await p.goto(`http://localhost:${port}/#screener`); await p.waitForSelector('#toolsBody [data-preset="risers"]', { timeout: 15000 });
  await p.click('#toolsBody [data-preset="risers"]'); await p.waitForTimeout(400);
  const syms = await p.$$eval('#toolsBody [data-section="Screener"] tbody tr td:first-child .chip-btn', l => l.map(x => x.textContent));
  check(syms.includes('NVDA') && !syms.includes('KO') && !syms.includes('AMD'), `Vorlage „Aufsteiger“: ${syms.join(',')}`);
  const head = await p.$$eval('#toolsBody [data-section="Screener"] thead th', l => l.map(x => x.textContent.trim()));
  check(head.some(h => /Δ Note/.test(h)), 'Spalte „Δ Note“');
  await p.goto(`http://localhost:${port}/#hinweise`); await p.waitForSelector('#hinweise', { timeout: 15000 }); await p.waitForTimeout(800);
  const al = await p.$eval('#hinweise', e => e.innerText.replace(/\s+/g, ' ')).catch(() => '');
  check(/AMD[^]*Gesamtnote fiel unter 40 \(vorher 45, jetzt 38\)/.test(al), 'Alarm: AMD fiel unter 40');
  check(/KO[^]*Gesamtnote stieg über 80 \(vorher 78/.test(al), 'Alarm: KO stieg über 80');
  // Ohne Verlaufsdatei: kein Fehler, kein Verlauf
  const q = await page(null);
  await q.goto(`http://localhost:${port}/#aktie`, { waitUntil: 'load' }); await q.waitForFunction(() => window.DTD.stockData && window.DTD.stockData());
  await q.evaluate(() => window.DTD.openStock('NVDA')); await q.waitForSelector('#skNote .note-num', { timeout: 15000 }).catch(() => null);
  check(!(await q.$('#skNote .nt-hist')), 'Ohne Verlaufsdatei: kein Verlauf, kein Fehler');
  check(!errs.length, `Keine Skriptfehler${errs.length ? ': ' + errs.join(' | ') : ''}`);
  await b.close();
  console.log(fails.length ? `\n${fails.length} FEHLER` : '\nALLES OK');
  process.exit(fails.length ? 1 : 0);
})();

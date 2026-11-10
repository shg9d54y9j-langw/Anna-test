// Browser-Test (Playwright) – läuft in der Rechenkontrolle über tests/browser/run.sh
// „Warum bewegt sie sich?“ und Schnellsuche – node check-why-qs.js <port> <ausgabe>
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
// Testdaten: feste Dateien in tests/browser/fixtures, abgeleitete aus make-fixtures.mjs (FIXTURES_TMP)
const FX = { 'stocks-2053.json': 'stocks.json', 'fund-cty.json': 'fund.json', 'swing-2053.json': 'swing.json', 'fund-earn.json': 'fund-earn.json' };
const fx = n => (FX[n] ? path.join(__dirname, 'fixtures', FX[n]) : path.join(process.env.FIXTURES_TMP || '/tmp/rojko-fixtures', n));

(async () => {
  const [port, out] = process.argv.slice(2);
  const stocks = fs.readFileSync(fx('stocks-2053.json'), 'utf8'), swing = fs.readFileSync(fx('swing-2053.json'), 'utf8'), fund = fs.readFileSync(fx('fund-cty.json'), 'utf8');
  const t0 = Math.floor(Date.now() / 1000);
  const mk = (sym, i, t, type, tone, ageH = 2) => ({ id: `${sym}${i}`, t, s: 'Reuters', u: `https://news.example.com/${sym}/${i}`, d: t0 - ageH * 3600, sum: 'S.', type, tone, rel: [sym] });
  const co = { AMD: [mk('AMD', 0, 'AMD raises full-year outlook after strong quarter', 'guidance_up', 'pos')], MU: [mk('MU', 0, 'Micron shares are trading higher today', 'general', 'neu'), mk('MU', 1, 'Micron beats estimates on memory demand', 'earnings_beat', 'pos', 5)], NVDA: [mk('NVDA', 0, 'Old Nvidia story', 'product', 'neu', 24 * 5)] };
  const news = { updated: new Date().toISOString(), count: 3, syms: Object.keys(co), market: [], hot: [] };
  const tvStub = `window.TradingView = { widget: function (c) {} };`;
  const b = await chromium.launch(), errs = [], fails = [];
  const check = (ok, msg) => { if (!ok) fails.push(msg); };
  for (const [name, vp] of [['desk', { width: 1280, height: 900 }], ['phone', { width: 390, height: 844 }], ['small', { width: 360, height: 740 }]]) {
    const ctx = await b.newContext({ viewport: vp, timezoneId: 'Europe/Vienna', locale: 'de-AT' });
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(`${name}: ${e.message}`));
    p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errs.push(`${name} console: ${m.text()}`); });
    await p.addInitScript(() => { if (localStorage.getItem('seeded')) return; localStorage.setItem('seeded', '1'); localStorage.setItem('dtd-watch', JSON.stringify(['MU', 'NVDA'])); });
    await p.route('**/stocks.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: stocks }));
    await p.route('**/swing.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: swing }));
    await p.route('**/fund-data/fund.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: fund }));
    await p.route('**/news-data/news.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(news) }));
    await p.route('**/news-data/co/*', r => { const sym = decodeURIComponent(r.request().url().split('/co/')[1].split('.json')[0]); return co[sym] ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sym, items: co[sym] }) }) : r.fulfill({ status: 404, body: '' }); });
    await p.route('https://s3.tradingview.com/tv.js', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: tvStub }));
    await p.route(/tradingview\.com\/external-embedding|finnhub\.io/, r => r.abort());
    const view = () => p.evaluate(() => [...document.querySelectorAll('.view')].filter(v => !v.hidden).map(v => v.id).join(','));
    // Aktien-Check AMD (+14,6 %): Warum?
    await p.goto(`http://localhost:${port}/#aktie`, { waitUntil: 'load' });
    await p.waitForFunction(() => window.DTD.stockData && window.DTD.stockData());
    await p.waitForFunction(() => window.DTD.market !== undefined, null, { timeout: 6000 }).catch(() => {});
    await p.evaluate(() => window.DTD.openStock('AMD'));
    await p.waitForSelector('#stockBody .why .why-btn', { timeout: 15000 });
    const why = await p.$eval('#stockBody .why .why-btn', e => e.innerText.replace(/\s+/g, ' '));
    console.log(`${name} Aktien-Check AMD: ${why}`);
    await p.click('#stockBody .why .why-btn'); await p.waitForTimeout(300);
    check(/Prognose angehoben/.test(await p.$eval('#drawerTitle', e => e.textContent)), `${name}: Warum öffnet keine Erklärung`);
    await p.click('#drawerClose');
    try { if (name !== 'small') await (await p.$('#stockBody .stock-head')).screenshot({ path: `${out}/${name}-why.png` }); } catch { /* Bildschirmfoto nur zur Ansicht */ }
    // Merkliste: MU mit eingeordneter Meldung (nicht „general“), NVDA ohne (zu alt / kleine Bewegung)
    await p.goto(`http://localhost:${port}/#merkliste`, { waitUntil: 'load' });
    await p.waitForSelector('#watchBody .w-row', { timeout: 15000 }); await p.waitForTimeout(800);
    const wl = await p.$$eval('#watchBody .w-row', r => r.map(x => ({ sym: x.querySelector('.chip-btn').textContent, why: (x.querySelector('.why-btn') || {}).innerText || '' })));
    console.log(`${name} Merkliste: ${JSON.stringify(wl)}`);
    check(/beats estimates/.test(wl.find(w => w.sym === 'MU').why) && !wl.find(w => w.sym === 'NVDA').why, `${name}: Merkliste-Warum ${JSON.stringify(wl)}`);
    // Schnellsuche
    await p.goto(`http://localhost:${port}/#home`, { waitUntil: 'load' }); await p.waitForTimeout(400);
    if (name === 'desk') { await p.keyboard.press('Control+k'); } else { await p.click('.qs-open'); }
    await p.waitForTimeout(200);
    const focused = await p.evaluate(() => document.activeElement && document.activeElement.id);
    await p.keyboard.type('micro'); await p.waitForTimeout(300);
    const sug = await p.$$eval('#qsInput-vorschlaege .sugg-sym', o => o.map(x => x.textContent));
    try { if (name !== 'small') await p.screenshot({ path: `${out}/${name}-quicksearch.png` }); } catch { /* Bildschirmfoto nur zur Ansicht */ }
    await p.keyboard.press('ArrowDown'); await p.keyboard.press('Enter'); await p.waitForTimeout(700);
    const res = { v: await view(), inp: await p.inputValue('#stockInput').catch(() => ''), qs: await p.inputValue('#qsInput'), open: await p.evaluate(() => document.querySelector('.qs').classList.contains('open')), header: await p.evaluate(() => document.querySelector('.appbar').offsetHeight) };
    console.log(`${name} Schnellsuche: Fokus ${focused} · Vorschläge ${sug.join(',')} → ${JSON.stringify(res)}`);
    check(focused === 'qsInput' && sug.length && res.v === 'aktie' && res.inp === sug[0] && res.qs === '' && !res.open, `${name}: Schnellsuche ${JSON.stringify(res)} ${sug}`);
    if (name !== 'desk') check(res.header <= 110, `${name}: Kopfzeile ${res.header}px`);
    const w = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    check(w[0] <= w[1], `${name}: zu breit ${w}`);
    await ctx.close();
  }
  console.log('JS-Fehler:', JSON.stringify(errs));
  console.log(fails.length ? `FEHLER (${fails.length}):\n - ${fails.join('\n - ')}` : 'Alle Prüfungen bestanden.');
  await b.close();
})();

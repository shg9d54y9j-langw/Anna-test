// Browser-Test (Playwright) – läuft in der Rechenkontrolle über tests/browser/run.sh
// Schritt 1: Merkliste, Gesamtnote, Erklärung per Antippen – node check-step1.js <port> <ausgabe>
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
// Testdaten: feste Dateien in tests/browser/fixtures, abgeleitete aus make-fixtures.mjs (FIXTURES_TMP)
const FX = { 'stocks-2053.json': 'stocks.json', 'fund-cty.json': 'fund.json', 'swing-2053.json': 'swing.json', 'fund-earn.json': 'fund-earn.json' };
const fx = n => (FX[n] ? path.join(__dirname, 'fixtures', FX[n]) : path.join(process.env.FIXTURES_TMP || '/tmp/rojko-fixtures', n));

(async () => {
  const [port, out] = process.argv.slice(2);
  const stocks = fs.readFileSync(fx('stocks-2053.json'), 'utf8'), swing = fs.readFileSync(fx('swing-2053.json'), 'utf8'), fund = fs.readFileSync(fx('fund-cty.json'), 'utf8');
  const tvStub = `window.TradingView = { widget: function (c) { var el = document.getElementById(c.container_id); if (el) el.innerHTML = '<div style="height:100%;display:grid;place-items:center;color:#666;font:12px monospace">TradingView ' + c.symbol + '</div>'; } };`;
  const b = await chromium.launch(), errs = [], fails = [];
  const check = (ok, msg) => { if (!ok) fails.push(msg); };
  for (const [name, vp] of [['desk', { width: 1280, height: 900 }], ['phone', { width: 390, height: 844 }], ['small', { width: 360, height: 740 }]]) {
    const ctx = await b.newContext({ viewport: vp, timezoneId: 'Europe/Vienna', locale: 'de-AT' });
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(`${name}: ${e.message}`));
    p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errs.push(`${name} console: ${m.text()}`); });
    await p.route('**/stocks.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: stocks }));
    await p.route('**/swing.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: swing }));
    await p.route('**/fund-data/fund.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: fund }));
    await p.route('https://s3.tradingview.com/tv.js', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: tvStub }));
    await p.route(/tradingview\.com\/external-embedding|finnhub\.io/, r => r.abort());
    const width = async label => { const w = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]); check(w[0] <= w[1], `${name}: ${label} zu breit ${w}`); };

    // Aktien-Check: Note, Stern, Begriffe
    await p.goto(`http://localhost:${port}/#aktie`, { waitUntil: 'load' });
    await p.waitForFunction(() => window.DTD.stockData && window.DTD.stockData());
    await p.waitForFunction(() => window.DTD.market !== undefined, null, { timeout: 6000 }).catch(() => {});   // Marktlage geladen (zeichnet sonst neu)
    await p.evaluate(() => window.DTD.openStock('NVDA'));
    await p.waitForSelector('#skNote .note-num', { timeout: 15000 });
    const note = await p.evaluate(() => ({ num: document.querySelector('#skNote .note-num').textContent, lbl: document.querySelector('#skNote .note-lbl').textContent, bars: [...document.querySelectorAll('#skNote .nbar')].map(b => b.innerText.replace(/\s+/g, ' ')), pro: [...document.querySelectorAll('#skNote .note-why > div:first-child li')].map(l => l.textContent), con: [...document.querySelectorAll('#skNote .note-why > div:last-child li')].map(l => l.textContent), terms: document.querySelectorAll('#stockBody .term').length }));
    console.log(`${name} NVDA Note ${note.num} (${note.lbl}) · ${note.bars.join(' | ')} · Begriffe ${note.terms}`);
    if (name === 'desk') { console.log('  Dafür:', JSON.stringify(note.pro)); console.log('  Dagegen:', JSON.stringify(note.con)); }
    check(/^\d+$/.test(note.num) && note.bars.length === 6 && note.terms >= 15, `${name}: Note ${JSON.stringify(note).slice(0, 200)}`);
    await (await p.$('#stockBody [data-section="Kennzahlen"] .term[data-term="kgv"]')).click(); await p.waitForTimeout(300);
    const dr = await p.evaluate(() => ({ open: !document.getElementById('drawer').hidden, title: document.getElementById('drawerTitle').textContent, ctx: (document.querySelector('#drawerBody .term-ctx') || {}).textContent || '' }));
    console.log(`${name} Antippen KGV: „${dr.title}“ · ${dr.ctx}`);
    check(dr.open && /KGV/.test(dr.title) && /NVDA/.test(dr.ctx), `${name}: Erklärung KGV ${JSON.stringify(dr)}`);
    try { if (name !== 'small') await p.screenshot({ path: `${out}/${name}-term.png` }); } catch { /* Bildschirmfoto nur zur Ansicht */ }
    await p.click('#drawerClose');
    try { if (name !== 'small') { const n = await p.$('#stockBody [data-section="Note"]'); await n.scrollIntoViewIfNeeded(); await n.screenshot({ path: `${out}/${name}-note.png` }); } } catch { /* Bildschirmfoto nur zur Ansicht */ }
    await p.click('#stockBody .star.big'); await p.waitForTimeout(150);
    check(await p.$eval('#stockBody .star.big', e => e.getAttribute('aria-pressed')) === 'true', `${name}: Stern im Aktien-Check nicht gesetzt`);
    await width('Aktien-Check');

    // Screener: Note-Spalte, Vorlage, Stern
    await p.goto(`http://localhost:${port}/#tools`, { waitUntil: 'load' });
    await p.waitForSelector('#toolsBody table.scr tbody tr', { timeout: 15000 });
    await p.click('#toolsBody [data-preset="best"]'); await p.waitForTimeout(300);
    const scr = await p.evaluate(() => ({ count: document.querySelector('#toolsBody [data-section="Screener"] .card-head .muted').textContent, head: [...document.querySelectorAll('#toolsBody [data-section="Screener"] thead th')].filter(t => getComputedStyle(t).display !== 'none').map(t => t.innerText.trim()).join('|'), top: [...document.querySelectorAll('#toolsBody [data-section="Screener"] tbody tr')].slice(0, 4).map(r => r.innerText.replace(/\s+/g, ' ').slice(0, 50)) }));
    console.log(`${name} Beste Gesamtnote: ${scr.count} · ${scr.head} · ${JSON.stringify(scr.top)}`);
    check(/note/i.test(scr.head) && !/^0 /.test(scr.count), `${name}: Screener ${JSON.stringify(scr)}`);
    await p.click('#toolsBody [data-section="Screener"] tbody tr:nth-child(1) .star'); await p.waitForTimeout(150);
    const starredSym = await p.$eval('#toolsBody [data-section="Screener"] tbody tr:nth-child(1) .star', e => e.dataset.watch);
    await width('Werkzeuge');
    // Lexikon
    const lex = await p.$$eval('#lexikon [data-term]', b => b.length);
    await (await p.$('#lexikon [data-term="beta"]')).click(); await p.waitForTimeout(200);
    check(lex >= 25 && /Beta/.test(await p.$eval('#drawerTitle', e => e.textContent)), `${name}: Lexikon ${lex}`);
    await p.click('#drawerClose');
    try { if (name !== 'small') await (await p.$('#lexikon')).screenshot({ path: `${out}/${name}-lexikon.png` }); } catch { /* Bildschirmfoto nur zur Ansicht */ }

    // Merkliste im Portfolio
    await p.goto(`http://localhost:${port}/#merkliste`, { waitUntil: 'load' });
    await p.waitForSelector('#watchBody .w-row', { timeout: 15000 });
    const wl = await p.$$eval('#watchBody .w-row', r => r.map(x => x.innerText.replace(/\s+/g, ' ').slice(0, 80)));
    console.log(`${name} Merkliste: ${JSON.stringify(wl)}`);
    check(wl.length === 2 && wl.some(t => t.startsWith('NVDA')) && wl.some(t => t.startsWith(starredSym)), `${name}: Merkliste ${JSON.stringify(wl)}`);
    try { if (name !== 'small') await (await p.$('#watchBody')).screenshot({ path: `${out}/${name}-watch.png` }); } catch { /* Bildschirmfoto nur zur Ansicht */ }
    await p.click('#watchBody .w-row:first-child .star'); await p.waitForTimeout(200);
    check((await p.$$('#watchBody .w-row')).length === 1, `${name}: Entfernen aus der Merkliste`);
    await width('Portfolio');

    // Sterne in HotStuff und Swing-Planer
    await p.goto(`http://localhost:${port}/#hot`, { waitUntil: 'load' }); await p.waitForSelector('#hotBody .idea .star', { timeout: 15000 }).catch(() => null);
    const hs = (await p.$$('#hotBody .idea .star')).length;
    await p.goto(`http://localhost:${port}/#swing`, { waitUntil: 'load' }); await p.waitForSelector('#swingBody .idea .star', { timeout: 15000 }).catch(() => null);
    const ss = (await p.$$('#swingBody .idea .star')).length;
    check(hs > 0 && ss > 0, `${name}: Sterne HotStuff ${hs}, Swing ${ss}`);
    await ctx.close();
  }
  console.log('JS-Fehler:', JSON.stringify(errs));
  console.log(fails.length ? `FEHLER (${fails.length}):\n - ${fails.join('\n - ')}` : 'Alle Prüfungen bestanden.');
  await b.close();
})();

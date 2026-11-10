// Browser-Test (Playwright) – läuft in der Rechenkontrolle über tests/browser/run.sh
// Klickbare Nachrichten: Markt, Aktien-Check, Portfolio, Erklärung – node check-news.js <port> <ausgabe>
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
  const mk = (sym, i, t, type, tone) => ({ id: `${sym}${i}`, t, s: ['Reuters', 'Bloomberg', 'CNBC'][i % 3], u: `https://news.example.com/${sym}/${i}`, d: t0 - i * 5400, sum: `Short summary ${i} about ${sym}.`, type, tone, rel: [sym] });
  const co = {
    NVDA: [mk('NVDA', 0, 'Nvidia beats estimates on data center demand', 'earnings_beat', 'pos'), mk('NVDA', 1, 'Analyst raises price target on Nvidia to $250', 'price_target', 'pos'), mk('NVDA', 2, 'New tariffs on chip imports weigh on Nvidia', 'tariffs', 'neu')],
    TSLA: [mk('TSLA', 0, 'Tesla downgraded to neutral at major bank', 'downgrade', 'neg')],
    AMD: [mk('AMD', 0, 'AMD raises full-year outlook after strong quarter', 'guidance_up', 'pos')],
  };
  const news = { updated: new Date().toISOString(), source: 'Test', days: 7, count: 3, syms: Object.keys(co), errors: [],
    market: [{ id: 'm1', t: 'Fed holds rates steady, signals two cuts this year', s: 'CNBC', u: 'https://news.example.com/m1', d: t0 - 3600, sum: 'Fed.', type: 'macro_rates', tone: 'neu', rel: [] }, { id: 'm2', t: 'Hotter-than-expected CPI print', s: 'CNBC', u: 'https://news.example.com/m2', d: t0 - 7200, sum: '', type: 'macro_inflation', tone: 'neu', rel: [] }],
    hot: [co.AMD[0], co.TSLA[0]] };
  const tvStub = `window.TradingView = { widget: function (c) { var el = document.getElementById(c.container_id); if (el) el.innerHTML = '<div style="height:100%;display:grid;place-items:center;color:#666">TradingView</div>'; } };`;
  const b = await chromium.launch(), errs = [], fails = [];
  const check = (ok, msg) => { if (!ok) fails.push(msg); };
  for (const [name, vp] of [['desk', { width: 1280, height: 900 }], ['phone', { width: 390, height: 844 }], ['small', { width: 360, height: 740 }]]) {
    const ctx = await b.newContext({ viewport: vp, timezoneId: 'Europe/Vienna', locale: 'de-AT' });
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(`${name}: ${e.message}`));
    p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errs.push(`${name} console: ${m.text()}`); });
    await p.addInitScript(() => {
      if (localStorage.getItem('seeded')) return;
      localStorage.setItem('seeded', '1');
      localStorage.setItem('dtd-portfolio', JSON.stringify([{ id: 'p1', sym: 'NVDA', buy: 150, qty: 10 }]));
      localStorage.setItem('dtd-watch', JSON.stringify(['TSLA', 'AMD']));
    });
    await p.route('**/stocks.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: stocks }));
    await p.route('**/swing.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: swing }));
    await p.route('**/fund-data/fund.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: fund }));
    await p.route('**/news-data/news.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(news) }));
    await p.route('**/news-data/co/*', r => { const sym = decodeURIComponent(r.request().url().split('/co/')[1].split('.json')[0]); return co[sym] ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sym, items: co[sym] }) }) : r.fulfill({ status: 404, body: '' }); });
    await p.route('https://s3.tradingview.com/tv.js', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: tvStub }));
    await p.route(/tradingview\.com\/external-embedding|finnhub\.io/, r => r.abort());
    const view = () => p.evaluate(() => [...document.querySelectorAll('.view')].filter(v => !v.hidden).map(v => v.id).join(','));

    // Markt: Meine Aktien
    await p.goto(`http://localhost:${port}/#news`, { waitUntil: 'load' });
    await p.waitForSelector('#newsBody .nw-item', { timeout: 15000 });
    const mineL = await p.$$eval('#newsBody .nw-item', l => l.map(x => x.innerText.replace(/\s+/g, ' ').slice(0, 70)));
    console.log(`${name} Meine Aktien: ${JSON.stringify(mineL)}`);
    check(mineL.length === 5 && /NVDA/.test(mineL.join()) && /TSLA/.test(mineL.join()), `${name}: Meine Aktien ${mineL.length}`);
    // Erklärung öffnen
    await p.click('#newsBody .nw-item:first-child'); await p.waitForTimeout(400);
    const dr = await p.evaluate(() => ({ open: !document.getElementById('drawer').hidden, title: document.getElementById('drawerTitle').textContent, heads: [...document.querySelectorAll('#drawerBody h3.swing-h3')].map(h => h.textContent), stock: (document.querySelector('#drawerBody .nw-stock') || {}).innerText }));
    console.log(`${name} Erklärung: „${dr.title}“ · ${dr.heads.join(' | ')}`);
    if (name === 'desk') console.log(`  Aktie: ${(dr.stock || '').replace(/\s+/g, ' ').slice(0, 160)}`);
    check(dr.open && dr.heads.includes('Was bedeutet das?') && dr.heads.some(h => /Betroffene/.test(h)) && /Analysten/.test(dr.stock || ''), `${name}: Erklärung ${JSON.stringify(dr).slice(0, 200)}`);
    try { if (name !== 'small') await p.screenshot({ path: `${out}/${name}-news-drawer.png` }); } catch { /* Bildschirmfoto nur zur Ansicht */ }
    await p.click('#drawerBody .nw-stock .chip-btn'); await p.waitForTimeout(600);
    check(await p.evaluate(() => document.getElementById('drawer').hidden) && (await view()) === 'aktie', `${name}: Kürzel in der Erklärung öffnet nicht den Aktien-Check`);
    // Markt-Reiter
    await p.goto(`http://localhost:${port}/#news`, { waitUntil: 'load' }); await p.waitForSelector('#newsBody [data-news-tab="market"]', { timeout: 15000 });
    await p.click('#newsBody [data-news-tab="market"]'); await p.waitForTimeout(300);
    const mk2 = await p.$$eval('#newsBody .nw-item', l => l.map(x => x.innerText.replace(/\s+/g, ' ').slice(0, 60)));
    await p.click('#newsBody .nw-item'); await p.waitForTimeout(300);
    const t2 = await p.$eval('#drawerTitle', e => e.textContent);
    console.log(`${name} Markt: ${JSON.stringify(mk2)} → „${t2}“`);
    check(mk2.length === 2 && t2 === 'Zinsen und Notenbank', `${name}: Markt-Reiter ${mk2.length} / ${t2}`);
    await p.click('#drawerClose');
    try { if (name !== 'small') await (await p.$('#newsExplained')).screenshot({ path: `${out}/${name}-news-list.png` }); } catch { /* Bildschirmfoto nur zur Ansicht */ }
    await p.click('#newsBody [data-news-tab="mine"]');
    // Aktien-Check
    await p.goto(`http://localhost:${port}/#aktie`, { waitUntil: 'load' });
    await p.waitForFunction(() => window.DTD.stockData && window.DTD.stockData());
    await p.waitForFunction(() => window.DTD.market !== undefined, null, { timeout: 6000 }).catch(() => {});
    await p.evaluate(() => window.DTD.openStock('NVDA'));
    await p.waitForSelector('#skNewsList .nw-item', { timeout: 15000 });
    const sk = await p.$$eval('#skNewsList .nw-item', l => l.length);
    check(sk === 3, `${name}: Aktien-Check-Nachrichten ${sk}`);
    // Portfolio: Nachrichten-Knopf
    await p.goto(`http://localhost:${port}/#portfolio`, { waitUntil: 'load' }); await p.waitForSelector('#portfolioBody [data-act="news"]', { timeout: 15000 });
    await p.click('#portfolioBody [data-act="news"]'); await p.waitForSelector('#portfolioBody .pf-news-list .nw-item', { timeout: 15000 });
    const pf = await p.$$eval('#portfolioBody .pf-news-list .nw-item', l => l.length);
    check(pf === 3, `${name}: Portfolio-Nachrichten ${pf}`);
    const w = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    check(w[0] <= w[1], `${name}: zu breit ${w}`);
    console.log(`${name} Aktien-Check ${sk} · Portfolio ${pf}`);
    await ctx.close();
  }
  console.log('JS-Fehler:', JSON.stringify(errs));
  console.log(fails.length ? `FEHLER (${fails.length}):\n - ${fails.join('\n - ')}` : 'Alle Prüfungen bestanden.');
  await b.close();
})();

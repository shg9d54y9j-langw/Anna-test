// Browser-Test (Playwright) – läuft in der Rechenkontrolle über tests/browser/run.sh
// Schritt 2: Konkurrenz-Vergleich, Vergleich 2–4 Aktien, Branchen-Rotation – node check-step2.js <port> <ausgabe>
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
    const view = () => p.evaluate(() => [...document.querySelectorAll('.view')].filter(v => !v.hidden).map(v => v.id).join(','));
    const width = async label => { const w = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]); check(w[0] <= w[1], `${name}: ${label} zu breit ${w}`); };

    // Konkurrenz-Vergleich
    await p.goto(`http://localhost:${port}/#aktie`, { waitUntil: 'load' });
    await p.waitForFunction(() => window.DTD.stockData && window.DTD.stockData());
    await p.waitForFunction(() => window.DTD.market !== undefined, null, { timeout: 6000 }).catch(() => {});   // Marktlage geladen (zeichnet sonst neu)
    await p.evaluate(() => window.DTD.openStock('NVDA'));
    await p.waitForSelector('#skPeers table.peers tbody tr', { timeout: 15000 });
    await p.waitForTimeout(2000);   // Marktlage zeichnet den Aktien-Check einmal neu
    await p.waitForSelector('#skPeers table.peers tbody tr', { timeout: 15000 });
    const peers = await p.evaluate(() => ({ intro: document.querySelector('#skPeers > p').textContent, says: [...document.querySelectorAll('#skPeers .peer-says li')].map(l => l.textContent), rows: [...document.querySelectorAll('#skPeers tbody tr')].map(r => r.querySelector('.chip-btn').textContent), me: document.querySelector('#skPeers tr.me .chip-btn').textContent }));
    console.log(`${name} Konkurrenz: ${peers.rows.join(', ')}`);
    if (name === 'desk') { console.log(`  ${peers.intro}`); console.log(`  ${JSON.stringify(peers.says)}`); }
    check(peers.rows.length >= 4 && peers.me === 'NVDA', `${name}: Konkurrenz ${JSON.stringify(peers.rows)}`);
    try { if (name !== 'small') { await p.evaluate(() => document.querySelector('#stockBody [data-section="Konkurrenz"]').scrollIntoView()); await p.waitForTimeout(200); await (await p.$('#stockBody [data-section="Konkurrenz"]')).screenshot({ path: `${out}/${name}-peers.png` }); } } catch { /* Bildschirmfoto nur zur Ansicht */ }
    await width('Aktien-Check');

    // Vergleich: NVDA aus dem Kopf, AMD aus der Konkurrenz-Tabelle (oder direkt)
    await p.click('#stockBody .stock-head .cmp-btn'); await p.waitForTimeout(150);
    const pill1 = await p.$eval('.cmp-pill', e => !e.hidden && e.textContent);
    const peerBtn = await p.$('#skPeers tbody tr:nth-child(2) .cmp-btn');
    if (peerBtn && await peerBtn.isVisible()) await peerBtn.click(); else await p.evaluate(() => window.DTD.compare.toggle('AMD'));
    await p.waitForTimeout(150);
    const pill2 = await p.$eval('.cmp-pill', e => e.textContent);
    console.log(`${name} Vergleich: „${pill1}“ → „${pill2}“`);
    check(/1/.test(pill1) && /2/.test(pill2), `${name}: Vergleichs-Hinweis ${pill1} / ${pill2}`);
    await p.click('.cmp-pill'); await p.waitForSelector('#vergleich table.cmp', { timeout: 15000 }); await p.waitForTimeout(400);
    const cmp = await p.evaluate(() => ({ cols: [...document.querySelectorAll('#vergleich thead .cmp-col .chip-btn')].map(b => b.textContent), rows: document.querySelectorAll('#vergleich tbody tr').length, best: document.querySelectorAll('#vergleich td.best').length, charts: document.querySelectorAll('#vergleich [data-tv]').length, top: Math.round(document.getElementById('vergleich').getBoundingClientRect().top), pillHidden: document.querySelector('.cmp-pill').hidden }));
    console.log(`${name} Vergleichstabelle: ${cmp.cols.join(' vs ')} · ${cmp.rows} Zeilen · ${cmp.best} beste Werte · ${cmp.charts} Diagramme · oben ${cmp.top}px`);
    check(cmp.cols.length === 2 && cmp.rows >= 25 && cmp.best >= 10 && cmp.charts === 2 && cmp.pillHidden && (await view()) === 'tools', `${name}: Vergleich ${JSON.stringify(cmp)}`);
    try { if (name !== 'small') await (await p.$('#vergleich')).screenshot({ path: `${out}/${name}-compare.png` }); } catch { /* Bildschirmfoto nur zur Ansicht */ }
    await width('Vergleich');
    await p.click('#vergleich .cmp-x'); await p.waitForTimeout(250);
    const cols2 = await p.$$eval('#vergleich thead .cmp-col', c => c.length);
    check(cols2 === 1, `${name}: nach Entfernen ${cols2} Spalten`);
    await p.click('#vergleich [data-cmp-clear]'); await p.waitForTimeout(250);
    check(!(await p.$('#vergleich table')) && /Aktien vergleichen/i.test(await p.$eval('#vergleich', e => e.textContent).catch(() => '')) && await p.evaluate(() => { const v = document.getElementById('vergleich'), s = document.getElementById('screener'); return !!(v && s && (s.compareDocumentPosition(v) & Node.DOCUMENT_POSITION_FOLLOWING)); }), `${name}: nach „Alle entfernen“ keine Tabelle mehr, Erklärung unter dem Screener`);

    // Branchen-Rotation
    await p.waitForSelector('#branchen .sec-row', { timeout: 15000 });
    const sec = await p.evaluate(() => [...document.querySelectorAll('#branchen .sec-row summary')].slice(0, 5).map(s => s.innerText.replace(/\s+/g, ' ')));
    console.log(`${name} Branchen (3 M): ${JSON.stringify(sec.slice(0, 3))}`);
    await p.click('#branchen [data-sec-sort="r12"]'); await p.waitForTimeout(150);
    const sorted = await p.evaluate(() => [...document.querySelectorAll('#branchen .sec-row summary')].map(s => { const t = s.querySelectorAll('.sec-vals .num, .sec-vals span'); return s.innerText; }).length);
    await p.click('#branchen [data-sec-mode="theme"]'); await p.waitForTimeout(150);
    const themes = await p.$$eval('#branchen .sec-row summary .sec-name', s => s.map(x => x.textContent.trim().slice(0, 40)));
    console.log(`${name} Theorie-Themen: ${themes.length} · ${JSON.stringify(themes.slice(0, 3))}`);
    check(sec.length >= 5 && themes.length >= 3, `${name}: Branchen ${sec.length}, Themen ${themes.length}`);
    await p.click('#branchen .sec-row summary'); await p.waitForTimeout(150);
    const chip = await p.$('#branchen .sec-row[open] .sec-top .chip-btn');
    check(!!chip, `${name}: aufgeklappte Gruppe ohne Aktien`);
    try { if (name !== 'small') await (await p.$('#branchen')).screenshot({ path: `${out}/${name}-sectors.png` }); } catch { /* Bildschirmfoto nur zur Ansicht */ }
    await p.click('#branchen [data-sec-mode="ind"]'); await p.click('#branchen [data-sec-sort="r3"]');
    await width('Branchen');
    if (chip) { const want = await (await p.$('#branchen .sec-row summary')).evaluate(() => 0); }

    // Branche im Screener
    await p.goto(`http://localhost:${port}/#aktie`, { waitUntil: 'load' }); await p.waitForFunction(() => window.DTD.stockData && window.DTD.stockData());
    await p.evaluate(() => window.DTD.openStock('NVDA')); await p.waitForSelector('#skPeers [data-industry]', { timeout: 15000 });
    await p.click('#skPeers [data-industry]'); await p.waitForTimeout(1200);
    const scr = await p.evaluate(() => ({ v: [...document.querySelectorAll('.view')].filter(v => !v.hidden).map(v => v.id).join(), ind: (document.getElementById('scInd') || {}).value, count: (document.querySelector('#screener .card-head .muted') || {}).textContent }));
    console.log(`${name} Branche im Screener: ${JSON.stringify(scr)}`);
    check(scr.v === 'tools' && scr.ind === 'Semiconductors', `${name}: Branche im Screener ${JSON.stringify(scr)}`);
    await p.evaluate(() => { const l = JSON.parse(localStorage.getItem('dtd-tools') || '{}'); });
    await ctx.close();
  }
  console.log('JS-Fehler:', JSON.stringify(errs));
  console.log(fails.length ? `FEHLER (${fails.length}):\n - ${fails.join('\n - ')}` : 'Alle Prüfungen bestanden.');
  await b.close();
})();

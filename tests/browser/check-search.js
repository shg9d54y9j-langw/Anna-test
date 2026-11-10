// Browser-Test (Playwright) – läuft in der Rechenkontrolle über tests/browser/run.sh
// Suche mit Vorschlägen, anklickbare Namen in allen Bereichen, Diagramm-Schalter: node check-search.js <port> <ausgabe>
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
// Testdaten: feste Dateien in tests/browser/fixtures, abgeleitete aus make-fixtures.mjs (FIXTURES_TMP)
const FX = { 'stocks-2053.json': 'stocks.json', 'fund-cty.json': 'fund.json', 'swing-2053.json': 'swing.json', 'fund-earn.json': 'fund-earn.json' };
const fx = n => (FX[n] ? path.join(__dirname, 'fixtures', FX[n]) : path.join(process.env.FIXTURES_TMP || '/tmp/rojko-fixtures', n));

(async () => {
  const [port, out] = process.argv.slice(2);
  const stocks = fs.readFileSync(fx('stocks-2053.json'), 'utf8'), swing = fs.readFileSync(fx('swing-2053.json'), 'utf8'), fund = fs.readFileSync(fx('fund-cty.json'), 'utf8');
  // tv.js-Ersatz: merkt sich jede Diagramm-Konfiguration (TradingView ist hier nicht erreichbar)
  const tvStub = `window.TradingView = { widget: function (c) { (window.__tv = window.__tv || []).push(JSON.parse(JSON.stringify(c))); var el = document.getElementById(c.container_id); if (el) el.innerHTML = '<div class="tv-stub" style="height:100%;display:grid;place-items:center;color:#888;font:12px monospace">TradingView ' + c.symbol + ' · ' + (c.studies || []).map(function (s) { return typeof s === 'string' ? s.split('@')[0] : s.id.split('@')[0] + '(' + s.inputs.length + ')'; }).join(', ') + (c.hide_volume ? ' · ohne Volumen' : ' · Volumen') + ' · Stil ' + c.style + '</div>'; } };`;
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
      localStorage.setItem('daytrade-journal-v1', JSON.stringify([{ id: 'j1', ts: '2026-11-02T10:00:00Z', date: '02.11.', sym: 'AMD', dir: 'Long', in: 100, out: 120, qty: 3, note: '' }]));
    });
    await p.route('**/stocks.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: stocks }));
    await p.route('**/swing.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: swing }));
    await p.route('**/fund-data/fund.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: fund }));
    await p.route('https://s3.tradingview.com/tv.js', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: tvStub }));
    await p.route(/tradingview\.com\/external-embedding|finnhub\.io/, r => r.abort());
    const view = () => p.evaluate(() => [...document.querySelectorAll('.view')].filter(v => !v.hidden).map(v => v.id).join(','));
    const stockName = () => p.$eval('#stockBody .stock-name', e => e.textContent).catch(() => '–');
    const tvLast = () => p.evaluate(() => (window.__tv || []).slice(-1)[0] || null);

    // 1) Suche mit Vorschlägen
    await p.goto(`http://localhost:${port}/#aktie`, { waitUntil: 'load' });
    await p.waitForFunction(() => window.DTD.stockData && window.DTD.stockData());
    await p.click('#stockInput'); await p.fill('#stockInput', 'nvi'); await p.waitForTimeout(150);
    const sugg = await p.$$eval('#stockInput-vorschlaege .sugg-opt', o => o.map(x => x.querySelector('.sugg-sym').textContent + ' ' + x.querySelector('.sugg-name').textContent));
    console.log(`${name} Vorschläge „nvi“: ${JSON.stringify(sugg.slice(0, 4))}`);
    check(sugg.length && /^NVDA/.test(sugg[0]), `${name}: erster Vorschlag für nvi ist ${sugg[0]}`);
    try { if (name !== 'small') await p.screenshot({ path: `${out}/${name}-suggest.png` }); } catch { /* Bildschirmfoto nur zur Ansicht */ }
    await p.keyboard.press('ArrowDown'); await p.keyboard.press('Enter'); await p.waitForTimeout(400);
    check(/NVIDIA/i.test(await stockName()), `${name}: Pfeil+Enter öffnet ${await stockName()}`);
    await p.fill('#stockInput', 'apple'); await p.press('#stockInput', 'Escape'); await p.press('#stockInput', 'Enter'); await p.waitForTimeout(400);
    check(/Apple/i.test(await stockName()) && (await p.inputValue('#stockInput')) === 'AAPL', `${name}: „apple“ + Enter öffnet ${await stockName()} (${await p.inputValue('#stockInput')})`);
    await p.fill('#stockInput', 'tesla'); await p.waitForTimeout(150);
    await p.click('#stockInput-vorschlaege .sugg-opt'); await p.waitForTimeout(400);
    check(/Tesla/i.test(await stockName()), `${name}: Klick auf Vorschlag öffnet ${await stockName()}`);
    await p.fill('#stockInput', ''); await p.evaluate(() => document.activeElement.blur()); await p.click('#stockInput'); await p.waitForTimeout(150);
    const recent = await p.$$eval('#stockInput-vorschlaege .sugg-sym', o => o.map(x => x.textContent));
    const title = await p.$eval('#stockInput-vorschlaege .sugg-title', e => e.textContent).catch(() => '');
    console.log(`${name} leeres Feld: „${title}“ ${JSON.stringify(recent)}`);
    check(title === 'Zuletzt angesehen' && recent.slice(0, 3).join() === 'TSLA,AAPL,NVDA', `${name}: zuletzt angesehen ${recent}`);
    await p.press('#stockInput', 'Escape');

    // 2) Diagramm-Schalter
    let c = await tvLast();
    const fmtCfg = c => c ? `${c.symbol} Stil ${c.style} · ${(c.studies || []).map(s => typeof s === 'string' ? s : `${s.id}(${s.inputs.length})`).join(', ')} · hide_volume ${c.hide_volume}` : 'kein Diagramm';
    console.log(`${name} Diagramm Start: ${fmtCfg(c)}`);
    check(c && c.symbol === 'TSLA' && c.interval === 'D' && c.studies.length === 2 && c.studies[0].inputs.length === 50 && c.studies[1].inputs.length === 200 && c.hide_volume === false, `${name}: Start-Diagramm ${fmtCfg(c)}`);
    const h0 = await p.$eval('#skChart', e => e.offsetHeight);
    await p.click('#skTools [data-ind="rsi"]'); await p.click('#skTools [data-ind="ma20"]'); await p.click('#skTools [data-ind="vol"]'); await p.click('#skTools [data-cstyle="2"]'); await p.waitForTimeout(300);
    c = await tvLast();
    const h1 = await p.$eval('#skChart', e => e.offsetHeight);
    console.log(`${name} nach Schaltern: ${fmtCfg(c)} · Höhe ${h0} → ${h1}`);
    check(c.style === '2' && c.hide_volume === true && c.studies.some(s => s === 'RSI@tv-basicstudies') && c.studies.some(s => s.inputs && s.inputs.length === 20) && h1 > h0, `${name}: Schalter ${fmtCfg(c)} Höhe ${h0}/${h1}`);
    const n0 = await p.evaluate(() => window.__tv.length);
    await p.click('#skTools [data-ind="lvl"]'); await p.waitForTimeout(200);
    const lad = await p.$('#skChartInfo .ladder'), n1 = await p.evaluate(() => window.__tv.length);
    const legend = await p.$$eval('#skChartInfo .chart-legend li', l => l.map(x => x.innerText.replace(/\s+/g, ' ').slice(0, 70)));
    console.log(`${name} Legende: ${JSON.stringify(legend)}`);
    check(lad && n1 === n0, `${name}: Marken-Leiter ${lad ? 'da' : 'fehlt'}, Diagramm neu gezeichnet ${n1 - n0}×`);
    let w = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    check(w[0] <= w[1], `${name}: Aktien-Check zu breit ${w}`);
    try { if (name !== 'small') { await (await p.$('#stockBody [data-section="Überblick"]')).screenshot({ path: `${out}/${name}-chart-tools.png` }); } } catch { /* Bildschirmfoto nur zur Ansicht */ }
    await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(800);
    const pressed = await p.$$eval('#skTools [aria-pressed="true"]', b => b.map(x => x.dataset.ind || 'stil' + x.dataset.cstyle).join(','));
    check(pressed === 'stil2,ma20,ma50,ma200,rsi,lvl', `${name}: nach Neuladen gewählt ${pressed}`);
    // zurück auf Standard für die nächsten Prüfungen
    for (const k of ['ma20', 'rsi', 'lvl', 'vol']) await p.click(`#skTools [data-ind="${k}"]`);
    await p.click('#skTools [data-cstyle="1"]');

    // 3) Namen in allen Bereichen führen zur Aktienübersicht
    const tryOpen = async (hash, sel, label) => {
      await p.goto(`http://localhost:${port}/#${hash}`, { waitUntil: 'load' });
      await p.waitForTimeout(800); await p.evaluate(() => document.querySelectorAll('details.more').forEach(d => { d.open = true; }));   // aufklappbare Bereiche öffnen
      const el = await p.waitForSelector(sel, { timeout: 15000 }).catch(() => null);
      if (!el) { fails.push(`${name}: ${label} – kein ${sel}`); return; }
      const want = await el.evaluate(e => e.dataset.open);
      await el.scrollIntoViewIfNeeded(); await el.click(); await p.waitForTimeout(700);
      const v = await view(), inp = await p.inputValue('#stockInput'), nm = await stockName();
      check(v === 'aktie' && inp === want, `${name}: ${label} → ${v}, Feld ${inp} statt ${want}`);
      return `${label}: ${want} → ${nm}`;
    };
    const res = [];
    res.push(await tryOpen('hot', '#hotBody .hs-plan-row .name-link', 'HotStuff Planer-Name'));
    res.push(await tryOpen('swing', '#swingBody .idea-name.name-link', 'Swing-Planer Name'));
    res.push(await tryOpen('tools', '#toolsBody button.scr-name', 'Screener Name'));
    res.push(await tryOpen('tools', '#toolsBody .cal-name .name-link', 'Kalender Name'));
    res.push(await tryOpen('portfolio', '#portfolioBody .idea-name.name-link', 'Portfolio Name'));
    res.push(await tryOpen('portfolio', '#jTable .name-link', 'Journal Kürzel'));
    res.push(await tryOpen('theorie', '#theoryBody .firm > button.chip-btn:not(.ext):not(.off)', 'Theorie Firma (eToro)'));
    const extRes = await tryOpen('theorie', '#theoryBody .firm > button.chip-btn.ext', 'Theorie Firma (andere Börse)');
    res.push(extRes);
    if (extRes) { const tvBtn = await p.$eval('#stockBody .stock-head .btn', e => e.textContent).catch(() => ''); check(/TradingView/.test(tvBtn), `${name}: andere Börse ohne TradingView-Knopf (${tvBtn})`); }
    console.log(`${name} Klicks: ${res.filter(Boolean).join(' · ')}`);

    // 4) Vorschläge in Portfolio und Kursalarmen
    await p.goto(`http://localhost:${port}/#portfolio`, { waitUntil: 'load' }); await p.waitForSelector('#pfSym');
    await p.waitForTimeout(500);
    await p.click('#pfSym'); await p.type('#pfSym', 'palan'); await p.waitForTimeout(200);
    const ps = await p.$$eval('#pfSym-vorschlaege .sugg-sym', o => o.map(x => x.textContent));
    if (ps.length) { await p.click('#pfSym-vorschlaege .sugg-opt'); await p.waitForTimeout(150); }
    const pv = await p.inputValue('#pfSym'), focus = await p.evaluate(() => document.activeElement && document.activeElement.id);
    check(ps[0] === 'PLTR' && pv === 'PLTR' && focus === 'pfBuy', `${name}: Portfolio-Vorschlag ${ps} → ${pv}, Fokus ${focus}`);
    await p.goto(`http://localhost:${port}/#tools`, { waitUntil: 'load' }); await p.waitForSelector('#alSym');
    await p.click('#alSym'); await p.type('#alSym', 'tesla'); await p.waitForTimeout(200);
    const as = await p.$$eval('#alSym-vorschlaege .sugg-sym', o => o.map(x => x.textContent));
    check(as[0] === 'TSLA', `${name}: Alarm-Vorschlag ${as}`);
    console.log(`${name} Formulare: Portfolio „palan“ → ${ps.slice(0, 3)} · Alarm „tesla“ → ${as.slice(0, 3)}`);
    w = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    check(w[0] <= w[1], `${name}: Werkzeuge zu breit ${w}`);
    await ctx.close();
  }
  console.log('JS-Fehler:', JSON.stringify(errs));
  console.log(fails.length ? `FEHLER (${fails.length}):\n - ${fails.join('\n - ')}` : 'Alle Prüfungen bestanden.');
  await b.close();
})();

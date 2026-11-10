// Browser-Test (Playwright) – läuft in der Rechenkontrolle über tests/browser/run.sh
// „Neu in RojkoMoney“: Karte, Links springen richtig, „Gelesen“ blendet aus und bleibt aus. node test-neu.js <port> <ausgabe>
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
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push(e.message));
  await p.addInitScript(() => { if (!localStorage.getItem('seeded')) { localStorage.setItem('seeded', '1'); localStorage.setItem('dtd-portfolio', JSON.stringify([{ id: 'a', sym: 'NVDA', buy: 150, qty: 10 }, { id: 'b', sym: 'KO', buy: 60, qty: 10 }])); } });
  await p.route('**/stock-data/stocks.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: stocks }));
  await p.route('**/stock-data/swing.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: swing }));
  await p.route('**/fund-data/fund.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: fund }));
  await p.route(/tradingview|finnhub\.io|news-data|note-track/, r => r.abort());
  await p.goto(`http://localhost:${port}/#home`, { waitUntil: 'load' });
  await p.waitForSelector('#ovSmart .whatsnew', { timeout: 15000 }).catch(() => null);
  const items = await p.$$eval('#ovSmart .whatsnew .wn-list li b', l => l.map(x => x.textContent));
  check(items.length >= 18 && !!items[0], `Karte mit ${items.length} neuen Funktionen: ${items.slice(0, 4).join(', ')} …`);
  const firstCard = await p.$eval('#ovSmart', e => (e.firstElementChild ? e.firstElementChild.dataset.home : 'leer'));
  check(firstCard === 'neu', `Karte steht ganz oben (erste Karte: ${firstCard})`);
  try { await (await p.$('#ovSmart .whatsnew')).screenshot({ path: `${out}/neu-phone.png` }); } catch { /* Bildschirmfoto nur zur Ansicht */ }
  // jeder Link führt an ein vorhandenes Ziel
  const targets = await p.$$eval('#ovSmart .whatsnew a[href^="#"]', l => l.map(a => a.getAttribute('href')));
  for (const href of targets) {
    await p.goto(`http://localhost:${port}/#home`); await p.waitForSelector('#ovSmart .whatsnew', { timeout: 10000 });
    const link = await p.$(`#ovSmart .whatsnew a[href="${href}"]`);
    if (!link) { check(false, `${href}: Link fehlt (unter „Früher neu“?)`); continue; }
    if (!(await link.isVisible())) await link.evaluate(a => { const d = a.closest('details'); if (d) d.open = true; });
    await link.click();
    await p.waitForTimeout(1500);
    const id = href.slice(1);
    const st = await p.evaluate(id => { const el = document.getElementById(id); const v = [...document.querySelectorAll('.view')].find(x => !x.hidden); return { ok: !!el && !!v && (el === v || v.contains(el)), view: v && v.id, top: el ? Math.round(el.getBoundingClientRect().top) : null }; }, id);
    check(st.ok && (st.top === null || st.top < 400), `${href} → Bereich ${st.view}, Ziel oben bei ${st.top}px`);
  }
  // Schnellsuche öffnet sich
  await p.goto(`http://localhost:${port}/#home`); await p.waitForSelector('#ovSmart .whatsnew', { timeout: 10000 });
  await p.$eval('#ovSmart .whatsnew [data-wn-act="search"]', a => { const d = a.closest('details'); if (d) d.open = true; });
  await p.click('#ovSmart .whatsnew [data-wn-act="search"]'); await p.waitForTimeout(200);
  check(await p.evaluate(() => document.activeElement && document.activeElement.id === 'qsInput'), 'Schnellsuche öffnet sich mit Fokus');
  await p.keyboard.press('Escape');
  // Gelesen: weg und bleibt weg
  await p.click('#ovSmart .whatsnew [data-wn-done]'); await p.waitForTimeout(300);
  check(!(await p.$('#ovSmart .whatsnew')), 'Nach „Gelesen“ ausgeblendet');
  await p.reload(); await p.waitForSelector('#ovSmart .card', { timeout: 15000 }); await p.waitForTimeout(500);
  check(!(await p.$('#ovSmart .whatsnew')), 'Bleibt nach dem Neuladen ausgeblendet');
  const ov = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
  check(ov[0] <= ov[1], `Kein seitliches Scrollen (${ov[0]} ≤ ${ov[1]})`);
  check(!errs.length, `Keine Skriptfehler${errs.length ? ': ' + errs.join(' | ') : ''}`);
  await b.close();
  console.log(fails.length ? `\n${fails.length} FEHLER` : '\nALLES OK');
  process.exit(fails.length ? 1 : 0);
})();

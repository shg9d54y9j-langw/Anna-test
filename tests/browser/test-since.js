// Browser-Test (Playwright) – läuft in der Rechenkontrolle über tests/browser/run.sh
// „Seit Ihrem letzten Besuch“: Karte mit Bewegungen und Notenänderungen, Speichern beim Verlassen, keine Karte bei kurzem Abstand
// node test-since.js <port> <ausgabe>
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
// Testdaten: feste Dateien in tests/browser/fixtures, abgeleitete aus make-fixtures.mjs (FIXTURES_TMP)
const FX = { 'stocks-2053.json': 'stocks.json', 'fund-cty.json': 'fund.json', 'swing-2053.json': 'swing.json', 'fund-earn.json': 'fund-earn.json' };
const fx = n => (FX[n] ? path.join(__dirname, 'fixtures', FX[n]) : path.join(process.env.FIXTURES_TMP || '/tmp/rojko-fixtures', n));

(async () => {
  const [port, out] = process.argv.slice(2);
  const stocksTxt = fs.readFileSync(fx('stocks-2053.json'), 'utf8'), swing = fs.readFileSync(fx('swing-2053.json'), 'utf8'), fund = fs.readFileSync(fx('fund-cty.json'), 'utf8');
  const stocks = JSON.parse(stocksTxt), notes = JSON.parse(fs.readFileSync(fx('nt-notes.json'), 'utf8'));
  const last = s => stocks.items.find(x => x.sym === s).last;
  const b = await chromium.launch(), errs = [], fails = [];
  const check = (ok, msg) => { console.log(`${ok ? '✓' : '✗'} ${msg}`); if (!ok) fails.push(msg); };
  async function page(visit) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Europe/Vienna' });
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(e.message));
    await p.addInitScript(v => {
      if (localStorage.getItem('seeded')) return;
      localStorage.setItem('seeded', '1');
      localStorage.setItem('dtd-wn-seen', JSON.stringify('2026-11-10-since'));
      localStorage.setItem('dtd-portfolio', JSON.stringify([{ id: 'a', sym: 'NVDA', buy: 150, qty: 10 }, { id: 'b', sym: 'KO', buy: 60, qty: 10 }]));
      localStorage.setItem('dtd-watch', JSON.stringify(['AAPL', 'TSLA']));
      if (v) localStorage.setItem('dtd-visit', JSON.stringify(v));
    }, visit);
    await p.route('**/stock-data/stocks.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: stocksTxt }));
    await p.route('**/stock-data/swing.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: swing }));
    await p.route('**/fund-data/fund.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: fund }));
    await p.route(/tradingview|finnhub\.io|news-data|note-track/, r => r.abort());
    await p.goto(`http://localhost:${port}/#home`, { waitUntil: 'load' });
    await p.waitForSelector('#ovSmart .card .stats', { timeout: 15000 }).catch(() => null);
    await p.waitForTimeout(600);
    // „Neu in RojkoMoney“ als gelesen markieren, damit die Reihenfolge der übrigen Karten geprüft werden kann
    if (await p.$('#ovSmart .whatsnew [data-wn-done]')) { await p.click('#ovSmart .whatsnew [data-wn-done]'); await p.evaluate(() => window.DTD.renderHome && window.DTD.renderHome()); await p.waitForTimeout(200); }
    return { ctx, p };
  }
  const ago = h => new Date(Date.now() - h * 3600e3).toISOString();
  const visit = { at: ago(20), data: '2026-11-08T13:40:00Z', px: { NVDA: last('NVDA') / 1.05, KO: last('KO') * 1.002, AAPL: last('AAPL') / 0.97, TSLA: last('TSLA') }, notes: { NVDA: notes.NVDA - 8, KO: notes.KO, AAPL: notes.AAPL, TSLA: notes.TSLA + 6 } };

  // 1) Besuch vor 20 Stunden, neue Daten seitdem
  const A = await page(visit);
  const card = await A.p.$('#ovSmart [data-section="Seit dem letzten Besuch"]');
  const txt = card ? (await card.innerText()).replace(/\s+/g, ' ') : '';
  console.log('  ', txt.slice(0, 300));
  check(!!card && /gestern|heute/.test(txt), 'Karte erscheint mit Zeitpunkt des letzten Besuchs');
  check(/Ihr Depot im Schnitt \+2,4 %/.test(txt) && /2 Aktien/.test(txt), 'Depot-Schnitt +2,4 % (NVDA +5 %, KO −0,2 %)');
  const rows = card ? await card.$$eval('.al-row', r => r.map(x => x.innerText.replace(/\s+/g, ' '))) : [];
  check(rows.length === 3 && /^NVDA/.test(rows[0]) && /Kurs \+5,0 %/.test(rows[0]) && new RegExp(`Gesamtnote ${notes.NVDA - 8} → ${notes.NVDA} ▲`).test(rows[0]) && /DEPOT/i.test(rows[0]), `NVDA zuerst mit Kurs und Note: ${rows[0]}`);
  check(rows.some(r => /^AAPL/.test(r) && /Kurs [−-]3,0 %/.test(r) && /MERKLISTE/i.test(r)), 'AAPL −3 % (Merkliste)');
  check(rows.some(r => /^TSLA/.test(r) && !/Kurs/.test(r) && new RegExp(`Gesamtnote ${notes.TSLA + 6} → ${notes.TSLA} ▼`).test(r)), 'TSLA: nur die Note fiel um 6 Punkte (ohne Kurszeile)');
  check(!rows.some(r => /^KO/.test(r)), 'KO (−0,2 %, Note gleich) nicht aufgeführt');
  check(await A.p.$eval('#ovSmart', e => { const c = e.querySelector('[data-section="Seit dem letzten Besuch"]'); return c && c.closest('#ovSmart > [data-home]') === [...e.children].find(k => k.dataset.home !== 'brief'); }), 'steht oben auf der Startseite (gleich nach „Heute wichtig“)');
  try { await card.screenshot({ path: `${out}/since-phone.png` }); } catch { /* Bildschirmfoto nur zur Ansicht */ }
  // Verlassen → neuer Vergleichsstand
  await A.p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  const saved = await A.p.evaluate(() => JSON.parse(localStorage.getItem('dtd-visit')));
  check(saved && Date.now() - Date.parse(saved.at) < 60e3 && saved.data && Math.abs(saved.px.NVDA - (saved.px.NVDA)) === 0 && Object.keys(saved.px).sort().join() === 'AAPL,KO,NVDA,TSLA', `beim Verlassen gespeichert (${saved && Object.keys(saved.px).join(',')})`);
  await A.p.evaluate(() => { delete document.hidden; });
  await A.p.reload(); await A.p.waitForSelector('#ovSmart .card .stats', { timeout: 15000 }); await A.p.waitForTimeout(500);
  check(!(await A.p.$('#ovSmart [data-section="Seit dem letzten Besuch"]')), 'gleich danach wieder geöffnet: keine Karte');

  // 2) Besuch vor 1 Stunde: keine Karte, Vergleichsstand bleibt
  const B = await page({ ...visit, at: ago(1) });
  check(!(await B.p.$('#ovSmart [data-section="Seit dem letzten Besuch"]')), 'Besuch vor 1 Stunde: keine Karte');
  await B.p.evaluate(() => window.DTD.saveVisit());
  const kept = await B.p.evaluate(() => JSON.parse(localStorage.getItem('dtd-visit')).at);
  check(Math.abs(Date.parse(kept) - (Date.now() - 3600e3)) < 120e3, 'Vergleichsstand bleibt bei kurzem Abstand erhalten');

  // 3) Keine neuen Daten seit damals: keine Karte
  const C = await page({ ...visit, data: stocks.updated });
  check(!(await C.p.$('#ovSmart [data-section="Seit dem letzten Besuch"]')), 'keine neuen Daten seit dem Besuch: keine Karte');

  // 4) Erster Besuch: keine Karte, aber danach gespeichert
  const D = await page(null);
  check(!(await D.p.$('#ovSmart [data-section="Seit dem letzten Besuch"]')), 'erster Besuch: keine Karte');
  await D.p.evaluate(() => window.DTD.saveVisit());
  check(!!(await D.p.evaluate(() => localStorage.getItem('dtd-visit'))), 'erster Besuch: Stand gespeichert');

  check(!errs.length, `Keine Skriptfehler${errs.length ? ': ' + errs.join(' | ') : ''}`);
  await b.close();
  console.log(fails.length ? `\n${fails.length} FEHLER` : '\nALLES OK');
  process.exit(fails.length ? 1 : 0);
})();

// Browser-Test (Playwright) – läuft in der Rechenkontrolle über tests/browser/run.sh
// Nachkäufe und Teilverkäufe: gleitender Durchschnitt, Journal, Steuer-Schätzer, Zusammenführen. node test-lots.js <port> <ausgabe>
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
// Testdaten: feste Dateien in tests/browser/fixtures, abgeleitete aus make-fixtures.mjs (FIXTURES_TMP)
const FX = { 'stocks-2053.json': 'stocks.json', 'fund-cty.json': 'fund.json', 'swing-2053.json': 'swing.json', 'fund-earn.json': 'fund-earn.json' };
const fx = n => (FX[n] ? path.join(__dirname, 'fixtures', FX[n]) : path.join(process.env.FIXTURES_TMP || '/tmp/rojko-fixtures', n));

(async () => {
  const [port, out] = process.argv.slice(2);
  const stocks = fs.readFileSync(fx('stocks-2053.json'), 'utf8'), fund = fs.readFileSync(fx('fund-cty.json'), 'utf8');
  const b = await chromium.launch(), errs = [], fails = [];
  const check = (ok, msg) => { console.log(`${ok ? '✓' : '✗'} ${msg}`); if (!ok) fails.push(msg); };
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  p.on('pageerror', e => errs.push(e.message));
  await p.addInitScript(() => { if (!localStorage.getItem('seeded')) { localStorage.setItem('seeded', '1'); localStorage.setItem('dtd-portfolio', JSON.stringify([{ id: 'p1', sym: 'NVDA', buy: 150, qty: 10, date: '2026-03-02', stop: null, note: '' }])); } });
  await p.route('**/stock-data/stocks.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: stocks }));
  await p.route('**/fund-data/fund.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: fund }));
  await p.route(/tradingview|finnhub\.io|news-data|note-track|swing\.json|note-recent/, r => r.abort());
  let dialogs = [];
  p.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
  await p.goto(`http://localhost:${port}/#portfolio`, { waitUntil: 'load' });
  await p.waitForSelector('.pf-card[data-id="p1"]', { timeout: 15000 });
  const card = () => p.$eval('.pf-card[data-id="p1"] .pf-nums', e => e.innerText.replace(/\s+/g, ' ')).catch(() => 'weg');
  const toastText = () => p.evaluate(() => [...document.querySelectorAll('.toast')].map(t => t.innerText.replace(/\s+/g, ' ')).join(' | '));
  async function trade(kind, q, price, d) {
    await p.click(`.pf-card[data-id="p1"] [data-act="${kind === 'buy' ? 'lotbuy' : 'lotsell'}"]`);
    await p.waitForSelector('form.pf-trade');
    await p.fill('form.pf-trade input[name=q]', String(q));
    await p.fill('form.pf-trade input[name=p]', String(price));
    if (d) await p.fill('form.pf-trade input[name=d]', d);
    await p.click('form.pf-trade button[type=submit]');
    await p.waitForTimeout(300);
  }
  const today = new Date().toISOString().slice(0, 10);
  await trade('buy', 10, '100', '2026-06-01');
  let c = await card();
  check(/Ø Kauf 125,00 · 20 Stück \(2 Käufe\)/.test(c), `Nachkauf: ${c}`);
  await trade('sell', 5, '200', today);
  c = await card();
  const j1 = await p.evaluate(() => JSON.parse(localStorage.getItem('daytrade-journal-v1') || '[]'));
  check(/Ø Kauf 125,00 · 15 Stück/.test(c), `Teilverkauf ändert den Durchschnitt nicht: ${c}`);
  check(j1.length === 1 && j1[0].in === 125 && j1[0].out === 200 && j1[0].qty === 5 && j1[0].sym === 'NVDA' && j1[0].ts.startsWith(today) && /Teilverkauf/.test(j1[0].note), `Journal-Eintrag: ${JSON.stringify(j1[0])}`);
  check(/Gewinn \+375,00 USD/.test(await toastText()), 'Meldung mit Gewinn +375,00 USD');
  await trade('buy', 5, '300', today);
  c = await card();
  check(/Ø Kauf 168,75 · 20 Stück \(3 Käufe\)/.test(c), `gleitender Durchschnitt nach Verkauf und Nachkauf: ${c}`);
  // zu viel verkaufen
  await trade('sell', 50, '170', today);
  check(/hatten Sie nur 20 Stück/.test(await toastText()), 'Zu viel verkaufen wird abgelehnt');
  await p.click('form.pf-trade [data-act="tradecancel"]').catch(() => null);
  // Verlauf aufklappbar
  const log = await p.$eval('.pf-card[data-id="p1"] .pf-log summary', e => e.textContent).catch(() => '');
  check(/Käufe und Verkäufe \(4\)/.test(log), `Verlauf: ${log}`);
  // alles verkaufen → Position weg, zweiter Journal-Eintrag
  await trade('sell', 20, '170', today);
  const j2 = await p.evaluate(() => JSON.parse(localStorage.getItem('daytrade-journal-v1') || '[]'));
  check((await card()) === 'weg' && j2.length === 2 && j2[1].in === 168.75 && j2[1].qty === 20, `Ganz verkauft: Position weg, Journal ${JSON.stringify(j2[1])}`);
  // Steuer-Schätzer sieht die Verkäufe
  const tax = await p.$eval('#pfTax', e => e.innerText.replace(/\s+/g, ' ')).catch(() => '');
  check(/2026/.test(tax) && /2 /.test(tax), `Steuer-Schätzer: ${tax.slice(0, 160)}`);
  // gleiche Aktie zweimal eintragen → Nachkauf zusammenführen
  dialogs = [];
  for (const [price, q] of [['60', '10'], ['70', '10']]) {
    await p.fill('#pfSym', 'KO'); await p.keyboard.press('Escape'); await p.fill('#pfBuy', price); await p.fill('#pfQty', q); await p.fill('#pfDate', '2026-05-0' + (price === '60' ? '1' : '2'));
    await p.click('#pfForm button[type=submit]'); await p.waitForTimeout(400);
  }
  const ko = await p.$$eval('.pf-card', l => l.map(x => x.querySelector('.pf-nums').innerText.replace(/\s+/g, ' ')));
  check(dialogs.length === 1 && /KO ist schon im Depot/.test(dialogs[0]) && ko.length === 1 && /Ø Kauf 65,00 · 20 Stück \(2 Käufe\)/.test(ko[0]), `Zusammenführen: ${JSON.stringify(ko)}`);
  // Daten bleiben nach dem Neuladen (und sind in der Sicherung)
  await p.reload(); await p.waitForSelector('.pf-card', { timeout: 15000 });
  const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('dtd-portfolio')));
  check(saved.length === 1 && saved[0].lots.length === 2 && saved[0].buy === 65 && saved[0].qty === 20 && saved[0].lots[1].t > 0, `nach dem Neuladen: ${JSON.stringify(saved[0])}`);
  try { await (await p.$('.pf-card')).screenshot({ path: `${out}/lots-card.png` }); } catch { /* Bildschirmfoto nur zur Ansicht */ }
  check(!errs.length, `Keine Skriptfehler${errs.length ? ': ' + errs.join(' | ') : ''}`);
  await b.close();
  console.log(fails.length ? `\n${fails.length} FEHLER` : '\nALLES OK');
  process.exit(fails.length ? 1 : 0);
})();

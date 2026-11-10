// Browser-Test (Playwright) – läuft in der Rechenkontrolle über tests/browser/run.sh
// Finanzkraft-Ampel: Aktien-Check, Screener-Vorlage, Depot-Hinweis. node test-fin.js <port> <ausgabe>
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
// Testdaten: feste Dateien in tests/browser/fixtures, abgeleitete aus make-fixtures.mjs (FIXTURES_TMP)
const FX = { 'stocks-2053.json': 'stocks.json', 'fund-cty.json': 'fund.json', 'swing-2053.json': 'swing.json', 'fund-earn.json': 'fund-earn.json' };
const fx = n => (FX[n] ? path.join(__dirname, 'fixtures', FX[n]) : path.join(process.env.FIXTURES_TMP || '/tmp/rojko-fixtures', n));

(async () => {
  const [port, out] = process.argv.slice(2);
  const stocks = fs.readFileSync(fx('stocks-2053.json'), 'utf8'), fund = fs.readFileSync(fx('fund-fs.json'), 'utf8'), fundNoFs = fs.readFileSync(fx('fund-cty.json'), 'utf8');
  const b = await chromium.launch(), errs = [], fails = [];
  const check = (ok, msg) => { console.log(`${ok ? '✓' : '✗'} ${msg}`); if (!ok) fails.push(msg); };
  async function page(fundBody, vp = { width: 1280, height: 900 }, hold = null) {
    const p = await (await b.newContext({ viewport: vp })).newPage();
    p.on('pageerror', e => errs.push(e.message));
    if (hold) await p.addInitScript(h => { if (!localStorage.getItem('seeded')) { localStorage.setItem('seeded', '1'); localStorage.setItem('dtd-portfolio', JSON.stringify(h)); } }, hold);
    await p.route('**/stock-data/stocks.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: stocks }));
    await p.route('**/fund-data/fund.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: fundBody }));
    await p.route(/tradingview|finnhub\.io|news-data|note-track|swing\.json/, r => r.abort());
    return p;
  }
  const p = await page(fund);
  await p.goto(`http://localhost:${port}/#aktie`, { waitUntil: 'load' });
  await p.waitForFunction(() => window.DTD.stockData && window.DTD.stockData());
  const fin = async sym => { await p.evaluate(s => window.DTD.openStock(s), sym); await p.waitForFunction(() => document.getElementById('skFin') && !/Prüfe die Bilanz/.test(document.getElementById('skFin').textContent), null, { timeout: 15000 }).catch(() => null); return p.$eval('#skFin', e => e.innerText.replace(/\s+/g, ' ')).catch(() => ''); };
  const nv = await fin('NVDA'), ko = await fin('KO'), amd = await fin('AMD'), ms = await fin('MSFT');
  console.log('  NVDA:', nv.slice(0, 140)); console.log('  KO:', ko.slice(0, 90)); console.log('  AMD:', amd.slice(0, 200)); console.log('  MSFT:', ms.slice(0, 120));
  check(/Finanzkraft stark/i.test(nv) && /8 von 8/.test(nv) && /Geschäftsjahr 2025/.test(nv), 'NVDA: grün, 8 von 8 Punkten');
  check(/Finanzkraft mittel/i.test(ko) && /von 8/.test(ko), 'KO: gelb');
  check(/Finanzkraft schwach/i.test(amd) && /Achtung/.test(amd) && /0 von 8/.test(amd), 'AMD: rot mit Warnung');
  check(/Zu wenige prüfbare Punkte/.test(ms), 'MSFT: zu wenige Punkte');
  await p.evaluate(s => window.DTD.openStock(s), 'NVDA'); await p.waitForTimeout(600);
  try { const finEl = await p.$('#skFin'); if (finEl) await finEl.screenshot({ path: `${out}/fin-nvda.png` }); } catch { /* Bildschirmfoto nur zur Ansicht */ }
  // Screener-Vorlage
  await p.goto(`http://localhost:${port}/#screener`); await p.waitForSelector('#toolsBody [data-preset="finance"]', { timeout: 15000 });
  await p.click('#toolsBody [data-preset="finance"]'); await p.waitForTimeout(400);
  const syms = await p.$$eval('#toolsBody [data-section="Screener"] tbody tr td:first-child .chip-btn', l => l.map(x => x.textContent));
  check(syms.includes('AAPL') && !syms.includes('NVDA') && !syms.includes('AMD') && !syms.includes('KO'), `Vorlage „Finanzstark“ (grün und Aufwärtstrend; NVDA grün, aber im Abwärtstrend): ${syms.join(',')}`);
  const head = await p.$$eval('#toolsBody [data-section="Screener"] thead th', l => l.map(x => x.textContent.trim()));
  check(head.some(h => /Finanz/.test(h)), 'Spalte „Finanz“ im Screener');
  // Depot-Hinweis
  const q = await page(fund, { width: 390, height: 844 }, [{ id: 'a', sym: 'NVDA', buy: 150, qty: 10 }, { id: 'b', sym: 'AMD', buy: 120, qty: 5 }]);
  await q.goto(`http://localhost:${port}/#pfMix`, { waitUntil: 'load' });
  await q.waitForSelector('#pfMix .mix-warn, #pfMix .up', { timeout: 15000 }).catch(() => null);
  // die Ampel braucht die Kennzahlen: warten, bis sie geladen sind und die Analyse neu gezeichnet ist
  await q.waitForFunction(() => window.DTD.shared.get('fund') && /Finanzkraft/.test((document.getElementById('pfMix') || {}).innerText || ''), null, { timeout: 15000 }).catch(() => null);
  const mix = await q.$eval('#pfMix', e => e.innerText.replace(/\s+/g, ' ')).catch(() => '');
  check(/Schwache Finanzkraft \(rote Ampel\): AMD/.test(mix), 'Depot-Analyse warnt bei AMD');
  // Ohne Jahreswerte (heutiger Stand der echten Daten): Hinweis statt Fehler
  const r = await page(fundNoFs);
  await r.goto(`http://localhost:${port}/#aktie`, { waitUntil: 'load' }); await r.waitForFunction(() => window.DTD.stockData && window.DTD.stockData());
  await r.evaluate(() => window.DTD.openStock('NVDA'));
  await r.waitForFunction(() => document.getElementById('skFin') && !/Prüfe die Bilanz/.test(document.getElementById('skFin').textContent), null, { timeout: 15000 }).catch(() => null);
  check(/nächsten nächtlichen Kennzahlen-Lauf/.test(await r.$eval('#skFin', e => e.textContent).catch(() => '')), 'Ohne Jahreswerte: Hinweis auf den nächsten Lauf');
  check(!errs.length, `Keine Skriptfehler${errs.length ? ': ' + errs.join(' | ') : ''}`);
  await b.close();
  console.log(fails.length ? `\n${fails.length} FEHLER` : '\nALLES OK');
  process.exit(fails.length ? 1 : 0);
})();

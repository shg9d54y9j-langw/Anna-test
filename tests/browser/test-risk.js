// Browser-Test (Playwright) – läuft in der Rechenkontrolle über tests/browser/run.sh
// Risiko-Check im Portfolio: Verlust bis zum Stop je Aktie in Euro (gegengerechnet), Summe und Anteil am Depot, Positionen ohne
// Stop mit Vorschlag, Stop über dem Kurs, Vorschlag zur Positionsgröße nach dem Risikobudget, Budget umschalten (bleibt
// gespeichert). node test-risk.js <port> <ausgabe>
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const stocks = fs.readFileSync(path.join(__dirname, 'fixtures', 'stocks.json'), 'utf8');
const fxBody = fs.readFileSync(path.join(process.env.FIXTURES_TMP || '/tmp/rojko-fixtures', 'fx.json'), 'utf8');
const FX = JSON.parse(fxBody), ST = JSON.parse(stocks);
const rN = FX.rates.USD[FX.rates.USD.length - 1];
const last = sym => ST.items.find(x => x.sym === sym).last;
const de = (v, d) => v.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
const eur = (v, sign) => `${sign ? (v < 0 ? '−' : v > 0 ? '+' : '±') : v < 0 ? '−' : ''}${de(Math.abs(v), Math.abs(v) >= 1000 ? 0 : 2)} €`;

(async () => {
  const [port, out] = process.argv.slice(2);
  const b = await chromium.launch(), errs = [], fails = [];
  const check = (ok, msg) => { console.log(`${ok ? '✓' : '✗'} ${msg}`); if (!ok) fails.push(msg); };
  const p = await (await b.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Europe/Vienna', locale: 'de-AT' })).newPage();
  p.on('pageerror', e => errs.push(e.message));
  await p.addInitScript(() => {
    if (localStorage.getItem('seeded')) return;
    localStorage.setItem('seeded', '1');
    localStorage.setItem('dtd-portfolio', JSON.stringify([
      { id: 'a', sym: 'NVDA', buy: 150, qty: 10, date: '2026-01-02', stop: 160 },
      { id: 'b', sym: 'SAP.DE', buy: 200, qty: 4, date: '2026-03-02', stop: 190 },
      { id: 'c', sym: 'KO', buy: 60, qty: 20, date: '2026-02-02' },
      { id: 'd', sym: 'AAPL', buy: 180, qty: 5, date: '2026-01-05', stop: 360 },
    ]));
  });
  await p.route('**/stock-data/stocks.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: stocks }));
  await p.route('**/fx-data/fx.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: fxBody }));
  await p.route(/tradingview|finnhub\.io|news-data|fund-data|note-|swing\.json|live-data/, r => r.abort());
  await p.goto(`http://localhost:${port}/#pfRisk`, { waitUntil: 'load' });
  await p.waitForSelector('#pfRisk', { timeout: 15000 });
  await p.waitForFunction(() => /€/.test((document.getElementById('pfRisk') || {}).innerText || ''), null, { timeout: 15000 }).catch(() => null);
  const text = () => p.$eval('#pfRisk', e => e.innerText.replace(/\s+/g, ' '));

  // Erwartung: Wert aller Positionen in Euro, Verluste bis zum Stop (AAPL: Stop über dem Kurs zählt nicht)
  const total = 10 * last('NVDA') / rN + 4 * last('SAP.DE') + 20 * last('KO') / rN + 5 * last('AAPL') / rN;
  const lossNv = 10 * (160 - last('NVDA')) / rN, lossSap = 4 * (190 - last('SAP.DE'));
  const sum = lossNv + lossSap;
  let t = await text();
  console.log('  ', t.slice(0, 300));
  check(t.includes(`Verlust, wenn alle Stops greifen ${eur(sum, true)}`), `Summe der Verluste bis zum Stop ${eur(sum, true)}`);
  check(t.includes(`Anteil am Depot ${de(-sum / total * 100, 1)} %`), `Anteil am Depot ${de(-sum / total * 100, 1)} %`);
  check(/Ohne Stop 1/.test(t) && /Größtes Einzelrisiko SAP\.DE/.test(t) === (lossSap < lossNv) || /Größtes Einzelrisiko NVDA/.test(t), 'eine Position ohne Stop, größtes Einzelrisiko benannt');
  const rowOf = async sym => p.$eval(`#pfRisk tbody tr:has([data-open="${sym}"])`, e => e.innerText.replace(/\s+/g, ' ')).catch(() => '');
  const nvRow = await rowOf('NVDA');
  check(nvRow.includes(eur(lossNv, true)), `NVDA: Verlust bis Stop ${eur(lossNv, true)} (${nvRow})`);
  // Budget 1 %: NVDA zu groß? Grenze = 1 % des Depots
  const limit1 = total * 0.01, maxNv = Math.floor(limit1 / ((last('NVDA') - 160) / rN) * 100) / 100;
  if (-lossNv > limit1) check(/zu groß – höchstens/.test(nvRow) && nvRow.includes(de(maxNv, maxNv % 1 ? 2 : 0)), `NVDA zu groß: höchstens ${de(maxNv, 2)} Stück`);
  else check(/passt/.test(nvRow), 'NVDA passt zum Budget');
  check(/Kein Stop – Vorschlag nach den Regeln/.test(await rowOf('KO')), 'KO ohne Stop: Vorschlag nach den Regeln');
  check(/Stop über dem Kurs/.test(await rowOf('AAPL')), 'AAPL: Stop über dem Kurs erkannt');
  try { await (await p.$('#pfRisk')).screenshot({ path: `${out}/risk.png` }); } catch { /* Bildschirmfoto nur zur Ansicht */ }
  // Budget 3 %: NVDA passt
  await p.click('#pfRisk [data-risk-budget="3"]'); await p.waitForTimeout(300);
  t = await text();
  check(/Budget 3 %/.test(t) && (-lossNv <= total * 0.03 ? /passt/.test(await rowOf('NVDA')) : true), 'Budget 3 %: Vorschlag neu berechnet');
  await p.reload({ waitUntil: 'load' }); await p.waitForSelector('#pfRisk', { timeout: 15000 }); await p.waitForTimeout(800);
  check(await p.$eval('#pfRisk [data-risk-budget="3"]', e => e.getAttribute('aria-pressed') === 'true'), 'Budget bleibt nach dem Neuladen');

  check(!errs.length, `Keine Skriptfehler${errs.length ? ': ' + errs.join(' | ') : ''}`);
  await b.close();
  console.log(fails.length ? `\n${fails.length} FEHLER` : '\nALLES OK');
  process.exit(fails.length ? 1 : 0);
})();

// Browser-Test (Playwright) – läuft in der Rechenkontrolle über tests/browser/run.sh
// Depot-Verlauf: zeitgewichtete Rendite, Vergleichs-ETFs, erster Tag, gleicher Tag ersetzt. node test-history.js <port> <ausgabe>
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
// Testdaten: feste Dateien in tests/browser/fixtures, abgeleitete aus make-fixtures.mjs (FIXTURES_TMP)
const FX = { 'stocks-2053.json': 'stocks.json', 'fund-cty.json': 'fund.json', 'swing-2053.json': 'swing.json', 'fund-earn.json': 'fund-earn.json' };
const fx = n => (FX[n] ? path.join(__dirname, 'fixtures', FX[n]) : path.join(process.env.FIXTURES_TMP || '/tmp/rojko-fixtures', n));

(async () => {
  const [port, out] = process.argv.slice(2);
  const stocksTxt = fs.readFileSync(fx('stocks-2053.json'), 'utf8'), fund = fs.readFileSync(fx('fund-cty.json'), 'utf8');
  const st = JSON.parse(stocksTxt), it = s => st.items.find(x => x.sym === s), today = st.updated.slice(0, 10);
  const days = [
    { d: '2026-11-03', px: { NVDA: 160, KO: 90 }, val: { NVDA: 1600, KO: 900 }, bench: { spx: ['SPY', 700], world: ['SWDA.L', 10000] } },
    { d: '2026-11-05', px: { NVDA: 176, KO: 90 }, val: { NVDA: 1760, KO: 900 }, bench: { spx: ['SPY', 714], world: ['SWDA.L', 10100] } },
    { d: '2026-11-06', px: { NVDA: 176, KO: 99 }, val: { NVDA: 1760, KO: 990 }, bench: { spx: ['SPY', 721], world: ['SWDA.L', 10200] } },
  ];
  // Gegenrechnung bis heute
  const r1 = 0.064, r2 = 900 / 2660 * 0.1, r3 = 1760 / 2750 * (it('NVDA').last / 176 - 1) + 990 / 2750 * (it('KO').last / 99 - 1);
  const want = ((1 + r1) * (1 + r2) * (1 + r3) - 1) * 100, wantSpx = (it('SPY').last / 700 - 1) * 100, wantWorld = (it('SWDA.L').last / 10000 - 1) * 100;
  const f1 = v => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(1).replace('.', ',')} %`;
  const b = await chromium.launch(), errs = [], fails = [];
  const check = (ok, msg) => { console.log(`${ok ? '✓' : '✗'} ${msg}`); if (!ok) fails.push(msg); };
  async function page(hist, vp = { width: 1280, height: 900 }) {
    const p = await (await b.newContext({ viewport: vp })).newPage();
    p.on('pageerror', e => errs.push(e.message));
    await p.addInitScript(h => { if (!localStorage.getItem('seeded')) { localStorage.setItem('seeded', '1'); localStorage.setItem('dtd-portfolio', JSON.stringify([{ id: 'a', sym: 'NVDA', buy: 150, qty: 10 }, { id: 'b', sym: 'KO', buy: 60, qty: 10 }])); if (h) localStorage.setItem('dtd-pf-hist', JSON.stringify({ v: 1, days: h })); } }, hist);
    await p.route('**/stock-data/stocks.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: stocksTxt }));
    await p.route('**/fund-data/fund.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: fund }));
    await p.route(/tradingview|finnhub\.io|news-data|note-track|swing\.json|note-recent/, r => r.abort());
    return p;
  }
  const p = await page(days);
  await p.goto(`http://localhost:${port}/#pfHist`, { waitUntil: 'load' });
  await p.waitForSelector('#pfHist .stats', { timeout: 15000 }).catch(() => null);
  await p.waitForTimeout(500);
  const kp = await p.$eval('#pfHist .stats', e => e.innerText.replace(/\s+/g, ' ')).catch(() => '');
  console.log('  ', kp, '| erwartet Depot', f1(want), 'S&P', f1(wantSpx), 'World', f1(wantWorld));
  check(kp.includes(`IHR DEPOT ${f1(want)}`) || kp.toUpperCase().includes(`IHR DEPOT ${f1(want)}`), `Depot zeitgewichtet ${f1(want)}`);
  check(kp.includes(f1(wantSpx)) && kp.includes(f1(wantWorld)), 'S&P 500 und MSCI World seit dem ersten Tag');
  const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('dtd-pf-hist')).days);
  check(saved.length === 4 && saved[3].d === today && saved[3].px.NVDA === it('NVDA').last && saved[3].bench.spx[0] === 'SPY', `heutiger Stand gemerkt (${saved.length} Tage, letzter ${saved[3] && saved[3].d})`);
  const svg = await p.evaluate(() => { const s = document.querySelector('#pfHistChart svg'); return s ? s.querySelectorAll('path').length : 0; });
  check(svg === 3, `Diagramm mit ${svg} Linien`);
  await p.waitForTimeout(2000);   // Portfolio zeichnet nach dem Laden noch einmal neu
  await p.evaluate(() => document.querySelector('#pfHistChart .hit').scrollIntoView({ block: 'center' })); await p.waitForTimeout(200);
  const hc = await p.evaluate(() => { const e = document.querySelector('#pfHistChart .hit').getBoundingClientRect(); return [e.x + e.width / 2, e.y + e.height / 2]; });
  await p.mouse.move(hc[0], hc[1]); await p.waitForTimeout(150);
  const tipNow = await p.evaluate(() => { const t = document.querySelector('#pfHistChart .viz-tip'); return t ? (t.hidden ? 'versteckt' : t.innerText) : 'fehlt'; });
  console.log('   Fadenkreuz:', tipNow.replace(/\s+/g, ' '));
  check(/Ihr Depot:\s*[+−±]/.test(tipNow), 'Fadenkreuz zeigt die Werte');
  try { await (await p.$('#pfHist')).screenshot({ path: `${out}/history.png` }); } catch { /* Bildschirmfoto nur zur Ansicht */ }
  // gleicher Tag noch einmal: ersetzt statt doppelt
  await p.evaluate(() => window.DTD.depotHistorySnapshot());
  check((await p.evaluate(() => JSON.parse(localStorage.getItem('dtd-pf-hist')).days.length)) === 4, 'gleicher Datenstand ersetzt den Eintrag');
  // erster Tag
  const q = await page(null, { width: 360, height: 740 });
  await q.goto(`http://localhost:${port}/#pfHist`, { waitUntil: 'load' });
  await q.waitForSelector('#pfHist', { timeout: 15000 }).catch(() => null); await q.waitForTimeout(500);
  const t = await q.$eval('#pfHist', e => e.innerText.replace(/\s+/g, ' ')).catch(() => '');
  check(/Der Verlauf beginnt am \d\d\.\d\d\.\d{4}/.test(t), `erster Tag: ${t.slice(0, 90)}`);
  const ov = await q.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
  check(ov[0] <= ov[1], 'Handy ohne seitliches Scrollen');
  check(!errs.length, `Keine Skriptfehler${errs.length ? ': ' + errs.join(' | ') : ''}`);
  await b.close();
  console.log(fails.length ? `\n${fails.length} FEHLER` : '\nALLES OK');
  process.exit(fails.length ? 1 : 0);
})();

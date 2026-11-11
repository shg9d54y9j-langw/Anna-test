// Browser-Test (Playwright) – läuft in der Rechenkontrolle über tests/browser/run.sh
// Import aus Trade Republic (trimport.js): englische CSV mit Komma und Dezimalpunkt (Verkäufe mit negativen Stück), deutsche
// mit Semikolon und Dezimalkomma, Spalten ohne Kurs (Betrag minus Gebühr); Einzahlungen und Dividenden übersprungen; gleitender
// Durchschnittspreis; Kürzel über Name und ISIN-Land (NVIDIA → NVDA, OMV ohne eToro → OMV.VI); Umrechnung Euro → Dollar zum
// EZB-Kurs des Handelstags; ganz verkaufte Werte bleiben draußen; gleiches Kürzel wird nach Rückfrage ersetzt; „Rückgängig“
// steht bereit; präparierte Namen werden nicht zu HTML. node test-trimport.js <port> <ausgabe>
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const base = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'stocks.json'), 'utf8'));
const fxBody = fs.readFileSync(path.join(process.env.FIXTURES_TMP || '/tmp/rojko-fixtures', 'fx.json'), 'utf8');
const fx = JSON.parse(fxBody);
const usd = d => { let k = fx.dates.findIndex(x => x > d); k = k < 0 ? fx.dates.length - 1 : k - 1; return fx.rates.USD[k]; };
const stocks = JSON.stringify({ ...base, outside: [{ name: 'OMV', tv: 'VIE:OMV', cc: 'AT' }] });

const CSV_EN = [
  'date,type,isin,name,shares,price,amount,fee,currency',
  '2025-03-03,BUY,US67066G1040,NVIDIA,10,100.00,-1001.00,1.00,EUR',
  '2025-06-02,BUY,US67066G1040,NVIDIA,10,120.00,-1201.00,1.00,EUR',
  '2025-09-01,SELL,US67066G1040,NVIDIA,-5,150.00,749.00,1.00,EUR',
  '2025-04-01,SAVINGS_PLAN,US0378331005,Apple,0.5,200.00,-100.00,0,EUR',
  '2025-05-05,BUY,AT0000743059,OMV,4,45.50,-183.00,1.00,EUR',
  '2025-02-10,DEPOSIT,,,,,500.00,,EUR',
  '2025-07-07,DIVIDEND,US0378331005,Apple,,,"1,20",,EUR',
  '2025-08-08,BUY,DE0007164600,SAP,2,180.00,-361.00,1.00,EUR',
  '2025-10-10,SELL,DE0007164600,SAP,-2,200.00,399.00,1.00,EUR',
  '2025-11-11,BUY,DE000BASF111,"<img src=x class=xss-canary onerror=alert(1)>",1,40.00,-41.00,1.00,EUR',
].join('\r\n');
const CSV_DE = '﻿' + [
  'Datum;Typ;ISIN;Wertpapier;Stück;Betrag;Gebühr',
  '03.03.2025;Kauf;US67066G1040;NVIDIA Corp.;10;-1.001,00;1,00',
  '02.06.2025;Sparplan;US67066G1040;NVIDIA Corp.;10;-1.201,00;1,00',
  '01.09.2025;Verkauf;US67066G1040;NVIDIA Corp.;5;749,00;1,00',
  '05.09.2025;Zinsen;;;;3,10;',
].join('\n');

(async () => {
  const [port, out] = process.argv.slice(2);
  const b = await chromium.launch(), errs = [], fails = [];
  const check = (ok, msg) => { console.log(`${ok ? '✓' : '✗'} ${msg}`); if (!ok) fails.push(msg); };
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push(e.message));
  const dialogs = [];
  p.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
  await p.route(/raw\.githubusercontent\.com/, r => r.fulfill({ status: 404, body: '' }));
  await p.route(/tradingview|finnhub\.io/, r => r.abort());
  await p.route('**/stock-data/stocks.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: stocks }));
  await p.route('**/fx-data/fx.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: fxBody }));
  // vorhandene NVDA-Position: wird nach Rückfrage ersetzt; KO bleibt
  await p.addInitScript(() => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('dtd-portfolio', JSON.stringify([{ id: 'a', sym: 'NVDA', buy: 90, qty: 3 }, { id: 'b', sym: 'KO', buy: 60, qty: 2 }])); } });
  await p.goto(`http://localhost:${port}/#portfolio`, { waitUntil: 'load' });
  await p.waitForTimeout(1200);

  // 1) Erkennen: deutsche Datei (Semikolon, Dezimalkomma, ohne Kurs-Spalte) – nur rechnen
  const de = await p.evaluate(csv => {
    const T = window.DTD.trImport, text = csv.replace(/^﻿/, ''), d = T.sniff(text), rows = T.parseCsv(text, d), map = T.guess(rows[0]);
    const res = T.analyze(rows, map), n = res.list.find(x => x.isin === 'US67066G1040');
    return { d, map, held: n && n.held, avg: n && n.avg, buys: n && n.buys.length, sells: n && n.sells.length, skipped: res.skipped };
  }, CSV_DE);
  check(de.d === ';' && de.map.date === 0 && de.map.type === 1 && de.map.isin === 2 && de.map.name === 3 && de.map.qty === 4 && de.map.price === -1 && de.map.amount === 5 && de.map.fee === 6,
    `deutsche Datei: Semikolon und Spalten erkannt (${JSON.stringify(de.map)})`);
  check(de.held === 15 && Math.abs(de.avg - 110) < 1e-9 && de.buys === 2 && de.sells === 1 && de.skipped.noIsin === 1,
    `Kurs aus Betrag minus Gebühr, Sparplan als Kauf, Verkauf ohne Vorzeichen, Zinsen übersprungen (${de.held} Stück, Ø ${de.avg})`);
  const nums = await p.evaluate(() => ['1.234,56', '1,234.56', '1234.56', '-12,5', '(12,50)', '12,50-', '−3', 'abc', ''].map(window.DTD.trImport.toNum));
  check(JSON.stringify(nums) === JSON.stringify([1234.56, 1234.56, 1234.56, -12.5, -12.5, -12.5, -3, null, null]), `Zahlenformate (${nums.join(' | ')})`);
  const days = await p.evaluate(() => ['2025-03-03T10:00:00Z', '03.03.2025 10:15', '3.3.25', '31.02.2025', '03/03/2025'].map(window.DTD.trImport.toDay));
  check(JSON.stringify(days) === JSON.stringify(['2025-03-03', '2025-03-03', '2025-03-03', null, null]), `Datumsformate, ungültige Tage abgelehnt (${days.join(' | ')})`);

  // 2) Englische Datei über das Portfolio: Vorschau
  await p.evaluate(() => { const d = document.getElementById('pfBackup'); if (d) d.open = true; });
  check(!!(await p.$('#trFile')) && !!(await p.$('[data-act="tr-import"]')), 'Portfolio: Knopf „Transaktionsexport wählen“');
  await p.setInputFiles('#trFile', { name: 'transaktionen.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV_EN, 'utf8') });
  await p.waitForSelector('.tr-table', { timeout: 8000 }).catch(() => null);
  const prev = await p.$$eval('.tr-table tbody tr', rows => rows.map(r => ({ text: r.innerText.replace(/\s+/g, ' '), on: !!(r.querySelector('[data-tr-on]') || {}).checked, sym: (r.querySelector('[data-tr-sym]') || {}).value || '' })));
  const row = s => prev.find(r => r.text.includes(s)) || {};
  check(prev.length === 5, `Vorschau: 5 Werte (${prev.map(r => r.text.slice(0, 30)).join(' | ')})`);
  check(row('NVIDIA').sym === 'NVDA' && row('NVIDIA').on && /15/.test(row('NVIDIA').text) && /110,00 EUR/.test(row('NVIDIA').text), `NVIDIA → NVDA, 15 Stück, Ø 110 EUR (${row('NVIDIA').text})`);
  check(row('Apple').sym === 'AAPL' && /0,50/.test(row('Apple').text), `Apple → AAPL, 0,5 Stück aus dem Sparplan (${row('Apple').sym})`);
  check(row('OMV').sym === 'OMV.VI' && row('OMV').on, `OMV (nicht bei eToro) → OMV.VI (${row('OMV').sym})`);
  check(/verkauft/.test(row('SAP').text) && !row('SAP').on, 'SAP ganz verkauft: nicht ausgewählt');
  const body = await p.$eval('#drawerBody', e => e.innerText.replace(/\s+/g, ' '));
  check(/2 Zeilen übersprungen/.test(body) && /nur in diesem Browser/.test(body), `Einzahlung und Dividende übersprungen, Hinweis „nur im Browser“ (${(body.match(/[^.]*übersprungen[^.]*/) || [''])[0].slice(0, 120)})`);
  check(await p.evaluate(() => !document.querySelector('#drawerBody img, #drawerBody .xss-canary')), 'präparierter Name bleibt Text');
  try { await (await p.$('#drawer')).screenshot({ path: `${out}/trimport.png` }); } catch { /* Bildschirmfoto nur zur Ansicht */ }

  // 3) Übernehmen: NVDA ersetzt (Rückfrage), Euro → Dollar zum Kurs des Handelstags, OMV.VI in Euro, SAP nicht, KO bleibt
  await p.click('[data-tr-act="apply"]');
  await p.waitForTimeout(600);
  const pf = await p.evaluate(() => JSON.parse(localStorage.getItem('dtd-portfolio') || '[]'));
  const nv = pf.find(h => h.sym === 'NVDA'), om = pf.find(h => h.sym === 'OMV.VI'), ap = pf.find(h => h.sym === 'AAPL');
  check(dialogs.some(m => /schon im Portfolio \(NVDA\)/.test(m)), `Rückfrage vor dem Ersetzen (${dialogs.join(' | ').slice(0, 100)})`);
  const want = (10 * 100 * usd('2025-03-03') + 10 * 120 * usd('2025-06-02')) / 20;
  check(nv && nv.qty === 15 && nv.lots.length === 2 && nv.sells.length === 1 && Math.abs(nv.buy - Math.round(want * 100) / 100) < 0.011 && Math.abs(nv.lots[0].p - 100 * usd('2025-03-03')) < 0.001,
    `NVDA in Dollar zum EZB-Kurs je Kauftag: ${nv && nv.qty} Stück, Ø ${nv && nv.buy} (erwartet ${want.toFixed(2)})`);
  check(om && om.qty === 4 && om.buy === 45.5 && ap && ap.qty === 0.5, 'OMV.VI in Euro (45,50), Apple 0,5 Stück');
  check(!pf.some(h => h.sym === 'SAP.DE') && pf.some(h => h.sym === 'KO') && pf.filter(h => h.sym === 'NVDA').length === 1, 'SAP nicht übernommen, KO bleibt, NVDA nur einmal');
  const undo = await p.evaluate(() => JSON.parse(localStorage.getItem('dtd-restore-undo') || 'null'));
  check(undo && /NVDA/.test(undo.data['dtd-portfolio']) && /KO/.test(undo.data['dtd-portfolio']) && /Trade-Republic/.test(undo.from), 'bisheriger Stand für „Rückgängig“ aufgehoben');
  const toasts = await p.$eval('#toasts', e => e.innerText.replace(/\s+/g, ' ')).catch(() => '');
  check(/3 Wert\(e\) ins Portfolio übernommen, 1 ersetzt/.test(toasts) && /Nicht ausgewählt: 1/.test(toasts), `Meldung nennt Übernommenes und Ausgelassenes (${toasts.slice(0, 160)})`);
  const cards = await p.$$eval('#portfolio [data-id], #portfolio .pf-card', l => l.length).catch(() => 0);
  check(cards >= 4 && await p.$('[data-act="undo-restore"]').then(Boolean), `Portfolio zeigt die Werte, „Stand vor dem Laden zurückholen“ ist da (${cards})`);

  check(!errs.length, `Keine Skriptfehler${errs.length ? ': ' + [...new Set(errs)].join(' | ') : ''}`);
  await b.close();
  console.log(fails.length ? `\n${fails.length} FEHLER` : '\nALLES OK');
  process.exit(fails.length ? 1 : 0);
})();

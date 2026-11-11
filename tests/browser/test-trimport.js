// Browser-Test (Playwright) – läuft in der Rechenkontrolle über tests/browser/run.sh
// Import aus Trade Republic (trimport.js): englische CSV mit Komma und Dezimalpunkt (Verkäufe mit negativen Stück), deutsche
// mit Semikolon und Dezimalkomma, Spalten ohne Kurs (Betrag minus Gebühr); Einzahlungen und Dividenden übersprungen; gleitender
// Durchschnittspreis; Kürzel über Name und ISIN-Land (NVIDIA → NVDA, OMV ohne eToro → OMV.VI); Umrechnung Euro → Dollar zum
// EZB-Kurs des Handelstags; ganz verkaufte Werte bleiben draußen; gleiches Kürzel wird nach Rückfrage ersetzt; „Rückgängig“
// steht bereit; präparierte Namen werden nicht zu HTML. Scalable Capital (Semikolon, englische Spalten, Status): Depot erkannt,
// stornierte Aufträge zählen nicht, gleiche Werte werden mit Trade Republic zusammengeführt (ohne Rückfrage); ein erneuter
// Trade-Republic-Import ersetzt nur dessen Einträge, ein dort ganz verkaufter Wert behält die Scalable-Käufe.
// node test-trimport.js <port> <ausgabe>
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
const CSV_SC = [
  'date;time;status;reference;description;assetType;type;isin;shares;price;amount;fee;tax;currency',
  '2025-07-01;10:15:00;Executed;SCAL001;NVIDIA;Security;Buy;US67066G1040;5;130,00;-650,99;0,99;0,00;EUR',
  '2025-07-02;11:00:00;Cancelled;SCAL002;NVIDIA;Security;Buy;US67066G1040;100;131,00;-13100,99;0,99;0,00;EUR',
  '2025-08-01;09:00:00;Executed;SCAL003;Apple;Security;Savings plan;US0378331005;1;190,00;-190,00;0,00;0,00;EUR',
  '2025-09-15;09:00:00;Executed;SCAL004;Apple;Security;Distribution;US0378331005;;;0,25;0,00;0,07;EUR',
  '2025-01-02;08:00:00;Executed;SCAL005;Einzahlung;Cash;Deposit;;;;1000,00;0,00;0,00;EUR',
].join('\n');
const CSV_EN2 = CSV_EN + '\r\n2025-12-01,SELL,US67066G1040,NVIDIA,-15,160.00,2399.00,1.00,EUR';
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
  check(dialogs.some(m => /von Hand eingetragen im Portfolio \(NVDA\)/.test(m)), `Rückfrage vor dem Ersetzen (${dialogs.join(' | ').slice(0, 100)})`);
  const want = (10 * 100 * usd('2025-03-03') + 10 * 120 * usd('2025-06-02')) / 20;
  check(nv && nv.qty === 15 && nv.lots.length === 2 && nv.sells.length === 1 && Math.abs(nv.buy - Math.round(want * 100) / 100) < 0.011 && Math.abs(nv.lots[0].p - 100 * usd('2025-03-03')) < 0.001,
    `NVDA in Dollar zum EZB-Kurs je Kauftag: ${nv && nv.qty} Stück, Ø ${nv && nv.buy} (erwartet ${want.toFixed(2)})`);
  check(om && om.qty === 4 && om.buy === 45.5 && ap && ap.qty === 0.5, 'OMV.VI in Euro (45,50), Apple 0,5 Stück');
  check(!pf.some(h => h.sym === 'SAP.DE') && pf.some(h => h.sym === 'KO') && pf.filter(h => h.sym === 'NVDA').length === 1, 'SAP nicht übernommen, KO bleibt, NVDA nur einmal');
  const undo = await p.evaluate(() => JSON.parse(localStorage.getItem('dtd-restore-undo') || 'null'));
  check(undo && /NVDA/.test(undo.data['dtd-portfolio']) && /KO/.test(undo.data['dtd-portfolio']) && /Trade Republic/.test(undo.from), 'bisheriger Stand für „Rückgängig“ aufgehoben');
  const toasts = await p.$eval('#toasts', e => e.innerText.replace(/\s+/g, ' ')).catch(() => '');
  check(/3 Wert\(e\) aus Trade Republic übernommen, 1 ersetzt/.test(toasts) && /Nicht ausgewählt: 1/.test(toasts), `Meldung nennt Übernommenes und Ausgelassenes (${toasts.slice(0, 160)})`);
  const cards = await p.$$eval('#portfolio [data-id], #portfolio .pf-card', l => l.length).catch(() => 0);
  check(cards >= 4 && await p.$('[data-act="undo-restore"]').then(Boolean), `Portfolio zeigt die Werte, „Stand vor dem Laden zurückholen“ ist da (${cards})`);

  // 4) Scalable Capital: Depot erkannt, Storno zählt nicht, mit Trade Republic zusammengeführt – ohne Rückfrage
  const nDialogs = dialogs.length;
  await p.evaluate(() => { const d = document.getElementById('pfBackup'); if (d) d.open = true; });
  await p.setInputFiles('#trFile', { name: 'scalable-transactions.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV_SC, 'utf8') });
  await p.waitForSelector('.tr-table', { timeout: 8000 }).catch(() => null);
  const src = await p.$eval('[data-tr-src]', e => e.value).catch(() => '');
  const prevSc = await p.$$eval('.tr-table tbody tr', rows => rows.map(r => r.innerText.replace(/\s+/g, ' ')));
  check(src === 'sc' && prevSc.length === 2 && prevSc.some(t => /NVIDIA/.test(t) && /5 Stück/.test(t) && /130,00 EUR/.test(t)), `Scalable erkannt, Storno nicht gezählt (${src}: ${prevSc.join(' | ').slice(0, 120)})`);
  await p.click('[data-tr-act="apply"]'); await p.waitForTimeout(600);
  let pf2 = await p.evaluate(() => JSON.parse(localStorage.getItem('dtd-portfolio') || '[]'));
  let nv2 = pf2.find(h => h.sym === 'NVDA'), ap2 = pf2.find(h => h.sym === 'AAPL');
  check(dialogs.length === nDialogs && nv2 && nv2.qty === 20 && nv2.lots.length === 3 && nv2.lots.filter(l => l.s === 'sc').length === 1 && nv2.lots.filter(l => l.s === 'tr').length === 2 && ap2 && ap2.qty === 1.5,
    `NVDA aus beiden Depots: 15 + 5 = ${nv2 && nv2.qty} Stück, Apple 0,5 + 1 = ${ap2 && ap2.qty}, keine Rückfrage`);
  check(nv2 && nv2.note === 'Trade Republic + Scalable Capital · US67066G1040' && pf2.filter(h => h.sym === 'NVDA').length === 1, `eine Position je Wert, Notiz nennt beide Depots (${nv2 && nv2.note})`);
  const toast2 = await p.$eval('#toasts', e => e.innerText.replace(/\s+/g, ' ')).catch(() => '');
  check(/2 Wert\(e\) aus Scalable Capital übernommen, 2 mit einem anderen Depot zusammengeführt/.test(toast2), `Meldung: zusammengeführt (${toast2.slice(-200)})`);

  // 5) Neuer Trade-Republic-Export: ersetzt nur dessen Einträge; NVIDIA dort ganz verkauft → nur die Scalable-Käufe bleiben
  await p.evaluate(() => { const d = document.getElementById('pfBackup'); if (d) d.open = true; });
  await p.setInputFiles('#trFile', { name: 'transaktionen-neu.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV_EN2, 'utf8') });
  await p.waitForSelector('.tr-table', { timeout: 8000 }).catch(() => null);
  check(await p.$eval('[data-tr-src]', e => e.value).catch(() => '') === 'tr', 'Trade Republic als Depot vorgewählt');
  await p.click('[data-tr-act="apply"]'); await p.waitForTimeout(600);
  pf2 = await p.evaluate(() => JSON.parse(localStorage.getItem('dtd-portfolio') || '[]'));
  nv2 = pf2.find(h => h.sym === 'NVDA'); ap2 = pf2.find(h => h.sym === 'AAPL');
  const om2 = pf2.find(h => h.sym === 'OMV.VI');
  check(nv2 && nv2.qty === 5 && nv2.lots.length === 1 && nv2.lots[0].s === 'sc' && !nv2.sells && Math.abs(nv2.buy - Math.round(130 * usd('2025-07-01') * 100) / 100) < 0.011 && nv2.note === 'Scalable Capital · US67066G1040',
    `NVDA bei Trade Republic ganz verkauft: 5 Stück aus Scalable bleiben (${nv2 && nv2.qty}, ${nv2 && nv2.note})`);
  check(ap2 && ap2.qty === 1.5 && ap2.lots.length === 2 && om2 && om2.qty === 4 && om2.lots.length === 1 && pf2.some(h => h.sym === 'KO') && dialogs.length === nDialogs,
    `erneuter Import doppelt nichts: Apple ${ap2 && ap2.qty}, OMV ${om2 && om2.qty}, KO bleibt, keine Rückfrage`);

  check(!errs.length, `Keine Skriptfehler${errs.length ? ': ' + [...new Set(errs)].join(' | ') : ''}`);
  await b.close();
  console.log(fails.length ? `\n${fails.length} FEHLER` : '\nALLES OK');
  process.exit(fails.length ? 1 : 0);
})();

// Browser-Test (Playwright) – läuft in der Rechenkontrolle über tests/browser/run.sh
// Europäische Aktien: Suche mit deutschen Namen in jeder Schreibweise (Münchener Rück, Muenchener, Munchener, Münchner),
// über Zusatznamen (Munich Re, Wiener Kürzel POS) und mit Enter ohne Auswahl; Herkunft im Aktien-Check (Land, Börse, weitere
// Namen); TradingView-Kürzel bleiben, wie sie sind; Screener mit Deutschland, Österreich, Schweiz; US-Aktiengattungen (BRK.B)
// zählen zu den USA. Schnellsuche in der Kopfzeile. Werte, die eToro nicht führt (OMV, Post, DO & CO): in beiden Suchen mit
// „nicht bei eToro“, eigene Ansicht mit Börse und TradingView-Kürzel; VIE:DOC ist DO & CO, nicht das US-Kürzel DOC; kaputte
// Einträge erscheinen nicht. node test-europe.js <port> <ausgabe>
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const base = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'stocks.json'), 'utf8'));
// drei Werte der Europa-Liste dazu (Kennzahlen von SAP.DE übernommen), dazu ein Schweizer Wert ohne Liste (Land aus der Börse)
const like = base.items.find(x => x.sym === 'SAP.DE');
const add = (sym, name, extra) => ({ ...like, sym, tv: `XETR:${sym.split('.')[0]}`, name, ...extra });
const stocks = JSON.stringify({ ...base, items: [...base.items,
  add('MUV2.DE', 'Muenchener Rueckversicherungs-Gesellschaft AG', { aka: 'Munich Re · Münchner Rück', cc: 'DE' }),
  add('ABS2.DE', 'Porr AG', { aka: 'POS', cc: 'AT' }),
  add('EBO.DE', 'Erste Group Bank AG', { aka: 'EBS · Erste Bank', cc: 'AT' }),
  { ...like, sym: 'NOVN.ZU', tv: 'SIX:NOVN', name: 'Novartis AG' },
  { ...like, sym: 'DOC', tv: 'DOC', name: 'Healthpeak Properties' },
], outside: [
  { name: 'OMV', tv: 'VIE:OMV', cc: 'AT' },
  { name: 'Österreichische Post', tv: 'VIE:POST', cc: 'AT', aka: 'Austrian Post' },
  { name: 'DO & CO', tv: 'VIE:DOC', cc: 'AT' },
  { name: '<img src=x onerror=alert(1)>', tv: 'VIE:"><b>X', cc: 'AT' },
] });

(async () => {
  const [port, out] = process.argv.slice(2);
  const b = await chromium.launch(), errs = [], fails = [];
  const check = (ok, msg) => { console.log(`${ok ? '✓' : '✗'} ${msg}`); if (!ok) fails.push(msg); };
  const p = await (await b.newContext({ viewport: { width: 1280, height: 900 }, locale: 'de-AT' })).newPage();
  p.on('pageerror', e => errs.push(e.message));
  // zuletzt angelegte Regel gilt zuerst: erst alles andere von GitHub abweisen, dann die Aktien-Daten liefern
  await p.route(/raw\.githubusercontent\.com/, r => r.fulfill({ status: 404, body: '' }));
  await p.route('**/stock-data/stocks.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: stocks }));
  await p.route(/tradingview|finnhub\.io/, r => r.abort());
  await p.goto(`http://localhost:${port}/#aktie`, { waitUntil: 'load' });
  await p.waitForFunction(() => window.DTD.stockData && window.DTD.stockData(), null, { timeout: 15000 });

  // 1) Vorschläge beim Tippen
  const suggest = async q => {
    await p.fill('#stockInput', ''); await p.type('#stockInput', q, { delay: 10 }); await p.waitForTimeout(200);
    return p.$$eval('#stockInput-vorschlaege [role="option"]', l => l.map(o => o.innerText.replace(/\s+/g, ' ')));
  };
  for (const q of ['Münchener Rück', 'muenchener', 'Munchener', 'Münchner', 'munich re']) {
    const s = await suggest(q);
    check(/MUV2\.DE/.test(s[0] || ''), `„${q}“ → Münchener Rück zuerst (${(s[0] || '–').slice(0, 60)})`);
  }
  check((await suggest('porr')).some(t => /ABS2\.DE/.test(t)) && (await suggest('POS')).some(t => /ABS2\.DE/.test(t)), 'Porr über den Namen und über das Wiener Kürzel POS');
  check((await suggest('erste')).some(t => /EBO\.DE/.test(t)) && (await suggest('apple')).some(t => /AAPL/.test(t)), 'Erste Group gefunden, US-Werte unverändert');

  // 2) Enter ohne Auswahl: bester Treffer, Herkunft im Aktien-Check
  const open = async q => { await p.fill('#stockInput', q); await p.press('#stockInput', 'Escape'); await p.evaluate(() => document.getElementById('stockForm').requestSubmit()); await p.waitForTimeout(600); };
  await open('Münchener Rück');
  let head = await p.$eval('#stockBody .stock-head', e => e.innerText.replace(/\s+/g, ' ')).catch(() => '');
  check(/Aktie · MUV2\.DE/.test(head) && /Firma aus Deutschland · Kurs von Xetra · auch: Munich Re · Münchner Rück/.test(head), `Münchener Rück geöffnet mit Herkunft (${head.slice(0, 160)})`);
  await open('porr');
  head = await p.$eval('#stockBody .stock-head', e => e.innerText.replace(/\s+/g, ' ')).catch(() => '');
  check(/ABS2\.DE/.test(head) && /Firma aus Österreich · Kurs von Xetra \(Heimatbörse: Wien\) · auch: POS/.test(head), `Porr: österreichische Firma, Kurs von Xetra (${head.slice(0, 160)})`);
  try { await (await p.$('#stockBody .stock-head')).screenshot({ path: `${out}/europe-porr.png` }); } catch { /* Bildschirmfoto nur zur Ansicht */ }
  await open('NOVN.ZU');
  head = await p.$eval('#stockBody .stock-head', e => e.innerText.replace(/\s+/g, ' ')).catch(() => '');
  check(/Kurs von SIX Zürich/.test(head) && !/Firma aus/.test(head), 'ohne Europa-Liste: nur die Börse, kein erfundenes Land');
  await open('XETR:ABC');
  head = await p.$eval('#stockBody .stock-head', e => e.innerText.replace(/\s+/g, ' ')).catch(() => '');
  check(/XETR:ABC/.test(head) && /Nicht unter den/.test(head), 'TradingView-Kürzel: kein Ersatztreffer, nur das Diagramm');
  await open('Apfelbaum Holding');
  head = await p.$eval('#stockBody .stock-head', e => e.innerText.replace(/\s+/g, ' ')).catch(() => '');
  check(/Nicht unter den/.test(head), 'unbekannter Name: kein falscher Treffer');

  // 2b) Werte ohne eToro: Vorschlag mit Hinweis, eigene Ansicht mit Börse; genaues Kürzel schlägt das gleichnamige US-Kürzel
  const sOmv = await suggest('OMV');
  check(/VIE:OMV/.test(sOmv[0] || '') && /nicht bei eToro/.test(sOmv[0] || ''), `„OMV“ → VIE:OMV mit „nicht bei eToro“ (${(sOmv[0] || '–').slice(0, 60)})`);
  const sPost = await suggest('austrian post'), sImg = await suggest('img');
  check(sPost.some(t => /VIE:POST/.test(t)) && !sImg.some(t => /VIE:|<img|onerror/.test(t)), `Post über den Zusatznamen; kaputter Eintrag erscheint nicht (${sPost.join(' | ').slice(0, 80)} / ${sImg.join(' | ').slice(0, 80)})`);
  await open('OMV');
  head = await p.$eval('#stockBody .stock-head', e => e.innerText.replace(/\s+/g, ' ')).catch(() => '');
  const tvLink = await p.$eval('#stockBody .stock-head a[href*="tradingview"]', a => a.href).catch(() => '');
  check(/Aktie · VIE:OMV · nicht bei eToro/.test(head) && /Firma aus Österreich · Kurs von der Wiener Börse/.test(head) && /Bei eToro nicht handelbar/.test(head) && /VIE-OMV/.test(tvLink),
    `OMV: eigene Ansicht mit Wiener Börse und TradingView (${head.slice(0, 160)})`);
  try { await (await p.$('#stockBody .stock-head')).screenshot({ path: `${out}/europe-omv.png` }); } catch { /* Bildschirmfoto nur zur Ansicht */ }
  await open('VIE:DOC');
  head = await p.$eval('#stockBody .stock-head', e => e.innerText.replace(/\s+/g, ' ')).catch(() => '');
  check(/DO & CO/.test(head) && !/Healthpeak/.test(head), `VIE:DOC zeigt DO & CO (${head.slice(0, 80)})`);
  await open('DOC');
  head = await p.$eval('#stockBody .stock-head', e => e.innerText.replace(/\s+/g, ' ')).catch(() => '');
  check(/Healthpeak/.test(head), 'DOC bleibt das US-Kürzel');
  check(await p.evaluate(() => !document.querySelector('#stockBody img, #stockInput-vorschlaege img, #stockInput-vorschlaege b:not(.sugg-sym)')), 'kein eingeschleustes HTML aus der Liste');

  // 3) Schnellsuche in der Kopfzeile
  await p.click('#qsInput'); await p.type('#qsInput', 'münchner rück', { delay: 10 }); await p.waitForTimeout(250);
  const opts = await p.$$eval('#qsInput-vorschlaege [role="option"]', l => l.map(o => o.innerText));
  check(opts.some(t => /MUV2\.DE/.test(t)), `Schnellsuche in der Kopfzeile findet Münchener Rück (${opts.length} Vorschläge)`);
  await p.fill('#qsInput', ''); await p.type('#qsInput', 'omv', { delay: 10 }); await p.waitForTimeout(250);
  const qsOmv = await p.$$eval('#qsInput-vorschlaege [role="option"]', l => l.map(o => o.innerText.replace(/\s+/g, ' ')));
  check(/VIE:OMV/.test(qsOmv[0] || ''), `Schnellsuche findet OMV (${(qsOmv[0] || '–').slice(0, 50)})`);
  await p.press('#qsInput', 'Enter'); await p.waitForTimeout(700);
  head = await p.$eval('#stockBody .stock-head', e => e.innerText.replace(/\s+/g, ' ')).catch(() => '');
  check(await p.evaluate(() => location.hash) === '#aktie' && /VIE:OMV/.test(head), 'Enter in der Schnellsuche öffnet OMV im Aktien-Check');

  // 4) Screener: Länder und Regionen
  await p.goto(`http://localhost:${port}/#tools`, { waitUntil: 'load' });
  await p.waitForSelector('#screener tbody tr', { timeout: 15000 });
  // Vorlage „Alle“ (keine weiteren Bedingungen), dann Region und optional ein Suchwort; die Liste zeigt höchstens 120 Zeilen
  const region = async (r, q = '') => {
    await p.click('#screener [data-preset="all"]'); await p.waitForTimeout(150);
    if (!(await p.$eval('#screener details.scr-more', e => e.open))) await p.click('#screener details.scr-more summary');
    await p.selectOption('#scRegion', r); await p.fill('#scQ', q); await p.click('#screener [data-act="scApply"]'); await p.waitForTimeout(250);
    return p.$$eval('#screener tbody tr td:first-child [data-open]', l => [...new Set(l.map(e => e.dataset.open))]);   // Kürzel und Name: je Zeile einmal
  };
  const at = await region('at');
  check(at.length === 2 && at.includes('ABS2.DE') && at.includes('EBO.DE'), `Österreich: Porr und Erste (${at.join(', ')})`);
  const de = await region('de');
  check(de.includes('MUV2.DE') && de.includes('SAP.DE') && !de.includes('ABS2.DE') && de.every(s => s.endsWith('.DE')), `Deutschland: deutsche Werte, ohne die österreichischen auf Xetra (${de.length})`);
  const ch = await region('ch');
  check(ch.includes('NOVN.ZU') && ch.every(s => /\.(ZU|SW)$/.test(s)), `Schweiz (${ch.join(', ')})`);
  const usB = await region('us', 'BRK'), euB = await region('eu', 'BRK'), euL = await region('eu', 'Rolls'), euP = await region('eu', 'Porr');
  check(usB.includes('BRK.B') && !euB.includes('BRK.B') && euL.includes('RR.L') && euP.includes('ABS2.DE'), `BRK.B zählt zu den USA, London und Xetra zu Europa (${usB}, ${euB}, ${euL}, ${euP})`);

  check(!errs.length, `Keine Skriptfehler${errs.length ? ': ' + errs.join(' | ') : ''}`);
  await b.close();
  console.log(fails.length ? `\n${fails.length} FEHLER` : '\nALLES OK');
  process.exit(fails.length ? 1 : 0);
})();

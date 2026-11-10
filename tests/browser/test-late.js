// Browser-Test (Playwright) – läuft in der Rechenkontrolle über tests/browser/run.sh
// Aktien-Check bei langsamem Netz: Kommen die Aktien-Daten erst nach dem Öffnen an, zeigt die Seite den zuletzt gewählten Wert
// danach mit Kennzahlen und Marken und zeichnet das Diagramm einmal. Lädt TradingView langsam, während die Seite neu zeichnet,
// entsteht trotzdem nur ein Diagramm. node test-late.js <port> <ausgabe>
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const stocks = fs.readFileSync(path.join(__dirname, 'fixtures', 'stocks.json'), 'utf8');
// tv.js-Ersatz: merkt sich jedes Diagramm und hängt wie TradingView ein Element in den Behälter
const tvStub = 'window.TradingView = { widget: function (c) { (window.__tv = window.__tv || []).push(c.symbol); var el = document.getElementById(c.container_id); if (el) el.appendChild(document.createElement("div")).className = "tv-stub"; } };';
const wait = ms => new Promise(res => setTimeout(res, ms));

(async () => {
  const [port] = process.argv.slice(2);
  const b = await chromium.launch(), errs = [], fails = [];
  const check = (ok, msg) => { console.log(`${ok ? '✓' : '✗'} ${msg}`); if (!ok) fails.push(msg); };
  async function open({ dataDelay = 0, tvDelay = 0 }) {
    const p = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    p.on('pageerror', e => errs.push(e.message));
    await p.addInitScript(() => localStorage.setItem('dtd-stock', JSON.stringify('TSLA')));
    await p.route('**/stock-data/stocks.json*', async r => { if (dataDelay) await wait(dataDelay); await r.fulfill({ status: 200, contentType: 'application/json', body: stocks }); });
    await p.route('https://s3.tradingview.com/tv.js', async r => { if (tvDelay) await wait(tvDelay); await r.fulfill({ status: 200, contentType: 'application/javascript', body: tvStub }); });
    // Marktlage und andere Dateien weglassen: Die Prüfung soll nicht vom Netz abhängen
    await p.route(/tradingview\.com\/external-embedding|finnhub\.io|live-data|news-data|fund-data|note-|swing\.json/, r => r.abort());
    await p.goto(`http://localhost:${port}/#aktie`, { waitUntil: 'load' });
    return p;
  }
  const state = p => p.evaluate(() => ({
    name: (document.querySelector('#stockBody .stock-name') || {}).textContent || '–',
    lvl: !!document.querySelector('#skTools [data-ind="lvl"]'),
    draws: (window.__tv || []).filter(s => /TSLA/.test(s)).length,
    stubs: document.querySelectorAll('#skChart .tv-stub').length,
  }));

  for (const [label, dataDelay] of [['Daten nach 2,5 s', 2500], ['Daten sofort', 0]]) {
    const p = await open({ dataDelay });
    await p.waitForSelector('#skTools [data-ind="lvl"]', { timeout: 15000 }).catch(() => null);
    await p.waitForTimeout(800);
    const s = await state(p);
    check(s.lvl && /Tesla/i.test(s.name), `${label}: TSLA mit Daten gezeigt (${s.name}, Marken ${s.lvl ? 'da' : 'fehlen'})`);
    check(s.draws === 1 && s.stubs === 1, `${label}: Diagramm ${s.draws}× gezeichnet, ${s.stubs} im Behälter`);
    await p.context().close();
  }

  // TradingView kommt erst nach 2 s, inzwischen wird umgeschaltet (neu gezeichnet): am Ende genau ein Diagramm
  const p = await open({ tvDelay: 2000 });
  await p.waitForSelector('#skTools [data-cstyle="2"]', { timeout: 15000 });
  await p.click('#skTools [data-cstyle="2"]');
  await p.waitForTimeout(3000);
  const s = await state(p);
  check(s.draws === 1 && s.stubs === 1, `Langsames TradingView und Umschalten: ${s.draws}× gezeichnet, ${s.stubs} im Behälter`);

  check(!errs.length, `Keine Skriptfehler${errs.length ? ': ' + errs.join(' | ') : ''}`);
  await b.close();
  console.log(fails.length ? `\n${fails.length} FEHLER` : '\nALLES OK');
  process.exit(fails.length ? 1 : 0);
})();

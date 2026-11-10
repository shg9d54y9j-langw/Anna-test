// Browser-Test (Playwright) – läuft in der Rechenkontrolle über tests/browser/run.sh
// Depot in Euro: EZB-Kurse nur laden, wenn eine Aktie in Fremdwährung im Depot liegt; Depotwert und Ergebnis in Euro mit Kurs- und
// Währungseffekt (gegengerechnet), Zeile je Aktie, Positionen ohne Stückzahl außen vor, Steuer-Schätzer in Euro zum Kurs am
// Verkaufstag. node test-euro.js <port> <ausgabe>
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const stocks = fs.readFileSync(path.join(__dirname, 'fixtures', 'stocks.json'), 'utf8');
const fxBody = fs.readFileSync(path.join(process.env.FIXTURES_TMP || '/tmp/rojko-fixtures', 'fx.json'), 'utf8');
const FX = JSON.parse(fxBody), ST = JSON.parse(stocks);
const rate = (cur, iso) => { if (cur === 'EUR') return 1; let i = FX.dates.length - 1; while (i > 0 && FX.dates[i] > iso) i--; return FX.rates[cur][i]; };
const last = sym => ST.items.find(x => x.sym === sym).last;
const de = (v, d) => v.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
const eur = (v, sign) => `${sign ? (v < 0 ? '−' : v > 0 ? '+' : '±') : v < 0 ? '−' : ''}${de(Math.abs(v), Math.abs(v) >= 1000 ? 0 : 2)} €`;

(async () => {
  const [port, out] = process.argv.slice(2);
  const b = await chromium.launch(), errs = [], fails = [];
  const check = (ok, msg) => { console.log(`${ok ? '✓' : '✗'} ${msg}`); if (!ok) fails.push(msg); };
  async function page(seed) {
    const p = await (await b.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Europe/Vienna', locale: 'de-AT' })).newPage();
    const fxReq = [];
    p.on('pageerror', e => errs.push(e.message));
    await p.addInitScript(s => { if (localStorage.getItem('seeded')) return; localStorage.setItem('seeded', '1'); for (const [k, v] of Object.entries(s)) localStorage.setItem(k, JSON.stringify(v)); }, seed);
    await p.route('**/stock-data/stocks.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: stocks }));
    await p.route('**/fx-data/fx.json*', r => { fxReq.push(r.request().url()); r.fulfill({ status: 200, contentType: 'application/json', body: fxBody }); });
    await p.route(/tradingview|finnhub\.io|news-data|fund-data|note-|swing\.json|live-data/, r => r.abort());
    await p.goto(`http://localhost:${port}/#portfolio`, { waitUntil: 'load' });
    await p.waitForSelector('#portfolioBody [data-section="Überblick"]', { timeout: 15000 });
    await p.waitForTimeout(1200);
    return { p, fxReq };
  }
  const text = (p, sel) => p.$eval(sel, e => e.innerText.replace(/\s+/g, ' ')).catch(() => '');

  // Erwartung nachrechnen: NVDA 10 Stück zu 150 USD am 2.1.2026, SAP.DE 4 Stück zu 200 EUR, AAPL ohne Stückzahl
  const rB = rate('USD', '2026-01-02'), rN = rate('USD', '2026-11-09');
  const nv = { value: 10 * last('NVDA') / rN, cost: 10 * 150 / rB };
  nv.gain = nv.value - nv.cost; nv.fx = 10 * last('NVDA') * (1 / rN - 1 / rB); nv.stock = nv.gain - nv.fx;
  const sap = { value: 4 * last('SAP.DE'), cost: 800 }; sap.gain = sap.value - sap.cost;
  const { p, fxReq } = await page({
    'dtd-portfolio': [{ id: 'a', sym: 'NVDA', buy: 150, qty: 10, date: '2026-01-02' }, { id: 'b', sym: 'SAP.DE', buy: 200, qty: 4, date: '2026-03-02' }, { id: 'c', sym: 'AAPL', buy: 180 }],
    'daytrade-journal-v1': [{ id: 'j1', ts: '2026-11-02T10:00:00Z', date: '02.11.', sym: 'AMD', dir: 'Long', in: 100, out: 120, qty: 3, note: '' }],
  });
  check(fxReq.length === 1, `EZB-Kurse einmal geladen (${fxReq.length})`);
  const sum = await text(p, '#portfolioBody [data-section="Überblick"]');
  console.log('  Übersicht:', sum.slice(0, 400));
  check(sum.includes(`Depotwert in Euro ${eur(nv.value + sap.value)}`), `Depotwert in Euro ${eur(nv.value + sap.value)}`);
  check(sum.includes(`Ergebnis in Euro ${eur(nv.gain + sap.gain, true)}`), `Ergebnis in Euro ${eur(nv.gain + sap.gain, true)}`);
  check(sum.includes(`= Kurs ${eur(nv.stock + sap.gain, true)} + Währung ${eur(nv.fx, true)}`) && /1 Position ohne Stückzahl oder Währung nicht enthalten/.test(sum), 'Aufteilung in Kurs und Währung, AAPL ohne Stückzahl außen vor');
  const nvRow = await text(p, '#portfolioBody .pf-card[data-id="a"] .pf-eur');
  check(nvRow === `In Euro: Wert ${eur(nv.value)} · Ergebnis ${eur(nv.gain, true)} (Kurs ${eur(nv.stock, true)}, Währung ${eur(nv.fx, true)})`, `NVDA in Euro: ${nvRow}`);
  const sapRow = await text(p, '#portfolioBody .pf-card[data-id="b"] .pf-eur');
  check(sapRow === `In Euro: Wert ${eur(sap.value)} · Ergebnis ${eur(sap.gain, true)}`, `SAP.DE ohne Währungsteil: ${sapRow}`);
  check(!(await p.$('#portfolioBody .pf-card[data-id="c"] .pf-eur')), 'AAPL ohne Stückzahl: keine Euro-Zeile');
  // Steuer-Schätzer: AMD +60 USD am 2.11.2026 → Euro
  const tax = await text(p, '#pfTax');
  const amd = 60 / rate('USD', '2026-11-02');
  check(/in Euro umgerechnet zum EZB-Referenzkurs am Verkaufstag/i.test(tax) && tax.includes(`${de(amd, 2)} €`), `Steuer-Schätzer in Euro (${de(amd, 2)} €)`);
  try { await (await p.$('#portfolioBody [data-section="Überblick"]')).screenshot({ path: `${out}/euro-summary.png` }); } catch { /* Bildschirmfoto nur zur Ansicht */ }

  // nur Euro-Aktien: keine Kurse laden
  const e = await page({ 'dtd-portfolio': [{ id: 'b', sym: 'SAP.DE', buy: 200, qty: 4 }] });
  check(e.fxReq.length === 0 && /Depotwert in Euro/.test(await text(e.p, '#portfolioBody [data-section="Überblick"]')), 'nur Euro-Aktien: keine EZB-Kurse nötig, Euro-Werte trotzdem da');

  check(!errs.length, `Keine Skriptfehler${errs.length ? ': ' + errs.join(' | ') : ''}`);
  await b.close();
  console.log(fails.length ? `\n${fails.length} FEHLER` : '\nALLES OK');
  process.exit(fails.length ? 1 : 0);
})();
